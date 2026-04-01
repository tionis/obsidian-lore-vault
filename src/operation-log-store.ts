import type {
  CompletionOperationLogAttempt,
  CompletionOperationLogRecord,
  CompletionOperationKind
} from './completion-provider';
import { InternalDbClient } from './internal-db-client';
import type { InternalDbStatus } from './internal-db-types';
import type {
  OperationLogListEntry,
  OperationLogParseIssue,
  ParsedOperationLogEntry
} from './operation-log';
import { buildOperationLogSearchText, tokenizeOperationLogSearchQuery } from './operation-log-utils';

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
  totalEntries: number | null;
  hasMoreEntries: boolean;
  backendLabel: string;
  legacyPath: string;
  warningMessage: string;
}

export interface OperationLogStoreStatus {
  internalDb: InternalDbStatus;
  legacyPath: string;
}

type OperationLogStoreOptions = {
  internalDbClient: InternalDbClient;
  getDeviceCostProfileLabel: () => string;
  getLegacyPath: (costProfile?: string | null) => string;
  getMaxEntries: () => number;
};

export class OperationLogStore {
  private readonly getDeviceCostProfileLabel: () => string;
  private readonly getLegacyPath: (costProfile?: string | null) => string;
  private readonly getMaxEntries: () => number;
  private readonly internalDbClient: InternalDbClient;

  constructor(options: OperationLogStoreOptions) {
    this.getDeviceCostProfileLabel = options.getDeviceCostProfileLabel;
    this.getLegacyPath = options.getLegacyPath;
    this.getMaxEntries = options.getMaxEntries;
    this.internalDbClient = options.internalDbClient;
  }

  async initialize(): Promise<void> {
    await this.internalDbClient.initialize();
  }

  async close(): Promise<void> {
    // Client lifecycle is managed externally (shared with usage ledger).
  }

  async getStatus(costProfile?: string | null): Promise<OperationLogStoreStatus> {
    const status = await this.internalDbClient.getStatus();
    return {
      internalDb: status,
      legacyPath: this.getLegacyPath(costProfile)
    };
  }

  async append(record: CompletionOperationLogRecord, costProfile?: string | null): Promise<void> {
    const resolvedProfile = this.resolveProfile(costProfile ?? record.costProfile);
    await this.internalDbClient.appendOperationLog(
      { ...record, costProfile: resolvedProfile },
      this.getMaxEntries()
    );
  }

  async query(request: OperationLogStoreQuery): Promise<OperationLogLoadResult> {
    const resolvedProfile = this.resolveProfile(request.costProfile);

    const result = await this.internalDbClient.queryOperationLog({
      costProfile: resolvedProfile,
      kindFilter: request.kindFilter,
      statusFilter: request.statusFilter,
      searchTokens: tokenizeOperationLogSearchQuery(request.searchQuery),
      limit: request.limit
    });
    const status = await this.internalDbClient.getStatus();
    return {
      entries: result.entries.map(record => ({
        lineNumber: 0,
        summary: record,
        searchText: ''
      })),
      issues: [],
      totalEntries: result.totalEntries,
      hasMoreEntries: result.hasMoreEntries,
      backendLabel: `SQLite (${status.backendLabel || 'local'})`,
      legacyPath: this.getLegacyPath(resolvedProfile),
      warningMessage: ''
    };
  }

  async getEntryDetail(costProfile: string, id: string): Promise<ParsedOperationLogEntry | null> {
    const resolvedProfile = this.resolveProfile(costProfile);
    const normalizedId = id.trim();
    if (!normalizedId) {
      return null;
    }

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
  }

  async getEntryRequestPayload(costProfile: string, id: string): Promise<unknown> {
    const resolvedProfile = this.resolveProfile(costProfile);
    const normalizedId = id.trim();
    if (!normalizedId) {
      return null;
    }

    const result = await this.internalDbClient.getOperationLogEntryRequestPayload({
      costProfile: resolvedProfile,
      id: normalizedId
    });
    return result.payload ?? null;
  }

  async getEntryAttempts(costProfile: string, id: string): Promise<CompletionOperationLogAttempt[]> {
    const resolvedProfile = this.resolveProfile(costProfile);
    const normalizedId = id.trim();
    if (!normalizedId) {
      return [];
    }

    const result = await this.internalDbClient.getOperationLogEntryAttempts({
      costProfile: resolvedProfile,
      id: normalizedId
    });
    return result.attempts;
  }

  async getEntryFinalText(costProfile: string, id: string): Promise<string | null> {
    const resolvedProfile = this.resolveProfile(costProfile);
    const normalizedId = id.trim();
    if (!normalizedId) {
      return null;
    }

    const result = await this.internalDbClient.getOperationLogEntryFinalText({
      costProfile: resolvedProfile,
      id: normalizedId
    });
    return result.finalText;
  }

  private resolveProfile(costProfile?: string | null): string {
    return (costProfile ?? '').trim()
      || this.getDeviceCostProfileLabel()
      || 'default';
  }
}
