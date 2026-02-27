import { LoreBookEntry, RagChunk, RagChunkEmbedding, RagDocument } from './models';
import { normalizeScope } from './lorebook-scoping';

export interface ScopeContextPack {
  scope: string;
  worldInfoEntries: LoreBookEntry[];
  ragDocuments: RagDocument[];
  ragChunks: RagChunk[];
  ragChunkEmbeddings: RagChunkEmbedding[];
  builtAt: number;
}

export interface ContextQueryOptions {
  queryText: string;
  tokenBudget: number;
  maxWorldInfoEntries?: number;
  maxRagDocuments?: number;
  worldInfoBudgetRatio?: number;
  ragSemanticBoostByDocUid?: {[key: number]: number};
  maxGraphHops?: number;
  graphHopDecay?: number;
  ragFallbackPolicy?: 'off' | 'auto' | 'always';
  ragFallbackSeedScoreThreshold?: number;
}

export type WorldInfoContentTier = 'short' | 'medium' | 'full';

export interface WorldInfoScoreBreakdown {
  seed: number;
  graph: number;
  constant: number;
  order: number;
  total: number;
}

export interface SelectedWorldInfoEntry {
  entry: LoreBookEntry;
  score: number;
  matchedKeywords: string[];
  reasons: string[];
  seedUid: number | null;
  pathUids: number[];
  hopDistance: number;
  scoreBreakdown: WorldInfoScoreBreakdown;
  contentTier: WorldInfoContentTier;
  includedContent: string;
}

export interface SelectedRagDocument {
  document: RagDocument;
  score: number;
  matchedTerms: string[];
}

export interface AssembledContext {
  scope: string;
  queryText: string;
  tokenBudget: number;
  usedTokens: number;
  worldInfo: SelectedWorldInfoEntry[];
  rag: SelectedRagDocument[];
  markdown: string;
  explainability: {
    seeds: Array<{
      uid: number;
      comment: string;
      score: number;
      matchedKeywords: string[];
      reasons: string[];
    }>;
    worldInfoBudget: {
      budget: number;
      used: number;
      droppedByBudget: number;
      droppedByLimit: number;
      droppedUids: number[];
    };
    rag: {
      policy: 'off' | 'auto' | 'always';
      enabled: boolean;
      seedConfidence: number;
      threshold: number;
    };
  };
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function normalizeText(value: string): string {
  return value.toLowerCase();
}

function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  const matches = normalized.match(/[a-z0-9][a-z0-9_-]*/g);
  if (!matches) {
    return [];
  }
  return [...new Set(matches.filter(token => token.length >= 2))];
}

function normalizeLinkTarget(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/#.*$/, '')
    .replace(/\.md$/i, '')
    .trim();
}

function getBasename(linkTarget: string): string {
  const normalized = normalizeLinkTarget(linkTarget);
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : normalized;
}

function sortWorldInfoByScore(a: SelectedWorldInfoEntry, b: SelectedWorldInfoEntry): number {
  return (
    b.score - a.score ||
    a.hopDistance - b.hopDistance ||
    b.entry.order - a.entry.order ||
    a.entry.uid - b.entry.uid
  );
}

function sortRagByScore(a: SelectedRagDocument, b: SelectedRagDocument): number {
  return (
    b.score - a.score ||
    a.document.path.localeCompare(b.document.path) ||
    a.document.title.localeCompare(b.document.title) ||
    a.document.uid - b.document.uid
  );
}

function uniqueKeywords(entry: LoreBookEntry): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const keyword of [...entry.key, ...entry.keysecondary]) {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    values.push(normalized);
  }
  return values;
}

interface SeedMatch {
  uid: number;
  matchedKeywords: string[];
  reasons: string[];
  score: number;
}

interface GraphCandidate {
  entry: LoreBookEntry;
  seedScore: number;
  graphScore: number;
  bestGraphContribution: number;
  matchedKeywords: string[];
  reasons: string[];
  seedUid: number | null;
  pathUids: number[];
  hopDistance: number;
}

