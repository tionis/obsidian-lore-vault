import { App, TFile } from 'obsidian';
import {
  FrontmatterData,
  asString,
  getFrontmatterValue,
  stripFrontmatter
} from './frontmatter-utils';

export interface ChapterSummarySnapshot {
  text: string;
  source: 'frontmatter' | 'excerpt';
}

interface ChapterSummaryCacheEntry {
  mtime: number;
  summary: ChapterSummarySnapshot;
}

export class ChapterSummaryStore {
  private readonly app: App;
  private readonly cache = new Map<string, ChapterSummaryCacheEntry>();

  constructor(app: App) {
    this.app = app;
  }

  invalidatePath(path: string): void {
    this.cache.delete(path);
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  async resolveSummary(
    file: TFile,
    frontmatter: FrontmatterData,
    excerptBuilder: (body: string) => string
  ): Promise<ChapterSummarySnapshot | null> {
    const cached = this.cache.get(file.path);
    const mtime = file.stat?.mtime ?? 0;
    if (cached && cached.mtime === mtime) {
      return cached.summary;
    }

    const summaryFromFrontmatter = asString(getFrontmatterValue(frontmatter, 'summary'))?.trim() ?? '';
    if (summaryFromFrontmatter) {
      const summary: ChapterSummarySnapshot = {
        text: summaryFromFrontmatter,
        source: 'frontmatter'
      };
      this.cache.set(file.path, { mtime, summary });
      return summary;
    }

    const raw = await this.app.vault.cachedRead(file);
    const body = stripFrontmatter(raw).trim();
    if (!body) {
      this.cache.delete(file.path);
      return null;
    }

    const excerpt = excerptBuilder(body).trim();
    if (!excerpt) {
      this.cache.delete(file.path);
      return null;
    }

    const summary: ChapterSummarySnapshot = {
      text: excerpt,
      source: 'excerpt'
    };
    this.cache.set(file.path, { mtime, summary });
    return summary;
  }
}
