import { slugifyIdentifier } from './hash-utils';
import { normalizeVaultPath } from './vault-path-utils';

export interface StoryChapterFrontmatterData {
  storyId?: string;
  chapter?: number | null;
  chapterTitle?: string;
  previousChapterRefs?: string[];
  nextChapterRefs?: string[];
}

export interface StoryChapterSection {
  chapterNumber: number;
  chapterTitle: string;
  chapterBody: string;
}

const MANAGED_STORY_KEYS = new Set([
  'storyid',
  'chapter',
  'chaptertitle',
  'previouschapter',
  'prevchapter',
  'previous',
  'prev',
  'nextchapter',
  'next'
]);

function normalizeYamlKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s_-]/g, '');
}

function isTopLevelYamlKey(line: string): boolean {
  return /^[A-Za-z0-9_-]+\s*:/.test(line.trim());
}

function normalizeMarkdown(text: string): string {
  return (text ?? '').replace(/\r\n?/g, '\n');
}

function splitFrontmatter(rawMarkdown: string): {
  frontmatterLines: string[];
  body: string;
} {
  const normalized = normalizeMarkdown(rawMarkdown);
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return {
      frontmatterLines: [],
      body: normalized.replace(/^\n+/, '')
    };
  }

  return {
    frontmatterLines: match[1].split('\n'),
    body: normalized.slice(match[0].length).replace(/^\n+/, '')
  };
}

function stripManagedStoryChapterFields(frontmatterLines: string[]): string[] {
  const output: string[] = [];
  let index = 0;

  while (index < frontmatterLines.length) {
    const line = frontmatterLines[index];
    const keyMatch = line.match(/^([A-Za-z0-9_-]+)\s*:/);
    if (!keyMatch) {
      output.push(line);
      index += 1;
      continue;
    }

    const normalizedKey = normalizeYamlKey(keyMatch[1]);
    if (!MANAGED_STORY_KEYS.has(normalizedKey)) {
      output.push(line);
      index += 1;
      continue;
    }

    index += 1;
    while (index < frontmatterLines.length) {
      const nextLine = frontmatterLines[index];
      if (!nextLine.trim()) {
        index += 1;
        continue;
      }
      if (!isTopLevelYamlKey(nextLine) && /^\s+/.test(nextLine)) {
        index += 1;
        continue;
      }
      break;
    }
  }

  while (output.length > 0 && !output[output.length - 1].trim()) {
    output.pop();
  }

  return output;
}

function normalizeRefList(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const deduped: string[] = [];
  for (const raw of values) {
    const normalized = String(raw ?? '').trim();
    if (!normalized || deduped.includes(normalized)) {
      continue;
    }
    deduped.push(normalized);
  }
  return deduped;
}

function renderYamlStringArrayOrScalar(key: string, values: string[]): string[] {
  if (values.length === 0) {
    return [];
  }
  if (values.length === 1) {
    return [`${key}: ${JSON.stringify(values[0])}`];
  }

  const lines = [`${key}:`];
  for (const value of values) {
    lines.push(`  - ${JSON.stringify(value)}`);
  }
  return lines;
}

function renderStoryChapterFields(data: StoryChapterFrontmatterData): string[] {
  const lines: string[] = [];
  const storyId = (data.storyId ?? '').trim();
  if (storyId) {
    lines.push(`storyId: ${JSON.stringify(storyId)}`);
  }

  if (typeof data.chapter === 'number' && Number.isFinite(data.chapter)) {
    lines.push(`chapter: ${Math.max(0, Math.floor(data.chapter))}`);
  }

  const chapterTitle = (data.chapterTitle ?? '').trim();
  if (chapterTitle) {
    lines.push(`chapterTitle: ${JSON.stringify(chapterTitle)}`);
  }

  lines.push(
    ...renderYamlStringArrayOrScalar(
      'previousChapter',
      normalizeRefList(data.previousChapterRefs)
    )
  );
  lines.push(
    ...renderYamlStringArrayOrScalar(
      'nextChapter',
      normalizeRefList(data.nextChapterRefs)
    )
  );

  return lines;
}

