import { App } from 'obsidian';
import { ScopePack } from './models';
import { getSqlJs } from './sqlite-runtime';
import { normalizeVaultFilePath, writeVaultBinary } from './vault-binary-io';
import { collectScopePackMetaRows } from './scope-pack-metadata';

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
    CREATE TABLE source_notes (
      uid INTEGER PRIMARY KEY,
      scope TEXT NOT NULL,
      path TEXT NOT NULL,
      basename TEXT NOT NULL,
      title TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      lorebook_scopes_json TEXT NOT NULL,
      aliases_json TEXT NOT NULL,
      keywords_json TEXT NOT NULL,
      keysecondary_json TEXT NOT NULL,
      retrieval_mode TEXT NOT NULL,
      include_world_info INTEGER NOT NULL,
      include_rag INTEGER NOT NULL,
      summary_source TEXT NOT NULL,
      summary TEXT NOT NULL,
      summary_hash TEXT NOT NULL,
      note_body TEXT NOT NULL,
      note_body_hash TEXT NOT NULL,
      wikilinks_json TEXT NOT NULL,
      modified_time INTEGER NOT NULL,
      size_bytes INTEGER NOT NULL
    );
    CREATE TABLE note_embeddings (
      uid INTEGER NOT NULL,
      scope TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      aggregation TEXT NOT NULL,
      source_chunk_count INTEGER NOT NULL,
      cache_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      vector_json TEXT NOT NULL,
      PRIMARY KEY (uid, provider, model)
    );
    CREATE INDEX idx_world_info_scope_order ON world_info_entries(scope, order_value DESC, uid ASC);
    CREATE INDEX idx_rag_documents_scope_path ON rag_documents(scope, path, uid);
    CREATE INDEX idx_rag_chunks_doc_uid ON rag_chunks(doc_uid, chunk_index);
    CREATE INDEX idx_rag_chunk_embeddings_chunk_id ON rag_chunk_embeddings(chunk_id);
    CREATE INDEX idx_source_notes_scope_path ON source_notes(scope, path, uid);
    CREATE INDEX idx_note_embeddings_scope_uid ON note_embeddings(scope, uid);
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
      for (const [key, value] of collectScopePackMetaRows(pack)) {
        metaStmt.run([key, value]);
      }
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

      const sourceNoteStmt = db.prepare(`
        INSERT INTO source_notes
        (uid, scope, path, basename, title, tags_json, lorebook_scopes_json, aliases_json, keywords_json, keysecondary_json, retrieval_mode, include_world_info, include_rag, summary_source, summary, summary_hash, note_body, note_body_hash, wikilinks_json, modified_time, size_bytes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `);
      for (const note of pack.sourceNotes) {
        sourceNoteStmt.run([
          note.uid,
          note.scope,
          note.path,
          note.basename,
          note.title,
          JSON.stringify(note.tags),
          JSON.stringify(note.lorebookScopes),
          JSON.stringify(note.aliases),
          JSON.stringify(note.keywords),
          JSON.stringify(note.keysecondary),
          note.retrievalMode,
          note.includeWorldInfo ? 1 : 0,
          note.includeRag ? 1 : 0,
          note.summarySource,
          note.summary,
          note.summaryHash,
          note.noteBody,
          note.noteBodyHash,
          JSON.stringify(note.wikilinks),
          note.modifiedTime,
          note.sizeBytes
        ]);
      }
      sourceNoteStmt.free();

      const noteEmbeddingStmt = db.prepare(`
        INSERT INTO note_embeddings
        (uid, scope, provider, model, dimensions, aggregation, source_chunk_count, cache_key, created_at, vector_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `);
      for (const embedding of pack.noteEmbeddings) {
        noteEmbeddingStmt.run([
          embedding.uid,
          embedding.scope,
          embedding.provider,
          embedding.model,
          embedding.dimensions,
          embedding.aggregation,
          embedding.sourceChunkCount,
          embedding.cacheKey,
          embedding.createdAt,
          JSON.stringify(embedding.vector)
        ]);
      }
      noteEmbeddingStmt.free();

      db.run('COMMIT;');
      const bytes = db.export();
      await writeVaultBinary(this.app, normalizedPath, bytes);
      return normalizedPath;
    } finally {
      db.close();
    }
  }
}
