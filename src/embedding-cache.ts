import { App } from 'obsidian';
import { ConverterSettings } from './models';
import { slugifyIdentifier } from './hash-utils';
import {
  ensureParentVaultFolderForFile,
  joinVaultPath,
  normalizeVaultRelativePath
} from './vault-path-utils';

export interface CachedEmbeddingRecord {
  cacheKey: string;
  provider: string;
  model: string;
  chunkingSignature: string;
  dimensions: number;
  vector: number[];
  createdAt: number;
}

export class EmbeddingCache {
  private app: App;
  private settings: ConverterSettings['embeddings'];

  constructor(app: App, settings: ConverterSettings['embeddings']) {
    this.app = app;
    this.settings = settings;
  }

  private resolveCacheRoot(): string {
    return normalizeVaultRelativePath(this.settings.cacheDir);
  }

  private recordPath(cacheKey: string): string {
    const root = this.resolveCacheRoot();
    const providerDir = slugifyIdentifier(this.settings.provider);
    const modelDir = slugifyIdentifier(this.settings.model);
    const chunkDir = slugifyIdentifier(
      `${this.settings.chunkingMode}-${this.settings.minChunkChars}-${this.settings.maxChunkChars}-${this.settings.overlapChars}`
    );
    const prefix = cacheKey.slice(0, 2);
    return joinVaultPath(root, providerDir, modelDir, chunkDir, prefix, `${cacheKey}.json`);
  }

  async get(cacheKey: string): Promise<CachedEmbeddingRecord | null> {
    const filePath = this.recordPath(cacheKey);
    if (!(await this.app.vault.adapter.exists(filePath))) {
      return null;
    }

    try {
      const raw = await this.app.vault.adapter.read(filePath);
      const parsed = JSON.parse(raw) as CachedEmbeddingRecord;
      if (!Array.isArray(parsed.vector)) {
        return null;
      }
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  async set(record: CachedEmbeddingRecord): Promise<void> {
    const filePath = this.recordPath(record.cacheKey);
    await ensureParentVaultFolderForFile(this.app, filePath);
    await this.app.vault.adapter.write(filePath, JSON.stringify(record));
  }
}
