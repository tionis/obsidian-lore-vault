import type { App } from 'obsidian';
import { GeneratedSummaryMode } from './summary-utils';

interface GeneratedSummaryEntry {
  path: string;
  mode: GeneratedSummaryMode;
  signature: string;
  text: string;
  provider: string;
  model: string;
  acceptedAt: number;
}

interface GeneratedSummaryStorePayload {
  schemaVersion: number;
  entries: GeneratedSummaryEntry[];
}

function sortEntries(entries: GeneratedSummaryEntry[]): GeneratedSummaryEntry[] {
  return [...entries].sort((left, right) => {
    return (
      left.mode.localeCompare(right.mode) ||
      left.path.localeCompare(right.path)
    );
  });
}

export class GeneratedSummaryStore {
  private readonly app: App;
  private readonly filePath: string;
  private loaded = false;
  private entriesByKey = new Map<string, GeneratedSummaryEntry>();

  constructor(app: App, filePath = '.obsidian/plugins/lore-vault/cache/generated-summaries.json') {
    this.app = app;
    this.filePath = filePath;
  }

  private makeKey(path: string, mode: GeneratedSummaryMode): string {
    return `${mode}\u0000${path}`;
  }

  private getParentDirectory(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    const index = normalized.lastIndexOf('/');
    if (index <= 0) {
      return '';
    }
    return normalized.slice(0, index);
  }

  private async ensureDirectory(pathValue: string): Promise<void> {
    const normalizedParts = pathValue
      .split('/')
      .map(part => part.trim())
      .filter(Boolean);
    if (normalizedParts.length === 0) {
      return;
    }

    let current = '';
    for (const part of normalizedParts) {
      current = current ? `${current}/${part}` : part;
      const exists = await this.app.vault.adapter.exists(current);
      if (!exists) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    this.loaded = true;
    const exists = await this.app.vault.adapter.exists(this.filePath);
    if (!exists) {
      return;
    }

    try {
      const raw = await this.app.vault.adapter.read(this.filePath);
      const payload = JSON.parse(raw) as Partial<GeneratedSummaryStorePayload>;
      const entries = Array.isArray(payload.entries) ? payload.entries : [];
      for (const item of entries) {
        if (!item || typeof item !== 'object') {
          continue;
        }
        const pathValue = String((item as GeneratedSummaryEntry).path ?? '').trim();
        const modeValue = String((item as GeneratedSummaryEntry).mode ?? '').trim();
        const signatureValue = String((item as GeneratedSummaryEntry).signature ?? '').trim();
        const textValue = String((item as GeneratedSummaryEntry).text ?? '').trim();
        if (!pathValue || !signatureValue || !textValue) {
          continue;
        }
        if (modeValue !== 'world_info' && modeValue !== 'chapter') {
          continue;
        }
        const entry: GeneratedSummaryEntry = {
          path: pathValue,
          mode: modeValue,
          signature: signatureValue,
          text: textValue,
          provider: String((item as GeneratedSummaryEntry).provider ?? ''),
          model: String((item as GeneratedSummaryEntry).model ?? ''),
          acceptedAt: Math.max(0, Math.floor(Number((item as GeneratedSummaryEntry).acceptedAt ?? 0)))
        };
        this.entriesByKey.set(this.makeKey(entry.path, entry.mode), entry);
      }
    } catch (error) {
      console.error('Failed to load generated summary store:', error);
      this.entriesByKey.clear();
    }
  }

  async initialize(): Promise<void> {
    await this.ensureLoaded();
  }

  async invalidatePath(path: string): Promise<void> {
    await this.ensureLoaded();
    this.entriesByKey.delete(this.makeKey(path, 'world_info'));
    this.entriesByKey.delete(this.makeKey(path, 'chapter'));
    await this.persist();
  }

  async getAcceptedSummary(
    path: string,
    mode: GeneratedSummaryMode,
    signature: string
  ): Promise<string | null> {
    await this.ensureLoaded();
    const entry = this.entriesByKey.get(this.makeKey(path, mode));
    if (!entry) {
      return null;
    }
    if (entry.signature !== signature) {
      return null;
    }
    return entry.text;
  }

  async setAcceptedSummary(
    path: string,
    mode: GeneratedSummaryMode,
    signature: string,
    text: string,
    provider: string,
    model: string
  ): Promise<void> {
    await this.ensureLoaded();
    const entry: GeneratedSummaryEntry = {
      path,
      mode,
      signature,
      text,
      provider,
      model,
      acceptedAt: Date.now()
    };
    this.entriesByKey.set(this.makeKey(path, mode), entry);
    await this.persist();
  }

  private async persist(): Promise<void> {
    const entries = sortEntries([...this.entriesByKey.values()]);
    const payload: GeneratedSummaryStorePayload = {
      schemaVersion: 1,
      entries
    };
    const parent = this.getParentDirectory(this.filePath);
    await this.ensureDirectory(parent);
    await this.app.vault.adapter.write(this.filePath, JSON.stringify(payload, null, 2));
  }
}
