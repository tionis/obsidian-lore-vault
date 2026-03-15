import * as SQLite from '@journeyapps/wa-sqlite';
import waSqliteWasmUrl from '@journeyapps/wa-sqlite/dist/wa-sqlite-async.wasm';
import { IDBBatchAtomicVFS } from '@journeyapps/wa-sqlite/src/examples/IDBBatchAtomicVFS.js';
import { OPFSAdaptiveVFS } from '@journeyapps/wa-sqlite/src/examples/OPFSAdaptiveVFS.js';
import type { CompletionOperationLogRecord } from './completion-provider';
import type {
  InternalDbBackend,
  InternalDbRequest,
  InternalDbResponse,
  InternalDbStatus,
  OperationLogQueryRequest,
  OperationLogQueryResult
} from './internal-db-types';
import { buildOperationLogSearchText } from './operation-log-utils';

type WorkerState = {
  sqlite3: any;
  db: number;
  backend: InternalDbBackend;
  backendLabel: string;
  sqliteVersion: string;
  storagePersisted: boolean | null;
  vfs: { close?: () => void } | null;
};

const DB_FILENAME = 'file:///lorevault-internal.sqlite3';
const OPFS_VFS_NAME = 'lorevault-opfs';
const IDB_VFS_NAME = 'lorevault-idb';
const IDB_NAME = 'lorevault-internal-db-v1';

let statePromise: Promise<WorkerState> | null = null;
let lastStatus: InternalDbStatus = {
  available: false,
  backend: null,
  backendLabel: 'uninitialized',
  sqliteVersion: '',
  storagePersisted: null,
  errorMessage: ''
};
let requestQueue: Promise<void> = Promise.resolve();

function isOpfsSupportedInWorker(): boolean {
  const maybeGlobal = globalThis as { FileSystemSyncAccessHandle?: unknown };
  return (
    typeof navigator !== 'undefined'
    && typeof navigator.storage?.getDirectory === 'function'
    && typeof maybeGlobal.FileSystemSyncAccessHandle !== 'undefined'
  );
}

function normalizeSqlValue(value: unknown): string | number | boolean | null {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }
  return value == null ? null : String(value);
}

async function queryRows(sqlite3: any, db: number, sql: string, bindings?: unknown[] | Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for await (const stmt of sqlite3.statements(db, sql)) {
    if (bindings) {
      sqlite3.bind_collection(stmt, bindings as any);
    }
    const columns = sqlite3.column_names(stmt) as string[];
    while (await sqlite3.step(stmt) === SQLite.SQLITE_ROW) {
      const values = sqlite3.row(stmt) as unknown[];
      const row: Record<string, unknown> = {};
      for (let index = 0; index < columns.length; index += 1) {
        row[columns[index]] = normalizeSqlValue(values[index]);
      }
      rows.push(row);
    }
  }
  return rows;
}

async function execSql(sqlite3: any, db: number, sql: string, bindings?: unknown[] | Record<string, unknown>): Promise<void> {
  for await (const stmt of sqlite3.statements(db, sql)) {
    if (bindings) {
      sqlite3.bind_collection(stmt, bindings as any);
    }
    await sqlite3.step(stmt);
  }
}

function serializeUsageJson(record: CompletionOperationLogRecord): string | null {
  return record.usage ? JSON.stringify(record.usage) : null;
}

