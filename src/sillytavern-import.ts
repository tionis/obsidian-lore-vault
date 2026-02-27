import type { App } from 'obsidian';
import { ensureParentVaultFolderForFile, normalizeVaultPath } from './vault-path-utils';

export interface ImportedLorebookEntry {
  uid: number;
  comment: string;
  content: string;
  key: string[];
  keysecondary: string[];
  disable: boolean;
}

export interface ParseSillyTavernLorebookResult {
  entries: ImportedLorebookEntry[];
  warnings: string[];
}

export interface BuildImportedWikiPagesOptions {
  targetFolder: string;
  defaultTagsRaw: string;
  lorebookName: string;
  tagPrefix: string;
  maxSummaryChars?: number;
}

export interface ImportedWikiPage {
  path: string;
  content: string;
  uid: number;
}

export interface ApplyImportedWikiPagesResult {
  created: number;
  updated: number;
}

interface VaultLike {
  getAbstractFileByPath(path: string): unknown | null;
  create(path: string, data: string): Promise<unknown>;
  modify(file: unknown, data: string): Promise<unknown>;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeStringArray(value: unknown): string[] {
  const values: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = asString(item);
      if (normalized) {
        values.push(normalized);
      }
    }
  } else if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized) {
      values.push(normalized);
    }
  }

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const item of values) {
    const key = item.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function normalizeImportedEntry(raw: unknown, fallbackUid: number): ImportedLorebookEntry | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const entry = raw as {[key: string]: unknown};
  const uidValue = Number(entry.uid);
  const uid = Number.isFinite(uidValue) && uidValue >= 0
    ? Math.floor(uidValue)
    : fallbackUid;
  const comment = asString(entry.comment);
  const content = typeof entry.content === 'string' ? entry.content.trim() : '';
  const key = normalizeStringArray(entry.key);
  const keysecondary = normalizeStringArray(entry.keysecondary);
  const disable = asBoolean(entry.disable);

  return {
    uid,
    comment,
    content,
    key,
    keysecondary,
    disable
  };
}

function compareImportedEntries(left: ImportedLorebookEntry, right: ImportedLorebookEntry): number {
  return (
    left.uid - right.uid ||
    left.comment.localeCompare(right.comment) ||
    left.key.join('\u0000').localeCompare(right.key.join('\u0000')) ||
    left.content.localeCompare(right.content)
  );
}

function readEntriesFromParsedPayload(parsed: unknown): unknown[] {
  if (!parsed || typeof parsed !== 'object') {
    return [];
  }
  const payload = parsed as {[key: string]: unknown};
  const entries = payload.entries;
  if (Array.isArray(entries)) {
    return entries;
  }
  if (entries && typeof entries === 'object') {
    return Object.values(entries as {[key: string]: unknown});
  }
  return [];
}

