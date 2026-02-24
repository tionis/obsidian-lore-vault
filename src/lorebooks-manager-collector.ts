import { App, getAllTags } from 'obsidian';
import { ConverterSettings } from './models';
import { FrontmatterData, normalizeFrontmatter } from './frontmatter-utils';
import { extractLorebookScopesFromTags } from './lorebook-scoping';
import { LorebookNoteMetadata } from './lorebooks-manager-data';

export function collectLorebookNoteMetadata(app: App, settings: ConverterSettings): LorebookNoteMetadata[] {
  const files = [...app.vault.getMarkdownFiles()].sort((a, b) => a.path.localeCompare(b.path));
  const notes: LorebookNoteMetadata[] = [];

  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    const tags = cache ? (getAllTags(cache) ?? []) : [];
    const scopes = extractLorebookScopesFromTags(tags, settings.tagScoping.tagPrefix);

    notes.push({
      path: file.path,
      basename: file.basename,
      scopes,
      frontmatter
    });
  }

  return notes;
}