const TITLE_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'into', 'from', 'that', 'this', 'then', 'when', 'where', 'what', 'who', 'why',
  'how', 'chapter', 'scene', 'notes', 'story', 'entry', 'world'
]);

function formatScore(score: number): string {
  return score.toFixed(2).replace(/\.?0+$/, '');
}

function computeContentTierContent(content: string, tier: WorldInfoContentTier): string {
  const cleaned = content.trim();
  if (!cleaned) {
    return cleaned;
  }

  if (tier === 'full') {
    return cleaned;
  }

  const maxChars = tier === 'short' ? 260 : 900;
  if (cleaned.length <= maxChars) {
    return cleaned;
  }

  const boundary = cleaned.slice(0, maxChars + 1).lastIndexOf(' ');
  const cut = boundary >= Math.floor(maxChars * 0.6) ? boundary : maxChars;
  return `${cleaned.slice(0, cut).trimEnd()}\n...`;
}

function renderWorldInfoSection(
  entry: LoreBookEntry,
  matchedKeywords: string[],
  contentTier: WorldInfoContentTier,
  includedContent: string
): string {
  const keywordSuffix = matchedKeywords.length > 0
    ? `Matched: ${matchedKeywords.join(', ')}`
    : 'Matched: (graph/constant/order)';
  return [
    `### ${entry.comment}`,
    `Keys: ${entry.key.join(', ')}`,
    `Tier: ${contentTier}`,
    keywordSuffix,
    '',
    includedContent.trim()
  ].join('\n');
}

function detectSeedMatches(entries: LoreBookEntry[], queryText: string): SeedMatch[] {
  const normalizedQuery = normalizeText(queryText);
  const tokenSet = new Set(tokenize(queryText));
  const scored: SeedMatch[] = [];

  for (const entry of entries) {
    const keywords = uniqueKeywords(entry);
    const matchedKeywords = keywords.filter(keyword => {
      if (keyword.includes(' ')) {
        return normalizedQuery.includes(keyword);
      }
      return tokenSet.has(keyword);
    });

    let score = 0;
    const reasons: string[] = [];
    for (const keyword of matchedKeywords) {
      if (keyword.includes(' ')) {
        score += 150;
        reasons.push(`seed:keyword phrase "${keyword}" (+150)`);
      } else {
        score += 120;
        reasons.push(`seed:keyword token "${keyword}" (+120)`);
      }
    }

    const title = normalizeText(entry.comment.trim());
    if (title && title.length >= 3 && normalizedQuery.includes(title)) {
      score += 70;
      reasons.push(`seed:title phrase "${title}" (+70)`);
    } else if (title) {
      const titleMatches = tokenize(title)
        .filter(token => token.length >= 4 && !TITLE_STOPWORDS.has(token) && tokenSet.has(token));
      if (titleMatches.length > 0) {
        const titleScore = titleMatches.length * 18;
        score += titleScore;
        reasons.push(`seed:title tokens ${titleMatches.join(', ')} (+${titleScore})`);
      }
    }

    if (score <= 0) {
      continue;
    }

    scored.push({
      score,
      uid: entry.uid,
      matchedKeywords,
      reasons
    });
  }

  return scored.sort((a, b) => b.score - a.score || a.uid - b.uid);
}

function comparePaths(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  for (let index = 0; index < len; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }
  return a.length - b.length;
}

