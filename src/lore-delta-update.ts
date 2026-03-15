import { normalizeVaultPath } from './vault-path-utils';
import {
  StoryExtractionChunk,
  StoryExtractionChunkResult,
  splitStoryMarkdownIntoChunks
} from './story-extraction';
import {
  resolveNoteSummary,
  stripSummarySectionFromBody,
  upsertSummarySectionInMarkdown
} from './summary-utils';
import {
  buildStructuredWikiBody,
  deriveWikiTitleFromPageKey,
  sanitizeWikiTitle
} from './wiki-markdown-format';
import { stripInlineLoreDirectives } from './inline-directives';
import { buildSourceDiffPreview, SourceDiffPreview } from './source-diff';
import {
  mergeStructuredMarkdownBodies,
  normalizeManagedMarkdownBody
} from './wiki-note-merge';

export type LoreDeltaUpdatePolicy = 'section_merge' | 'rewrite_focused';

export interface LoreDeltaExistingPageInput {
  path: string;
  content: string;
}

export interface LoreDeltaOperation {
  pageKey: string;
  title: string;
  updateMode: 'merge' | 'rewrite';
  summary: string;
  keywords: string[];
  aliases: string[];
  content: string;
  confidence: number;
  rationale: string;
}

export interface LoreDeltaPlannedPage {
  path: string;
  content: string;
  previousContent: string | null;
  pageKey: string;
  action: 'create' | 'update';
  diff: LoreDeltaDiffPreview;
}

export interface LoreDeltaPlannedChange {
  path: string;
  pageKey: string;
  title: string;
  action: 'create' | 'update';
  confidence: number;
  rationales: string[];
  chunkIndices: number[];
  appliedOperations: number;
  skippedLowConfidence: number;
  diffAddedLines: number;
  diffRemovedLines: number;
  diffTruncated: boolean;
}

export type LoreDeltaConflictSeverity = 'low' | 'medium' | 'high';

export interface LoreDeltaConflict {
  id: string;
  path: string;
  pageKey: string;
  title: string;
  action: 'update';
  severity: LoreDeltaConflictSeverity;
  summary: string;
  diffAddedLines: number;
  diffRemovedLines: number;
}

export interface LoreDeltaResult {
  pages: LoreDeltaPlannedPage[];
  changes: LoreDeltaPlannedChange[];
  conflicts: LoreDeltaConflict[];
  chunks: StoryExtractionChunkResult[];
  warnings: string[];
  skippedLowConfidence: number;
}

export interface LoreDeltaProgressEvent {
  stage:
    | 'starting'
    | 'chunk_start'
    | 'chunk_success'
    | 'chunk_error'
    | 'rendering_pages'
    | 'completed';
  chunkIndex?: number;
  chunkTotal?: number;
  operationCount?: number;
  warning?: string;
  pageCount?: number;
  conflictCount?: number;
}

export interface LoreDeltaUpdateOptions {
  ideaMarkdown: string;
  ignoredCalloutTypes?: string[];
  newNoteFolder: string;
  defaultTagsRaw: string;
  lorebookScopes: string[];
  tagPrefix: string;
  updatePolicy: LoreDeltaUpdatePolicy;
  allowCreateNotes: boolean;
  maxChunkChars: number;
  maxOperationsPerChunk: number;
  maxExistingPagesInPrompt: number;
  focusedPagePaths: string[];
  maxFocusedPagesInPrompt: number;
  maxFocusedPageChars: number;
  lowConfidenceThreshold: number;
  existingPages: LoreDeltaExistingPageInput[];
  callModel: (systemPrompt: string, userPrompt: string) => Promise<string>;
  onProgress?: (event: LoreDeltaProgressEvent) => void;
}

export type LoreDeltaDiffPreview = SourceDiffPreview;

interface SplitFrontmatter {
  frontmatter: string | null;
  body: string;
}

interface PageState {
  path: string;
  pageKey: string;
  title: string;
  summary: string;
  summaryConfidence: number;
  keywords: string[];
  aliases: string[];
  tags: string[];
  originalContent: string;
  originalFrontmatter: string | null;
  originalBody: string;
  preservedFrontmatterLines: string[];
  bodyText: string;
  created: boolean;
  touched: boolean;
  maxConfidence: number;
  rationales: string[];
  chunkIndices: Set<number>;
  appliedOperations: number;
  skippedLowConfidence: number;
}

