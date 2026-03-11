export const DEFAULT_IGNORED_LLM_CALLOUT_TYPES = [
  'lv-thinking',
  'lv-ignore',
  'note'
] as const;

const CALLOUT_MARKER_PATTERN = /^\[!\s*([^\]\s]+)\s*\](?:[+-])?(?:\s+.*)?$/i;
const CALLOUT_START_PATTERN = /^\s*>\s*\[!\s*([^\]\s]+)\s*\](?:[+-])?(?:\s+.*)?$/i;
const BLOCKQUOTE_LINE_PATTERN = /^\s*>/;

export function normalizeCalloutType(value: unknown): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  const calloutMatch = normalized.match(CALLOUT_MARKER_PATTERN);
  const candidate = calloutMatch?.[1] ?? normalized;
  return candidate
    .replace(/^!+/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeIgnoredCalloutTypes(
  value: unknown,
  fallback: readonly string[] = DEFAULT_IGNORED_LLM_CALLOUT_TYPES
): string[] {
  const rawValues = Array.isArray(value)
    ? value.map(item => String(item ?? ''))
    : typeof value === 'string'
      ? value.split(/[\n,]+/)
      : [];

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const rawValue of rawValues) {
    const calloutType = normalizeCalloutType(rawValue);
    if (!calloutType || seen.has(calloutType)) {
      continue;
    }
    seen.add(calloutType);
    normalized.push(calloutType);
  }

  if (normalized.length > 0) {
    return normalized;
  }

  return [...fallback];
}

export function stripIgnoredCallouts(source: string, ignoredCalloutTypes: readonly string[] = []): string {
  if (!source) {
    return '';
  }

  const ignored = new Set(normalizeIgnoredCalloutTypes(ignoredCalloutTypes, []));
  if (ignored.size === 0) {
    return source.replace(/\r\n?/g, '\n');
  }

  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const kept: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const calloutMatch = line.match(CALLOUT_START_PATTERN);
    const calloutType = normalizeCalloutType(calloutMatch?.[1] ?? '');
    if (calloutType && ignored.has(calloutType)) {
      index += 1;
      while (index < lines.length && BLOCKQUOTE_LINE_PATTERN.test(lines[index])) {
        index += 1;
      }
      index -= 1;
      continue;
    }
    kept.push(line);
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function buildObsidianCallout(
  type: string,
  body: string,
  options: {
    title?: string;
    collapsed?: boolean;
  } = {}
): string {
  const normalizedType = normalizeCalloutType(type) || 'note';
  const normalizedBody = body.replace(/\r\n?/g, '\n').trim();
  if (!normalizedBody) {
    return '';
  }

  const title = options.title?.trim() ?? '';
  const collapseMarker = options.collapsed === false ? '' : '-';
  const header = title
    ? `> [!${normalizedType}]${collapseMarker} ${title}`
    : `> [!${normalizedType}]${collapseMarker}`;

  return [
    header,
    ...normalizedBody.split('\n').map(line => line ? `> ${line}` : '>')
  ].join('\n');
}

export function buildThinkingCallout(body: string): string {
  return buildObsidianCallout('lv-thinking', body, {
    title: 'Thinking',
    collapsed: true
  });
}
