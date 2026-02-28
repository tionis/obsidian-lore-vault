const TYPE_PREFIX_PATTERN = /^(character|person|npc|protagonist|antagonist|place|location|faction|organization|org|group|nation|realm|world|species|item|artifact|concept|event|culture)\b(?:\s*:\s*|\s+[-–—]\s+)/i;
const H1_HEADING_PATTERN = /^\s{0,3}#\s+\S/;
const SECTION_HEADING_PATTERN = /^\s{0,3}#{2,6}\s+\S/m;

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

export function deriveWikiTitleFromPageKey(pageKey: string): string {
  const normalized = pageKey.trim();
  if (!normalized) {
    return 'Entry';
  }
  const leaf = normalized.split('/').pop() ?? normalized;
  const spaced = leaf
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spaced) {
    return 'Entry';
  }
  return spaced.replace(/\b\p{L}/gu, match => match.toUpperCase());
}

export function sanitizeWikiTitle(rawTitle: string, fallbackTitle: string): string {
  const normalized = normalizeWhitespace(rawTitle);
  const fallback = normalizeWhitespace(fallbackTitle) || 'Entry';
  if (!normalized) {
    return fallback;
  }

  let value = normalized;
  let prior = '';
  while (value && value !== prior && TYPE_PREFIX_PATTERN.test(value)) {
    prior = value;
    value = value.replace(TYPE_PREFIX_PATTERN, '').trim();
  }

  return value || fallback;
}

export function inferWikiPrimarySectionHeading(pageKey: string): string {
  const prefix = pageKey
    .trim()
    .toLowerCase()
    .split('/')[0]
    ?.trim() ?? '';

  if (prefix === 'character' || prefix === 'person' || prefix === 'npc' || prefix === 'protagonist' || prefix === 'antagonist') {
    return 'Backstory';
  }
  if (prefix === 'location' || prefix === 'place' || prefix === 'world' || prefix === 'nation' || prefix === 'realm' || prefix === 'region' || prefix === 'city') {
    return 'Overview';
  }
  if (prefix === 'faction' || prefix === 'organization' || prefix === 'org' || prefix === 'group' || prefix === 'culture') {
    return 'Overview';
  }
  if (prefix === 'item' || prefix === 'artifact' || prefix === 'relic' || prefix === 'object') {
    return 'Description';
  }
  return 'Details';
}

function stripLeadingH1(body: string): string {
  const normalized = body.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  let cursor = 0;
  while (cursor < lines.length && lines[cursor].trim().length === 0) {
    cursor += 1;
  }

  if (cursor < lines.length && H1_HEADING_PATTERN.test(lines[cursor].trim())) {
    cursor += 1;
    while (cursor < lines.length && lines[cursor].trim().length === 0) {
      cursor += 1;
    }
    return lines.slice(cursor).join('\n').trim();
  }

  return normalized.trim();
}

export function normalizeWikiSectionBody(rawBody: string, pageKey: string): string {
  const withoutLeadingH1 = stripLeadingH1(rawBody);
  if (!withoutLeadingH1) {
    return '';
  }
  if (SECTION_HEADING_PATTERN.test(withoutLeadingH1)) {
    return withoutLeadingH1;
  }
  const heading = inferWikiPrimarySectionHeading(pageKey);
  return [`## ${heading}`, '', withoutLeadingH1].join('\n').trim();
}

export function buildStructuredWikiBody(
  title: string,
  pageKey: string,
  rawBody: string,
  emptyBodyPlaceholder: string
): string {
  const sectionBody = normalizeWikiSectionBody(rawBody, pageKey) || [
    `## ${inferWikiPrimarySectionHeading(pageKey)}`,
    '',
    emptyBodyPlaceholder
  ].join('\n');

  return [
    `# ${title}`,
    '',
    sectionBody.trim()
  ].join('\n').trim();
}
