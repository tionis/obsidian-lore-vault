import type { App } from 'obsidian';
import type {
  CompletionOperationLogAttempt,
  CompletionOperationLogRecord,
  CompletionOperationKind
} from './completion-provider';
import { InternalDbClient } from './internal-db-client';
import type { InternalDbStatus } from './internal-db-types';
import {
  OperationLogListEntry,
  OperationLogParseIssue,
  ParsedOperationLogEntry,
  parseOperationLogJsonl,
  summarizeOperationLogRecord
} from './operation-log';
import { buildOperationLogSearchText, tokenizeOperationLogSearchQuery } from './operation-log-utils';
import { ensureParentVaultFolderForFile } from './vault-path-utils';

export interface OperationLogStoreQuery {
  costProfile: string;
  kindFilter: 'all' | CompletionOperationKind;
  statusFilter: 'all' | 'ok' | 'error';
  searchQuery: string;
  limit: number;
}

export interface OperationLogLoadResult {
  entries: OperationLogListEntry[];
  issues: OperationLogParseIssue[];
  totalEntries: number;
  backendLabel: string;
  legacyPath: string;
  warningMessage: string;
}

export interface OperationLogStoreStatus {
  internalDb: InternalDbStatus;
  legacyPath: string;
}

type OperationLogStoreOptions = {
  app: App;
  internalDbClient?: InternalDbClient | null;
  workerUrl?: string | null;
  storagePersisted: boolean | null;
  getDeviceCostProfileLabel: () => string;
  getLegacyPath: (costProfile?: string | null) => string;
  getMaxEntries: () => number;
};

export class OperationLogStore {
  private readonly app: App;
  private readonly getDeviceCostProfileLabel: () => string;
  private readonly getLegacyPath: (costProfile?: string | null) => string;
  private readonly getMaxEntries: () => number;
  private readonly internalDbClient: InternalDbClient | null;
  private readonly ownsInternalDbClient: boolean;
  private internalDbStatus: InternalDbStatus = {
    available: false,
    backend: null,
    backendLabel: 'jsonl',
    sqliteVersion: '',
    storagePersisted: null,
    errorMessage: ''
  };
  private readonly importedLegacyProfiles = new Set<string>();

  constructor(options: OperationLogStoreOptions) {
    this.app = options.app;
    this.getDeviceCostProfileLabel = options.getDeviceCostProfileLabel;
    this.getLegacyPath = options.getLegacyPath;
    this.getMaxEntries = options.getMaxEntries;
    this.internalDbStatus.storagePersisted = options.storagePersisted;
    if (options.internalDbClient) {
      this.internalDbClient = options.internalDbClient;
      this.ownsInternalDbClient = false;
    } else {
      this.internalDbClient = options.workerUrl
        ? new InternalDbClient(options.workerUrl, options.storagePersisted)
        : null;
      this.ownsInternalDbClient = Boolean(this.internalDbClient);
    }
  }

  async initialize(): Promise<void> {
    if (!this.internalDbClient) {
      return;
    }
    try {
      this.internalDbStatus = await this.internalDbClient.initialize();
    } catch (error) {
      this.markInternalDbUnavailable(error);
    }
  }

  async close(): Promise<void> {
    if (this.ownsInternalDbClient) {
      await this.internalDbClient?.close();
    }
  }

  async getStatus(costProfile?: string | null): Promise<OperationLogStoreStatus> {
    if (this.internalDbClient) {
      try {
        this.internalDbStatus = await this.internalDbClient.getStatus();
      } catch (error) {
        this.markInternalDbUnavailable(error);
      }
    }
    return {
      internalDb: this.internalDbStatus,
      legacyPath: this.getLegacyPath(costProfile)
    };
  }

  async append(record: CompletionOperationLogRecord, costProfile?: string | null): Promise<void> {
    const resolvedProfile = (costProfile ?? record.costProfile ?? '').trim()
      || this.getDeviceCostProfileLabel()
      || 'default';
    const normalizedRecord: CompletionOperationLogRecord = {
      ...record,
      costProfile: resolvedProfile
    };

    if (this.internalDbClient && this.internalDbStatus.available) {
      try {
        await this.ensureLegacyProfileImported(resolvedProfile);
        await this.internalDbClient.appendOperationLog(normalizedRecord, this.getMaxEntries());
        return;
      } catch (error) {
        this.markInternalDbUnavailable(error);
      }
    }

    await this.appendLegacyJsonl(normalizedRecord, resolvedProfile);
  }

