import { normalizeScope } from './lorebook-scoping';
import { normalizeLinkTarget } from './link-target-index';
import { ImportedWikiPage } from './sillytavern-import';
import {
  buildChapterFileStem,
  buildStoryChapterNoteMarkdown,
  deriveStoryIdFromTitle
} from './story-chapter-management';
import { normalizeVaultPath } from './vault-path-utils';

const STORY_STARTER_SOURCE_TYPE = 'lorevault_story_starter';

export interface StoryStarterPromptInput {
  requestedTitle: string;
  storyIdea: string;
  brainstormNotes: string;
  selectedLorebooks: string[];
  loreContextMarkdown: string;
}

export interface StoryStarterResult {
  title: string;
  chapterTitle: string;
  storyMarkdown: string;
  authorNoteMarkdown: string;
  starterNotes: string[];
}

export interface BuildStoryStarterImportPlanOptions {
  targetFolder: string;
  authorNoteFolder: string;
  defaultTagsRaw: string;
  lorebookNames: string[];
  completionPresetId?: string;
}

export interface StoryStarterImportPlan {
  pages: ImportedWikiPage[];
  warnings: string[];
  storyPath: string;
  authorNotePath: string;
  storyId: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(value.map(item => asString(item)).filter(Boolean));
  }
  const normalized = asString(value);
  return normalized ? [normalized] : [];
}