const MANAGED_FRONTMATTER_KEYS = new Set<string>([
  'title',
  'summary',
  'pagekey',
  'keywords',
  'aliases',
  'tags',
  'sourcetype'
]);

function normalizeTagPrefix(tagPrefix: string): string {
  const normalized = tagPrefix.trim().replace(/^#+/, '').replace(/^\/+|\/+$/g, '');
  return normalized || 'lorebook';
}

function normalizeLorebookScope(scope: string): string {
  return scope
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/[^a-z0-9/_\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/-+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '');
}

function normalizeTagValue(value: string): string {
  return value
    .trim()
    .replace(/^#+/, '')
    .replace(/^\/+|\/+$/g, '');
}

function parseDefaultTags(raw: string): string[] {
  const tags = raw
    .split(/[\n,]+/)
    .map(normalizeTagValue)
    .filter(Boolean);
  return uniqueStrings(tags);
}

function uniqueStrings(values: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const item of values) {
    const normalized = item.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}

function normalizePageKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/-+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '');
}

function normalizeTextKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function toSafeFileStem(value: string): string {
  const withoutControls = [...value]
    .filter(char => char.charCodeAt(0) >= 32)
    .join('');
  const normalized = withoutControls
    .trim()
    .toLowerCase()
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/[^a-z0-9._ -]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return normalized || 'entry';
}

function normalizeSummaryLine(value: string): string {
  return value
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function choosePreferredSummary(
  existing: string,
  existingConfidence: number,
  incoming: string,
  incomingConfidence: number
): { summary: string; confidence: number } {
  const normalizedIncoming = normalizeSummaryLine(incoming);
  if (!normalizedIncoming) {
    return {
      summary: existing,
      confidence: existingConfidence
    };
  }

  const normalizedExisting = normalizeSummaryLine(existing);
  if (!normalizedExisting) {
    return {
      summary: normalizedIncoming,
      confidence: incomingConfidence
    };
  }

  const lowerExisting = normalizedExisting.toLowerCase();
  const lowerIncoming = normalizedIncoming.toLowerCase();
  if (lowerExisting === lowerIncoming) {
    return {
      summary: normalizedIncoming,
      confidence: Math.max(existingConfidence, incomingConfidence)
    };
  }

  if (lowerExisting.includes(lowerIncoming)) {
    return {
      summary: normalizedExisting,
      confidence: existingConfidence
    };
  }

  if (lowerIncoming.includes(lowerExisting)) {
    return {
      summary: normalizedIncoming,
      confidence: incomingConfidence
    };
  }

  const confidenceSlack = 0.1;
  if (incomingConfidence + confidenceSlack >= existingConfidence) {
    return {
      summary: normalizedIncoming,
      confidence: incomingConfidence
    };
  }

  return {
    summary: normalizedExisting,
    confidence: existingConfidence
  };
}

function mergeSummary(existing: string, incoming: string, existingConfidence: number, incomingConfidence: number): {
  summary: string;
  confidence: number;
} {
  if (!existing) {
    const normalizedIncoming = normalizeSummaryLine(incoming);
    return {
      summary: normalizedIncoming,
      confidence: normalizedIncoming ? incomingConfidence : existingConfidence
    };
  }
  return choosePreferredSummary(existing, existingConfidence, incoming, incomingConfidence);
}

function splitFrontmatter(content: string): SplitFrontmatter {
  const normalized = content.replace(/\r\n?/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return {
      frontmatter: null,
      body: normalized.trim()
    };
  }
  const closing = normalized.indexOf('\n---\n', 4);
  if (closing < 0) {
    return {
      frontmatter: null,
      body: normalized.trim()
    };
  }
  const frontmatter = normalized.slice(4, closing).trim();
  const body = normalized.slice(closing + 5).trim();
  return {
    frontmatter,
    body
  };
}

function parseYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      if (trimmed.startsWith('"')) {
        return JSON.parse(trimmed);
      }
      return trimmed.slice(1, -1);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

interface ParsedFrontmatterFields {
  title: string;
  summary: string;
  pageKey: string;
  keywords: string[];
  aliases: string[];
  tags: string[];
  preservedLines: string[];
}

function parseManagedFrontmatter(frontmatter: string | null): ParsedFrontmatterFields {
  if (!frontmatter) {
    return {
      title: '',
      summary: '',
      pageKey: '',
      keywords: [],
      aliases: [],
      tags: [],
      preservedLines: []
    };
  }

  const lines = frontmatter.split('\n');
  let title = '';
  let summary = '';
  let pageKey = '';
  const keywords: string[] = [];
  const aliases: string[] = [];
  const tags: string[] = [];
  const preservedLines: string[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) {
      preservedLines.push(line);
      index += 1;
      continue;
    }

    const key = keyMatch[1].toLowerCase();
    const valuePart = keyMatch[2] ?? '';
    const managed = MANAGED_FRONTMATTER_KEYS.has(key);

    if (!managed) {
      preservedLines.push(line);
      index += 1;
      continue;
    }

    if (key === 'title') {
      title = parseYamlScalar(valuePart);
    } else if (key === 'summary') {
      summary = parseYamlScalar(valuePart);
    } else if (key === 'pagekey') {
      pageKey = parseYamlScalar(valuePart);
    }

    if (!valuePart.trim()) {
      let lookahead = index + 1;
      while (lookahead < lines.length && /^\s+/.test(lines[lookahead])) {
        const itemMatch = lines[lookahead].match(/^\s*-\s*(.*)$/);
        if (itemMatch) {
          const parsedItem = parseYamlScalar(itemMatch[1]);
          if (key === 'keywords') {
            keywords.push(parsedItem);
          } else if (key === 'aliases') {
            aliases.push(parsedItem);
          } else if (key === 'tags') {
            tags.push(parsedItem);
          }
        }
        lookahead += 1;
      }
      index = lookahead;
      continue;
    }

    index += 1;
  }

  return {
    title,
    summary,
    pageKey,
    keywords: uniqueStrings(keywords),
    aliases: uniqueStrings(aliases),
    tags: uniqueStrings(tags),
    preservedLines
  };
}

