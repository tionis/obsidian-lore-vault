import { FrontmatterData, asStringArray, getFrontmatterValue, normalizeFrontmatter } from './frontmatter-utils';
import { normalizeScope, normalizeTagPrefix } from './lorebook-scoping';

const STORY_SCOPE_KEYS = [
  'lorebooks',
  'lorebookScopes',
  'lorevaultScopes',
  'activeLorebooks'
];

export function normalizeStoryScopeReference(rawValue: string, tagPrefix: string): string {
  const normalizedPrefix = normalizeTagPrefix(tagPrefix);
  let value = rawValue.trim().replace(/^#+/, '').replace(/^\/+/, '');
  if (!value) {
    return '';
  }

  const lowered = value.toLowerCase();
  if (normalizedPrefix && lowered.startsWith(`${normalizedPrefix}/`)) {
    value = value.slice(normalizedPrefix.length + 1);
  }

  return normalizeScope(value);
}

export function parseStoryScopesFromRawValues(rawValues: string[], tagPrefix: string): string[] {
  const seen = new Set<string>();
  const scopes: string[] = [];

  for (const rawValue of rawValues) {
    const scope = normalizeStoryScopeReference(rawValue, tagPrefix);
    if (!scope || seen.has(scope)) {
      continue;
    }
    seen.add(scope);
    scopes.push(scope);
  }

  return scopes;
}

export function parseStoryScopesFromFrontmatter(
  frontmatter: FrontmatterData,
  tagPrefix: string
): string[] {
  const normalizedFrontmatter = normalizeFrontmatter(frontmatter);
  const rawValues = asStringArray(getFrontmatterValue(normalizedFrontmatter, ...STORY_SCOPE_KEYS));
  return parseStoryScopesFromRawValues(rawValues, tagPrefix);
}
