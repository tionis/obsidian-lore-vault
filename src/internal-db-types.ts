import type {
  CompletionOperationKind,
  CompletionOperationLogAttempt,
  CompletionOperationLogRecord
} from './completion-provider';
import type { OperationLogRecordSummary } from './operation-log';
import type { UsageLedgerReportAggregates } from './usage-ledger-report';
import type { UsageLedgerEntry } from './usage-ledger-store';

export type InternalDbBackend = 'opfs' | 'idb';

export interface InternalDbStatus {
  available: boolean;
  backend: InternalDbBackend | null;
  backendLabel: string;
  sqliteVersion: string;
  storagePersisted: boolean | null;
  errorMessage: string;
}

export interface OperationLogQueryRequest {
  costProfile: string;
  kindFilter: 'all' | CompletionOperationKind;
  statusFilter: 'all' | 'ok' | 'error';
  searchTokens: string[];
  limit: number;
}

export interface OperationLogQueryResult {
  entries: OperationLogRecordSummary[];
  totalEntries: number | null;
  hasMoreEntries: boolean;
}

export interface OperationLogEntryDetailRequest {
  costProfile: string;
  id: string;
}

export interface OperationLogEntryDetailResult {
  record: CompletionOperationLogRecord | null;
}

export interface OperationLogEntryRequestPayloadResult {
  payload: unknown;
}

export interface OperationLogEntryAttemptsResult {
  attempts: CompletionOperationLogAttempt[];
}

export interface OperationLogEntryFinalTextResult {
  finalText: string | null;
}

export interface UsageLedgerQueryRequest {
  sourceRoot: string;
  costProfile?: string | null;
}

export interface UsageLedgerQueryResult {
  entries: UsageLedgerEntry[];
}

export interface UsageLedgerCostProfilesResult {
  profiles: string[];
}

export interface UsageLedgerReportQueryRequest extends UsageLedgerQueryRequest {
  nowMs: number;
  sessionStartAt: number;
}

export type UsageLedgerReportQueryResult = UsageLedgerReportAggregates;

export type InternalDbRequest =
  | {
    id: number;
    type: 'init';
    storagePersisted: boolean | null;
  }
  | {
    id: number;
    type: 'appendOperationLog';
    record: CompletionOperationLogRecord;
    maxEntries: number;
  }
  | {
    id: number;
    type: 'importOperationLogRecords';
    records: CompletionOperationLogRecord[];
    maxEntries: number;
  }
  | ({
    id: number;
    type: 'queryOperationLog';
  } & OperationLogQueryRequest)
  | ({
    id: number;
    type: 'getOperationLogEntryDetail';
  } & OperationLogEntryDetailRequest)
  | ({
    id: number;
    type: 'getOperationLogEntryRequestPayload';
  } & OperationLogEntryDetailRequest)
  | ({
    id: number;
    type: 'getOperationLogEntryAttempts';
  } & OperationLogEntryDetailRequest)
  | ({
    id: number;
    type: 'getOperationLogEntryFinalText';
  } & OperationLogEntryDetailRequest)
  | {
    id: number;
    type: 'appendUsageLedgerEntry';
    sourceRoot: string;
    entry: UsageLedgerEntry;
  }
  | {
    id: number;
    type: 'importUsageLedgerEntries';
    sourceRoot: string;
    entries: UsageLedgerEntry[];
  }
  | {
    id: number;
    type: 'replaceUsageLedgerEntries';
    sourceRoot: string;
    entries: UsageLedgerEntry[];
  }
  | ({
    id: number;
    type: 'queryUsageLedger';
  } & UsageLedgerQueryRequest)
  | ({
    id: number;
    type: 'queryUsageLedgerReport';
  } & UsageLedgerReportQueryRequest)
  | {
    id: number;
    type: 'listUsageLedgerCostProfiles';
    sourceRoot: string;
  }
  | {
    id: number;
    type: 'getStatus';
  }
  | {
    id: number;
    type: 'close';
  };

export type InternalDbRequestPayload =
  InternalDbRequest extends infer Request
    ? Request extends { id: number }
      ? Omit<Request, 'id'>
      : never
    : never;

export type InternalDbResponse =
  | {
    id: number;
    ok: true;
    result?: unknown;
  }
  | {
    id: number;
    ok: false;
    error: string;
  };