function extractJsonPayload(raw: string): unknown {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('Response did not contain a JSON object.');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const normalized = item.trim();
    if (!normalized) {
      continue;
    }
    items.push(normalized);
  }
  return uniqueStrings(items);
}

export function parseLoreDeltaOperations(
  raw: string,
  maxOperationsPerChunk: number
): LoreDeltaOperation[] {
  const payload = extractJsonPayload(raw);
  if (!payload || typeof payload !== 'object') {
    throw new Error('Lore delta payload is not an object.');
  }

  const operationsRaw = (payload as { operations?: unknown }).operations;
  if (!Array.isArray(operationsRaw)) {
    throw new Error('Lore delta payload missing operations array.');
  }

  const operations: LoreDeltaOperation[] = [];
  for (const item of operationsRaw) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const op = item as {[key: string]: unknown};
    const pageKey = typeof op.pageKey === 'string' ? op.pageKey.trim() : '';
    const title = typeof op.title === 'string' ? op.title.trim() : '';
    const summary = typeof op.summary === 'string' ? op.summary.trim() : '';
    const content = typeof op.content === 'string' ? op.content.trim() : '';
    const rationale = typeof op.rationale === 'string' ? op.rationale.trim() : '';
    const keywords = asStringArray(op.keywords);
    const aliases = asStringArray(op.aliases);
    const updateModeRaw = typeof op.updateMode === 'string' ? op.updateMode.trim().toLowerCase() : 'merge';
    const updateMode = updateModeRaw === 'rewrite' ? 'rewrite' : 'merge';
    const confidenceValue = Number(op.confidence);
    const confidence = Number.isFinite(confidenceValue)
      ? Math.max(0, Math.min(1, confidenceValue))
      : 0.5;

    const resolvedKey = pageKey || title;
    if (!resolvedKey) {
      continue;
    }
    const fallbackTitle = deriveWikiTitleFromPageKey(resolvedKey);
    const sanitizedTitle = sanitizeWikiTitle(title, fallbackTitle);

    operations.push({
      pageKey: resolvedKey,
      title: sanitizedTitle,
      updateMode,
      summary,
      keywords,
      aliases,
      content,
      confidence,
      rationale
    });
  }

  operations.sort((left, right) => (
    left.pageKey.localeCompare(right.pageKey) ||
    left.title.localeCompare(right.title) ||
    left.updateMode.localeCompare(right.updateMode) ||
    left.summary.localeCompare(right.summary) ||
    left.content.localeCompare(right.content)
  ));

  return operations.slice(0, Math.max(1, Math.floor(maxOperationsPerChunk)));
}

