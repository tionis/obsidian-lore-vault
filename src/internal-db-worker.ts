import * as SQLite from '@journeyapps/wa-sqlite';
import waSqliteWasmUrl from '@journeyapps/wa-sqlite/dist/wa-sqlite-async.wasm';
import { IDBBatchAtomicVFS } from '@journeyapps/wa-sqlite/src/examples/IDBBatchAtomicVFS.js';
import { OPFSAdaptiveVFS } from '@journeyapps/wa-sqlite/src/examples/OPFSAdaptiveVFS.js';
import type { CompletionOperationLogRecord } from './completion-provider';
import type {
  InternalDbBackend,
  OperationLogEntryAttemptsResult,
  OperationLogEntryDetailRequest,
  OperationLogEntryDetailResult,
  OperationLogEntryFinalTextResult,
  OperationLogEntryRequestPayloadResult,
  InternalDbRequest,
  InternalDbResponse,
  InternalDbStatus,
  OperationLogQueryRequest,
  OperationLogQueryResult,
  UsageLedgerCostProfilesResult,
  UsageLedgerQueryRequest,
  UsageLedgerQueryResult
} from './internal-db-types';
import { buildOperationLogSearchText } from './operation-log-utils';
import type { UsageLedgerEntry } from './usage-ledger-store';

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

function normalizeUsageLedgerCostProfile(entry: UsageLedgerEntry): string {
  return typeof entry.metadata?.costProfile === 'string'
    ? entry.metadata.costProfile.trim()
    : '';
}

async function insertUsageLedgerEntry(
  sqlite3: any,
  db: number,
  sourceRoot: string,
  entry: UsageLedgerEntry
): Promise<void> {
  await execSql(
    sqlite3,
    db,
    `INSERT OR REPLACE INTO usage_ledger (
      id,
      source_root,
      cost_profile,
      timestamp,
      operation,
      provider,
      model,
      prompt_tokens,
      completion_tokens,
      total_tokens,
      reported_cost_usd,
      estimated_cost_usd,
      cost_source,
      pricing_source,
      input_cost_per_million_usd,
      output_cost_per_million_usd,
      pricing_rule,
      pricing_snapshot_at,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      entry.id,
      sourceRoot,
      normalizeUsageLedgerCostProfile(entry),
      Math.max(0, Math.floor(entry.timestamp)),
      entry.operation,
      entry.provider,
      entry.model,
      Math.max(0, Math.floor(entry.promptTokens)),
      Math.max(0, Math.floor(entry.completionTokens)),
      Math.max(0, Math.floor(entry.totalTokens)),
      entry.reportedCostUsd,
      entry.estimatedCostUsd,
      entry.costSource,
      entry.pricingSource,
      entry.inputCostPerMillionUsd,
      entry.outputCostPerMillionUsd,
      entry.pricingRule,
      entry.pricingSnapshotAt,
      JSON.stringify(entry.metadata ?? {})
    ]
  );
}

function rowToUsageLedgerEntry(row: Record<string, unknown>): UsageLedgerEntry {
  return {
    id: String(row.id ?? ''),
    timestamp: Number(row.timestamp ?? 0),
    operation: String(row.operation ?? ''),
    provider: String(row.provider ?? ''),
    model: String(row.model ?? ''),
    promptTokens: Number(row.prompt_tokens ?? 0),
    completionTokens: Number(row.completion_tokens ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
    reportedCostUsd: typeof row.reported_cost_usd === 'number' ? row.reported_cost_usd : null,
    estimatedCostUsd: typeof row.estimated_cost_usd === 'number' ? row.estimated_cost_usd : null,
    costSource: row.cost_source === 'provider_reported' || row.cost_source === 'estimated'
      ? row.cost_source
      : 'unknown',
    pricingSource: row.pricing_source === 'provider_reported'
      || row.pricing_source === 'model_override'
      || row.pricing_source === 'default_rates'
      ? row.pricing_source
      : 'none',
    inputCostPerMillionUsd: typeof row.input_cost_per_million_usd === 'number' ? row.input_cost_per_million_usd : null,
    outputCostPerMillionUsd: typeof row.output_cost_per_million_usd === 'number' ? row.output_cost_per_million_usd : null,
    pricingRule: typeof row.pricing_rule === 'string' && row.pricing_rule.trim() ? row.pricing_rule.trim() : null,
    pricingSnapshotAt: typeof row.pricing_snapshot_at === 'number' ? row.pricing_snapshot_at : null,
    metadata: parseJsonOr(row.metadata_json, {})
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

async function queryUsageLedgerRows(
  workerState: WorkerState,
  request: UsageLedgerQueryRequest
): Promise<UsageLedgerQueryResult> {
  const bindings: unknown[] = [request.sourceRoot];
  const clauses: string[] = ['source_root = ?'];
  const normalizedCostProfile = (request.costProfile ?? '').trim();
  if (normalizedCostProfile) {
    clauses.push('cost_profile = ?');
    bindings.push(normalizedCostProfile);
  }
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await queryRows(
    workerState.sqlite3,
    workerState.db,
    `SELECT
      id,
      cost_profile,
      timestamp,
      operation,
      provider,
      model,
      prompt_tokens,
      completion_tokens,
      total_tokens,
      reported_cost_usd,
      estimated_cost_usd,
      cost_source,
      pricing_source,
      input_cost_per_million_usd,
      output_cost_per_million_usd,
      pricing_rule,
      pricing_snapshot_at,
      metadata_json
    FROM usage_ledger
    ${whereSql}
    ORDER BY timestamp ASC, id ASC;`,
    bindings
  );
  return {
    entries: rows.map(row => rowToUsageLedgerEntry(row))
  };
}

async function listUsageLedgerCostProfiles(
  workerState: WorkerState,
  sourceRoot: string
): Promise<UsageLedgerCostProfilesResult> {
  const rows = await queryRows(
    workerState.sqlite3,
    workerState.db,
    `SELECT DISTINCT cost_profile
    FROM usage_ledger
    WHERE source_root = ?
      AND cost_profile <> ''
    ORDER BY cost_profile ASC;`,
    [sourceRoot]
  );
  return {
    profiles: rows
      .map(row => typeof row.cost_profile === 'string' ? row.cost_profile.trim() : '')
      .filter(Boolean)
  };
}

async function getOperationLogEntryDetail(
  workerState: WorkerState,
  request: OperationLogEntryDetailRequest
): Promise<OperationLogEntryDetailResult> {
  const rows = await queryRows(
    workerState.sqlite3,
    workerState.db,
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
    WHERE cost_profile = ? AND id = ?
    LIMIT 1;`,
    [request.costProfile, request.id]
  );
  if (rows.length === 0) {
    return { record: null };
  }
  return {
    record: rowToOperationLogRecord(rows[0])
  };
}

