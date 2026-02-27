import { normalizeVaultPath } from './vault-path-utils';
import { upsertSummarySectionInMarkdown } from './summary-utils';

export interface StoryExtractionChunk {
  index: number;
  text: string;
}

export interface StoryExtractionOperation {
  pageKey: string;
  title: string;
  summary: string;
  keywords: string[];
  aliases: string[];
  content: string;
  confidence: number;
}

export interface StoryExtractionChunkResult {
  chunkIndex: number;
  operationCount: number;
  warnings: string[];
}

export interface StoryExtractionPage {
  path: string;
  content: string;
  pageKey: string;
}

export interface StoryExtractionResult {
  pages: StoryExtractionPage[];
  chunks: StoryExtractionChunkResult[];
  warnings: string[];
}

export interface StoryExtractionOptions {
  storyMarkdown: string;
  targetFolder: string;
  defaultTagsRaw: string;
  lorebookName: string;
  tagPrefix: string;
  maxChunkChars: number;
  maxSummaryChars: number;
  maxOperationsPerChunk: number;
  maxExistingPagesInPrompt: number;
  callModel: (systemPrompt: string, userPrompt: string) => Promise<string>;
}

interface PageState {
  pageKey: string;
  title: string;
  summary: string;
  keywords: string[];
  aliases: string[];
  contentBlocks: string[];
}

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
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(tag);
  }
  return deduped;
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

function splitLongText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    const candidate = text.slice(offset, offset + maxChars);
    if (candidate.length < maxChars) {
      chunks.push(candidate.trim());
      break;
    }
    const lastParagraphBreak = candidate.lastIndexOf('\n\n');
    const splitAt = lastParagraphBreak > maxChars * 0.45
      ? offset + lastParagraphBreak
      : offset + maxChars;
    const nextChunk = text.slice(offset, splitAt).trim();
    if (nextChunk) {
      chunks.push(nextChunk);
    }
    offset = splitAt;
  }
  return chunks.filter(Boolean);
}

function splitSections(markdown: string): string[] {
  const normalized = markdown.replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split('\n');
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    const isHeading = /^#{1,6}\s+/.test(line.trim());
    if (isHeading && current.length > 0) {
      sections.push(current.join('\n').trim());
      current = [line];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) {
    sections.push(current.join('\n').trim());
  }
  return sections.filter(Boolean);
}