function renderExistingPageState(pages: PageState[], limit: number): string {
  if (pages.length === 0) {
    return '[]';
  }
  return JSON.stringify(
    pages.slice(0, limit).map(page => ({
      path: page.path,
      pageKey: page.pageKey,
      title: page.title,
      summary: page.summary,
      keywords: page.keywords,
      aliases: page.aliases
    })),
    null,
    2
  );
}

function renderFocusedPageState(pages: PageState[], focusedPaths: Set<string>, limit: number, bodyCharLimit: number): string {
  const focused = pages
    .filter(page => focusedPaths.has(page.path))
    .slice(0, limit)
    .map(page => {
      const body = page.originalBody.length > bodyCharLimit
        ? `${page.originalBody.slice(0, bodyCharLimit)}...`
        : page.originalBody;
      return {
        path: page.path,
        pageKey: page.pageKey,
        title: page.title,
        summary: page.summary,
        keywords: page.keywords,
        aliases: page.aliases,
        body
      };
    });
  return JSON.stringify(focused, null, 2);
}

function buildPrompts(
  chunk: StoryExtractionChunk,
  totalChunks: number,
  pages: PageState[],
  options: LoreDeltaUpdateOptions,
  focusedPaths: Set<string>
): { systemPrompt: string; userPrompt: string } {
  const policyText = options.updatePolicy === 'rewrite_focused'
    ? 'rewrite_focused (focused target notes may receive full structural rewrites; other notes get section-aware merges)'
    : 'section_merge (merge new information into matching sections and preserve untargeted content)';
  const createText = options.allowCreateNotes
    ? 'Create new notes only when the idea clearly introduces a durable concept that does not fit an existing page.'
    : 'Do not create new notes. Only update existing pages.';

  const systemPrompt = [
    'You propose deterministic lorebook maintenance operations from an idea brief or change request.',
    'Return JSON only, no markdown, no prose.',
    'Schema:',
    '{',
    '  "operations": [',
    '    {',
    '      "pageKey": "stable key (character/alice)",',
    '      "title": "display title",',
    '      "updateMode": "merge | rewrite",',
    '      "summary": "compact summary update",',
    '      "keywords": ["trigger keyword"],',
    '      "aliases": ["alternate name"],',
    '      "content": "markdown body only (no frontmatter, no top-level # title heading)",',
    '      "confidence": 0.0,',
    '      "rationale": "why this page should change"',
    '    }',
    '  ]',
    '}',
    `Return at most ${Math.max(1, Math.floor(options.maxOperationsPerChunk))} operations.`,
    `Update policy: ${policyText}.`,
    `Focused target notes available for rewrite: ${focusedPaths.size > 0 ? 'yes' : 'no'}.`,
    createText,
    'Prefer existing pageKey reuse whenever possible.',
    'Use updateMode="rewrite" only for focused target notes when the brief clearly asks for structure/wording cleanup or reorganization.',
    'Use updateMode="merge" for incorporating new canon into existing notes while preserving their broader structure.',
    'If a fact belongs under an existing heading, use that heading in content so the merge lands in the correct section.',
    'Title must be canonical note title only. Do not prefix title with type labels like "Character:", "Location:", or "Faction:".',
    'Content should prefer ## headings such as ## Overview, ## Backstory, ## Relationships, ## Timeline, or ## Details.',
    'Do not invent unsupported canon.'
  ].join('\n');

  const userPrompt = [
    `Chunk ${chunk.index}/${totalChunks}`,
    '',
    '<focused_target_pages_json>',
    renderFocusedPageState(pages, focusedPaths, options.maxFocusedPagesInPrompt, options.maxFocusedPageChars),
    '</focused_target_pages_json>',
    '',
    '<candidate_pages_json>',
    renderExistingPageState(pages, options.maxExistingPagesInPrompt),
    '</candidate_pages_json>',
    '',
    '<lore_change_brief_markdown>',
    chunk.text,
    '</lore_change_brief_markdown>'
  ].join('\n');

  return {
    systemPrompt,
    userPrompt
  };
}

