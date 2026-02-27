export type FrontmatterData = {[key: string]: unknown};

export function stripFrontmatter(content: string): string {
  return content.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n)?/, '');
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]/g, '');
}

export function normalizeFrontmatter(frontmatter: FrontmatterData | null | undefined): FrontmatterData {
  const normalized: FrontmatterData = {};

  if (!frontmatter) {
    return normalized;
  }

  for (const [key, value] of Object.entries(frontmatter)) {
    if (normalizeKey(key) === 'position') {
      continue;
    }
    normalized[normalizeKey(key)] = value;
  }

  return normalized;
}

export function getFrontmatterValue(frontmatter: FrontmatterData, ...keys: string[]): unknown {
  for (const key of keys) {
    const normalizedKey = normalizeKey(key);
    if (normalizedKey in frontmatter) {
      return frontmatter[normalizedKey];
    }
  }
  return undefined;
}

export function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', 'no', 'n', '0', 'off'].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => asString(item))
      .filter((item): item is string => Boolean(item))
      .map(item => item.trim())
      .filter(item => item.length > 0);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0);
  }

  const scalar = asString(value);
  return scalar ? [scalar] : [];
}

export function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }

  return result;
}
