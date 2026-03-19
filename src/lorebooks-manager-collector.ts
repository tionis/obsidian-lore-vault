import { App, TFile, getAllTags } from 'obsidian';
import { ConverterSettings } from './models';
import { FrontmatterData, normalizeFrontmatter } from './frontmatter-utils';
import { extractLorebookScopesFromTags } from './lorebook-scoping';
import { LorebookNoteMetadata } from './lorebooks-manager-data';

export function collectLorebookNoteMetadataForFile(
  app: App,
  settings: ConverterSettings,
  fileOrPath: TFile | string | null | undefined
): LorebookNoteMetadata | null {
  const file = typeof fileOrPath === 'string'
    ? app.vault.getAbstractFileByPath(fileOrPath)
    : fileOrPath;
  if (!(file instanceof TFile) || !file.path.toLowerCase().endsWith('.md')) {
    return null;
  }

  const cache = app.metadataCache.getFileCache(file);
  const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
  const tags = cache ? (getAllTags(cache) ?? []) : [];
  const scopes = extractLorebookScopesFromTags(tags, settings.tagScoping.tagPrefix);

  return {
    path: file.path,
    basename: file.basename,
    scopes,
    frontmatter
  };
}

export function collectLorebookNoteMetadata(app: App, settings: ConverterSettings): LorebookNoteMetadata[] {
  const files = [...app.vault.getMarkdownFiles()].sort((a, b) => a.path.localeCompare(b.path));
  const notes: LorebookNoteMetadata[] = [];

  for (const file of files) {
    const note = collectLorebookNoteMetadataForFile(app, settings, file);
    if (note) {
      notes.push(note);
    }
  }

  return notes;
}