function renderYamlArray(key: string, values: string[]): string[] {
  if (values.length === 0) {
    return [];
  }
  const lines = [`${key}:`];
  for (const value of values) {
    lines.push(`  - ${JSON.stringify(value)}`);
  }
  return lines;
}

function renderFrontmatter(state: PageState): string {
  const lines: string[] = [];

  if (state.preservedFrontmatterLines.length > 0) {
    for (const line of state.preservedFrontmatterLines) {
      lines.push(line);
    }
  }

  const resolvedTitle = sanitizeWikiTitle(
    state.title || '',
    deriveWikiTitleFromPageKey(state.pageKey || state.title)
  );
  lines.push(`title: ${JSON.stringify(resolvedTitle)}`);
  lines.push(...renderYamlArray('aliases', state.aliases));
  lines.push(...renderYamlArray('keywords', state.keywords));
  lines.push(...renderYamlArray('tags', state.tags));
  lines.push('sourceType: "lore_delta_update"');
  lines.push(`pageKey: ${JSON.stringify(state.pageKey)}`);

  return lines.join('\n').trim();
}

function renderStateContent(state: PageState): string {
  const frontmatter = renderFrontmatter(state);
  const resolvedTitle = sanitizeWikiTitle(
    state.title || '',
    deriveWikiTitleFromPageKey(state.pageKey || state.title)
  );
  const managedBody = normalizeManagedMarkdownBody(state.bodyText, state.pageKey);
  const baseBody = managedBody || '(no lore delta content)';
  const structuredBody = buildStructuredWikiBody(
    resolvedTitle,
    state.pageKey,
    baseBody,
    '(no lore delta content)'
  );
  const baseContent = ['---', frontmatter, '---', '', structuredBody, ''].join('\n');
  if (!state.summary) {
    return baseContent;
  }
  return upsertSummarySectionInMarkdown(baseContent, state.summary);
}

function buildDiffPreview(
  action: 'create' | 'update',
  previousContent: string | null,
  nextContent: string
): LoreDeltaDiffPreview {
  const beforeContent = action === 'create'
    ? ''
    : (previousContent ?? '');
  return buildSourceDiffPreview(beforeContent, nextContent, {
    contextLines: 4,
    maxRenderRows: 360
  });
}

function resolveConflictSeverity(addedLines: number, removedLines: number): LoreDeltaConflictSeverity {
  const churn = Math.max(addedLines, removedLines);
  if (churn >= 40) {
    return 'high';
  }
  if (churn >= 16) {
    return 'medium';
  }
  return 'low';
}

function buildPlannedConflicts(changes: LoreDeltaPlannedChange[]): LoreDeltaConflict[] {
  const conflicts: LoreDeltaConflict[] = [];
  for (const change of changes) {
    if (change.action !== 'update') {
      continue;
    }
    if (change.diffAddedLines <= 0 || change.diffRemovedLines <= 0) {
      continue;
    }
    conflicts.push({
      id: `update:${change.path}`,
      path: change.path,
      pageKey: change.pageKey,
      title: change.title,
      action: 'update',
      severity: resolveConflictSeverity(change.diffAddedLines, change.diffRemovedLines),
      summary: `Replaces ${change.diffRemovedLines} line(s) with ${change.diffAddedLines} line(s).`,
      diffAddedLines: change.diffAddedLines,
      diffRemovedLines: change.diffRemovedLines
    });
  }
  return conflicts.sort((left, right) => (
    left.path.localeCompare(right.path) ||
    left.pageKey.localeCompare(right.pageKey)
  ));
}

function resolveUniquePath(targetFolder: string, stem: string, used: Set<string>): string {
  let attempt = 1;
  while (attempt < 10000) {
    const suffix = attempt === 1 ? '' : `-${attempt}`;
    const candidate = normalizeVaultPath(`${targetFolder}/${stem}${suffix}.md`);
    const key = candidate.toLowerCase();
    if (!used.has(key)) {
      used.add(key);
      return candidate;
    }
    attempt += 1;
  }
  throw new Error(`Unable to allocate file path for ${stem}.`);
}