async function insertOperationLogRecord(sqlite3: any, db: number, record: CompletionOperationLogRecord): Promise<void> {
  await execSql(
    sqlite3,
    db,
    `INSERT OR REPLACE INTO operation_log (
      id,
      cost_profile,
      kind,
      operation_name,
      provider,
      model,
      endpoint,
      started_at,
      finished_at,
      duration_ms,
      status,
      aborted,
      error_text,
      request_json,
      attempts_json,
      final_text,
      usage_json,
      search_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      record.id,
      (record.costProfile ?? '').trim() || 'default',
      record.kind,
      record.operationName,
      record.provider,
      record.model,
      record.endpoint,
      Math.max(0, Math.floor(record.startedAt)),
      Math.max(0, Math.floor(record.finishedAt)),
      Math.max(0, Math.floor(record.durationMs)),
      record.status,
      record.aborted ? 1 : 0,
      record.error ?? null,
      JSON.stringify(record.request ?? {}),
      JSON.stringify(record.attempts ?? []),
      record.finalText ?? null,
      serializeUsageJson(record),
      buildOperationLogSearchText(record)
    ]
  );
}

async function pruneOperationLogForProfile(sqlite3: any, db: number, costProfile: string, maxEntries: number): Promise<void> {
  await execSql(
    sqlite3,
    db,
    `DELETE FROM operation_log
     WHERE id IN (
       SELECT id
       FROM operation_log
       WHERE cost_profile = ?
       ORDER BY started_at DESC, finished_at DESC, id DESC
       LIMIT -1 OFFSET ?
     );`,
    [costProfile, Math.max(20, Math.floor(maxEntries))]
  );
}

function parseJsonOr<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch (_error) {
    return fallback;
  }
}

function rowToOperationLogRecord(row: Record<string, unknown>): CompletionOperationLogRecord {
  const costProfile = typeof row.cost_profile === 'string' ? row.cost_profile.trim() : '';
  const usage = parseJsonOr(row.usage_json, null as CompletionOperationLogRecord['usage']);
  return {
    id: String(row.id ?? ''),
    ...(costProfile ? { costProfile } : {}),
    kind: row.kind === 'completion_stream' || row.kind === 'tool_planner' || row.kind === 'embedding'
      ? row.kind
      : 'completion',
    operationName: String(row.operation_name ?? ''),
    provider: row.provider === 'ollama' || row.provider === 'openai_compatible'
      ? row.provider
      : 'openrouter',
    model: String(row.model ?? ''),
    endpoint: String(row.endpoint ?? ''),
    startedAt: Number(row.started_at ?? 0),
    finishedAt: Number(row.finished_at ?? 0),
    durationMs: Number(row.duration_ms ?? 0),
    status: row.status === 'error' ? 'error' : 'ok',
    aborted: Number(row.aborted ?? 0) !== 0,
    ...(typeof row.error_text === 'string' && row.error_text.trim() ? { error: row.error_text.trim() } : {}),
    request: parseJsonOr(row.request_json, {}),
    attempts: parseJsonOr(row.attempts_json, []),
    ...(typeof row.final_text === 'string' && row.final_text.length > 0 ? { finalText: row.final_text } : {}),
    ...(usage ? { usage } : {})
  };
}

function buildQueryWhere(request: OperationLogQueryRequest): { whereSql: string; bindings: unknown[] } {
  const clauses = ['cost_profile = ?'];
  const bindings: unknown[] = [request.costProfile];

  if (request.kindFilter !== 'all') {
    clauses.push('kind = ?');
    bindings.push(request.kindFilter);
  }
  if (request.statusFilter !== 'all') {
    clauses.push('status = ?');
    bindings.push(request.statusFilter);
  }
  for (const token of request.searchTokens) {
    clauses.push('search_text LIKE ?');
    bindings.push(`%${token}%`);
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    bindings
  };
}

async function queryOperationLogRows(workerState: WorkerState, request: OperationLogQueryRequest): Promise<OperationLogQueryResult> {
  const { sqlite3, db } = workerState;
  const { whereSql, bindings } = buildQueryWhere(request);
  const countRows = await queryRows(
    sqlite3,
    db,
    `SELECT COUNT(*) AS total FROM operation_log ${whereSql};`,
    bindings
  );
  const totalEntries = Number(countRows[0]?.total ?? 0);
  const entryRows = await queryRows(
    sqlite3,
    db,
    `SELECT
      id,
      cost_profile,
      kind,
      operation_name,
      provider,
      model,
      endpoint,
      started_at,
      finished_at,
      duration_ms,
      status,
      aborted,
      error_text,
      request_json,
      attempts_json,
      final_text,
      usage_json
    FROM operation_log
    ${whereSql}
    ORDER BY started_at DESC, finished_at DESC, id DESC
    LIMIT ?;`,
    [...bindings, Math.max(1, Math.floor(request.limit))]
  );

  return {
    entries: entryRows.map(row => rowToOperationLogRecord(row)),
    totalEntries
  };
}

async function ensureSchema(sqlite3: any, db: number): Promise<void> {
  await sqlite3.exec(
    db,
    `
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS operation_log (
        id TEXT PRIMARY KEY,
        cost_profile TEXT NOT NULL,
        kind TEXT NOT NULL,
        operation_name TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        aborted INTEGER NOT NULL,
        error_text TEXT,
        request_json TEXT NOT NULL,
        attempts_json TEXT NOT NULL,
        final_text TEXT,
        usage_json TEXT,
        search_text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_operation_log_cost_profile_time
        ON operation_log(cost_profile, started_at DESC, finished_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_operation_log_kind_status
        ON operation_log(cost_profile, kind, status, started_at DESC, id DESC);
      INSERT OR REPLACE INTO meta (key, value) VALUES
        ('schema_version', '1'),
        ('store_kind', 'lorevault.internal.operation_log');
    `
  );
}

async function initializeWorkerState(storagePersisted: boolean | null): Promise<WorkerState> {
  if (statePromise) {
    return statePromise;
  }

  statePromise = (async () => {
    const sqliteFactoryModule = await import('@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs');
    const sqliteFactory = (
      (sqliteFactoryModule as { default?: (moduleArg?: unknown) => Promise<unknown> }).default
      ?? (sqliteFactoryModule as unknown as (moduleArg?: unknown) => Promise<unknown>)
    );
    const module = await sqliteFactory({
      locateFile: (path: string) => path === 'wa-sqlite-async.wasm'
        ? 'file:///wa-sqlite-async.wasm'
        : path,
      wasmBinary: waSqliteWasmUrl
    });
    const sqlite3 = SQLite.Factory(module as any);

    let backend: InternalDbBackend = 'idb';
    let backendLabel = 'IndexedDB';
    let vfs: { close?: () => void } | null = null;
    let db = 0;

    if (isOpfsSupportedInWorker()) {
      try {
        vfs = await (OPFSAdaptiveVFS as any).create(OPFS_VFS_NAME, module as any);
        sqlite3.vfs_register(vfs as any, true);
        db = await sqlite3.open_v2(DB_FILENAME, undefined, OPFS_VFS_NAME);
        backend = 'opfs';
        backendLabel = 'OPFS';
      } catch (error) {
        console.warn('LoreVault: OPFS backend unavailable, falling back to IndexedDB VFS.', error);
        vfs = null;
      }
    }

    if (!db) {
      vfs = await (IDBBatchAtomicVFS as any).create(IDB_VFS_NAME, module as any, { idbName: IDB_NAME });
      sqlite3.vfs_register(vfs as any, true);
      db = await sqlite3.open_v2(DB_FILENAME, undefined, IDB_VFS_NAME);
      backend = 'idb';
      backendLabel = 'IndexedDB';
    }

    await ensureSchema(sqlite3, db);

    const workerState: WorkerState = {
      sqlite3,
      db,
      backend,
      backendLabel,
      sqliteVersion: sqlite3.libversion(),
      storagePersisted,
      vfs
    };

    lastStatus = {
      available: true,
      backend,
      backendLabel,
      sqliteVersion: workerState.sqliteVersion,
      storagePersisted,
      errorMessage: ''
    };

    return workerState;
  })().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    lastStatus = {
      available: false,
      backend: null,
      backendLabel: 'unavailable',
      sqliteVersion: '',
      storagePersisted,
      errorMessage: message
    };
    statePromise = null;
    throw error;
  });

  return statePromise;
}

async function handleRequest(request: InternalDbRequest): Promise<unknown> {
  switch (request.type) {
    case 'init': {
      await initializeWorkerState(request.storagePersisted);
      return lastStatus;
    }
    case 'getStatus': {
      return lastStatus;
    }
    case 'appendOperationLog': {
      const workerState = await initializeWorkerState(lastStatus.storagePersisted);
      const costProfile = (request.record.costProfile ?? '').trim() || 'default';
      await workerState.sqlite3.exec(workerState.db, 'BEGIN IMMEDIATE;');
      try {
        await insertOperationLogRecord(workerState.sqlite3, workerState.db, {
          ...request.record,
          costProfile
        });
        await pruneOperationLogForProfile(workerState.sqlite3, workerState.db, costProfile, request.maxEntries);
        await workerState.sqlite3.exec(workerState.db, 'COMMIT;');
      } catch (error) {
        await workerState.sqlite3.exec(workerState.db, 'ROLLBACK;');
        throw error;
      }
      return undefined;
    }
    case 'importOperationLogRecords': {
      const workerState = await initializeWorkerState(lastStatus.storagePersisted);
      const touchedProfiles = new Set<string>();
      await workerState.sqlite3.exec(workerState.db, 'BEGIN IMMEDIATE;');
      try {
        for (const record of request.records) {
          const costProfile = (record.costProfile ?? '').trim() || 'default';
          touchedProfiles.add(costProfile);
          await insertOperationLogRecord(workerState.sqlite3, workerState.db, {
            ...record,
            costProfile
          });
        }
        for (const costProfile of touchedProfiles) {
          await pruneOperationLogForProfile(workerState.sqlite3, workerState.db, costProfile, request.maxEntries);
        }
        await workerState.sqlite3.exec(workerState.db, 'COMMIT;');
      } catch (error) {
        await workerState.sqlite3.exec(workerState.db, 'ROLLBACK;');
        throw error;
      }
      return undefined;
    }
    case 'queryOperationLog': {
      const workerState = await initializeWorkerState(lastStatus.storagePersisted);
      return queryOperationLogRows(workerState, request);
    }
    case 'close': {
      if (!statePromise) {
        return undefined;
      }
      const workerState = await statePromise;
      try {
        await workerState.sqlite3.close(workerState.db);
      } finally {
        workerState.vfs?.close?.();
        statePromise = null;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

function postResponse(response: InternalDbResponse): void {
  self.postMessage(response);
}

self.addEventListener('message', event => {
  const request = event.data as InternalDbRequest;
  requestQueue = requestQueue
    .then(async () => {
      try {
        const result = await handleRequest(request);
        postResponse({
          id: request.id,
          ok: true,
          result
        });
      } catch (error) {
        postResponse({
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    })
    .catch(error => {
      postResponse({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });
});