export function parseSillyTavernLorebookJson(rawJson: string): ParseSillyTavernLorebookResult {
  const warnings: string[] = [];
  const parsed = JSON.parse(rawJson) as unknown;
  const rawEntries = readEntriesFromParsedPayload(parsed);
  if (rawEntries.length === 0) {
    warnings.push('No entries found in pasted JSON.');
  }

  const entries: ImportedLorebookEntry[] = [];
  for (let index = 0; index < rawEntries.length; index += 1) {
    const normalized = normalizeImportedEntry(rawEntries[index], index);
    if (!normalized) {
      warnings.push(`Skipped invalid entry at index ${index}.`);
      continue;
    }
    entries.push(normalized);
  }

  entries.sort(compareImportedEntries);
  return {
    entries,
    warnings
  };
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
  const limit = Math.max(80, Math.floor(maxChars));
  if (singleLine.length <= limit) {
    return singleLine;
  }
  return `${singleLine.slice(0, limit).trimEnd()}...`;
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

function buildNoteFrontmatter(
  entry: ImportedLorebookEntry,
  tags: string[],
  maxSummaryChars: number
): string[] {
  const lines: string[] = ['---'];
  if (entry.comment) {
    lines.push(`title: ${yamlQuote(entry.comment)}`);
  }
  lines.push(...yamlArrayBlock('aliases', entry.keysecondary));
  lines.push(...yamlArrayBlock('keywords', entry.key));
  lines.push(...yamlArrayBlock('tags', tags));

  const summary = buildSummary(entry.content, maxSummaryChars);
  if (summary) {
    lines.push(`summary: ${yamlQuote(summary)}`);
  }
  lines.push(`sourceUid: ${entry.uid}`);
  lines.push(`sourceType: "sillytavern_lorebook_import"`);
  lines.push('---');
  return lines;
}

function buildNoteBody(entry: ImportedLorebookEntry): string {
  if (entry.content) {
    return entry.content;
  }
  if (entry.comment) {
    return entry.comment;
  }
  return '(empty imported entry)';
}

function resolveUniqueFilePath(
  targetFolder: string,
  uid: number,
  stem: string,
  usedPaths: Set<string>
): string {
  const baseName = `${uid.toString().padStart(6, '0')}-${stem}`;
  let attempt = 1;
  while (attempt < 10000) {
    const suffix = attempt === 1 ? '' : `-${attempt}`;
    const candidate = normalizeVaultPath(`${targetFolder}/${baseName}${suffix}.md`);
    const key = candidate.toLowerCase();
    if (!usedPaths.has(key)) {
      usedPaths.add(key);
      return candidate;
    }
    attempt += 1;
  }
  throw new Error(`Failed to allocate unique path for ${baseName}.`);
}

export function buildImportedWikiPages(
  entries: ImportedLorebookEntry[],
  options: BuildImportedWikiPagesOptions
): ImportedWikiPage[] {
  const targetFolder = normalizeVaultPath(options.targetFolder.trim().replace(/^\/+|\/+$/g, ''));
  if (!targetFolder) {
    throw new Error('Target folder is required.');
  }

  const tagPrefix = normalizeTagPrefix(options.tagPrefix);
  const defaultTags = parseDefaultTags(options.defaultTagsRaw);
  const lorebookScope = normalizeLorebookNameToScope(options.lorebookName);
  const lorebookTag = lorebookScope ? `${tagPrefix}/${lorebookScope}` : '';
  const tags = lorebookTag ? [...defaultTags, lorebookTag] : [...defaultTags];

  const maxSummaryChars = options.maxSummaryChars ?? 320;
  const usedPaths = new Set<string>();
  const pages: ImportedWikiPage[] = [];

  for (const entry of entries) {
    const stemSource = entry.comment || entry.key[0] || `entry-${entry.uid}`;
    const stem = toSafeFileStem(stemSource);
    const filePath = resolveUniqueFilePath(targetFolder, entry.uid, stem, usedPaths);
    const frontmatter = buildNoteFrontmatter(entry, tags, maxSummaryChars);
    const body = buildNoteBody(entry);
    const content = [...frontmatter, '', body.trim(), ''].join('\n');
    pages.push({
      path: filePath,
      content,
      uid: entry.uid
    });
  }

  pages.sort((left, right) => left.path.localeCompare(right.path));
  return pages;
}

export async function applyImportedWikiPages(
  app: App,
  pages: ImportedWikiPage[]
): Promise<ApplyImportedWikiPagesResult> {
  const vault = app.vault as unknown as VaultLike;
  let created = 0;
  let updated = 0;
  for (const page of pages) {
    await ensureParentVaultFolderForFile(
      app as unknown as {
        vault: {
          getAbstractFileByPath(path: string): unknown | null;
          createFolder(path: string): Promise<unknown>;
        };
      },
      page.path
    );
    const existing = vault.getAbstractFileByPath(page.path);
    if (!existing) {
      await vault.create(page.path, page.content);
      created += 1;
      continue;
    }
    await vault.modify(existing, page.content);
    updated += 1;
  }
  return { created, updated };
}