function createPageStateFromInput(input: LoreDeltaExistingPageInput): PageState {
  const normalizedPath = normalizeVaultPath(input.path);
  const split = splitFrontmatter(input.content);
  const parsed = parseManagedFrontmatter(split.frontmatter);
  const resolvedSummary = resolveNoteSummary(split.body, parsed.summary);
  const inferredTitle = parsed.title || normalizedPath.split('/').pop()?.replace(/\.md$/i, '') || 'entry';
  const resolvedKey = normalizePageKey(parsed.pageKey || inferredTitle) || normalizePageKey(inferredTitle) || 'entry';
  const bodyWithoutSummary = stripSummarySectionFromBody(split.body).trim();

  return {
    path: normalizedPath,
    pageKey: resolvedKey,
    title: parsed.title || inferredTitle,
    summary: resolvedSummary?.text ?? '',
    summaryConfidence: 0,
    keywords: parsed.keywords,
    aliases: parsed.aliases,
    tags: parsed.tags,
    originalContent: input.content.replace(/\r\n?/g, '\n'),
    originalFrontmatter: split.frontmatter,
    originalBody: split.body,
    preservedFrontmatterLines: parsed.preservedLines,
    bodyText: bodyWithoutSummary,
    created: false,
    touched: false,
    maxConfidence: 0,
    rationales: [],
    chunkIndices: new Set<number>(),
    appliedOperations: 0,
    skippedLowConfidence: 0
  };
}

function buildNewPageState(
  pageKey: string,
  title: string,
  path: string,
  tags: string[]
): PageState {
  return {
    path,
    pageKey,
    title,
    summary: '',
    summaryConfidence: 0,
    keywords: [],
    aliases: [],
    tags: [...tags],
    originalContent: '',
    originalFrontmatter: null,
    originalBody: '',
    preservedFrontmatterLines: [],
    bodyText: '',
    created: true,
    touched: false,
    maxConfidence: 0,
    rationales: [],
    chunkIndices: new Set<number>(),
    appliedOperations: 0,
    skippedLowConfidence: 0
  };
}

function findExistingPageStateForOperation(
  operation: LoreDeltaOperation,
  pageByPath: Map<string, PageState>,
  pageKeyToPath: Map<string, string>,
  titleToPath: Map<string, string>
): PageState | null {
  const normalizedKey = normalizePageKey(operation.pageKey || operation.title);
  const titleKey = normalizeTextKey(operation.title || operation.pageKey);

  const keyPath = normalizedKey ? pageKeyToPath.get(normalizedKey) : undefined;
  if (keyPath) {
    const existing = pageByPath.get(keyPath);
    if (existing) {
      return existing;
    }
  }

  if (titleKey) {
    const titlePath = titleToPath.get(titleKey);
    if (titlePath) {
      const existing = pageByPath.get(titlePath);
      if (existing) {
        return existing;
      }
    }
  }

  return null;
}

function resolvePageStateForOperation(
  operation: LoreDeltaOperation,
  targetFolder: string,
  defaultTags: string[],
  usedPaths: Set<string>,
  pageByPath: Map<string, PageState>,
  pageKeyToPath: Map<string, string>,
  titleToPath: Map<string, string>
): PageState {
  const existing = findExistingPageStateForOperation(operation, pageByPath, pageKeyToPath, titleToPath);
  if (existing) {
    return existing;
  }

  const normalizedKey = normalizePageKey(operation.pageKey || operation.title);
  const safeStem = toSafeFileStem(normalizedKey || operation.title || 'entry');
  const path = resolveUniquePath(targetFolder, safeStem, usedPaths);
  const state = buildNewPageState(
    normalizedKey || normalizePageKey(operation.title) || safeStem,
    operation.title || normalizedKey || safeStem,
    path,
    defaultTags
  );

  pageByPath.set(path, state);
  if (state.pageKey) {
    pageKeyToPath.set(state.pageKey, path);
  }
  titleToPath.set(normalizeTextKey(state.title), path);
  return state;
}