async function getOperationLogEntryRequestPayload(
  workerState: WorkerState,
  request: OperationLogEntryDetailRequest
): Promise<OperationLogEntryRequestPayloadResult> {
  const rows = await queryRows(
    workerState.sqlite3,
    workerState.db,
    `SELECT request_json
    FROM operation_log
    WHERE cost_profile = ? AND id = ?
    LIMIT 1;`,
    [request.costProfile, request.id]
  );
  return {
    payload: parseJsonOr(rows[0]?.request_json, null)
  };
}

async function getOperationLogEntryAttempts(
  workerState: WorkerState,
  request: OperationLogEntryDetailRequest
): Promise<OperationLogEntryAttemptsResult> {
  const rows = await queryRows(
    workerState.sqlite3,
    workerState.db,
    `SELECT attempts_json
    FROM operation_log
    WHERE cost_profile = ? AND id = ?
    LIMIT 1;`,
    [request.costProfile, request.id]
  );
  return {
    attempts: parseJsonOr(rows[0]?.attempts_json, [])
  };
}

async function getOperationLogEntryFinalText(
  workerState: WorkerState,
  request: OperationLogEntryDetailRequest
): Promise<OperationLogEntryFinalTextResult> {
  const rows = await queryRows(
    workerState.sqlite3,
    workerState.db,
    `SELECT final_text
    FROM operation_log
    WHERE cost_profile = ? AND id = ?
    LIMIT 1;`,
    [request.costProfile, request.id]
  );
  return {
    finalText: typeof rows[0]?.final_text === 'string' ? rows[0].final_text : null
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
      CREATE TABLE IF NOT EXISTS usage_ledger (
        id TEXT PRIMARY KEY,
        source_root TEXT NOT NULL DEFAULT '',
        cost_profile TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        operation TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        reported_cost_usd REAL,
        estimated_cost_usd REAL,
        cost_source TEXT NOT NULL,
        pricing_source TEXT NOT NULL,
        input_cost_per_million_usd REAL,
        output_cost_per_million_usd REAL,
        pricing_rule TEXT,
        pricing_snapshot_at INTEGER,
        metadata_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_operation_log_cost_profile_time
        ON operation_log(cost_profile, started_at DESC, finished_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_operation_log_kind_status
        ON operation_log(cost_profile, kind, status, started_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_usage_ledger_cost_profile_time
        ON usage_ledger(cost_profile, timestamp ASC, id ASC);
      CREATE INDEX IF NOT EXISTS idx_usage_ledger_operation_time
        ON usage_ledger(operation, timestamp ASC, id ASC);
      INSERT OR REPLACE INTO meta (key, value) VALUES
        ('schema_version', '3'),
        ('store_kind', 'lorevault.internal');
    `
  );

  const usageLedgerColumns = await queryRows(sqlite3, db, 'PRAGMA table_info(usage_ledger);');
  if (!usageLedgerColumns.some(row => row.name === 'source_root')) {
    await execSql(
      sqlite3,
      db,
      `ALTER TABLE usage_ledger
       ADD COLUMN source_root TEXT NOT NULL DEFAULT '';`
    );
  }

  await execSql(
    sqlite3,
    db,
    `
      CREATE INDEX IF NOT EXISTS idx_usage_ledger_source_root_cost_profile_time
        ON usage_ledger(source_root, cost_profile, timestamp ASC, id ASC);
      CREATE INDEX IF NOT EXISTS idx_usage_ledger_source_root_operation_time
        ON usage_ledger(source_root, operation, timestamp ASC, id ASC);
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
    case 'getOperationLogEntryDetail': {
      const workerState = await initializeWorkerState(lastStatus.storagePersisted);
      return getOperationLogEntryDetail(workerState, request);
    }
    case 'getOperationLogEntryRequestPayload': {
      const workerState = await initializeWorkerState(lastStatus.storagePersisted);
      return getOperationLogEntryRequestPayload(workerState, request);
    }
    case 'getOperationLogEntryAttempts': {
      const workerState = await initializeWorkerState(lastStatus.storagePersisted);
      return getOperationLogEntryAttempts(workerState, request);
    }
    case 'getOperationLogEntryFinalText': {
      const workerState = await initializeWorkerState(lastStatus.storagePersisted);
      return getOperationLogEntryFinalText(workerState, request);
    }
    case 'appendUsageLedgerEntry': {
      const workerState = await initializeWorkerState(lastStatus.storagePersisted);
      await workerState.sqlite3.exec(workerState.db, 'BEGIN IMMEDIATE;');
      try {
        await insertUsageLedgerEntry(workerState.sqlite3, workerState.db, request.sourceRoot, request.entry);
        await workerState.sqlite3.exec(workerState.db, 'COMMIT;');
      } catch (error) {
        await workerState.sqlite3.exec(workerState.db, 'ROLLBACK;');
        throw error;
      }
      return undefined;
    }
    case 'importUsageLedgerEntries': {
      if (!request.entries.length) {
        return undefined;
      }
      const workerState = await initializeWorkerState(lastStatus.storagePersisted);
      await workerState.sqlite3.exec(workerState.db, 'BEGIN IMMEDIATE;');
      try {
        for (const entry of request.entries) {
          await insertUsageLedgerEntry(workerState.sqlite3, workerState.db, request.sourceRoot, entry);
        }
        await workerState.sqlite3.exec(workerState.db, 'COMMIT;');
      } catch (error) {
        await workerState.sqlite3.exec(workerState.db, 'ROLLBACK;');
        throw error;
      }
      return undefined;
    }
    case 'queryUsageLedger': {
      const workerState = await initializeWorkerState(lastStatus.storagePersisted);
      return queryUsageLedgerRows(workerState, request);
    }
    case 'listUsageLedgerCostProfiles': {
      const workerState = await initializeWorkerState(lastStatus.storagePersisted);
      return listUsageLedgerCostProfiles(workerState, request.sourceRoot);
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
