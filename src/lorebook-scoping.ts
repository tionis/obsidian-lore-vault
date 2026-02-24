export type MembershipMode = 'exact' | 'cascade';

export function normalizeTagPrefix(prefix: string): string {
  return prefix
    .trim()
    .replace(/^#+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

export function normalizeScope(scope: string): string {
  return scope
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function normalizeTag(tag: string): string {
  return tag
    .trim()
    .replace(/^#+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function extractLorebookScopesFromTags(tags: string[], rawTagPrefix: string): string[] {
  const prefix = normalizeTagPrefix(rawTagPrefix);
  if (!prefix) {
    return [];
  }

  const scopes: string[] = [];

  for (const rawTag of tags) {
    const tag = normalizeTag(rawTag);

    if (tag === prefix) {
      scopes.push('');
      continue;
    }

    if (tag.startsWith(`${prefix}/`)) {
      scopes.push(normalizeScope(tag.slice(prefix.length + 1)));
    }
  }

  return uniqueSorted(scopes);
}

export function shouldIncludeInScope(
  noteScopes: string[],
  rawActiveScope: string,
  membershipMode: MembershipMode,
  includeUntagged: boolean
): boolean {
  const activeScope = normalizeScope(rawActiveScope);
  const scopes = uniqueSorted(noteScopes.map(normalizeScope));

  if (scopes.length === 0) {
    return includeUntagged;
  }

  if (!activeScope) {
    return true;
  }

  if (membershipMode === 'exact') {
    return scopes.includes(activeScope);
  }

  // Cascade mode: notes in child scopes are inherited by ancestor scopes.
  return scopes.some(scope => scope === activeScope || scope.startsWith(`${activeScope}/`));
}

export function discoverScopesFromTags(tags: string[], rawTagPrefix: string): string[] {
  const directScopes = extractLorebookScopesFromTags(tags, rawTagPrefix);
  return uniqueSorted(directScopes.filter(scope => scope.length > 0));
}