export function upsertStoryChapterFrontmatter(
  rawMarkdown: string,
  data: StoryChapterFrontmatterData
): string {
  const split = splitFrontmatter(rawMarkdown);
  const cleaned = stripManagedStoryChapterFields(split.frontmatterLines);
  const storyFields = renderStoryChapterFields(data);
  const frontmatterLines = cleaned.length > 0
    ? (storyFields.length > 0 ? [...cleaned, '', ...storyFields] : [...cleaned])
    : [...storyFields];

  if (frontmatterLines.length === 0) {
    return `${split.body.trimEnd()}\n`;
  }

  return [
    '---',
    ...frontmatterLines,
    '---',
    '',
    split.body.trimEnd()
  ].join('\n').trimEnd() + '\n';
}

function stripLeadingH1(body: string): string {
  const lines = normalizeMarkdown(body).split('\n');
  let cursor = 0;
  while (cursor < lines.length && !lines[cursor].trim()) {
    cursor += 1;
  }
  if (cursor < lines.length && /^#\s+\S/.test(lines[cursor].trim())) {
    cursor += 1;
    while (cursor < lines.length && !lines[cursor].trim()) {
      cursor += 1;
    }
  }
  return lines.slice(cursor).join('\n').trim();
}

export function splitStoryMarkdownIntoChapterSections(rawMarkdown: string): StoryChapterSection[] {
  const split = splitFrontmatter(rawMarkdown);
  const body = stripLeadingH1(split.body);
  if (!body) {
    return [];
  }

  const headingRegex = /^##\s+(.+)$/gm;
  const headings: Array<{ index: number; title: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(body)) !== null) {
    headings.push({
      index: match.index,
      title: (match[1] ?? '').trim()
    });
  }

  if (headings.length === 0) {
    return [];
  }

  const prologue = body.slice(0, headings[0].index).trim();
  const sections: StoryChapterSection[] = [];

  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index];
    const start = current.index;
    const end = headings[index + 1]?.index ?? body.length;
    const rawSection = body.slice(start, end).trim();
    const firstNewline = rawSection.indexOf('\n');
    const chapterTitle = current.title || `Chapter ${index + 1}`;
    let chapterBody = firstNewline >= 0
      ? rawSection.slice(firstNewline + 1).trim()
      : '';

    if (index === 0 && prologue) {
      chapterBody = chapterBody
        ? `${prologue}\n\n${chapterBody}`
        : prologue;
    }

    sections.push({
      chapterNumber: index + 1,
      chapterTitle,
      chapterBody: chapterBody.trim()
    });
  }

  return sections;
}

export function buildStoryChapterNoteMarkdown(
  sourceRawMarkdown: string,
  data: StoryChapterFrontmatterData,
  chapterTitle: string,
  chapterBody: string
): string {
  const withFrontmatter = upsertStoryChapterFrontmatter(sourceRawMarkdown, data);
  const split = splitFrontmatter(withFrontmatter);
  const title = chapterTitle.trim() || 'Chapter';
  const body = chapterBody.trim();
  const structuredBody = body
    ? `# ${title}\n\n${body}\n`
    : `# ${title}\n\n`;

  if (split.frontmatterLines.length === 0) {
    return structuredBody;
  }

  return [
    '---',
    ...split.frontmatterLines,
    '---',
    '',
    structuredBody.trimEnd()
  ].join('\n').trimEnd() + '\n';
}

export function deriveStoryIdFromTitle(value: string): string {
  const slug = slugifyIdentifier((value ?? '').trim());
  return slug || 'story';
}

export function formatStoryChapterRef(filePath: string): string {
  const normalized = normalizeVaultPath(filePath)
    .replace(/\.md$/i, '')
    .trim();
  return `[[${normalized}]]`;
}

export function buildChapterFileStem(storyId: string, chapterNumber: number, chapterTitle: string): string {
  const storySlug = slugifyIdentifier(storyId).replace(/\./g, '-');
  const chapterSlug = slugifyIdentifier(chapterTitle || `chapter-${chapterNumber}`).replace(/\./g, '-');
  const chapterLabel = String(Math.max(1, Math.floor(chapterNumber))).padStart(2, '0');
  return `${storySlug}-ch${chapterLabel}-${chapterSlug}`;
}
