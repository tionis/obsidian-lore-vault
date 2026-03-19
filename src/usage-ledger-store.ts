import type { App } from 'obsidian';
import type { UsageCostSource, UsagePricingSource } from './cost-utils';
import { InternalDbClient } from './internal-db-client';
import type { InternalDbStatus } from './internal-db-types';
import {
  buildUsageLedgerReportSnapshot,
  createUsageLedgerReportSnapshot,
  type UsageLedgerReportOptions,
  type UsageLedgerReportSnapshot
} from './usage-ledger-report';
import { ensureParentVaultFolderForFile } from './vault-path-utils';

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

interface UsageLedgerRecordFile {
  schemaVersion: number;
  entry: UsageLedgerEntry;
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

function dedupeEntries(entries: UsageLedgerEntry[]): UsageLedgerEntry[] {
  const map = new Map<string, UsageLedgerEntry>();
  for (const entry of entries) {
    map.set(entry.id, entry);
  }
  return sortEntries([...map.values()]);
}

function normalizeEntry(entry: Omit<UsageLedgerEntry, 'id'> | UsageLedgerEntry): UsageLedgerEntry | null {
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
      entry.pricingSource === 'provider_reported'
      || entry.pricingSource === 'model_override'
      || entry.pricingSource === 'default_rates'
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
    return null;
  }

  if (normalized.totalTokens <= 0) {
    normalized.totalTokens = normalized.promptTokens + normalized.completionTokens;
  }

  const rawId = 'id' in entry ? String(entry.id ?? '').trim() : '';
  return {
    id: rawId || buildEntryId(normalized),
    ...normalized
  };
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/');
}

function resolveCanonicalRootPath(filePath: string): string {
  const normalized = normalizePath(filePath);
  return normalized.toLowerCase().endsWith('.json')
    ? normalized.slice(0, -'.json'.length)
    : normalized;
}

function resolveLegacyFilePath(filePath: string): string | null {
  const normalized = normalizePath(filePath);
  return normalized.toLowerCase().endsWith('.json') ? normalized : null;
}

function resolveEntryCostProfile(entry: UsageLedgerEntry): string {
  return typeof entry.metadata?.costProfile === 'string'
    ? entry.metadata.costProfile.trim()
    : '';
}

type UsageLedgerStoragePaths = {
  canonicalRootPath: string;
  legacyFilePath: string | null;
};

type UsageLedgerStoreOptions = {
  internalDbClient?: InternalDbClient | null;
  storagePersisted?: boolean | null;
};

export class UsageLedgerStore {
  private readonly app: App;
  private filePath: string;
  private readonly internalDbClient: InternalDbClient | null;
  private readonly ownsInternalDbClient: boolean;
  private internalDbStatus: InternalDbStatus = {
    available: false,
    backend: null,
    backendLabel: 'unavailable',
    sqliteVersion: '',
    storagePersisted: null,
    errorMessage: ''
  };
  private knownRecordPaths = new Set<string>();
  private pendingChangedRecordPaths = new Set<string>();
  private needsFullRescan = true;
  private legacyFileMtime = -1;
  private syncPromise: Promise<void> | null = null;

  constructor(app: App, filePath: string, options: UsageLedgerStoreOptions = {}) {
    this.app = app;
    this.filePath = normalizePath(filePath);
    this.internalDbStatus.storagePersisted = options.storagePersisted ?? null;
    if (options.internalDbClient) {
      this.internalDbClient = options.internalDbClient;
      this.ownsInternalDbClient = false;
    } else {
      this.internalDbClient = null;
      this.ownsInternalDbClient = false;
    }
  }

  async close(): Promise<void> {
    if (this.ownsInternalDbClient) {
      await this.internalDbClient?.close();
    }
  }

  setFilePath(filePath: string): void {
    const normalized = normalizePath(filePath);
    if (this.filePath === normalized) {
      return;
    }
    this.filePath = normalized;
    this.knownRecordPaths.clear();
    this.pendingChangedRecordPaths.clear();
    this.needsFullRescan = true;
    this.legacyFileMtime = -1;
  }

  async initialize(): Promise<void> {
    if (this.internalDbClient) {
      await this.ensureInternalDbSynchronized();
      if (!this.internalDbStatus.available) {
        await this.importLegacyLedgerFile();
      }
      return;
    }

    await this.importLegacyLedgerFile();
  }

