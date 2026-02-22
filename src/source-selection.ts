import { FrontmatterData, asBoolean, asStringArray, getFrontmatterValue } from './frontmatter-utils';
import { ConverterSettings } from './models';

export interface SourceSelectionDecision {
  include: boolean;
  reason: string;
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function normalizeFolder(folder: string): string {
  return normalizePath(folder).replace(/\/+$/, '');
}

function isPathInFolder(filePath: string, folder: string): boolean {
  const normalizedPath = normalizePath(filePath);
  const normalizedFolder = normalizeFolder(folder);

  if (!normalizedFolder) {
    return false;
  }

  return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#/, '').toLowerCase();
}

function getTags(frontmatter: FrontmatterData): Set<string> {
  const tagsValue = getFrontmatterValue(frontmatter, 'tags');
  const rawTags = asStringArray(tagsValue);
  const tags = new Set<string>();

  for (const rawTag of rawTags) {
    for (const part of rawTag.split(/\s+/)) {
      const normalized = normalizeTag(part);
      if (normalized) {
        tags.add(normalized);
      }
    }
  }

  return tags;
}

function hasAnyTag(tags: Set<string>, requiredTags: string[]): boolean {
  for (const requiredTag of requiredTags) {
    if (tags.has(normalizeTag(requiredTag))) {
      return true;
    }
  }
  return false;
}

function isRecord(value: unknown): value is {[key: string]: unknown} {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLorebookEnabled(frontmatter: FrontmatterData): boolean {
  const lorebookValue = getFrontmatterValue(frontmatter, 'lorebook');

  if (lorebookValue === undefined) {
    return false;
  }

  const lorebookBoolean = asBoolean(lorebookValue);
  if (lorebookBoolean !== undefined) {
    return lorebookBoolean;
  }

  if (Array.isArray(lorebookValue)) {
    return lorebookValue.length > 0;
  }

  if (isRecord(lorebookValue)) {
    const enabled = asBoolean(lorebookValue.enabled);
    if (enabled !== undefined) {
      return enabled;
    }
    const exclude = asBoolean(lorebookValue.exclude);
    if (exclude === true) {
      return false;
    }
    return true;
  }

  return true;
}

function isExplicitlyExcluded(frontmatter: FrontmatterData): boolean {
  const exclude = asBoolean(getFrontmatterValue(frontmatter, 'exclude'));
  if (exclude === true) {
    return true;
  }

  const lorebookValue = getFrontmatterValue(frontmatter, 'lorebook');
  if (lorebookValue === undefined) {
    return false;
  }

  const lorebookBoolean = asBoolean(lorebookValue);
  if (lorebookBoolean === false) {
    return true;
  }

  if (isRecord(lorebookValue)) {
    const nestedExclude = asBoolean(lorebookValue.exclude);
    if (nestedExclude === true) {
      return true;
    }
    const nestedEnabled = asBoolean(lorebookValue.enabled);
    if (nestedEnabled === false) {
      return true;
    }
  }

  return false;
}

export function shouldIncludeSourceFile(
  filePath: string,
  frontmatter: FrontmatterData,
  sourceSelection: ConverterSettings['sourceSelection']
): SourceSelectionDecision {
  if (isExplicitlyExcluded(frontmatter)) {
    return { include: false, reason: 'excluded-by-frontmatter' };
  }

  for (const folder of sourceSelection.excludeFolders) {
    if (isPathInFolder(filePath, folder)) {
      return { include: false, reason: `excluded-by-folder:${folder}` };
    }
  }

  if (sourceSelection.includeFolders.length > 0) {
    const matchesIncludedFolder = sourceSelection.includeFolders.some(folder =>
      isPathInFolder(filePath, folder)
    );
    if (!matchesIncludedFolder) {
      return { include: false, reason: 'not-in-included-folders' };
    }
  }

  const tags = getTags(frontmatter);

  if (sourceSelection.excludeTags.length > 0 && hasAnyTag(tags, sourceSelection.excludeTags)) {
    return { include: false, reason: 'excluded-by-tag' };
  }

  if (sourceSelection.includeTags.length > 0 && !hasAnyTag(tags, sourceSelection.includeTags)) {
    return { include: false, reason: 'missing-required-tag' };
  }

  if (sourceSelection.requireLorebookFlag && !isLorebookEnabled(frontmatter)) {
    return { include: false, reason: 'missing-lorebook-flag' };
  }

  return { include: true, reason: 'included' };
}
