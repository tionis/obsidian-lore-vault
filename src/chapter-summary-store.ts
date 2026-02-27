import type { App, TFile } from 'obsidian';
import { ConverterSettings } from './models';
import {
  FrontmatterData,
  asString,
  getFrontmatterValue,
  stripFrontmatter
} from './frontmatter-utils';
import { GeneratedSummaryStore } from './generated-summary-store';
import { buildGeneratedSummarySignature } from './summary-utils';

export interface ChapterSummarySnapshot {
  text: string;
  source: 'frontmatter' | 'generated' | 'excerpt';
}

interface ChapterSummaryCacheEntry {
  mtime: number;
  summary: ChapterSummarySnapshot;
}

export class ChapterSummaryStore {
  private readonly app: App;
  private readonly getSettings: () => ConverterSettings;
  private readonly generatedSummaryStore: GeneratedSummaryStore;
  private readonly cache = new Map<string, ChapterSummaryCacheEntry>();

  constructor(
    app: App,
    getSettings: () => ConverterSettings,
    generatedSummaryStore: GeneratedSummaryStore
  ) {
    this.app = app;
    this.getSettings = getSettings;
    this.generatedSummaryStore = generatedSummaryStore;
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

    const settings = this.getSettings();
    if (settings.summaries.chapter.useGeneratedSummary) {
      const signature = buildGeneratedSummarySignature('chapter', body, settings);
      const generatedSummary = await this.generatedSummaryStore.getAcceptedSummary(
        file.path,
        'chapter',
        signature
      );
      if (generatedSummary) {
        const summary: ChapterSummarySnapshot = {
          text: generatedSummary,
          source: 'generated'
        };
        this.cache.set(file.path, { mtime, summary });
        return summary;
      }
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