function buildWorldInfoGraph(entries: LoreBookEntry[]): Map<number, number[]> {
  const adjacency = new Map<number, number[]>();
  const targetToUids = new Map<string, number[]>();

  const addTarget = (target: string, uid: number): void => {
    const normalized = normalizeLinkTarget(target);
    if (!normalized) {
      return;
    }
    const existing = targetToUids.get(normalized) ?? [];
    if (!existing.includes(uid)) {
      existing.push(uid);
      existing.sort((a, b) => a - b);
      targetToUids.set(normalized, existing);
    }
  };

  for (const entry of entries) {
    const terms = [entry.comment, ...entry.key, ...entry.keysecondary];
    for (const term of terms) {
      const normalized = normalizeLinkTarget(term);
      if (!normalized) {
        continue;
      }
      addTarget(normalized, entry.uid);
      const basename = getBasename(normalized);
      if (basename && basename !== normalized) {
        addTarget(basename, entry.uid);
      }
      if (normalized.includes(' ')) {
        addTarget(normalized.replace(/ /g, '-'), entry.uid);
        addTarget(normalized.replace(/ /g, '_'), entry.uid);
      }
    }
  }

  for (const entry of entries) {
    const neighbors = new Set<number>();
    const links = entry.wikilinks ?? [];
    for (const link of links) {
      const normalized = normalizeLinkTarget(link);
      if (!normalized) {
        continue;
      }

      const candidates = [
        ...(targetToUids.get(normalized) ?? []),
        ...(targetToUids.get(getBasename(normalized)) ?? [])
      ];
      for (const candidateUid of candidates) {
        if (candidateUid !== entry.uid) {
          neighbors.add(candidateUid);
        }
      }
    }

    adjacency.set(entry.uid, [...neighbors].sort((a, b) => a - b));
  }

  return adjacency;
}

