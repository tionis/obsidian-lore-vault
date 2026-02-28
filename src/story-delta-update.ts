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

export type StoryDeltaUpdatePolicy = 'safe_append' | 'structured_merge';

export interface StoryDeltaExistingPageInput {
  path: string;
  content: string;
}

export interface StoryDeltaOperation {
  pageKey: string;
  title: string;
  summary: string;
  keywords: string[];
  aliases: string[];
  content: string;
  confidence: number;
  rationale: string;
}

export interface StoryDeltaPlannedPage {
  path: string;
  content: string;
  previousContent: string | null;
  pageKey: string;
  action: 'create' | 'update';
  diff: StoryDeltaDiffPreview;
}

export interface StoryDeltaPlannedChange {
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

export interface StoryDeltaResult {
  pages: StoryDeltaPlannedPage[];
  changes: StoryDeltaPlannedChange[];
  chunks: StoryExtractionChunkResult[];
  warnings: string[];
  skippedLowConfidence: number;
}

export interface StoryDeltaUpdateOptions {
  storyMarkdown: string;
  targetFolder: string;
  defaultTagsRaw: string;
  lorebookName: string;
  tagPrefix: string;
  updatePolicy: StoryDeltaUpdatePolicy;
  maxChunkChars: number;
  maxSummaryChars: number;
  maxOperationsPerChunk: number;
  maxExistingPagesInPrompt: number;
  lowConfidenceThreshold: number;
  existingPages: StoryDeltaExistingPageInput[];
  callModel: (systemPrompt: string, userPrompt: string) => Promise<string>;
}

export interface StoryDeltaDiffPreview {
  addedLines: number;
  removedLines: number;
  preview: string;
  truncated: boolean;
}

interface SplitFrontmatter {
  frontmatter: string | null;
  body: string;
}

interface PageState {
  path: string;
  pageKey: string;
  title: string;
  summary: string;
  keywords: string[];
  aliases: string[];
  tags: string[];
  originalContent: string;
  originalFrontmatter: string | null;
  preservedFrontmatterLines: string[];
  contentBlocks: string[];
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

function normalizeLorebookNameToScope(name: string): string {
  return name
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

function buildSummary(content: string, maxChars: number): string {
  const singleLine = content
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!singleLine) {
    return '';
  }
  const limit = Math.max(80, Math.floor(maxChars));
  if (singleLine.length <= limit) {
    return singleLine;
  }
  return `${singleLine.slice(0, limit).trimEnd()}...`;
}

function mergeSummary(existing: string, incoming: string, maxSummaryChars: number): string {
  if (!incoming) {
    return existing;
  }
  if (!existing) {
    return buildSummary(incoming, maxSummaryChars);
  }
  const lowerExisting = existing.toLowerCase();
  const lowerIncoming = incoming.toLowerCase();
  if (lowerExisting.includes(lowerIncoming)) {
    return buildSummary(existing, maxSummaryChars);
  }
  return buildSummary(`${existing} | ${incoming}`, maxSummaryChars);
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

function splitBodyIntoBlocks(body: string): string[] {
  const trimmed = body.trim();
  if (!trimmed) {
    return [];
  }
  const blocks = trimmed
    .split(/\n\n---\n\n/)
    .map(item => item.trim())
    .filter(Boolean);
  if (blocks.length === 0) {
    return [trimmed];
  }
  return blocks;
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

export function parseStoryDeltaOperations(
  raw: string,
  maxOperationsPerChunk: number
): StoryDeltaOperation[] {
  const payload = extractJsonPayload(raw);
  if (!payload || typeof payload !== 'object') {
    throw new Error('Story delta payload is not an object.');
  }

  const operationsRaw = (payload as { operations?: unknown }).operations;
  if (!Array.isArray(operationsRaw)) {
    throw new Error('Story delta payload missing operations array.');
  }

  const operations: StoryDeltaOperation[] = [];

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

function buildPrompts(
  chunk: StoryExtractionChunk,
  totalChunks: number,
  pages: PageState[],
  options: StoryDeltaUpdateOptions
): { systemPrompt: string; userPrompt: string } {
  const policyText = options.updatePolicy === 'structured_merge'
    ? 'structured_merge (update summary/keywords/aliases when confidence is high)'
    : 'safe_append (append durable updates without rewriting existing metadata)';

  const systemPrompt = [
    'You propose deterministic wiki update operations from story markdown.',
    'Return JSON only, no markdown, no prose.',
    'Schema:',
    '{',
    '  "operations": [',
    '    {',
    '      "pageKey": "stable key (character/alice)",',
    '      "title": "display title",',
    '      "summary": "compact summary update",',
    '      "keywords": ["trigger keyword"],',
    '      "aliases": ["alternate name"],',
    '      "content": "durable state change or facts to add",',
    '      "confidence": 0.0,',
    '      "rationale": "why this update belongs on that page"',
    '    }',
    '  ]',
    '}',
    `Return at most ${Math.max(1, Math.floor(options.maxOperationsPerChunk))} operations.`,
    `Update policy: ${policyText}.`,
    'Prefer existing pageKey reuse whenever possible.',
    'Title must be canonical note title only. Do not prefix title with type labels like "Character:", "Location:", or "Faction:".',
    'Content must be markdown body only (no frontmatter, no top-level # title heading).',
    'Prefer sectioned markdown with ## headings (for example ## Backstory, ## Overview, ## Relationships, ## Timeline).',
    'Do not invent facts outside the chunk.'
  ].join('\n');

  const userPrompt = [
    `Chunk ${chunk.index}/${totalChunks}`,
    '',
    '<existing_pages_json>',
    renderExistingPageState(pages, options.maxExistingPagesInPrompt),
    '</existing_pages_json>',
    '',
    '<story_chunk_markdown>',
    chunk.text,
    '</story_chunk_markdown>'
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
  lines.push('sourceType: "story_delta_update"');
  lines.push(`pageKey: ${JSON.stringify(state.pageKey)}`);

  return lines.join('\n').trim();
}

function renderStateContent(state: PageState, policy: StoryDeltaUpdatePolicy): string {
  const rawBody = state.contentBlocks.length > 0
    ? state.contentBlocks.join('\n\n---\n\n').trim()
    : '(no story delta content)';

  const keepOriginalFrontmatter = policy === 'safe_append' && !state.created;
  if (keepOriginalFrontmatter) {
    if (state.originalFrontmatter) {
      return [`---`, state.originalFrontmatter.trim(), `---`, '', rawBody, ''].join('\n');
    }
    return [rawBody, ''].join('\n');
  }

  const frontmatter = renderFrontmatter(state);
  const resolvedTitle = sanitizeWikiTitle(
    state.title || '',
    deriveWikiTitleFromPageKey(state.pageKey || state.title)
  );
  const bodyWithoutSummary = stripSummarySectionFromBody(rawBody);
  const baseBody = bodyWithoutSummary || (state.summary ? '' : '(no story delta content)');
  const structuredBody = buildStructuredWikiBody(
    resolvedTitle,
    state.pageKey,
    baseBody,
    '(no story delta content)'
  );
  const baseContent = ['---', frontmatter, '---', '', structuredBody, ''].join('\n');
  if (!state.summary) {
    return baseContent;
  }
  return upsertSummarySectionInMarkdown(baseContent, state.summary);
}

function splitLines(content: string): string[] {
  const normalized = content.replace(/\r\n?/g, '\n');
  if (!normalized) {
    return [];
  }
  return normalized.split('\n');
}

function buildCreateDiffPreview(content: string): StoryDeltaDiffPreview {
  const lines = splitLines(content);
  const maxLines = 220;
  const raw = [
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map(line => `+${line}`)
  ];
  const truncated = raw.length > maxLines;
  const previewLines = truncated
    ? [...raw.slice(0, maxLines), '... [truncated]']
    : raw;
  return {
    addedLines: lines.length,
    removedLines: 0,
    preview: previewLines.join('\n'),
    truncated
  };
}

function buildUpdateDiffPreview(previousContent: string, nextContent: string): StoryDeltaDiffPreview {
  if (previousContent === nextContent) {
    return {
      addedLines: 0,
      removedLines: 0,
      preview: '(no changes)',
      truncated: false
    };
  }

  const before = splitLines(previousContent);
  const after = splitLines(nextContent);

  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }

  let beforeEnd = before.length - 1;
  let afterEnd = after.length - 1;
  while (beforeEnd >= prefix && afterEnd >= prefix && before[beforeEnd] === after[afterEnd]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const removedSegment = before.slice(prefix, beforeEnd + 1);
  const addedSegment = after.slice(prefix, afterEnd + 1);

  const raw: string[] = [];
  raw.push(`@@ -${prefix + 1},${removedSegment.length} +${prefix + 1},${addedSegment.length} @@`);

  if (prefix > 0) {
    raw.push(` ${before[prefix - 1]}`);
  }
  for (const line of removedSegment) {
    raw.push(`-${line}`);
  }
  for (const line of addedSegment) {
    raw.push(`+${line}`);
  }
  if (beforeEnd + 1 < before.length) {
    raw.push(` ${before[beforeEnd + 1]}`);
  }

  const maxLines = 220;
  const truncated = raw.length > maxLines;
  const previewLines = truncated
    ? [...raw.slice(0, maxLines), '... [truncated]']
    : raw;

  return {
    addedLines: addedSegment.length,
    removedLines: removedSegment.length,
    preview: previewLines.join('\n'),
    truncated
  };
}

function buildDiffPreview(
  action: 'create' | 'update',
  previousContent: string | null,
  nextContent: string
): StoryDeltaDiffPreview {
  if (action === 'create' || !previousContent) {
    return buildCreateDiffPreview(nextContent);
  }
  return buildUpdateDiffPreview(previousContent, nextContent);
}

function normalizeBlockKey(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hasContentBlock(contentBlocks: string[], candidate: string): boolean {
  const candidateKey = normalizeBlockKey(candidate);
  if (!candidateKey) {
    return true;
  }
  for (const block of contentBlocks) {
    const blockKey = normalizeBlockKey(block);
    if (!blockKey) {
      continue;
    }
    if (blockKey === candidateKey || blockKey.includes(candidateKey) || candidateKey.includes(blockKey)) {
      return true;
    }
  }
  return false;
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

function createPageStateFromInput(input: StoryDeltaExistingPageInput): PageState {
  const normalizedPath = normalizeVaultPath(input.path);
  const split = splitFrontmatter(input.content);
  const parsed = parseManagedFrontmatter(split.frontmatter);
  const resolvedSummary = resolveNoteSummary(split.body, parsed.summary);
  const inferredTitle = parsed.title || normalizedPath.split('/').pop()?.replace(/\.md$/i, '') || 'entry';
  const resolvedKey = normalizePageKey(parsed.pageKey || inferredTitle) || normalizePageKey(inferredTitle) || 'entry';

  return {
    path: normalizedPath,
    pageKey: resolvedKey,
    title: parsed.title || inferredTitle,
    summary: resolvedSummary?.text ?? '',
    keywords: parsed.keywords,
    aliases: parsed.aliases,
    tags: parsed.tags,
    originalContent: input.content.replace(/\r\n?/g, '\n'),
    originalFrontmatter: split.frontmatter,
    preservedFrontmatterLines: parsed.preservedLines,
    contentBlocks: splitBodyIntoBlocks(split.body),
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
    keywords: [],
    aliases: [],
    tags: [...tags],
    originalContent: '',
    originalFrontmatter: null,
    preservedFrontmatterLines: [],
    contentBlocks: [],
    created: true,
    touched: false,
    maxConfidence: 0,
    rationales: [],
    chunkIndices: new Set<number>(),
    appliedOperations: 0,
    skippedLowConfidence: 0
  };
}

function resolvePageStateForOperation(
  operation: StoryDeltaOperation,
  targetFolder: string,
  defaultTags: string[],
  usedPaths: Set<string>,
  pageByPath: Map<string, PageState>,
  pageKeyToPath: Map<string, string>,
  titleToPath: Map<string, string>
): PageState {
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
  operation: StoryDeltaOperation,
  options: StoryDeltaUpdateOptions,
  chunkIndex: number
): void {
  const canMergeMetadata = options.updatePolicy === 'structured_merge' || state.created;

  if (canMergeMetadata) {
    if (!state.title && operation.title) {
      state.title = operation.title;
    }
    state.summary = mergeSummary(state.summary, operation.summary, options.maxSummaryChars);
    state.keywords = uniqueStrings([...state.keywords, ...operation.keywords]);
    state.aliases = uniqueStrings([...state.aliases, ...operation.aliases]);
  }

  if (operation.content) {
    if (!hasContentBlock(state.contentBlocks, operation.content)) {
      state.contentBlocks.push(operation.content.trim());
      state.touched = true;
    }
  }

  if (canMergeMetadata && (operation.summary || operation.keywords.length > 0 || operation.aliases.length > 0)) {
    state.touched = true;
  }

  state.maxConfidence = Math.max(state.maxConfidence, operation.confidence);
  if (operation.rationale) {
    state.rationales = uniqueStrings([...state.rationales, operation.rationale]);
  }
  state.chunkIndices.add(chunkIndex);
  state.appliedOperations += 1;
}

export async function buildStoryDeltaPlan(
  options: StoryDeltaUpdateOptions
): Promise<StoryDeltaResult> {
  const storyMarkdown = stripInlineLoreDirectives(options.storyMarkdown).trim();
  if (!storyMarkdown) {
    throw new Error('Story markdown is empty.');
  }

  const targetFolder = normalizeVaultPath(options.targetFolder.trim().replace(/^\/+|\/+$/g, ''));
  if (!targetFolder) {
    throw new Error('Target folder is required.');
  }

  const chunks = splitStoryMarkdownIntoChunks(storyMarkdown, options.maxChunkChars);
  if (chunks.length === 0) {
    throw new Error('No extractable story chunks were produced.');
  }

  const warnings: string[] = [];
  const chunkResults: StoryExtractionChunkResult[] = [];

  const tagPrefix = normalizeTagPrefix(options.tagPrefix);
  const defaultTags = parseDefaultTags(options.defaultTagsRaw);
  const lorebookScope = normalizeLorebookNameToScope(options.lorebookName);
  const lorebookTag = lorebookScope ? `${tagPrefix}/${lorebookScope}` : '';
  const tags = lorebookTag ? uniqueStrings([...defaultTags, lorebookTag]) : defaultTags;

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
    const existingPagesSorted = [...pageByPath.values()].sort((a, b) => (
      a.pageKey.localeCompare(b.pageKey) || a.path.localeCompare(b.path)
    ));

    const prompts = buildPrompts(chunk, chunks.length, existingPagesSorted, options);

    try {
      const raw = await options.callModel(prompts.systemPrompt, prompts.userPrompt);
      const operations = parseStoryDeltaOperations(raw, options.maxOperationsPerChunk);

      for (const operation of operations) {
        if (operation.confidence < options.lowConfidenceThreshold) {
          skippedLowConfidence += 1;
          warnings.push(
            `Chunk ${chunk.index}: skipped low-confidence operation (${operation.confidence.toFixed(2)}) for ${operation.pageKey || operation.title}.`
          );

          const skippedState = resolvePageStateForOperation(
            operation,
            targetFolder,
            tags,
            usedPaths,
            pageByPath,
            pageKeyToPath,
            titleToPath
          );
          skippedState.skippedLowConfidence += 1;
          skippedState.maxConfidence = Math.max(skippedState.maxConfidence, operation.confidence);
          continue;
        }

        const state = resolvePageStateForOperation(
          operation,
          targetFolder,
          tags,
          usedPaths,
          pageByPath,
          pageKeyToPath,
          titleToPath
        );
        applyOperation(state, operation, options, chunk.index);
      }

      chunkResults.push({
        chunkIndex: chunk.index,
        operationCount: operations.length,
        warnings: []
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Chunk ${chunk.index}: ${message}`);
      chunkResults.push({
        chunkIndex: chunk.index,
        operationCount: 0,
        warnings: [message]
      });
    }
  }

  const pages: StoryDeltaPlannedPage[] = [];
  const changes: StoryDeltaPlannedChange[] = [];

  for (const state of [...pageByPath.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    if (!state.touched) {
      continue;
    }

    const rendered = renderStateContent(state, options.updatePolicy);
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

  pages.sort((left, right) => left.path.localeCompare(right.path));
  changes.sort((left, right) => left.path.localeCompare(right.path));

  return {
    pages,
    changes,
    chunks: chunkResults,
    warnings,
    skippedLowConfidence
  };
}
