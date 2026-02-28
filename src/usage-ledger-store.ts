import type { App } from 'obsidian';
import type { UsageCostSource, UsagePricingSource } from './cost-utils';

export interface UsageLedgerEntry {
  id: string;
  timestamp: number;
  operation: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reportedCostUsd: number | null;
  estimatedCostUsd: number | null;
  costSource: UsageCostSource;
  pricingSource: UsagePricingSource;
  inputCostPerMillionUsd: number | null;
  outputCostPerMillionUsd: number | null;
  pricingRule: string | null;
  pricingSnapshotAt: number | null;
  metadata: {[key: string]: unknown};
}

interface UsageLedgerPayload {
  schemaVersion: number;
  entries: UsageLedgerEntry[];
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.floor(parsed));
}

function normalizeMoney(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function normalizeTimestamp(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function normalizeMetadata(value: unknown): {[key: string]: unknown} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value as {[key: string]: unknown})
    .filter(([key]) => key.trim().length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  const normalized: {[key: string]: unknown} = {};
  for (const [key, item] of entries) {
    normalized[key] = item;
  }
  return normalized;
}

function sortEntries(entries: UsageLedgerEntry[]): UsageLedgerEntry[] {
  return [...entries].sort((left, right) => (
    left.timestamp - right.timestamp ||
    left.id.localeCompare(right.id)
  ));
}

function buildEntryId(entry: Omit<UsageLedgerEntry, 'id'>): string {
  const key = JSON.stringify({
    timestamp: entry.timestamp,
    operation: entry.operation,
    provider: entry.provider,
    model: entry.model,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    totalTokens: entry.totalTokens,
    reportedCostUsd: entry.reportedCostUsd,
    estimatedCostUsd: entry.estimatedCostUsd,
    costSource: entry.costSource,
    pricingSource: entry.pricingSource,
    inputCostPerMillionUsd: entry.inputCostPerMillionUsd,
    outputCostPerMillionUsd: entry.outputCostPerMillionUsd,
    pricingRule: entry.pricingRule,
    pricingSnapshotAt: entry.pricingSnapshotAt,
    metadata: entry.metadata
  });
  return fnv1a32(key);
}

export class UsageLedgerStore {
  private readonly app: App;
  private filePath: string;
  private loaded = false;
  private entries: UsageLedgerEntry[] = [];

  constructor(app: App, filePath: string) {
    this.app = app;
    this.filePath = filePath;
  }

  setFilePath(filePath: string): void {
    if (this.filePath === filePath) {
      return;
    }
    this.filePath = filePath;
    this.loaded = false;
    this.entries = [];
  }

  private parentDirectory(pathValue: string): string {
    const normalized = pathValue.replace(/\\/g, '/');
    const index = normalized.lastIndexOf('/');
    if (index <= 0) {
      return '';
    }
    return normalized.slice(0, index);
  }

  private isPathAlreadyExistsError(error: unknown): boolean {
    const maybe = error as { code?: string; message?: string };
    const code = typeof maybe?.code === 'string' ? maybe.code.toUpperCase() : '';
    if (code === 'EEXIST') {
      return true;
    }
    const message = typeof maybe?.message === 'string' ? maybe.message.toLowerCase() : String(error ?? '').toLowerCase();
    return message.includes('already exists');
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
        try {
          await this.app.vault.adapter.mkdir(current);
        } catch (error) {
          if (!this.isPathAlreadyExistsError(error)) {
            throw error;
          }
        }
      }
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    this.entries = [];

    const exists = await this.app.vault.adapter.exists(this.filePath);
    if (!exists) {
      return;
    }

    try {
      const raw = await this.app.vault.adapter.read(this.filePath);
      const parsed = JSON.parse(raw) as Partial<UsageLedgerPayload>;
      const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : [];
      for (const rawEntry of rawEntries) {
        if (!rawEntry || typeof rawEntry !== 'object') {
          continue;
        }
        const timestamp = normalizeNumber((rawEntry as UsageLedgerEntry).timestamp);
        const operation = String((rawEntry as UsageLedgerEntry).operation ?? '').trim();
        const provider = String((rawEntry as UsageLedgerEntry).provider ?? '').trim();
        const model = String((rawEntry as UsageLedgerEntry).model ?? '').trim();
        if (!operation || !provider || !model) {
          continue;
        }
        const promptTokens = normalizeNumber((rawEntry as UsageLedgerEntry).promptTokens);
        const completionTokens = normalizeNumber((rawEntry as UsageLedgerEntry).completionTokens);
        const totalTokensRaw = normalizeNumber((rawEntry as UsageLedgerEntry).totalTokens);
        const totalTokens = totalTokensRaw > 0 ? totalTokensRaw : promptTokens + completionTokens;
        const costSourceValue = String((rawEntry as UsageLedgerEntry).costSource ?? '').trim();
        const costSource: UsageCostSource = costSourceValue === 'provider_reported' || costSourceValue === 'estimated'
          ? costSourceValue
          : 'unknown';
        const pricingSourceValue = String((rawEntry as UsageLedgerEntry).pricingSource ?? '').trim();
        const pricingSource: UsagePricingSource = (
          pricingSourceValue === 'provider_reported' ||
          pricingSourceValue === 'model_override' ||
          pricingSourceValue === 'default_rates'
        )
          ? pricingSourceValue
          : 'none';
        const pricingRuleValue = String((rawEntry as UsageLedgerEntry).pricingRule ?? '').trim();

        const withoutId: Omit<UsageLedgerEntry, 'id'> = {
          timestamp,
          operation,
          provider,
          model,
          promptTokens,
          completionTokens,
          totalTokens,
          reportedCostUsd: normalizeMoney((rawEntry as UsageLedgerEntry).reportedCostUsd),
          estimatedCostUsd: normalizeMoney((rawEntry as UsageLedgerEntry).estimatedCostUsd),
          costSource,
          pricingSource,
          inputCostPerMillionUsd: normalizeMoney((rawEntry as UsageLedgerEntry).inputCostPerMillionUsd),
          outputCostPerMillionUsd: normalizeMoney((rawEntry as UsageLedgerEntry).outputCostPerMillionUsd),
          pricingRule: pricingRuleValue || null,
          pricingSnapshotAt: normalizeTimestamp((rawEntry as UsageLedgerEntry).pricingSnapshotAt),
          metadata: normalizeMetadata((rawEntry as UsageLedgerEntry).metadata)
        };

        const id = String((rawEntry as UsageLedgerEntry).id ?? '').trim() || buildEntryId(withoutId);
        this.entries.push({
          id,
          ...withoutId
        });
      }
      this.entries = sortEntries(this.entries);
    } catch (error) {
      console.error('Failed to load usage ledger:', error);
      this.entries = [];
    }
  }

  async initialize(): Promise<void> {
    await this.ensureLoaded();
  }

  async append(entry: Omit<UsageLedgerEntry, 'id'>): Promise<void> {
    await this.ensureLoaded();
    const normalized: Omit<UsageLedgerEntry, 'id'> = {
      timestamp: normalizeNumber(entry.timestamp),
      operation: String(entry.operation ?? '').trim(),
      provider: String(entry.provider ?? '').trim(),
      model: String(entry.model ?? '').trim(),
      promptTokens: normalizeNumber(entry.promptTokens),
      completionTokens: normalizeNumber(entry.completionTokens),
      totalTokens: normalizeNumber(entry.totalTokens),
      reportedCostUsd: normalizeMoney(entry.reportedCostUsd),
      estimatedCostUsd: normalizeMoney(entry.estimatedCostUsd),
      costSource: entry.costSource === 'provider_reported' || entry.costSource === 'estimated'
        ? entry.costSource
        : 'unknown',
      pricingSource: (
        entry.pricingSource === 'provider_reported' ||
        entry.pricingSource === 'model_override' ||
        entry.pricingSource === 'default_rates'
      )
        ? entry.pricingSource
        : 'none',
      inputCostPerMillionUsd: normalizeMoney(entry.inputCostPerMillionUsd),
      outputCostPerMillionUsd: normalizeMoney(entry.outputCostPerMillionUsd),
      pricingRule: (entry.pricingRule ?? '').toString().trim() || null,
      pricingSnapshotAt: normalizeTimestamp(entry.pricingSnapshotAt),
      metadata: normalizeMetadata(entry.metadata)
    };

    if (!normalized.operation || !normalized.provider || !normalized.model) {
      return;
    }

    if (normalized.totalTokens <= 0) {
      normalized.totalTokens = normalized.promptTokens + normalized.completionTokens;
    }

    const id = buildEntryId(normalized);
    this.entries.push({
      id,
      ...normalized
    });
    this.entries = sortEntries(this.entries);
    await this.persist();
  }

  async listEntries(): Promise<UsageLedgerEntry[]> {
    await this.ensureLoaded();
    return this.entries.map(entry => ({
      ...entry,
      metadata: { ...entry.metadata }
    }));
  }

  private async persist(): Promise<void> {
    const payload: UsageLedgerPayload = {
      schemaVersion: 1,
      entries: this.entries
    };
    const parent = this.parentDirectory(this.filePath);
    await this.ensureDirectory(parent);
    await this.app.vault.adapter.write(this.filePath, JSON.stringify(payload, null, 2));
  }
}
