import { App } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import { ConverterSettings } from './models';
import { slugifyIdentifier } from './hash-utils';

export interface CachedEmbeddingRecord {
  cacheKey: string;
  provider: string;
  model: string;
  chunkingSignature: string;
  dimensions: number;
  vector: number[];
  createdAt: number;
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function resolveBaseDir(app: App, cacheDir: string): string {
  if (path.isAbsolute(cacheDir)) {
    return cacheDir;
  }
  const adapter = app.vault.adapter as any;
  if (typeof adapter.getBasePath !== 'function') {
    throw new Error('Unable to resolve vault base path for embedding cache.');
  }
  return path.join(adapter.getBasePath() as string, cacheDir);
}

export class EmbeddingCache {
  private app: App;
  private settings: ConverterSettings['embeddings'];

  constructor(app: App, settings: ConverterSettings['embeddings']) {
    this.app = app;
    this.settings = settings;
  }

  private recordPath(cacheKey: string): string {
    const root = resolveBaseDir(this.app, this.settings.cacheDir);
    const providerDir = slugifyIdentifier(this.settings.provider);
    const modelDir = slugifyIdentifier(this.settings.model);
    const chunkDir = slugifyIdentifier(
      `${this.settings.chunkingMode}-${this.settings.minChunkChars}-${this.settings.maxChunkChars}-${this.settings.overlapChars}`
    );
    const prefix = cacheKey.slice(0, 2);
    const dirPath = path.join(root, providerDir, modelDir, chunkDir, prefix);
    return path.join(dirPath, `${cacheKey}.json`);
  }

  get(cacheKey: string): CachedEmbeddingRecord | null {
    const filePath = this.recordPath(cacheKey);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as CachedEmbeddingRecord;
      if (!Array.isArray(parsed.vector)) {
        return null;
      }
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  set(record: CachedEmbeddingRecord): void {
    const filePath = this.recordPath(record.cacheKey);
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(record), 'utf8');
  }
}
