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
    _requestId: number;
    type: 'init';
    storagePersisted: boolean | null;
  }
  | {
    _requestId: number;
    type: 'appendOperationLog';
    record: CompletionOperationLogRecord;
    maxEntries: number;
  }
  | ({
    _requestId: number;
    type: 'queryOperationLog';
  } & OperationLogQueryRequest)
  | ({
    _requestId: number;
    type: 'getOperationLogEntryDetail';
  } & OperationLogEntryDetailRequest)
  | ({
    _requestId: number;
    type: 'getOperationLogEntryRequestPayload';
  } & OperationLogEntryDetailRequest)
  | ({
    _requestId: number;
    type: 'getOperationLogEntryAttempts';
  } & OperationLogEntryDetailRequest)
  | ({
    _requestId: number;
    type: 'getOperationLogEntryFinalText';
  } & OperationLogEntryDetailRequest)
  | {
    _requestId: number;
    type: 'appendUsageLedgerEntry';
    sourceRoot: string;
    entry: UsageLedgerEntry;
  }
  | {
    _requestId: number;
    type: 'importUsageLedgerEntries';
    sourceRoot: string;
    entries: UsageLedgerEntry[];
  }
  | {
    _requestId: number;
    type: 'replaceUsageLedgerEntries';
    sourceRoot: string;
    entries: UsageLedgerEntry[];
  }
  | {
    _requestId: number;
    type: 'deleteUsageLedgerSourceRoot';
    sourceRoot: string;
  }
  | ({
    _requestId: number;
    type: 'queryUsageLedger';
  } & UsageLedgerQueryRequest)
  | ({
    _requestId: number;
    type: 'queryUsageLedgerReport';
  } & UsageLedgerReportQueryRequest)
  | {
    _requestId: number;
    type: 'listUsageLedgerCostProfiles';
    sourceRoot: string;
  }
  | {
    _requestId: number;
    type: 'getStatus';
  }
  | {
    _requestId: number;
    type: 'resetLocalDb';
  }
  | {
    _requestId: number;
    type: 'close';
  };

export type InternalDbRequestPayload =
  InternalDbRequest extends infer Request
    ? Request extends { _requestId: number }
      ? Omit<Request, '_requestId'>
      : never
    : never;

export type InternalDbResponse =
  | {
    _requestId: number;
    ok: true;
    result?: unknown;
  }
  | {
    _requestId: number;
    ok: false;
    error: string;
  };
