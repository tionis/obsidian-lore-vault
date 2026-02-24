import { LoreBookEntry, RagDocument } from './models';
import { normalizeScope } from './lorebook-scoping';

export interface ScopeContextPack {
  scope: string;
  worldInfoEntries: LoreBookEntry[];
  ragDocuments: RagDocument[];
  builtAt: number;
}

export interface ContextQueryOptions {
  queryText: string;
  tokenBudget: number;
  maxWorldInfoEntries?: number;
  maxRagDocuments?: number;
  worldInfoBudgetRatio?: number;
}

export interface SelectedWorldInfoEntry {
  entry: LoreBookEntry;
  score: number;
  matchedKeywords: string[];
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

function sortWorldInfoByScore(a: SelectedWorldInfoEntry, b: SelectedWorldInfoEntry): number {
  return (
    b.score - a.score ||
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

function scoreWorldInfoEntries(entries: LoreBookEntry[], queryText: string): SelectedWorldInfoEntry[] {
  const normalizedQuery = normalizeText(queryText);
  const tokenSet = new Set(tokenize(queryText));
  const scored: SelectedWorldInfoEntry[] = [];

  for (const entry of entries) {
    const keywords = uniqueKeywords(entry);
    const matchedKeywords = keywords.filter(keyword => {
      if (keyword.includes(' ')) {
        return normalizedQuery.includes(keyword);
      }
      return tokenSet.has(keyword);
    });

    const keywordScore = matchedKeywords.length * 100;
    const constantBoost = entry.constant ? 30 : 0;
    const orderScore = Math.max(0, entry.order) * 0.01;
    const score = keywordScore + constantBoost + orderScore;

    if (score <= 0) {
      continue;
    }

    scored.push({
      entry,
      score,
      matchedKeywords
    });
  }

  return scored.sort(sortWorldInfoByScore);
}

function scoreRagDocuments(documents: RagDocument[], queryText: string): SelectedRagDocument[] {
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

function renderWorldInfoSection(entry: SelectedWorldInfoEntry): string {
  const keywordSuffix = entry.matchedKeywords.length > 0
    ? `Matched: ${entry.matchedKeywords.join(', ')}`
    : 'Matched: (constant)';
  return [
    `### ${entry.entry.comment}`,
    `Keys: ${entry.entry.key.join(', ')}`,
    keywordSuffix,
    '',
    entry.entry.content.trim()
  ].join('\n');
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
  const worldInfoRatio = options.worldInfoBudgetRatio ?? 0.6;
  const worldInfoBudget = Math.max(0, Math.floor(tokenBudget * worldInfoRatio));
  const ragBudget = Math.max(0, tokenBudget - worldInfoBudget);
  const maxWorldInfoEntries = options.maxWorldInfoEntries ?? 8;
  const maxRagDocuments = options.maxRagDocuments ?? 6;

  const worldInfoCandidates = scoreWorldInfoEntries(pack.worldInfoEntries, options.queryText);
  const ragCandidates = scoreRagDocuments(pack.ragDocuments, options.queryText);

  const selectedWorldInfo: SelectedWorldInfoEntry[] = [];
  let usedWorldInfoTokens = 0;
  for (const candidate of worldInfoCandidates) {
    if (selectedWorldInfo.length >= maxWorldInfoEntries) {
      break;
    }
    const section = renderWorldInfoSection(candidate);
    const sectionTokens = estimateTokens(section);
    if (usedWorldInfoTokens + sectionTokens > worldInfoBudget) {
      continue;
    }
    selectedWorldInfo.push(candidate);
    usedWorldInfoTokens += sectionTokens;
  }

  const selectedRag: SelectedRagDocument[] = [];
  let usedRagTokens = 0;
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

  const worldInfoSections = selectedWorldInfo.map(renderWorldInfoSection);
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
    markdown
  };
}