function applyOperation(
  state: PageState,
  operation: LoreDeltaOperation,
  options: LoreDeltaUpdateOptions,
  chunkIndex: number,
  focusedPaths: Set<string>
): string[] {
  const warnings: string[] = [];
  const requestedRewrite = operation.updateMode === 'rewrite';
  const rewriteAllowed = options.updatePolicy === 'rewrite_focused' && (state.created || focusedPaths.has(state.path));
  const effectiveMode: 'merge' | 'rewrite' = requestedRewrite && rewriteAllowed ? 'rewrite' : 'merge';

  if (requestedRewrite && effectiveMode !== 'rewrite') {
    warnings.push(
      state.created
        ? `Rewrite request downgraded to section merge for new page ${state.pageKey || state.title}.`
        : `Rewrite request downgraded to section merge for non-focused page ${state.path}.`
    );
  }

  const previousTitle = state.title;
  const previousSummary = state.summary;
  const previousKeywords = state.keywords.join('\u0000');
  const previousAliases = state.aliases.join('\u0000');

  if (operation.title && (state.created || effectiveMode === 'rewrite' || !state.title)) {
    state.title = operation.title;
  }

  const mergedSummary = mergeSummary(
    state.summary,
    operation.summary,
    state.summaryConfidence,
    operation.confidence
  );
  state.summary = mergedSummary.summary;
  state.summaryConfidence = mergedSummary.confidence;
  state.keywords = uniqueStrings([...state.keywords, ...operation.keywords]);
  state.aliases = uniqueStrings([...state.aliases, ...operation.aliases]);

  const previousBody = state.bodyText;
  if (operation.content) {
    if (effectiveMode === 'rewrite') {
      const rewrittenBody = normalizeManagedMarkdownBody(operation.content, state.pageKey || operation.pageKey);
      if (rewrittenBody) {
        state.bodyText = rewrittenBody;
      }
    } else {
      state.bodyText = mergeStructuredMarkdownBodies(
        state.bodyText,
        operation.content,
        state.pageKey || operation.pageKey
      );
    }
  }

  if (
    state.created ||
    previousTitle !== state.title ||
    previousSummary !== state.summary ||
    previousKeywords !== state.keywords.join('\u0000') ||
    previousAliases !== state.aliases.join('\u0000') ||
    previousBody !== state.bodyText
  ) {
    state.touched = true;
  }

  state.maxConfidence = Math.max(state.maxConfidence, operation.confidence);
  if (operation.rationale) {
    state.rationales = uniqueStrings([...state.rationales, operation.rationale]);
  }
  state.chunkIndices.add(chunkIndex);
  state.appliedOperations += 1;
  return warnings;
}