  async append(entry: Omit<UsageLedgerEntry, 'id'>): Promise<void> {
    const normalized = normalizeEntry(entry);
    if (!normalized) {
      return;
    }
    const { canonicalRootPath } = this.resolveStoragePaths();
    const filePath = this.buildRecordPath(normalized);

    await this.writeCanonicalRecordFile(normalized, filePath);

    if (this.internalDbClient) {
      try {
        await this.ensureInternalDbReady();
        if (this.internalDbStatus.available) {
          await this.internalDbClient.appendUsageLedgerEntry(canonicalRootPath, normalized);
          this.knownRecordPaths.add(filePath);
        }
      } catch (error) {
        this.markInternalDbUnavailable(error);
      }
    }
  }

  async listEntries(options: { costProfile?: string | null } = {}): Promise<UsageLedgerEntry[]> {
    const normalizedCostProfile = (options.costProfile ?? '').trim();
    if (this.internalDbClient) {
      try {
        await this.ensureInternalDbSynchronized();
        if (this.internalDbStatus.available) {
          const result = await this.internalDbClient.queryUsageLedger({
            sourceRoot: this.resolveStoragePaths().canonicalRootPath,
            costProfile: normalizedCostProfile || null
          });
          return result.entries.map(entry => ({
            ...entry,
            metadata: { ...entry.metadata }
          }));
        }
      } catch (error) {
        this.markInternalDbUnavailable(error);
      }
    }

    const entries = await this.loadEntriesFromVault();
    if (!normalizedCostProfile) {
      return entries;
    }
    return entries.filter(entry => resolveEntryCostProfile(entry) === normalizedCostProfile);
  }

  async listKnownCostProfiles(): Promise<string[]> {
    if (this.internalDbClient) {
      try {
        await this.ensureInternalDbSynchronized();
        if (this.internalDbStatus.available) {
          const result = await this.internalDbClient.listUsageLedgerCostProfiles(
            this.resolveStoragePaths().canonicalRootPath
          );
          return result.profiles;
        }
      } catch (error) {
        this.markInternalDbUnavailable(error);
      }
    }

    const profiles = new Set<string>();
    for (const entry of await this.loadEntriesFromVault()) {
      const profile = resolveEntryCostProfile(entry);
      if (profile) {
        profiles.add(profile);
      }
    }
    return [...profiles].sort((left, right) => left.localeCompare(right));
  }

  async getReportSnapshot(
    options: UsageLedgerReportOptions & { costProfile?: string | null }
  ): Promise<UsageLedgerReportSnapshot> {
    const normalizedCostProfile = (options.costProfile ?? '').trim();
    if (this.internalDbClient) {
      try {
        await this.ensureInternalDbSynchronized();
        if (this.internalDbStatus.available) {
          const aggregates = await this.internalDbClient.queryUsageLedgerReport({
            sourceRoot: this.resolveStoragePaths().canonicalRootPath,
            costProfile: normalizedCostProfile || null,
            nowMs: options.nowMs,
            sessionStartAt: options.sessionStartAt
          });
          return createUsageLedgerReportSnapshot(aggregates, options);
        }
      } catch (error) {
        this.markInternalDbUnavailable(error);
      }
    }

    const entries = await this.listEntries({ costProfile: normalizedCostProfile || null });
    return buildUsageLedgerReportSnapshot(entries, options);
  }

  handleVaultCreate(path: string): boolean {
    return this.handleVaultFileMutation(path, 'create');
  }

  handleVaultModify(path: string): boolean {
    return this.handleVaultFileMutation(path, 'modify');
  }

  handleVaultDelete(path: string): boolean {
    return this.handleVaultFileMutation(path, 'delete');
  }

  handleVaultRename(path: string, oldPath: string): boolean {
    const deleted = this.handleVaultDelete(oldPath);
    const created = this.handleVaultCreate(path);
    return deleted || created;
  }

  private resolveStoragePaths(): UsageLedgerStoragePaths {
    return {
      canonicalRootPath: resolveCanonicalRootPath(this.filePath),
      legacyFilePath: resolveLegacyFilePath(this.filePath)
    };
  }

  private handleVaultFileMutation(path: string, mutation: 'create' | 'modify' | 'delete'): boolean {
    const normalizedPath = normalizePath(path);
    if (!normalizedPath) {
      return false;
    }
    if (this.isLegacyLedgerFilePath(normalizedPath)) {
      this.legacyFileMtime = -1;
      this.needsFullRescan = true;
      if (mutation === 'delete') {
        this.pendingChangedRecordPaths.clear();
      }
      return true;
    }
    if (!this.isCanonicalRecordFilePath(normalizedPath)) {
      return false;
    }
    if (mutation === 'delete') {
      this.needsFullRescan = true;
      this.knownRecordPaths.delete(normalizedPath);
      this.pendingChangedRecordPaths.delete(normalizedPath);
      return true;
    }
    if (!this.needsFullRescan) {
      this.pendingChangedRecordPaths.add(normalizedPath);
    }
    return true;
  }

