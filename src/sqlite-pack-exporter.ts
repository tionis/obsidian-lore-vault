import { App } from 'obsidian';
import { ScopePack } from './models';
import { getSqlJs } from './sqlite-runtime';
import { normalizeVaultFilePath, writeVaultBinary } from './vault-binary-io';

function createSchema(db: any): void {
  db.run(`
    PRAGMA journal_mode=MEMORY;
    PRAGMA synchronous=OFF;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE world_info_entries (
      uid INTEGER PRIMARY KEY,
      scope TEXT NOT NULL,
      order_value INTEGER NOT NULL,
      comment TEXT NOT NULL,
      content TEXT NOT NULL,
      key_json TEXT NOT NULL,
      keysecondary_json TEXT NOT NULL,
      entry_json TEXT NOT NULL
    );
    CREATE TABLE rag_documents (
      uid INTEGER PRIMARY KEY,
      scope TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL
    );
    CREATE TABLE rag_chunks (
      chunk_id TEXT PRIMARY KEY,
      doc_uid INTEGER NOT NULL,
      scope TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      heading TEXT NOT NULL,
      text TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      token_estimate INTEGER NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL
    );
    CREATE TABLE rag_chunk_embeddings (
      chunk_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      cache_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      vector_json TEXT NOT NULL,
      PRIMARY KEY (chunk_id, provider, model)
    );
    CREATE INDEX idx_world_info_scope_order ON world_info_entries(scope, order_value DESC, uid ASC);
    CREATE INDEX idx_rag_documents_scope_path ON rag_documents(scope, path, uid);
    CREATE INDEX idx_rag_chunks_doc_uid ON rag_chunks(doc_uid, chunk_index);
    CREATE INDEX idx_rag_chunk_embeddings_chunk_id ON rag_chunk_embeddings(chunk_id);
  `);
}

export class SqlitePackExporter {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  async exportScopePack(pack: ScopePack, outputPath: string): Promise<string> {
    const normalizedPath = normalizeVaultFilePath(outputPath);

    const SQL = await getSqlJs();
    const db = new SQL.Database();

    try {
      createSchema(db);
      db.run('BEGIN IMMEDIATE;');

      const metaStmt = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?);');
      metaStmt.run(['schema_version', String(pack.schemaVersion)]);
      metaStmt.run(['scope', pack.scope]);
      metaStmt.run(['generated_at', String(pack.generatedAt)]);
      metaStmt.run(['world_info_entries_count', String(pack.worldInfoEntries.length)]);
      metaStmt.run(['rag_documents_count', String(pack.ragDocuments.length)]);
      metaStmt.run(['rag_chunks_count', String(pack.ragChunks.length)]);
      metaStmt.run(['rag_chunk_embeddings_count', String(pack.ragChunkEmbeddings.length)]);
      metaStmt.free();

      const worldInfoStmt = db.prepare(`
        INSERT INTO world_info_entries
        (uid, scope, order_value, comment, content, key_json, keysecondary_json, entry_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?);
      `);
      for (const entry of pack.worldInfoEntries) {
        worldInfoStmt.run([
          entry.uid,
          pack.scope,
          entry.order,
          entry.comment,
          entry.content,
          JSON.stringify(entry.key),
          JSON.stringify(entry.keysecondary),
          JSON.stringify(entry)
        ]);
      }
      worldInfoStmt.free();

      const ragDocStmt = db.prepare(`
        INSERT INTO rag_documents
        (uid, scope, path, title, content)
        VALUES (?, ?, ?, ?, ?);
      `);
      for (const doc of pack.ragDocuments) {
        ragDocStmt.run([doc.uid, doc.scope, doc.path, doc.title, doc.content]);
      }
      ragDocStmt.free();

      const ragChunkStmt = db.prepare(`
        INSERT INTO rag_chunks
        (chunk_id, doc_uid, scope, path, title, chunk_index, heading, text, text_hash, token_estimate, start_offset, end_offset)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `);
      for (const chunk of pack.ragChunks) {
        ragChunkStmt.run([
          chunk.chunkId,
          chunk.docUid,
          chunk.scope,
          chunk.path,
          chunk.title,
          chunk.chunkIndex,
          chunk.heading,
          chunk.text,
          chunk.textHash,
          chunk.tokenEstimate,
          chunk.startOffset,
          chunk.endOffset
        ]);
      }
      ragChunkStmt.free();

      const embeddingStmt = db.prepare(`
        INSERT INTO rag_chunk_embeddings
        (chunk_id, provider, model, dimensions, cache_key, created_at, vector_json)
        VALUES (?, ?, ?, ?, ?, ?, ?);
      `);
      for (const embedding of pack.ragChunkEmbeddings) {
        embeddingStmt.run([
          embedding.chunkId,
          embedding.provider,
          embedding.model,
          embedding.dimensions,
          embedding.cacheKey,
          embedding.createdAt,
          JSON.stringify(embedding.vector)
        ]);
      }
      embeddingStmt.free();

      db.run('COMMIT;');
      const bytes = db.export();
      await writeVaultBinary(this.app, normalizedPath, bytes);
      return normalizedPath;
    } finally {
      db.close();
    }
  }
}