export async function buildLoreDeltaPlan(
  options: LoreDeltaUpdateOptions
): Promise<LoreDeltaResult> {
  const ideaMarkdown = stripInlineLoreDirectives(options.ideaMarkdown, {
    ignoredCalloutTypes: options.ignoredCalloutTypes ?? []
  }).trim();
  if (!ideaMarkdown) {
    throw new Error('Lore change brief is empty.');
  }

  const newNoteFolder = normalizeVaultPath(options.newNoteFolder.trim().replace(/^\/+|\/+$/g, ''));
  if (options.allowCreateNotes && !newNoteFolder) {
    throw new Error('New note target folder is required when note creation is enabled.');
  }

  const chunks = splitStoryMarkdownIntoChunks(ideaMarkdown, options.maxChunkChars);
  if (chunks.length === 0) {
    throw new Error('No extractable lore-delta chunks were produced.');
  }
  options.onProgress?.({
    stage: 'starting',
    chunkTotal: chunks.length
  });

  const warnings: string[] = [];
  const chunkResults: StoryExtractionChunkResult[] = [];
  const focusedPaths = new Set(
    options.focusedPagePaths
      .map(path => normalizeVaultPath(path))
      .filter(Boolean)
  );

  const tagPrefix = normalizeTagPrefix(options.tagPrefix);
  const defaultTags = parseDefaultTags(options.defaultTagsRaw);
  const lorebookTags = options.lorebookScopes
    .map(scope => normalizeLorebookScope(scope))
    .filter(Boolean)
    .map(scope => `${tagPrefix}/${scope}`);
  const tags = uniqueStrings([...defaultTags, ...lorebookTags]);

  const pageByPath = new Map<string, PageState>();
  const pageKeyToPath = new Map<string, string>();
  const titleToPath = new Map<string, string>();
  const usedPaths = new Set<string>();

  for (const page of options.existingPages
    .map(createPageStateFromInput)
    .sort((left, right) => left.path.localeCompare(right.path))) {
    pageByPath.set(page.path, page);
    usedPaths.add(page.path.toLowerCase());
    if (page.pageKey) {
      pageKeyToPath.set(page.pageKey, page.path);
    }
    titleToPath.set(normalizeTextKey(page.title), page.path);
  }

  let skippedLowConfidence = 0;

  for (const chunk of chunks) {
    options.onProgress?.({
      stage: 'chunk_start',
      chunkIndex: chunk.index,
      chunkTotal: chunks.length
    });
    const existingPagesSorted = [...pageByPath.values()].sort((a, b) => (
      a.pageKey.localeCompare(b.pageKey) || a.path.localeCompare(b.path)
    ));
    const prompts = buildPrompts(chunk, chunks.length, existingPagesSorted, options, focusedPaths);

    try {
      const raw = await options.callModel(prompts.systemPrompt, prompts.userPrompt);
      const operations = parseLoreDeltaOperations(raw, options.maxOperationsPerChunk);

      for (const operation of operations) {
        if (operation.confidence < options.lowConfidenceThreshold) {
          skippedLowConfidence += 1;
          warnings.push(
            `Chunk ${chunk.index}: skipped low-confidence operation (${operation.confidence.toFixed(2)}) for ${operation.pageKey || operation.title}.`
          );
          const skippedState = findExistingPageStateForOperation(operation, pageByPath, pageKeyToPath, titleToPath);
          if (skippedState) {
            skippedState.skippedLowConfidence += 1;
            skippedState.maxConfidence = Math.max(skippedState.maxConfidence, operation.confidence);
          }
          continue;
        }

        const existingState = findExistingPageStateForOperation(operation, pageByPath, pageKeyToPath, titleToPath);
        if (!existingState && !options.allowCreateNotes) {
          warnings.push(
            `Chunk ${chunk.index}: skipped create request for ${operation.pageKey || operation.title} because new-note creation is disabled.`
          );
          continue;
        }

        const state = existingState ?? resolvePageStateForOperation(
          operation,
          newNoteFolder,
          tags,
          usedPaths,
          pageByPath,
          pageKeyToPath,
          titleToPath
        );
        const operationWarnings = applyOperation(state, operation, options, chunk.index, focusedPaths);
        warnings.push(...operationWarnings.map(warning => `Chunk ${chunk.index}: ${warning}`));
      }

      chunkResults.push({
        chunkIndex: chunk.index,
        operationCount: operations.length,
        warnings: []
      });
      options.onProgress?.({
        stage: 'chunk_success',
        chunkIndex: chunk.index,
        chunkTotal: chunks.length,
        operationCount: operations.length
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Chunk ${chunk.index}: ${message}`);
      chunkResults.push({
        chunkIndex: chunk.index,
        operationCount: 0,
        warnings: [message]
      });
      options.onProgress?.({
        stage: 'chunk_error',
        chunkIndex: chunk.index,
        chunkTotal: chunks.length,
        warning: message
      });
    }
  }

  options.onProgress?.({
    stage: 'rendering_pages',
    chunkTotal: chunks.length
  });

  const pages: LoreDeltaPlannedPage[] = [];
  const changes: LoreDeltaPlannedChange[] = [];

  for (const state of [...pageByPath.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    if (!state.touched) {
      continue;
    }

    const rendered = renderStateContent(state);
    if (!state.created && rendered === state.originalContent) {
      continue;
    }

    const action: 'create' | 'update' = state.created ? 'create' : 'update';
    const previousContent = state.created ? null : state.originalContent;
    const diff = buildDiffPreview(action, previousContent, rendered);
    pages.push({
      path: state.path,
      content: rendered,
      previousContent,
      pageKey: state.pageKey,
      action,
      diff
    });
    changes.push({
      path: state.path,
      pageKey: state.pageKey,
      title: state.title,
      action,
      confidence: state.maxConfidence,
      rationales: state.rationales,
      chunkIndices: [...state.chunkIndices].sort((left, right) => left - right),
      appliedOperations: state.appliedOperations,
      skippedLowConfidence: state.skippedLowConfidence,
      diffAddedLines: diff.addedLines,
      diffRemovedLines: diff.removedLines,
      diffTruncated: diff.truncated
    });
  }

  const conflicts = buildPlannedConflicts(changes);
  options.onProgress?.({
    stage: 'completed',
    chunkTotal: chunks.length,
    pageCount: pages.length,
    conflictCount: conflicts.length
  });

  return {
    pages,
    changes,
    conflicts,
    chunks: chunkResults,
    warnings,
    skippedLowConfidence
  };
}