function uniqueStrings(values: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
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

function trimTo(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function yamlQuote(value: string): string {
  return JSON.stringify(value);
}

function yamlArrayBlock(key: string, values: string[]): string[] {
  if (values.length === 0) {
    return [];
  }
  const lines = [`${key}:`];
  for (const item of values) {
    lines.push(`  - ${yamlQuote(item)}`);
  }
  return lines;
}

function parseDefaultTags(raw: string): string[] {
  return uniqueStrings(
    raw
      .split(/[\n,]+/)
      .map(item => item.trim().replace(/^#+/, '').replace(/^\/+|\/+$/g, ''))
      .filter(Boolean)
  );
}

function normalizeLorebookNames(values: string[]): string[] {
  return uniqueStrings(
    values
      .map(value => normalizeScope(value))
      .filter(Boolean)
  ).sort((left, right) => left.localeCompare(right));
}

function stripLeadingTopLevelHeading(markdown: string): string {
  const normalized = markdown.replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return '';
  }
  const lines = normalized.split('\n');
  if (!/^#\s+\S/.test(lines[0].trim())) {
    return normalized;
  }
  let index = 1;
  while (index < lines.length && !lines[index].trim()) {
    index += 1;
  }
  return lines.slice(index).join('\n').trim();
}

function ensureHeading(markdown: string, heading: string): string {
  const normalized = markdown.replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return `# ${heading}`;
  }
  if (/^#\s+\S/.test(normalized)) {
    return normalized;
  }
  return `# ${heading}\n\n${normalized}`;
}

function collectUnresolvedPlaceholders(value: string): string[] {
  const matches = value.match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g) ?? [];
  return uniqueStrings(
    matches.map(item => item.replace(/\s+/g, '').toLowerCase())
  ).sort((left, right) => left.localeCompare(right));
}

function buildStoryPageContent(
  result: StoryStarterResult,
  storyId: string,
  authorNotePath: string,
  defaultTags: string[],
  lorebookNames: string[]
): string {
  const frontmatter: string[] = [
    '---',
    `title: ${yamlQuote(result.title)}`,
    `authorNote: ${yamlQuote(`[[${normalizeLinkTarget(authorNotePath)}]]`)}`,
    ...yamlArrayBlock('tags', defaultTags),
    ...yamlArrayBlock('lorebooks', lorebookNames),
    `sourceType: ${yamlQuote(STORY_STARTER_SOURCE_TYPE)}`,
    '---',
    ''
  ];

  const chapterTitle = result.chapterTitle || 'Chapter 1';
  const chapterBody = stripLeadingTopLevelHeading(result.storyMarkdown);
  return buildStoryChapterNoteMarkdown(
    frontmatter.join('\n'),
    {
      storyId,
      chapter: 1,
      chapterTitle
    },
    chapterTitle,
    chapterBody
  );
}

function buildAuthorNoteContent(
  result: StoryStarterResult,
  storyId: string,
  defaultTags: string[],
  lorebookNames: string[],
  completionPresetId: string
): string {
  const lines: string[] = [
    '---',
    `title: ${yamlQuote(`${result.title} Author Note`)}`,
    'lvDocType: "authorNote"',
    `storyId: ${yamlQuote(storyId)}`,
    ...yamlArrayBlock('tags', defaultTags),
    ...yamlArrayBlock('lorebooks', lorebookNames),
    `sourceType: ${yamlQuote(STORY_STARTER_SOURCE_TYPE)}`
  ];
  if (completionPresetId.trim()) {
    lines.push(`completionProfile: ${yamlQuote(completionPresetId.trim())}`);
  }
  lines.push('---', '', result.authorNoteMarkdown.trim() || '## Author Note', '');
  return lines.join('\n');
}

export function buildStoryStarterSystemPrompt(): string {
  return [
    'You are a careful fiction development editor.',
    'Turn a story idea into a usable LoreVault story starter.',
    'Return JSON only. Do not wrap it in markdown fences.',
    'Required JSON schema:',
    '{',
    '  "title": "string",',
    '  "chapterTitle": "string",',
    '  "storyMarkdown": "markdown string",',
    '  "authorNoteMarkdown": "markdown string",',
    '  "starterNotes": ["string"]',
    '}',
    'Rules:',
    '- If `requestedTitle` is non-empty, keep it unless it directly conflicts with stronger input constraints.',
    '- Treat `loreContextMarkdown` as canon constraints when it is present.',
    '- `storyMarkdown` must be prose suitable for the first chapter or introduction, not an outline.',
    '- Start near the first dramatic movement; avoid spending the whole opening on exposition.',
    '- Use markdown body content only. No YAML frontmatter and no code fences.',
    '- `authorNoteMarkdown` must be practical writing guidance: tone, POV, constraints, immediate tensions, and near-term next-scene guidance.',
    '- Keep the author note specific and operational. Do not restate long encyclopedic lore dumps.',
    '- `starterNotes` should be short bullets about key assumptions, risks, or deliberate framing choices.',
    '- Do not include placeholders like `{{user}}` or `{{char}}` in the output.',
    '- Keep the output internally consistent and faithful to the provided idea and lore.'
  ].join('\n');
}

export function buildStoryStarterUserPrompt(input: StoryStarterPromptInput): string {
  const payload = {
    requestedTitle: input.requestedTitle.trim(),
    storyIdea: trimTo(input.storyIdea.trim(), 8000),
    brainstormNotes: trimTo(input.brainstormNotes.trim(), 12000),
    selectedLorebooks: normalizeLorebookNames(input.selectedLorebooks),
    loreContextMarkdown: trimTo(input.loreContextMarkdown.trim(), 16000)
  };

  return [
    'Build a story starter from the following input.',
    '',
    'Input JSON:',
    JSON.stringify(payload, null, 2),
    '',
    'Output only JSON with keys: title, chapterTitle, storyMarkdown, authorNoteMarkdown, starterNotes.'
  ].join('\n');
}

export function parseStoryStarterResponse(raw: string): StoryStarterResult {
  const payload = extractJsonPayload(raw);
  const objectPayload = asRecord(payload);
  if (!objectPayload) {
    throw new Error('Story starter response payload is not an object.');
  }

  const title = asString(objectPayload.title)
    || asString(objectPayload.storyTitle)
    || asString(objectPayload.name)
    || 'Story Starter';
  const chapterTitle = asString(objectPayload.chapterTitle)
    || asString(objectPayload.openingTitle)
    || asString(objectPayload.chapter)
    || 'Chapter 1';
  const storyMarkdown = asString(objectPayload.storyMarkdown)
    || asString(objectPayload.chapterMarkdown)
    || asString(objectPayload.openingMarkdown)
    || asString(objectPayload.story);
  const authorNoteMarkdown = asString(objectPayload.authorNoteMarkdown)
    || asString(objectPayload.authorNote)
    || asString(objectPayload.authorNotes);
  const starterNotes = asStringArray(
    objectPayload.starterNotes
    ?? objectPayload.rewriteNotes
    ?? objectPayload.notes
  );

  if (!storyMarkdown) {
    throw new Error('Story starter response is missing `storyMarkdown`.');
  }
  if (!authorNoteMarkdown) {
    throw new Error('Story starter response is missing `authorNoteMarkdown`.');
  }

  return {
    title,
    chapterTitle,
    storyMarkdown,
    authorNoteMarkdown,
    starterNotes
  };
}

export function buildStoryStarterImportPlan(
  result: StoryStarterResult,
  options: BuildStoryStarterImportPlanOptions
): StoryStarterImportPlan {
  const targetFolder = normalizeVaultPath(options.targetFolder.trim().replace(/^\/+|\/+$/g, ''));
  if (!targetFolder) {
    throw new Error('Target folder is required.');
  }

  const authorNoteFolder = normalizeVaultPath(options.authorNoteFolder.trim().replace(/^\/+|\/+$/g, ''));
  if (!authorNoteFolder) {
    throw new Error('Author-note folder is required.');
  }

  const storyId = deriveStoryIdFromTitle(result.title);
  const chapterTitle = result.chapterTitle || 'Chapter 1';
  const storyPath = normalizeVaultPath(
    `${targetFolder}/${buildChapterFileStem(storyId, 1, chapterTitle)}.md`
  );
  const authorNotePath = normalizeVaultPath(`${authorNoteFolder}/${storyId}-author-note.md`);
  const defaultTags = parseDefaultTags(options.defaultTagsRaw);
  const lorebookNames = normalizeLorebookNames(options.lorebookNames);

  const storyContent = buildStoryPageContent(
    result,
    storyId,
    authorNotePath,
    defaultTags,
    lorebookNames
  );
  const authorNoteContent = buildAuthorNoteContent(
    result,
    storyId,
    defaultTags,
    lorebookNames,
    options.completionPresetId ?? ''
  );

  const warnings = uniqueStrings([
    ...collectUnresolvedPlaceholders(storyContent).map(token => `Story note still contains unresolved placeholder: ${token}`),
    ...collectUnresolvedPlaceholders(authorNoteContent).map(token => `Author note still contains unresolved placeholder: ${token}`)
  ]).sort((left, right) => left.localeCompare(right));

  const pages: ImportedWikiPage[] = [
    {
      path: storyPath,
      content: storyContent,
      uid: 0
    },
    {
      path: authorNotePath,
      content: authorNoteContent,
      uid: 1
    }
  ].sort((left, right) => left.path.localeCompare(right.path));

  return {
    pages,
    warnings,
    storyPath,
    authorNotePath,
    storyId
  };
}

export function buildStoryStarterPreviewStoryMarkdown(result: StoryStarterResult): string {
  return ensureHeading(result.storyMarkdown, result.chapterTitle || 'Chapter 1');
}