  async query(request: OperationLogStoreQuery): Promise<OperationLogLoadResult> {
    const resolvedProfile = request.costProfile.trim()
      || this.getDeviceCostProfileLabel()
      || 'default';

    if (this.internalDbClient && this.internalDbStatus.available) {
      try {
        await this.ensureLegacyProfileImported(resolvedProfile);
        const result = await this.internalDbClient.queryOperationLog({
          costProfile: resolvedProfile,
          kindFilter: request.kindFilter,
          statusFilter: request.statusFilter,
          searchTokens: tokenizeOperationLogSearchQuery(request.searchQuery),
          limit: request.limit
        });
        return {
          entries: result.entries.map(record => ({
            lineNumber: 0,
            summary: summarizeOperationLogRecord(record),
            searchText: buildOperationLogSearchText(record),
            detailRecord: {
              lineNumber: 0,
              record,
              searchText: buildOperationLogSearchText(record)
            }
          })),
          issues: [],
          totalEntries: result.totalEntries,
          backendLabel: `SQLite (${this.internalDbStatus.backendLabel || 'local'})`,
          legacyPath: this.getLegacyPath(resolvedProfile),
          warningMessage: ''
        };
      } catch (error) {
        this.markInternalDbUnavailable(error);
      }
    }

    return this.queryLegacyJsonl({
      ...request,
      costProfile: resolvedProfile
    });
  }

  async getEntryDetail(costProfile: string, id: string): Promise<ParsedOperationLogEntry | null> {
    const resolvedProfile = costProfile.trim()
      || this.getDeviceCostProfileLabel()
      || 'default';
    const normalizedId = id.trim();
    if (!normalizedId) {
      return null;
    }

    if (this.internalDbClient && this.internalDbStatus.available) {
      try {
        await this.ensureLegacyProfileImported(resolvedProfile);
        const result = await this.internalDbClient.getOperationLogEntryDetail({
          costProfile: resolvedProfile,
          id: normalizedId
        });
        if (!result.record) {
          return null;
        }
        return {
          lineNumber: 0,
          record: result.record,
          searchText: buildOperationLogSearchText(result.record)
        };
      } catch (error) {
        this.markInternalDbUnavailable(error);
      }
    }

    return this.getLegacyJsonlEntryDetail(resolvedProfile, normalizedId);
  }

  async getEntryRequestPayload(costProfile: string, id: string): Promise<unknown> {
    const resolvedProfile = costProfile.trim()
      || this.getDeviceCostProfileLabel()
      || 'default';
    const normalizedId = id.trim();
    if (!normalizedId) {
      return null;
    }

    if (this.internalDbClient && this.internalDbStatus.available) {
      try {
        await this.ensureLegacyProfileImported(resolvedProfile);
        const result = await this.internalDbClient.getOperationLogEntryRequestPayload({
          costProfile: resolvedProfile,
          id: normalizedId
        });
        return result.payload ?? null;
      } catch (error) {
        this.markInternalDbUnavailable(error);
      }
    }

    const detail = await this.getLegacyJsonlEntryDetail(resolvedProfile, normalizedId);
    return detail?.record.request ?? null;
  }

  async getEntryAttempts(costProfile: string, id: string): Promise<CompletionOperationLogAttempt[]> {
    const resolvedProfile = costProfile.trim()
      || this.getDeviceCostProfileLabel()
      || 'default';
    const normalizedId = id.trim();
    if (!normalizedId) {
      return [];
    }

    if (this.internalDbClient && this.internalDbStatus.available) {
      try {
        await this.ensureLegacyProfileImported(resolvedProfile);
        const result = await this.internalDbClient.getOperationLogEntryAttempts({
          costProfile: resolvedProfile,
          id: normalizedId
        });
        return result.attempts;
      } catch (error) {
        this.markInternalDbUnavailable(error);
      }
    }

    const detail = await this.getLegacyJsonlEntryDetail(resolvedProfile, normalizedId);
    return detail?.record.attempts ?? [];
  }

  async getEntryFinalText(costProfile: string, id: string): Promise<string | null> {
    const resolvedProfile = costProfile.trim()
      || this.getDeviceCostProfileLabel()
      || 'default';
    const normalizedId = id.trim();
    if (!normalizedId) {
      return null;
    }

    if (this.internalDbClient && this.internalDbStatus.available) {
      try {
        await this.ensureLegacyProfileImported(resolvedProfile);
        const result = await this.internalDbClient.getOperationLogEntryFinalText({
          costProfile: resolvedProfile,
          id: normalizedId
        });
        return result.finalText;
      } catch (error) {
        this.markInternalDbUnavailable(error);
      }
    }

    const detail = await this.getLegacyJsonlEntryDetail(resolvedProfile, normalizedId);
    return detail?.record.finalText ?? null;
  }

