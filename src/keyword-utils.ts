import { asStringArray, uniqueStrings } from './frontmatter-utils';

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeKeywordValue(value: string): string {
  const cleaned = normalizeWhitespace(
    value
      .replace(/^[-*+\d.)\s]+/, '')
      .replace(/^"+|"+$/g, '')
      .replace(/^'+|'+$/g, '')
  );
  if (!cleaned) {
    return '';
  }
  return cleaned.slice(0, 64);
}

function dedupeKeywords(values: string[]): string[] {
  const normalized = uniqueStrings(
    values
      .map(normalizeKeywordValue)
      .filter(Boolean)
  );
  const seenLower = new Set<string>();
  const output: string[] = [];
  for (const value of normalized) {
    const lowered = value.toLowerCase();
    if (seenLower.has(lowered)) {
      continue;
    }
    seenLower.add(lowered);
    output.push(value);
  }
  return output.slice(0, 16);
}

function parseJsonKeywords(raw: string): string[] {
  const tryParse = (payload: string): string[] => {
    const parsed = JSON.parse(payload) as unknown;
    if (Array.isArray(parsed)) {
      return asStringArray(parsed);
    }
    if (parsed && typeof parsed === 'object') {
      const keywords = (parsed as {[key: string]: unknown})['keywords'];
      return asStringArray(keywords);
    }
    return [];
  };

  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  try {
    return tryParse(trimmed);
  } catch (_error) {
    // fall through to block extraction
  }

  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    const objectPayload = trimmed.slice(objectStart, objectEnd + 1);
    try {
      return tryParse(objectPayload);
    } catch (_error) {
      // ignore
    }
  }

  const arrayStart = trimmed.indexOf('[');
  const arrayEnd = trimmed.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    const arrayPayload = trimmed.slice(arrayStart, arrayEnd + 1);
    try {
      return tryParse(arrayPayload);
    } catch (_error) {
      // ignore
    }
  }

  return [];
}

export function parseGeneratedKeywords(raw: string): string[] {
  const jsonParsed = parseJsonKeywords(raw);
  if (jsonParsed.length > 0) {
    return dedupeKeywords(jsonParsed);
  }

  const fallback = raw
    .replace(/\r\n?/g, '\n')
    .split(/[\n,]/g)
    .map(item => item.trim())
    .filter(Boolean);
  return dedupeKeywords(fallback);
}

function normalizeFrontmatterKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s_-]/g, '');
}

function isTopLevelYamlKey(line: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9_-]*\s*:/.test(line.trim());
}

function stripKeywordFields(frontmatterLines: string[]): string[] {
  const output: string[] = [];
  let index = 0;
  while (index < frontmatterLines.length) {
    const line = frontmatterLines[index];
    const trimmed = line.trim();
    const keyMatch = /^([A-Za-z0-9_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(trimmed);
    if (!keyMatch) {
      output.push(line);
      index += 1;
      continue;
    }

    const normalizedKey = normalizeFrontmatterKey(keyMatch[1]);
    if (normalizedKey !== 'keywords' && normalizedKey !== 'key') {
      output.push(line);
      index += 1;
      continue;
    }

    // Skip current key line + any following indented list/block lines.
    index += 1;
    while (index < frontmatterLines.length) {
      const next = frontmatterLines[index];
      if (!next.trim()) {
        index += 1;
        continue;
      }
      if (!isTopLevelYamlKey(next) && /^\s+/.test(next)) {
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

function renderKeywordsBlock(keywords: string[]): string[] {
  const lines = ['keywords:'];
  for (const keyword of keywords) {
    const escaped = keyword.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    lines.push(`  - "${escaped}"`);
  }
  return lines;
}

export function upsertKeywordsFrontmatter(rawMarkdown: string, keywordsInput: string[]): string {
  const keywords = dedupeKeywords(keywordsInput);
  if (keywords.length === 0) {
    return rawMarkdown;
  }

  const normalizedRaw = rawMarkdown.replace(/\r\n?/g, '\n');
  const frontmatterMatch = normalizedRaw.match(/^---\n([\s\S]*?)\n---\n?/);
  const keywordBlock = renderKeywordsBlock(keywords);

  if (!frontmatterMatch) {
    const body = normalizedRaw.replace(/^\n+/, '');
    return ['---', ...keywordBlock, '---', '', body].join('\n').trimEnd() + '\n';
  }

  const rawFrontmatter = frontmatterMatch[1];
  const body = normalizedRaw.slice(frontmatterMatch[0].length).replace(/^\n+/, '');
  const cleanedLines = stripKeywordFields(rawFrontmatter.split('\n'));
  const nextFrontmatterLines = cleanedLines.length > 0
    ? [...cleanedLines, '', ...keywordBlock]
    : [...keywordBlock];

  return ['---', ...nextFrontmatterLines, '---', '', body].join('\n').trimEnd() + '\n';
}