  private buildRecordPath(entry: UsageLedgerEntry): string {
    const { canonicalRootPath } = this.resolveStoragePaths();
    const timestamp = Math.max(0, Math.floor(entry.timestamp));
    const date = new Date(timestamp);
    const year = date.getUTCFullYear().toString().padStart(4, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${canonicalRootPath}/${year}/${month}/${day}/${timestamp}-${entry.id}.json`;
  }

  private async writeCanonicalRecordFile(entry: UsageLedgerEntry, filePath = this.buildRecordPath(entry)): Promise<void> {
    const exists = await this.app.vault.adapter.exists(filePath);
    if (exists) {
      return;
    }

    const payload: UsageLedgerRecordFile = {
      schemaVersion: 1,
      entry
    };
    await ensureParentVaultFolderForFile(this.app, filePath);
    await this.app.vault.adapter.write(filePath, JSON.stringify(payload));
  }

  private async ensureInternalDbReady(): Promise<void> {
    if (!this.internalDbClient) {
      return;
    }
    if (this.internalDbStatus.available) {
      return;
    }
    try {
      this.internalDbStatus = await this.internalDbClient.initialize();
    } catch (error) {
      this.markInternalDbUnavailable(error);
    }
  }

  private async ensureInternalDbSynchronized(): Promise<void> {
    if (!this.internalDbClient) {
      return;
    }
    await this.ensureInternalDbReady();
    if (!this.internalDbStatus.available) {
      return;
    }
    if (this.syncPromise) {
      await this.syncPromise;
      return;
    }

    const syncPromise = this.synchronizeInternalDbNow()
      .finally(() => {
        if (this.syncPromise === syncPromise) {
          this.syncPromise = null;
        }
      });
    this.syncPromise = syncPromise;
    await syncPromise;
  }

  private async synchronizeInternalDbNow(): Promise<void> {
    if (!this.internalDbClient || !this.internalDbStatus.available) {
      return;
    }

    while (true) {
      const { canonicalRootPath } = this.resolveStoragePaths();
      if (this.needsFullRescan) {
        this.needsFullRescan = false;
        this.pendingChangedRecordPaths.clear();
        await this.replaceInternalDbFromVault(canonicalRootPath);
        continue;
      }

      const changedPaths = [...this.pendingChangedRecordPaths].sort((left, right) => left.localeCompare(right));
      if (changedPaths.length === 0) {
        return;
      }
      this.pendingChangedRecordPaths.clear();
      await this.importChangedRecordPaths(canonicalRootPath, changedPaths);
    }
  }

  private async replaceInternalDbFromVault(canonicalRootPath: string): Promise<void> {
    if (!this.internalDbClient) {
      return;
    }

    await this.importLegacyLedgerFile();
    const { entries, filePaths } = await this.loadCanonicalEntriesFromVault(canonicalRootPath);
    await this.internalDbClient.replaceUsageLedgerEntries(canonicalRootPath, entries);
    this.knownRecordPaths = new Set(filePaths);
  }

  private async importChangedRecordPaths(canonicalRootPath: string, changedPaths: string[]): Promise<void> {
    if (!this.internalDbClient) {
      return;
    }

    const imports: UsageLedgerEntry[] = [];
    for (const filePath of changedPaths) {
      if (!this.isCanonicalRecordFilePath(filePath)) {
        continue;
      }
      const entry = await this.readCanonicalRecordFile(filePath);
      if (!entry) {
        continue;
      }
      imports.push(entry);
      this.knownRecordPaths.add(filePath);
    }

    if (imports.length > 0) {
      await this.internalDbClient.importUsageLedgerEntries(canonicalRootPath, dedupeEntries(imports));
    }
  }

  private async importLegacyLedgerFile(): Promise<UsageLedgerEntry[]> {
    const { legacyFilePath } = this.resolveStoragePaths();
    if (!legacyFilePath) {
      return [];
    }
    const stat = await this.app.vault.adapter.stat(legacyFilePath);
    if (!stat || stat.type !== 'file') {
      this.legacyFileMtime = -1;
      return [];
    }
    if (stat.mtime === this.legacyFileMtime) {
      return [];
    }

    const raw = await this.app.vault.adapter.read(legacyFilePath);
    const entries = this.parseLegacyLedgerEntries(raw);
    for (const entry of entries) {
      await this.writeCanonicalRecordFile(entry);
      this.knownRecordPaths.add(this.buildRecordPath(entry));
    }
    this.legacyFileMtime = stat.mtime;
    return entries;
  }

  private async loadEntriesFromVault(): Promise<UsageLedgerEntry[]> {
    await this.importLegacyLedgerFile();

    const entries: UsageLedgerEntry[] = [];
    for (const filePath of await this.listRecordFiles(this.resolveStoragePaths().canonicalRootPath)) {
      const entry = await this.readCanonicalRecordFile(filePath);
      if (entry) {
        entries.push(entry);
      }
    }

    const { legacyFilePath } = this.resolveStoragePaths();
    if (legacyFilePath && await this.app.vault.adapter.exists(legacyFilePath)) {
      const raw = await this.app.vault.adapter.read(legacyFilePath);
      entries.push(...this.parseLegacyLedgerEntries(raw));
    }

    return dedupeEntries(entries).map(entry => ({
      ...entry,
      metadata: { ...entry.metadata }
    }));
  }

  private async loadCanonicalEntriesFromVault(rootPath: string): Promise<{ entries: UsageLedgerEntry[]; filePaths: string[] }> {
    const entries: UsageLedgerEntry[] = [];
    const filePaths: string[] = [];
    for (const filePath of await this.listRecordFiles(rootPath)) {
      const entry = await this.readCanonicalRecordFile(filePath);
      if (!entry) {
        continue;
      }
      entries.push(entry);
      filePaths.push(filePath);
    }
    return {
      entries: dedupeEntries(entries),
      filePaths
    };
  }

  private parseLegacyLedgerEntries(raw: string): UsageLedgerEntry[] {
    try {
      const parsed = JSON.parse(raw) as Partial<UsageLedgerPayload>;
      const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : [];
      return rawEntries
        .map(item => normalizeEntry(item as UsageLedgerEntry))
        .filter((entry): entry is UsageLedgerEntry => Boolean(entry));
    } catch (error) {
      console.error('Failed to load legacy usage ledger:', error);
      return [];
    }
  }

  private async readCanonicalRecordFile(filePath: string): Promise<UsageLedgerEntry | null> {
    try {
      const raw = await this.app.vault.adapter.read(filePath);
      const parsed = JSON.parse(raw) as Partial<UsageLedgerRecordFile | UsageLedgerEntry>;
      const candidate = (parsed && typeof parsed === 'object' && 'entry' in parsed)
        ? parsed.entry
        : parsed;
      return normalizeEntry(candidate as UsageLedgerEntry);
    } catch (error) {
      console.error(`Failed to load usage ledger record ${filePath}:`, error);
      return null;
    }
  }

  private isCanonicalRecordFilePath(filePath: string): boolean {
    const normalized = normalizePath(filePath);
    const { canonicalRootPath } = this.resolveStoragePaths();
    return Boolean(
      normalized
      && canonicalRootPath
      && normalized.toLowerCase().endsWith('.json')
      && normalized.startsWith(`${canonicalRootPath}/`)
    );
  }

  private isLegacyLedgerFilePath(filePath: string): boolean {
    const normalized = normalizePath(filePath);
    const { legacyFilePath } = this.resolveStoragePaths();
    return Boolean(legacyFilePath && normalized === legacyFilePath);
  }

  private async listRecordFiles(rootPath: string): Promise<string[]> {
    const normalizedRoot = normalizePath(rootPath);
    if (!normalizedRoot) {
      return [];
    }

    const stat = await this.app.vault.adapter.stat(normalizedRoot);
    if (!stat || stat.type !== 'folder') {
      return [];
    }

    const collected: string[] = [];
    const queue = [normalizedRoot];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }
      const listed = await this.app.vault.adapter.list(current);
      for (const folder of listed.folders) {
        queue.push(normalizePath(folder));
      }
      for (const file of listed.files) {
        const normalizedFile = normalizePath(file);
        if (normalizedFile.toLowerCase().endsWith('.json')) {
          collected.push(normalizedFile);
        }
      }
    }
    return collected.sort((left, right) => left.localeCompare(right));
  }

  private markInternalDbUnavailable(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.internalDbStatus = {
      available: false,
      backend: null,
      backendLabel: 'unavailable',
      sqliteVersion: '',
      storagePersisted: this.internalDbStatus.storagePersisted,
      errorMessage: message
    };
  }
}
