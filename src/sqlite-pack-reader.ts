import { App } from 'obsidian';
import {
  DEFAULT_SETTINGS,
  LoreBookEntry,
  RagDocument,
  RagChunk,
  RagChunkEmbedding,
  ScopePack,
  ScopePackBuildMetadata,
  ScopePackNoteEmbedding,
  ScopePackSourceNote
} from './models';
import { getSqlJs } from './sqlite-runtime';
import { readVaultBinary } from './vault-binary-io';

type SqlCell = string | number | Uint8Array | null;
type SqlRow = Record<string, SqlCell>;
type SqlResult = { columns: string[]; values: SqlCell[][] };

function parseJsonColumn<T>(value: string): T {
  return JSON.parse(value) as T;
}

function parseJsonColumnOr<T>(value: string, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return parseJsonColumn<T>(value);
  } catch (_error) {
    return fallback;
  }
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

function toBooleanValue(row: SqlRow, key: string): boolean {
  const value = row[key];
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
  return false;
}

function tableExists(db: any, tableName: string): boolean {
  const escapedName = tableName.replace(/'/g, "''");
  const rows = queryRows(
    db,
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${escapedName}' LIMIT 1;`
  );
  return rows.length > 0;
}

function defaultSettingsSnapshot(): ScopePackBuildMetadata['settingsSnapshot'] {
  return {
    tagScoping: { ...DEFAULT_SETTINGS.tagScoping },
    weights: { ...DEFAULT_SETTINGS.weights },
    defaultEntry: { ...DEFAULT_SETTINGS.defaultEntry },
    retrieval: {
      ...DEFAULT_SETTINGS.retrieval,
      toolCalls: { ...DEFAULT_SETTINGS.retrieval.toolCalls }
    },
    summaries: { ...DEFAULT_SETTINGS.summaries },
    embeddings: {
      enabled: DEFAULT_SETTINGS.embeddings.enabled,
      provider: DEFAULT_SETTINGS.embeddings.provider,
      endpoint: DEFAULT_SETTINGS.embeddings.endpoint,
      model: DEFAULT_SETTINGS.embeddings.model,
      instruction: DEFAULT_SETTINGS.embeddings.instruction,
      batchSize: DEFAULT_SETTINGS.embeddings.batchSize,
      timeoutMs: DEFAULT_SETTINGS.embeddings.timeoutMs,
      chunkingMode: DEFAULT_SETTINGS.embeddings.chunkingMode,
      minChunkChars: DEFAULT_SETTINGS.embeddings.minChunkChars,
      maxChunkChars: DEFAULT_SETTINGS.embeddings.maxChunkChars,
      overlapChars: DEFAULT_SETTINGS.embeddings.overlapChars
    }
  };
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

      const sourceNotes: ScopePackSourceNote[] = tableExists(db, 'source_notes')
        ? queryRows(
          db,
          'SELECT uid, scope, path, basename, title, tags_json, lorebook_scopes_json, aliases_json, keywords_json, keysecondary_json, retrieval_mode, include_world_info, include_rag, summary_source, summary, summary_hash, note_body, note_body_hash, wikilinks_json, modified_time, size_bytes FROM source_notes ORDER BY uid ASC;'
        ).map(row => ({
          uid: toNumberValue(row, 'uid'),
          scope: toStringValue(row, 'scope'),
          path: toStringValue(row, 'path'),
          basename: toStringValue(row, 'basename'),
          title: toStringValue(row, 'title'),
          tags: parseJsonColumnOr<string[]>(toStringValue(row, 'tags_json'), []),
          lorebookScopes: parseJsonColumnOr<string[]>(toStringValue(row, 'lorebook_scopes_json'), []),
          aliases: parseJsonColumnOr<string[]>(toStringValue(row, 'aliases_json'), []),
          keywords: parseJsonColumnOr<string[]>(toStringValue(row, 'keywords_json'), []),
          keysecondary: parseJsonColumnOr<string[]>(toStringValue(row, 'keysecondary_json'), []),
          retrievalMode: toStringValue(row, 'retrieval_mode') as ScopePackSourceNote['retrievalMode'],
          includeWorldInfo: toBooleanValue(row, 'include_world_info'),
          includeRag: toBooleanValue(row, 'include_rag'),
          summarySource: (toStringValue(row, 'summary_source') as ScopePackSourceNote['summarySource']) || 'body',
          summary: toStringValue(row, 'summary'),
          summaryHash: toStringValue(row, 'summary_hash'),
          noteBody: toStringValue(row, 'note_body'),
          noteBodyHash: toStringValue(row, 'note_body_hash'),
          wikilinks: parseJsonColumnOr<string[]>(toStringValue(row, 'wikilinks_json'), []),
          modifiedTime: toNumberValue(row, 'modified_time'),
          sizeBytes: toNumberValue(row, 'size_bytes')
        }))
        : [];

      const noteEmbeddings: ScopePackNoteEmbedding[] = tableExists(db, 'note_embeddings')
        ? queryRows(
          db,
          'SELECT uid, scope, provider, model, dimensions, aggregation, source_chunk_count, cache_key, created_at, vector_json FROM note_embeddings ORDER BY uid ASC, provider ASC, model ASC;'
        ).map(row => ({
          uid: toNumberValue(row, 'uid'),
          scope: toStringValue(row, 'scope'),
          provider: toStringValue(row, 'provider'),
          model: toStringValue(row, 'model'),
          dimensions: toNumberValue(row, 'dimensions'),
          aggregation: (toStringValue(row, 'aggregation') as ScopePackNoteEmbedding['aggregation']) || 'mean_normalized',
          sourceChunkCount: toNumberValue(row, 'source_chunk_count'),
          cacheKey: toStringValue(row, 'cache_key'),
          createdAt: toNumberValue(row, 'created_at'),
          vector: parseJsonColumnOr<number[]>(toStringValue(row, 'vector_json'), [])
        }))
        : [];

      const settingsSnapshot = parseJsonColumnOr<ScopePackBuildMetadata['settingsSnapshot']>(
        meta.get('settings_snapshot_json') ?? '',
        defaultSettingsSnapshot()
      );
      const metadata: ScopePackBuildMetadata = {
        format: 'lorevault.scope-pack',
        schemaVersion: Number(meta.get('schema_version') ?? 1),
        pluginId: meta.get('plugin_id') ?? 'lore-vault',
        pluginVersion: meta.get('plugin_version') ?? 'unknown',
        buildMode: (meta.get('build_mode') === 'multi_scope' ? 'multi_scope' : 'single_scope'),
        sourceFileCount: Number(meta.get('source_file_count') ?? 0),
        sourceNoteCount: Number(meta.get('source_note_count') ?? sourceNotes.length),
        explicitRootUid: (() => {
          const raw = (meta.get('explicit_root_uid') ?? '').trim();
          if (!raw) {
            return null;
          }
          const parsed = Number(raw);
          return Number.isFinite(parsed) ? parsed : null;
        })(),
        settingsSnapshot,
        settingsSignature: meta.get('settings_signature') ?? ''
      };

      return {
        schemaVersion: Number(meta.get('schema_version') ?? 1),
        scope: meta.get('scope') ?? '',
        generatedAt: Number(meta.get('generated_at') ?? Date.now()),
        metadata,
        worldInfoEntries,
        ragDocuments,
        ragChunks,
        ragChunkEmbeddings,
        sourceNotes,
        noteEmbeddings
      };
    });
  }
}