export function splitStoryMarkdownIntoChunks(
  storyMarkdown: string,
  maxChunkChars: number
): StoryExtractionChunk[] {
  const limit = Math.max(200, Math.floor(maxChunkChars));
  const sections = splitSections(storyMarkdown);
  const chunks: StoryExtractionChunk[] = [];
  let buffer = '';

  const flushBuffer = (): void => {
    const normalized = buffer.trim();
    if (!normalized) {
      return;
    }
    chunks.push({
      index: chunks.length + 1,
      text: normalized
    });
    buffer = '';
  };

  for (const section of sections) {
    if (section.length > limit) {
      flushBuffer();
      const splits = splitLongText(section, limit);
      for (const split of splits) {
        chunks.push({
          index: chunks.length + 1,
          text: split
        });
      }
      continue;
    }

    if (!buffer) {
      buffer = section;
      continue;
    }

    const candidate = `${buffer}\n\n${section}`;
    if (candidate.length > limit) {
      flushBuffer();
      buffer = section;
    } else {
      buffer = candidate;
    }
  }
  flushBuffer();
  return chunks;
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

export function parseStoryExtractionOperations(
  raw: string,
  maxOperationsPerChunk: number
): StoryExtractionOperation[] {
  const payload = extractJsonPayload(raw);
  if (!payload || typeof payload !== 'object') {
    throw new Error('Extraction response payload is not an object.');
  }
  const operationsRaw = (payload as { operations?: unknown }).operations;
  if (!Array.isArray(operationsRaw)) {
    throw new Error('Extraction response missing operations array.');
  }

  const operations: StoryExtractionOperation[] = [];
  for (const item of operationsRaw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const op = item as {[key: string]: unknown};
    const pageKey = typeof op.pageKey === 'string' ? op.pageKey.trim() : '';
    const title = typeof op.title === 'string' ? op.title.trim() : '';
    const summary = typeof op.summary === 'string' ? op.summary.trim() : '';
    const content = typeof op.content === 'string' ? op.content.trim() : '';
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
    operations.push({
      pageKey: resolvedKey,
      title: title || resolvedKey,
      summary,
      keywords,
      aliases,
      content,
      confidence
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
  const merged = `${existing} | ${incoming}`;
  return buildSummary(merged, maxSummaryChars);
}

function mergeContentBlocks(existing: string[], incoming: string): string[] {
  const normalizedIncoming = incoming.trim();
  if (!normalizedIncoming) {
    return existing;
  }
  const keys = new Set(existing.map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
  const candidateKey = normalizedIncoming.replace(/\s+/g, ' ').trim().toLowerCase();
  if (keys.has(candidateKey)) {
    return existing;
  }
  return [...existing, normalizedIncoming];
}

function renderExistingPageState(pages: PageState[], limit: number): string {
  if (pages.length === 0) {
    return '[]';
  }
  const mapped = pages
    .slice(0, limit)
    .map(page => ({
      pageKey: page.pageKey,
      title: page.title,
      summary: page.summary,
      keywords: page.keywords,
      aliases: page.aliases
    }));
  return JSON.stringify(mapped, null, 2);
}

function buildExtractionPrompts(
  chunk: StoryExtractionChunk,
  totalChunks: number,
  existingPages: PageState[],
  options: StoryExtractionOptions
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    'You extract structured wiki pages from story markdown.',
    'Return JSON only. No markdown. No prose.',
    'Schema:',
    '{',
    '  "operations": [',
    '    {',
    '      "pageKey": "stable key, e.g. character/alice",',
    '      "title": "display title",',
    '      "summary": "compact summary",',
    '      "keywords": ["trigger keyword"],',
    '      "aliases": ["alternate name"],',
    '      "content": "detail to append/update for page",',
    '      "confidence": 0.0',
    '    }',
    '  ]',
    '}',
    `Return at most ${Math.max(1, Math.floor(options.maxOperationsPerChunk))} operations.`,
    'Prefer stable pageKey reuse when existing state already has a matching page.',
    'Focus on durable entities, places, factions, concepts, and state changes.',
    'Do not invent facts outside the chunk.'
  ].join('\n');

  const userPrompt = [
    `Chunk ${chunk.index}/${totalChunks}`,
    '',
    '<existing_pages_json>',
    renderExistingPageState(existingPages, options.maxExistingPagesInPrompt),
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

function buildPageContent(
  page: PageState,
  tags: string[],
  maxSummaryChars: number
): string {
  const lines: string[] = ['---'];
  lines.push(`title: ${JSON.stringify(page.title || page.pageKey)}`);
  if (page.aliases.length > 0) {
    lines.push('aliases:');
    for (const alias of page.aliases) {
      lines.push(`  - ${JSON.stringify(alias)}`);
    }
  }
  if (page.keywords.length > 0) {
    lines.push('keywords:');
    for (const keyword of page.keywords) {
      lines.push(`  - ${JSON.stringify(keyword)}`);
    }
  }
  if (tags.length > 0) {
    lines.push('tags:');
    for (const tag of tags) {
      lines.push(`  - ${JSON.stringify(tag)}`);
    }
  }
  const summary = mergeSummary('', page.summary, maxSummaryChars);
  lines.push(`sourceType: "story_extraction"`);
  lines.push(`pageKey: ${JSON.stringify(page.pageKey)}`);
  lines.push('---');

  const body = page.contentBlocks.length > 0
    ? page.contentBlocks.join('\n\n---\n\n')
    : '(no extracted content)';

  const baseContent = [...lines, '', body.trim(), ''].join('\n');
  if (!summary) {
    return baseContent;
  }
  return upsertSummarySectionInMarkdown(baseContent, summary);
}

function resolveUniquePath(
  targetFolder: string,
  stem: string,
  used: Set<string>
): string {
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

export async function extractWikiPagesFromStory(
  options: StoryExtractionOptions
): Promise<StoryExtractionResult> {
  const storyMarkdown = options.storyMarkdown.trim();
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

  const pagesByKey = new Map<string, PageState>();
  const chunkResults: StoryExtractionChunkResult[] = [];
  const warnings: string[] = [];

  for (const chunk of chunks) {
    const prompts = buildExtractionPrompts(
      chunk,
      chunks.length,
      [...pagesByKey.values()].sort((a, b) => a.pageKey.localeCompare(b.pageKey)),
      options
    );

    try {
      const raw = await options.callModel(prompts.systemPrompt, prompts.userPrompt);
      const operations = parseStoryExtractionOperations(raw, options.maxOperationsPerChunk);
      for (const operation of operations) {
        const key = normalizePageKey(operation.pageKey || operation.title);
        if (!key) {
          continue;
        }
        const existing = pagesByKey.get(key) ?? {
          pageKey: key,
          title: operation.title || key,
          summary: '',
          keywords: [],
          aliases: [],
          contentBlocks: []
        };
        existing.title = existing.title || operation.title || key;
        existing.summary = mergeSummary(existing.summary, operation.summary, options.maxSummaryChars);
        existing.keywords = uniqueStrings([...existing.keywords, ...operation.keywords]);
        existing.aliases = uniqueStrings([...existing.aliases, ...operation.aliases]);
        existing.contentBlocks = mergeContentBlocks(existing.contentBlocks, operation.content);
        pagesByKey.set(key, existing);
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

  const tagPrefix = normalizeTagPrefix(options.tagPrefix);
  const defaultTags = parseDefaultTags(options.defaultTagsRaw);
  const lorebookScope = normalizeLorebookNameToScope(options.lorebookName);
  const lorebookTag = lorebookScope ? `${tagPrefix}/${lorebookScope}` : '';
  const tags = lorebookTag ? uniqueStrings([...defaultTags, lorebookTag]) : defaultTags;

  const pages = [...pagesByKey.values()]
    .sort((left, right) => left.pageKey.localeCompare(right.pageKey))
    .map(page => {
      return {
        page,
        stem: toSafeFileStem(page.pageKey || page.title)
      };
    });

  const usedPaths = new Set<string>();
  const renderedPages: StoryExtractionPage[] = pages.map(({ page, stem }) => ({
    path: resolveUniquePath(targetFolder, stem, usedPaths),
    content: buildPageContent(page, tags, options.maxSummaryChars),
    pageKey: page.pageKey
  }));

  return {
    pages: renderedPages,
    chunks: chunkResults,
    warnings
  };
}