function scoreWorldInfoEntries(
  entries: LoreBookEntry[],
  queryText: string,
  maxGraphHops: number,
  graphHopDecay: number
): {
  seeds: SeedMatch[];
  candidates: SelectedWorldInfoEntry[];
} {
  const byUid = new Map<number, LoreBookEntry>(entries.map(entry => [entry.uid, entry]));
  const seeds = detectSeedMatches(entries, queryText);
  const adjacency = buildWorldInfoGraph(entries);
  const aggregates = new Map<number, GraphCandidate>();

  const ensureAggregate = (entry: LoreBookEntry): GraphCandidate => {
    const existing = aggregates.get(entry.uid);
    if (existing) {
      return existing;
    }
    const created: GraphCandidate = {
      entry,
      seedScore: 0,
      graphScore: 0,
      bestGraphContribution: -1,
      matchedKeywords: [],
      reasons: [],
      seedUid: null,
      pathUids: [],
      hopDistance: Number.POSITIVE_INFINITY
    };
    aggregates.set(entry.uid, created);
    return created;
  };

  type QueueItem = {
    uid: number;
    seedUid: number;
    score: number;
    depth: number;
    pathUids: number[];
  };

  const queue: QueueItem[] = [];
  for (const seed of seeds) {
    const entry = byUid.get(seed.uid);
    if (!entry) {
      continue;
    }

    const aggregate = ensureAggregate(entry);
    const previousSeedScore = aggregate.seedScore;
    aggregate.seedScore += seed.score;
    aggregate.matchedKeywords = [...new Set([...aggregate.matchedKeywords, ...seed.matchedKeywords])]
      .sort((a, b) => a.localeCompare(b));
    aggregate.reasons.push(...seed.reasons);

    const betterSeed = (
      aggregate.seedUid === null ||
      seed.score > previousSeedScore ||
      (seed.score === previousSeedScore && seed.uid < aggregate.seedUid)
    );
    if (betterSeed) {
      aggregate.seedUid = seed.uid;
      aggregate.pathUids = [seed.uid];
      aggregate.hopDistance = 0;
    }

    if (maxGraphHops > 0) {
      queue.push({
        uid: seed.uid,
        seedUid: seed.uid,
        score: seed.score,
        depth: 0,
        pathUids: [seed.uid]
      });
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    if (current.depth >= maxGraphHops) {
      continue;
    }

    const neighbors = adjacency.get(current.uid) ?? [];
    for (const neighborUid of neighbors) {
      if (current.pathUids.includes(neighborUid)) {
        continue;
      }

      const neighborEntry = byUid.get(neighborUid);
      if (!neighborEntry) {
        continue;
      }

      const nextDepth = current.depth + 1;
      const contribution = current.score * graphHopDecay;
      if (contribution <= 0.5) {
        continue;
      }

      const pathUids = [...current.pathUids, neighborUid];
      const aggregate = ensureAggregate(neighborEntry);
      aggregate.graphScore += contribution;
      aggregate.reasons.push(
        `graph:path ${pathUids.join(' -> ')} (hop ${nextDepth}, +${formatScore(contribution)})`
      );

      const shouldReplacePath = (
        aggregate.pathUids.length === 0 ||
        nextDepth < aggregate.hopDistance ||
        (nextDepth === aggregate.hopDistance && contribution > aggregate.bestGraphContribution) ||
        (nextDepth === aggregate.hopDistance && contribution === aggregate.bestGraphContribution && comparePaths(pathUids, aggregate.pathUids) < 0)
      );
      if (shouldReplacePath) {
        aggregate.seedUid = current.seedUid;
        aggregate.pathUids = pathUids;
        aggregate.hopDistance = nextDepth;
        aggregate.bestGraphContribution = contribution;
      }

      if (nextDepth < maxGraphHops) {
        queue.push({
          uid: neighborUid,
          seedUid: current.seedUid,
          score: contribution,
          depth: nextDepth,
          pathUids
        });
      }
    }
  }

  const scored: SelectedWorldInfoEntry[] = [];
  for (const entry of entries) {
    const aggregate = aggregates.get(entry.uid);
    const seedScore = aggregate?.seedScore ?? 0;
    const graphScore = aggregate?.graphScore ?? 0;
    const constantBoost = entry.constant ? 30 : 0;
    const orderBoost = Math.max(0, entry.order) * 0.01;
    const total = seedScore + graphScore + constantBoost + orderBoost;

    if (total <= 0) {
      continue;
    }

    const hopDistance = Number.isFinite(aggregate?.hopDistance)
      ? (aggregate?.hopDistance ?? 0)
      : Number.MAX_SAFE_INTEGER;
    const reasons = aggregate
      ? [...new Set(aggregate.reasons)].sort((a, b) => a.localeCompare(b))
      : [];
    const matchedKeywords = aggregate?.matchedKeywords ?? [];

    scored.push({
      entry,
      score: total,
      matchedKeywords,
      reasons,
      seedUid: aggregate?.seedUid ?? null,
      pathUids: aggregate?.pathUids ?? [],
      hopDistance,
      scoreBreakdown: {
        seed: seedScore,
        graph: graphScore,
        constant: constantBoost,
        order: orderBoost,
        total
      },
      contentTier: 'short',
      includedContent: computeContentTierContent(entry.content, 'short')
    });
  }

  return {
    seeds,
    candidates: scored.sort(sortWorldInfoByScore)
  };
}

function scoreRagDocuments(
  documents: RagDocument[],
  queryText: string,
  ragSemanticBoostByDocUid?: {[key: number]: number}
): SelectedRagDocument[] {
  const normalizedQuery = normalizeText(queryText);
  const tokens = tokenize(queryText);
  const tokenSet = new Set(tokens);
  const scored: SelectedRagDocument[] = [];

  for (const document of documents) {
    const normalizedTitle = normalizeText(document.title);
    const normalizedPath = normalizeText(document.path);
    const normalizedContent = normalizeText(document.content);
    const matchedTerms: string[] = [];
    let score = 0;

    for (const token of tokenSet) {
      if (normalizedTitle.includes(token)) {
        score += 40;
        matchedTerms.push(token);
        continue;
      }
      if (normalizedPath.includes(token)) {
        score += 20;
        matchedTerms.push(token);
        continue;
      }
      if (normalizedContent.includes(token)) {
        score += 10;
        matchedTerms.push(token);
      }
    }

    if (normalizedContent.includes(normalizedQuery) && normalizedQuery.length >= 4) {
      score += 25;
    }

    const semanticBoost = ragSemanticBoostByDocUid?.[document.uid] ?? 0;
    score += semanticBoost;

    if (score <= 0) {
      continue;
    }

    scored.push({
      document,
      score,
      matchedTerms: [...new Set(matchedTerms)].sort((a, b) => a.localeCompare(b))
    });
  }

  return scored.sort(sortRagByScore);
}

function trimRagContent(content: string): string {
  const cleaned = content.trim();
  if (cleaned.length <= 1200) {
    return cleaned;
  }
  return `${cleaned.slice(0, 1200).trimEnd()}\n...`;
}

function renderRagSection(document: SelectedRagDocument): string {
  const matched = document.matchedTerms.length > 0
    ? `Matched terms: ${document.matchedTerms.join(', ')}`
    : 'Matched terms: -';
  return [
    `### ${document.document.title}`,
    `Source: \`${document.document.path}\``,
    matched,
    '',
    trimRagContent(document.document.content)
  ].join('\n');
}

export function assembleScopeContext(
  pack: ScopeContextPack,
  options: ContextQueryOptions
): AssembledContext {
  const tokenBudget = Math.max(128, Math.floor(options.tokenBudget));
  const worldInfoRatio = Math.min(0.95, Math.max(0.05, options.worldInfoBudgetRatio ?? 0.7));
  const worldInfoBudget = Math.max(0, Math.floor(tokenBudget * worldInfoRatio));
  const ragBudget = Math.max(0, tokenBudget - worldInfoBudget);
  const maxWorldInfoEntries = options.maxWorldInfoEntries ?? 8;
  const maxRagDocuments = options.maxRagDocuments ?? 6;
  const maxGraphHops = Math.max(0, Math.min(3, Math.floor(options.maxGraphHops ?? 2)));
  const graphHopDecay = Math.max(0.2, Math.min(0.9, Number(options.graphHopDecay ?? 0.55)));
  const ragFallbackPolicy = options.ragFallbackPolicy ?? 'auto';
  const ragFallbackSeedScoreThreshold = Math.max(1, Math.floor(options.ragFallbackSeedScoreThreshold ?? 120));

  const scoredWorldInfo = scoreWorldInfoEntries(
    pack.worldInfoEntries,
    options.queryText,
    maxGraphHops,
    graphHopDecay
  );
  const worldInfoCandidates = scoredWorldInfo.candidates;
  const ragCandidates = scoreRagDocuments(
    pack.ragDocuments,
    options.queryText,
    options.ragSemanticBoostByDocUid
  );

  const droppedByLimit = worldInfoCandidates
    .slice(maxWorldInfoEntries)
    .map(candidate => candidate.entry.uid);
  const candidatePool = worldInfoCandidates.slice(0, maxWorldInfoEntries);
  const selectedWorldInfo: SelectedWorldInfoEntry[] = [];
  const droppedByBudget: number[] = [];
  let usedWorldInfoTokens = 0;
  for (const candidate of candidatePool) {
    const shortContent = computeContentTierContent(candidate.entry.content, 'short');
    const section = renderWorldInfoSection(
      candidate.entry,
      candidate.matchedKeywords,
      'short',
      shortContent
    );
    const sectionTokens = estimateTokens(section);
    if (usedWorldInfoTokens + sectionTokens > worldInfoBudget) {
      droppedByBudget.push(candidate.entry.uid);
      continue;
    }

    selectedWorldInfo.push({
      ...candidate,
      contentTier: 'short',
      includedContent: shortContent
    });
    usedWorldInfoTokens += sectionTokens;
  }

  // Upgrade included entries from short -> medium -> full while staying in budget.
  for (const tier of ['medium', 'full'] as WorldInfoContentTier[]) {
    for (let index = 0; index < selectedWorldInfo.length; index += 1) {
      const candidate = selectedWorldInfo[index];
      if (candidate.contentTier === tier) {
        continue;
      }

      const upgradedContent = computeContentTierContent(candidate.entry.content, tier);
      if (upgradedContent === candidate.includedContent) {
        candidate.contentTier = tier;
        continue;
      }

      const currentSection = renderWorldInfoSection(
        candidate.entry,
        candidate.matchedKeywords,
        candidate.contentTier,
        candidate.includedContent
      );
      const nextSection = renderWorldInfoSection(
        candidate.entry,
        candidate.matchedKeywords,
        tier,
        upgradedContent
      );
      const delta = estimateTokens(nextSection) - estimateTokens(currentSection);
      if (delta <= 0 || usedWorldInfoTokens + delta <= worldInfoBudget) {
        selectedWorldInfo[index] = {
          ...candidate,
          contentTier: tier,
          includedContent: upgradedContent
        };
        usedWorldInfoTokens += Math.max(0, delta);
      }
    }
  }

  const seedConfidence = scoredWorldInfo.seeds[0]?.score ?? 0;
  const ragEnabled = ragFallbackPolicy === 'always' || (
    ragFallbackPolicy === 'auto' &&
    (selectedWorldInfo.length === 0 || seedConfidence < ragFallbackSeedScoreThreshold)
  );

  const selectedRag: SelectedRagDocument[] = [];
  let usedRagTokens = 0;
  if (ragEnabled && ragBudget > 0) {
    for (const candidate of ragCandidates) {
      if (selectedRag.length >= maxRagDocuments) {
        break;
      }
      const section = renderRagSection(candidate);
      const sectionTokens = estimateTokens(section);
      if (usedRagTokens + sectionTokens > ragBudget) {
        continue;
      }
      selectedRag.push(candidate);
      usedRagTokens += sectionTokens;
    }
  }

  const worldInfoSections = selectedWorldInfo.map(entry => renderWorldInfoSection(
    entry.entry,
    entry.matchedKeywords,
    entry.contentTier,
    entry.includedContent
  ));
  const ragSections = selectedRag.map(renderRagSection);
  const scopeLabel = normalizeScope(pack.scope) || '(all)';
  const markdown = [
    `## LoreVault Context`,
    `Scope: \`${scopeLabel}\``,
    `Query: ${options.queryText.trim() || '(empty)'}`,
    '',
    '### world_info',
    worldInfoSections.length > 0 ? worldInfoSections.join('\n\n---\n\n') : '_No matching world_info entries._',
    '',
    '### rag',
    ragSections.length > 0 ? ragSections.join('\n\n---\n\n') : '_No matching rag documents._'
  ].join('\n');

  return {
    scope: pack.scope,
    queryText: options.queryText,
    tokenBudget,
    usedTokens: usedWorldInfoTokens + usedRagTokens,
    worldInfo: selectedWorldInfo,
    rag: selectedRag,
    markdown,
    explainability: {
      seeds: scoredWorldInfo.seeds.map(seed => ({
        uid: seed.uid,
        comment: pack.worldInfoEntries.find(entry => entry.uid === seed.uid)?.comment ?? `UID ${seed.uid}`,
        score: seed.score,
        matchedKeywords: [...seed.matchedKeywords],
        reasons: [...seed.reasons]
      })),
      worldInfoBudget: {
        budget: worldInfoBudget,
        used: usedWorldInfoTokens,
        droppedByBudget: droppedByBudget.length,
        droppedByLimit: droppedByLimit.length,
        droppedUids: [...droppedByBudget, ...droppedByLimit]
      },
      rag: {
        policy: ragFallbackPolicy,
        enabled: ragEnabled,
        seedConfidence,
        threshold: ragFallbackSeedScoreThreshold
      }
    }
  };
}