  private async ensureLegacyProfileImported(costProfile: string): Promise<void> {
    if (!this.internalDbClient || !this.internalDbStatus.available || this.importedLegacyProfiles.has(costProfile)) {
      return;
    }

    const path = this.getLegacyPath(costProfile);
    const exists = await this.app.vault.adapter.exists(path);
    if (!exists) {
      this.importedLegacyProfiles.add(costProfile);
      return;
    }

    try {
      const raw = await this.app.vault.adapter.read(path);
      const parsed = parseOperationLogJsonl(raw);
      if (parsed.entries.length === 0) {
        this.importedLegacyProfiles.add(costProfile);
        return;
      }
      await this.internalDbClient.importOperationLogRecords(
        parsed.entries.map(entry => ({
          ...entry.record,
          costProfile
        })),
        this.getMaxEntries()
      );
      this.importedLegacyProfiles.add(costProfile);
    } catch (error) {
      console.warn(`LoreVault: Failed to import legacy JSONL operation log for ${costProfile}:`, error);
    }
  }

  private markInternalDbUnavailable(error: unknown): void {
    this.internalDbStatus = {
      available: false,
      backend: null,
      backendLabel: 'jsonl',
      sqliteVersion: '',
      storagePersisted: this.internalDbStatus.storagePersisted,
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }

  private async appendLegacyJsonl(record: CompletionOperationLogRecord, costProfile: string): Promise<void> {
    const path = this.getLegacyPath(costProfile);
    const serialized = JSON.stringify({
      ...record,
      costProfile
    });

    await ensureParentVaultFolderForFile(this.app, path);
    const exists = await this.app.vault.adapter.exists(path);
    let lines: string[] = [];
    if (exists) {
      const current = await this.app.vault.adapter.read(path);
      lines = current
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    }
    lines.push(serialized);
    const maxEntries = this.getMaxEntries();
    if (lines.length > maxEntries) {
      lines = lines.slice(lines.length - maxEntries);
    }
    await this.app.vault.adapter.write(path, `${lines.join('\n')}\n`);
  }

  private async queryLegacyJsonl(request: OperationLogStoreQuery): Promise<OperationLogLoadResult> {
    const path = this.getLegacyPath(request.costProfile);
    const exists = await this.app.vault.adapter.exists(path);
    if (!exists) {
      return {
        entries: [],
        issues: [],
        totalEntries: 0,
        backendLabel: 'JSONL fallback',
        legacyPath: path,
        warningMessage: this.buildFallbackWarningMessage()
      };
    }

    const raw = await this.app.vault.adapter.read(path);
    const parsed = parseOperationLogJsonl(raw);
    const tokens = tokenizeOperationLogSearchQuery(request.searchQuery);
    const filtered = parsed.entries.filter(entry => {
      if (request.kindFilter !== 'all' && entry.record.kind !== request.kindFilter) {
        return false;
      }
      if (request.statusFilter !== 'all' && entry.record.status !== request.statusFilter) {
        return false;
      }
      return tokens.every(token => entry.searchText.includes(token));
    });

    return {
      entries: filtered
        .slice(0, request.limit)
        .map(entry => ({
          lineNumber: entry.lineNumber,
          summary: summarizeOperationLogRecord(entry.record),
          searchText: entry.searchText,
          detailRecord: entry
        })),
      issues: parsed.issues,
      totalEntries: filtered.length,
      backendLabel: 'JSONL fallback',
      legacyPath: path,
      warningMessage: this.buildFallbackWarningMessage()
    };
  }

  private async getLegacyJsonlEntryDetail(costProfile: string, id: string): Promise<ParsedOperationLogEntry | null> {
    const path = this.getLegacyPath(costProfile);
    const exists = await this.app.vault.adapter.exists(path);
    if (!exists) {
      return null;
    }
    const raw = await this.app.vault.adapter.read(path);
    const parsed = parseOperationLogJsonl(raw);
    return parsed.entries.find(entry => entry.record.id === id) ?? null;
  }

  private buildFallbackWarningMessage(): string {
    if (!this.internalDbStatus.available) {
      return this.internalDbStatus.errorMessage
        ? `Internal DB unavailable; using JSONL fallback. ${this.internalDbStatus.errorMessage}`
        : 'Internal DB unavailable; using JSONL fallback.';
    }
    return '';
  }
}
