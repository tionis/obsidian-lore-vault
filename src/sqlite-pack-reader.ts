import { App } from 'obsidian';
import { LoreBookEntry, RagDocument, RagChunk, RagChunkEmbedding, ScopePack } from './models';
import { getSqlJs } from './sqlite-runtime';
import { readVaultBinary } from './vault-binary-io';

type SqlCell = string | number | Uint8Array | null;
type SqlRow = Record<string, SqlCell>;
type SqlResult = { columns: string[]; values: SqlCell[][] };

function parseJsonColumn<T>(value: string): T {
  return JSON.parse(value) as T;
}

function queryRows(db: any, sql: string): SqlRow[] {
  const results = db.exec(sql) as SqlResult[];
  if (!results || results.length === 0) {
    return [];
  }

  const [result] = results;
  const rows: SqlRow[] = [];
  for (const values of result.values) {
    const row: SqlRow = {};
    for (let index = 0; index < result.columns.length; index += 1) {
      row[result.columns[index]] = values[index];
    }
    rows.push(row);
  }
  return rows;
}

function toStringValue(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return '';
}

function toNumberValue(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export class SqlitePackReader {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  private async withDatabase<T>(outputPath: string, handler: (db: any) => T): Promise<T> {
    const dbBytes = await readVaultBinary(this.app, outputPath);
    const SQL = await getSqlJs();
    const db = new SQL.Database(dbBytes);

    try {
      return handler(db);
    } finally {
      db.close();
    }
  }

  async readWorldInfoEntries(outputPath: string): Promise<{[key: number]: LoreBookEntry}> {
    return this.withDatabase(outputPath, db => {
      const rows = queryRows(db, 'SELECT entry_json FROM world_info_entries ORDER BY order_value DESC, uid ASC;');
      const entries: {[key: number]: LoreBookEntry} = {};
      for (const row of rows) {
        const serialized = toStringValue(row, 'entry_json');
        if (!serialized) {
          continue;
        }
        const entry = parseJsonColumn<LoreBookEntry>(serialized);
        entries[entry.uid] = entry;
      }
      return entries;
    });
  }

  async readRagDocuments(outputPath: string): Promise<RagDocument[]> {
    return this.withDatabase(outputPath, db => {
      const rows = queryRows(db, 'SELECT uid, scope, path, title, content FROM rag_documents ORDER BY path ASC, title ASC, uid ASC;');
      return rows.map(row => ({
        uid: toNumberValue(row, 'uid'),
        scope: toStringValue(row, 'scope'),
        path: toStringValue(row, 'path'),
        title: toStringValue(row, 'title'),
        content: toStringValue(row, 'content')
      }));
    });
  }

  async readScopePack(outputPath: string): Promise<ScopePack> {
    return this.withDatabase(outputPath, db => {
      const metaRows = queryRows(db, 'SELECT key, value FROM meta ORDER BY key ASC;');
      const meta = new Map(metaRows.map(row => [toStringValue(row, 'key'), toStringValue(row, 'value')]));

      const worldInfoRows = queryRows(db, 'SELECT entry_json FROM world_info_entries ORDER BY order_value DESC, uid ASC;');
      const worldInfoEntries: LoreBookEntry[] = [];
      for (const row of worldInfoRows) {
        const serialized = toStringValue(row, 'entry_json');
        if (!serialized) {
          continue;
        }
        worldInfoEntries.push(parseJsonColumn<LoreBookEntry>(serialized));
      }

      const documentRows = queryRows(db, 'SELECT uid, scope, path, title, content FROM rag_documents ORDER BY path ASC, title ASC, uid ASC;');
      const ragDocuments: RagDocument[] = documentRows.map(row => ({
        uid: toNumberValue(row, 'uid'),
        scope: toStringValue(row, 'scope'),
        path: toStringValue(row, 'path'),
        title: toStringValue(row, 'title'),
        content: toStringValue(row, 'content')
      }));

      const chunkRows = queryRows(db, 'SELECT chunk_id, doc_uid, scope, path, title, chunk_index, heading, text, text_hash, token_estimate, start_offset, end_offset FROM rag_chunks ORDER BY path ASC, chunk_index ASC;');
      const ragChunks: RagChunk[] = chunkRows.map(row => ({
        chunkId: toStringValue(row, 'chunk_id'),
        docUid: toNumberValue(row, 'doc_uid'),
        scope: toStringValue(row, 'scope'),
        path: toStringValue(row, 'path'),
        title: toStringValue(row, 'title'),
        chunkIndex: toNumberValue(row, 'chunk_index'),
        heading: toStringValue(row, 'heading'),
        text: toStringValue(row, 'text'),
        textHash: toStringValue(row, 'text_hash'),
        tokenEstimate: toNumberValue(row, 'token_estimate'),
        startOffset: toNumberValue(row, 'start_offset'),
        endOffset: toNumberValue(row, 'end_offset')
      }));

      const embeddingRows = queryRows(db, 'SELECT chunk_id, provider, model, dimensions, cache_key, created_at, vector_json FROM rag_chunk_embeddings ORDER BY chunk_id ASC, provider ASC, model ASC;');
      const ragChunkEmbeddings: RagChunkEmbedding[] = embeddingRows.map(row => {
        const serializedVector = toStringValue(row, 'vector_json');
        return {
          chunkId: toStringValue(row, 'chunk_id'),
          provider: toStringValue(row, 'provider'),
          model: toStringValue(row, 'model'),
          dimensions: toNumberValue(row, 'dimensions'),
          cacheKey: toStringValue(row, 'cache_key'),
          createdAt: toNumberValue(row, 'created_at'),
          vector: serializedVector ? parseJsonColumn<number[]>(serializedVector) : []
        };
      });

      return {
        schemaVersion: Number(meta.get('schema_version') ?? 1),
        scope: meta.get('scope') ?? '',
        generatedAt: Number(meta.get('generated_at') ?? Date.now()),
        worldInfoEntries,
        ragDocuments,
        ragChunks,
        ragChunkEmbeddings
      };
    });
  }
}
