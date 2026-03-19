import type {
  CompletionOperationKind,
  CompletionOperationLogAttempt,
  CompletionOperationLogRecord
} from './completion-provider';

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
  entries: CompletionOperationLogRecord[];
  totalEntries: number;
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
