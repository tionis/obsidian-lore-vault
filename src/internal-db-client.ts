import type { CompletionOperationLogRecord } from './completion-provider';
import type {
  OperationLogEntryAttemptsResult,
  OperationLogEntryDetailRequest,
  OperationLogEntryDetailResult,
  OperationLogEntryFinalTextResult,
  OperationLogEntryRequestPayloadResult,
  InternalDbRequest,
  InternalDbRequestPayload,
  InternalDbResponse,
  InternalDbStatus,
  OperationLogQueryRequest,
  OperationLogQueryResult,
  UsageLedgerCostProfilesResult,
  UsageLedgerQueryRequest,
  UsageLedgerQueryResult
} from './internal-db-types';
import type { UsageLedgerEntry } from './usage-ledger-store';

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

export class InternalDbClient {
  private readonly workerUrl: string;
  private readonly storagePersisted: boolean | null;
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private initPromise: Promise<InternalDbStatus> | null = null;
  private status: InternalDbStatus = {
    available: false,
    backend: null,
    backendLabel: 'uninitialized',
    sqliteVersion: '',
    storagePersisted: null,
    errorMessage: ''
  };

  constructor(workerUrl: string, storagePersisted: boolean | null) {
    this.workerUrl = workerUrl;
    this.storagePersisted = storagePersisted;
  }

  async initialize(): Promise<InternalDbStatus> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        const worker = new Worker(this.workerUrl);
        this.worker = worker;
        worker.addEventListener('message', event => {
          this.handleWorkerMessage(event.data as InternalDbResponse);
        });
        worker.addEventListener('error', event => {
          this.failAllPending(event.message || 'Internal DB worker failed.');
          this.status = {
            available: false,
            backend: null,
            backendLabel: 'unavailable',
            sqliteVersion: '',
            storagePersisted: this.storagePersisted,
            errorMessage: event.message || 'Internal DB worker failed.'
          };
        });

        const status = await this.request<InternalDbStatus>({
          type: 'init',
          storagePersisted: this.storagePersisted
        });
        this.status = status;
        return status;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.status = {
          available: false,
          backend: null,
          backendLabel: 'unavailable',
          sqliteVersion: '',
          storagePersisted: this.storagePersisted,
          errorMessage: message
        };
        this.worker?.terminate();
        this.worker = null;
        throw error;
      }
    })();

    return this.initPromise;
  }

  async getStatus(): Promise<InternalDbStatus> {
    if (!this.worker) {
      return this.status;
    }
    try {
      this.status = await this.request<InternalDbStatus>({ type: 'getStatus' });
    } catch (_error) {
      return this.status;
    }
    return this.status;
  }

  async appendOperationLog(record: CompletionOperationLogRecord, maxEntries: number): Promise<void> {
    await this.initialize();
    await this.request<void>({
      type: 'appendOperationLog',
      record,
      maxEntries
    });
  }

  async importOperationLogRecords(records: CompletionOperationLogRecord[], maxEntries: number): Promise<void> {
    if (records.length === 0) {
      return;
    }
    await this.initialize();
    await this.request<void>({
      type: 'importOperationLogRecords',
      records,
      maxEntries
    });
  }

  async queryOperationLog(request: OperationLogQueryRequest): Promise<OperationLogQueryResult> {
    await this.initialize();
    return this.request<OperationLogQueryResult>({
      type: 'queryOperationLog',
      ...request
    });
  }

  async getOperationLogEntryDetail(request: OperationLogEntryDetailRequest): Promise<OperationLogEntryDetailResult> {
    await this.initialize();
    return this.request<OperationLogEntryDetailResult>({
      type: 'getOperationLogEntryDetail',
      ...request
    });
  }

  async getOperationLogEntryRequestPayload(
    request: OperationLogEntryDetailRequest
  ): Promise<OperationLogEntryRequestPayloadResult> {
    await this.initialize();
    return this.request<OperationLogEntryRequestPayloadResult>({
      type: 'getOperationLogEntryRequestPayload',
      ...request
    });
  }

  async getOperationLogEntryAttempts(request: OperationLogEntryDetailRequest): Promise<OperationLogEntryAttemptsResult> {
    await this.initialize();
    return this.request<OperationLogEntryAttemptsResult>({
      type: 'getOperationLogEntryAttempts',
      ...request
    });
  }

  async getOperationLogEntryFinalText(request: OperationLogEntryDetailRequest): Promise<OperationLogEntryFinalTextResult> {
    await this.initialize();
    return this.request<OperationLogEntryFinalTextResult>({
      type: 'getOperationLogEntryFinalText',
      ...request
    });
  }

  async appendUsageLedgerEntry(sourceRoot: string, entry: UsageLedgerEntry): Promise<void> {
    await this.initialize();
    await this.request<void>({
      type: 'appendUsageLedgerEntry',
      sourceRoot,
      entry
    });
  }

  async importUsageLedgerEntries(sourceRoot: string, entries: UsageLedgerEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    await this.initialize();
    await this.request<void>({
      type: 'importUsageLedgerEntries',
      sourceRoot,
      entries
    });
  }

  async queryUsageLedger(request: UsageLedgerQueryRequest): Promise<UsageLedgerQueryResult> {
    await this.initialize();
    return this.request<UsageLedgerQueryResult>({
      type: 'queryUsageLedger',
      ...request
    });
  }

  async listUsageLedgerCostProfiles(sourceRoot: string): Promise<UsageLedgerCostProfilesResult> {
    await this.initialize();
    return this.request<UsageLedgerCostProfilesResult>({
      type: 'listUsageLedgerCostProfiles',
      sourceRoot
    });
  }

  async close(): Promise<void> {
    const worker = this.worker;
    if (!worker) {
      return;
    }
    try {
      await this.request<void>({ type: 'close' });
    } catch (_error) {
      // Ignore worker-close failures during shutdown.
    } finally {
      this.worker = null;
      worker.terminate();
      this.pending.clear();
    }
  }

  private async request<T>(payload: InternalDbRequestPayload): Promise<T> {
    const worker = this.worker;
    if (!worker) {
      throw new Error('Internal DB worker is not running.');
    }

    const id = this.nextRequestId++;
    const request = { id, ...payload } as InternalDbRequest;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage(request);
    });
  }

  private handleWorkerMessage(response: InternalDbResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);
    if (response.ok) {
      pending.resolve(response.result);
      return;
    }
    pending.reject(new Error(response.error));
  }

  private failAllPending(reason: string): void {
    const error = new Error(reason);
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
