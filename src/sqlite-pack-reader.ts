import { App } from 'obsidian';
import { LoreBookEntry, RagDocument, RagChunk, RagChunkEmbedding, ScopePack } from './models';
import { resolveAbsoluteOutputPath, runSqliteJsonQuery } from './sqlite-cli';

interface JsonRow {
  entry_json?: string;
  uid?: number;
  scope?: string;
  path?: string;
  title?: string;
  content?: string;
  chunk_id?: string;
  doc_uid?: number;
  chunk_index?: number;
  heading?: string;
  text?: string;
  text_hash?: string;
  token_estimate?: number;
  start_offset?: number;
  end_offset?: number;
  provider?: string;
  model?: string;
  dimensions?: number;
  cache_key?: string;
  created_at?: number;
  vector_json?: string;
}

function parseJsonColumn<T>(value: string): T {
  return JSON.parse(value) as T;
}

export class SqlitePackReader {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  private resolvePath(outputPath: string): string {
    return resolveAbsoluteOutputPath(this.app, outputPath);
  }

  async readWorldInfoEntries(outputPath: string): Promise<{[key: number]: LoreBookEntry}> {
    const dbPath = this.resolvePath(outputPath);
    const rows = await runSqliteJsonQuery<JsonRow>(
      dbPath,
      'SELECT entry_json FROM world_info_entries ORDER BY order_value DESC, uid ASC;'
    );

    const entries: {[key: number]: LoreBookEntry} = {};
    for (const row of rows) {
      if (!row.entry_json) {
        continue;
      }
      const entry = parseJsonColumn<LoreBookEntry>(row.entry_json);
      entries[entry.uid] = entry;
    }
    return entries;
  }

  async readRagDocuments(outputPath: string): Promise<RagDocument[]> {
    const dbPath = this.resolvePath(outputPath);
    const rows = await runSqliteJsonQuery<JsonRow>(
      dbPath,
      'SELECT uid, scope, path, title, content FROM rag_documents ORDER BY path ASC, title ASC, uid ASC;'
    );

    return rows
      .filter(row => typeof row.uid === 'number')
      .map(row => ({
        uid: row.uid as number,
        scope: row.scope ?? '',
        path: row.path ?? '',
        title: row.title ?? '',
        content: row.content ?? ''
      }));
  }

  async readScopePack(outputPath: string): Promise<ScopePack> {
    const dbPath = this.resolvePath(outputPath);
    const metaRows = await runSqliteJsonQuery<{ key: string; value: string }>(
      dbPath,
      'SELECT key, value FROM meta ORDER BY key ASC;'
    );

    const meta = new Map(metaRows.map(row => [row.key, row.value]));
    const worldInfoEntries = Object.values(await this.readWorldInfoEntries(outputPath));
    const ragDocuments = await this.readRagDocuments(outputPath);

    const chunkRows = await runSqliteJsonQuery<JsonRow>(
      dbPath,
      'SELECT chunk_id, doc_uid, scope, path, title, chunk_index, heading, text, text_hash, token_estimate, start_offset, end_offset FROM rag_chunks ORDER BY path ASC, chunk_index ASC;'
    );
    const ragChunks: RagChunk[] = chunkRows.map(row => ({
      chunkId: row.chunk_id ?? '',
      docUid: row.doc_uid ?? 0,
      scope: row.scope ?? '',
      path: row.path ?? '',
      title: row.title ?? '',
      chunkIndex: row.chunk_index ?? 0,
      heading: row.heading ?? '',
      text: row.text ?? '',
      textHash: row.text_hash ?? '',
      tokenEstimate: row.token_estimate ?? 0,
      startOffset: row.start_offset ?? 0,
      endOffset: row.end_offset ?? 0
    }));

    const embeddingRows = await runSqliteJsonQuery<JsonRow>(
      dbPath,
      'SELECT chunk_id, provider, model, dimensions, cache_key, created_at, vector_json FROM rag_chunk_embeddings ORDER BY chunk_id ASC, provider ASC, model ASC;'
    );
    const ragChunkEmbeddings: RagChunkEmbedding[] = embeddingRows.map(row => ({
      chunkId: row.chunk_id ?? '',
      provider: row.provider ?? '',
      model: row.model ?? '',
      dimensions: row.dimensions ?? 0,
      cacheKey: row.cache_key ?? '',
      createdAt: row.created_at ?? 0,
      vector: row.vector_json ? parseJsonColumn<number[]>(row.vector_json) : []
    }));

    return {
      schemaVersion: Number(meta.get('schema_version') ?? 1),
      scope: meta.get('scope') ?? '',
      generatedAt: Number(meta.get('generated_at') ?? Date.now()),
      worldInfoEntries,
      ragDocuments,
      ragChunks,
      ragChunkEmbeddings
    };
  }
}
