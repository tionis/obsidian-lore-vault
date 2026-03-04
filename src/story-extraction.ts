import { normalizeVaultPath } from './vault-path-utils';
import { upsertSummarySectionInMarkdown } from './summary-utils';
import { stripInlineLoreDirectives } from './inline-directives';
import {
  buildStructuredWikiBody,
  deriveWikiTitleFromPageKey,
  sanitizeWikiTitle
} from './wiki-markdown-format';

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

export interface StoryExtractionProgressEvent {
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
}

export interface StoryExtractionOptions {
  storyMarkdown: string;
  targetFolder: string;
  defaultTagsRaw: string;
  lorebookName: string;
  lorebookNames?: string[];
  tagPrefix: string;
  maxChunkChars: number;
  maxSummaryChars: number;
  maxOperationsPerChunk: number;
  maxExistingPagesInPrompt: number;
  callModel: (systemPrompt: string, userPrompt: string) => Promise<string>;
  onProgress?: (event: StoryExtractionProgressEvent) => void;
}

interface PageState {
  pageKey: string;
  title: string;
  summary: string;
  summaryConfidence: number;
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

function normalizeLorebookNamesToScopes(names: string[]): string[] {
  const scopes = names
    .map(normalizeLorebookNameToScope)
    .filter(Boolean);
  return uniqueStrings(scopes);
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
  const limit = Math.floor(maxChars);
  if (!Number.isFinite(limit) || limit <= 0 || singleLine.length <= limit) {
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
    const fallbackTitle = deriveWikiTitleFromPageKey(resolvedKey);
    const sanitizedTitle = sanitizeWikiTitle(title, fallbackTitle);
    operations.push({
      pageKey: resolvedKey,
      title: sanitizedTitle,
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

  // Prefer recency unless the incoming summary is substantially lower confidence.
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
    'Title must be canonical note title only. Do not prefix title with type labels like "Character:", "Location:", or "Faction:".',
    'Content must be markdown body only (no frontmatter, no top-level # title heading).',
    'Prefer sectioned markdown with ## headings (for example ## Backstory, ## Overview, ## Relationships, ## Timeline).',
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
  const resolvedTitle = sanitizeWikiTitle(
    page.title || '',
    deriveWikiTitleFromPageKey(page.pageKey || page.title)
  );
  const lines: string[] = ['---'];
  lines.push(`title: ${JSON.stringify(resolvedTitle)}`);
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
  const rawBody = page.contentBlocks.length > 0
    ? page.contentBlocks.join('\n\n---\n\n').trim()
    : '(no extracted content)';
  const structuredBody = buildStructuredWikiBody(
    resolvedTitle,
    page.pageKey,
    rawBody,
    '(no extracted content)'
  );
  let summary = normalizeSummaryLine(page.summary);
  if (!summary && page.contentBlocks.length > 0) {
    summary = buildSummary(page.contentBlocks.join(' '), maxSummaryChars);
  }
  lines.push(`sourceType: "story_extraction"`);
  lines.push(`pageKey: ${JSON.stringify(page.pageKey)}`);
  lines.push('---');

  const baseContent = [...lines, '', structuredBody.trim(), ''].join('\n');
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
  options.onProgress?.({
    stage: 'starting',
    chunkTotal: chunks.length
  });

  const pagesByKey = new Map<string, PageState>();
  const chunkResults: StoryExtractionChunkResult[] = [];
  const warnings: string[] = [];

  for (const chunk of chunks) {
    options.onProgress?.({
      stage: 'chunk_start',
      chunkIndex: chunk.index,
      chunkTotal: chunks.length
    });
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
          title: sanitizeWikiTitle(operation.title || '', deriveWikiTitleFromPageKey(key)),
          summary: '',
          summaryConfidence: 0,
          keywords: [],
          aliases: [],
          contentBlocks: []
        };
        if (operation.title) {
          existing.title = sanitizeWikiTitle(operation.title, existing.title || deriveWikiTitleFromPageKey(key));
        } else if (!existing.title) {
          existing.title = deriveWikiTitleFromPageKey(key);
        }
        const mergedSummary = mergeSummary(
          existing.summary,
          operation.summary,
          existing.summaryConfidence,
          operation.confidence
        );
        existing.summary = mergedSummary.summary;
        existing.summaryConfidence = mergedSummary.confidence;
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

  const tagPrefix = normalizeTagPrefix(options.tagPrefix);
  const defaultTags = parseDefaultTags(options.defaultTagsRaw);
  const resolvedScopes = options.lorebookNames && options.lorebookNames.length > 0
    ? normalizeLorebookNamesToScopes(options.lorebookNames)
    : normalizeLorebookNamesToScopes([options.lorebookName]);
  const lorebookTags = resolvedScopes.map(scope => `${tagPrefix}/${scope}`);
  const tags = uniqueStrings([...defaultTags, ...lorebookTags]);
  options.onProgress?.({
    stage: 'rendering_pages',
    chunkTotal: chunks.length
  });

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

  options.onProgress?.({
    stage: 'completed',
    chunkTotal: chunks.length,
    pageCount: renderedPages.length
  });

  return {
    pages: renderedPages,
    chunks: chunkResults,
    warnings
  };
}
