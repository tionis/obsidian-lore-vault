import { App } from 'obsidian';
import * as fs from 'fs';
import { ScopePack } from './models';
import { ensureParentDirectory, resolveAbsoluteOutputPath, runSqliteScript } from './sqlite-cli';

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNullableString(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  return sqlString(value);
}

function sqlNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return `${value}`;
}

function sqlJson(value: unknown): string {
  return sqlString(JSON.stringify(value));
}

function createSchemaSql(): string[] {
  return [
    'PRAGMA journal_mode=WAL;',
    'PRAGMA synchronous=NORMAL;',
    'BEGIN IMMEDIATE;',
    'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
    'CREATE TABLE world_info_entries (',
    '  uid INTEGER PRIMARY KEY,',
    '  scope TEXT NOT NULL,',
    '  order_value INTEGER NOT NULL,',
    '  comment TEXT NOT NULL,',
    '  content TEXT NOT NULL,',
    '  key_json TEXT NOT NULL,',
    '  keysecondary_json TEXT NOT NULL,',
    '  entry_json TEXT NOT NULL',
    ');',
    'CREATE TABLE rag_documents (',
    '  uid INTEGER PRIMARY KEY,',
    '  scope TEXT NOT NULL,',
    '  path TEXT NOT NULL,',
    '  title TEXT NOT NULL,',
    '  content TEXT NOT NULL',
    ');',
    'CREATE TABLE rag_chunks (',
    '  chunk_id TEXT PRIMARY KEY,',
    '  doc_uid INTEGER NOT NULL,',
    '  scope TEXT NOT NULL,',
    '  path TEXT NOT NULL,',
    '  title TEXT NOT NULL,',
    '  chunk_index INTEGER NOT NULL,',
    '  heading TEXT NOT NULL,',
    '  text TEXT NOT NULL,',
    '  text_hash TEXT NOT NULL,',
    '  token_estimate INTEGER NOT NULL,',
    '  start_offset INTEGER NOT NULL,',
    '  end_offset INTEGER NOT NULL',
    ');',
    'CREATE TABLE rag_chunk_embeddings (',
    '  chunk_id TEXT NOT NULL,',
    '  provider TEXT NOT NULL,',
    '  model TEXT NOT NULL,',
    '  dimensions INTEGER NOT NULL,',
    '  cache_key TEXT NOT NULL,',
    '  created_at INTEGER NOT NULL,',
    '  vector_json TEXT NOT NULL,',
    '  PRIMARY KEY (chunk_id, provider, model)',
    ');',
    'CREATE INDEX idx_world_info_scope_order ON world_info_entries(scope, order_value DESC, uid ASC);',
    'CREATE INDEX idx_rag_documents_scope_path ON rag_documents(scope, path, uid);',
    'CREATE INDEX idx_rag_chunks_doc_uid ON rag_chunks(doc_uid, chunk_index);',
    'CREATE INDEX idx_rag_chunk_embeddings_chunk_id ON rag_chunk_embeddings(chunk_id);'
  ];
}

function createInsertSql(pack: ScopePack): string[] {
  const statements: string[] = [];

  statements.push(
    `INSERT INTO meta (key, value) VALUES (${sqlString('schema_version')}, ${sqlString(String(pack.schemaVersion))});`,
    `INSERT INTO meta (key, value) VALUES (${sqlString('scope')}, ${sqlString(pack.scope)});`,
    `INSERT INTO meta (key, value) VALUES (${sqlString('generated_at')}, ${sqlString(String(pack.generatedAt))});`
  );

  for (const entry of pack.worldInfoEntries) {
    statements.push(
      [
        'INSERT INTO world_info_entries (uid, scope, order_value, comment, content, key_json, keysecondary_json, entry_json)',
        'VALUES (',
        `${sqlNumber(entry.uid)},`,
        `${sqlString(pack.scope)},`,
        `${sqlNumber(entry.order)},`,
        `${sqlString(entry.comment)},`,
        `${sqlString(entry.content)},`,
        `${sqlJson(entry.key)},`,
        `${sqlJson(entry.keysecondary)},`,
        `${sqlJson(entry)}`,
        ');'
      ].join(' ')
    );
  }

  for (const doc of pack.ragDocuments) {
    statements.push(
      [
        'INSERT INTO rag_documents (uid, scope, path, title, content)',
        'VALUES (',
        `${sqlNumber(doc.uid)},`,
        `${sqlString(doc.scope)},`,
        `${sqlString(doc.path)},`,
        `${sqlString(doc.title)},`,
        `${sqlString(doc.content)}`,
        ');'
      ].join(' ')
    );
  }

  for (const chunk of pack.ragChunks) {
    statements.push(
      [
        'INSERT INTO rag_chunks (chunk_id, doc_uid, scope, path, title, chunk_index, heading, text, text_hash, token_estimate, start_offset, end_offset)',
        'VALUES (',
        `${sqlString(chunk.chunkId)},`,
        `${sqlNumber(chunk.docUid)},`,
        `${sqlString(chunk.scope)},`,
        `${sqlString(chunk.path)},`,
        `${sqlString(chunk.title)},`,
        `${sqlNumber(chunk.chunkIndex)},`,
        `${sqlNullableString(chunk.heading)},`,
        `${sqlString(chunk.text)},`,
        `${sqlString(chunk.textHash)},`,
        `${sqlNumber(chunk.tokenEstimate)},`,
        `${sqlNumber(chunk.startOffset)},`,
        `${sqlNumber(chunk.endOffset)}`,
        ');'
      ].join(' ')
    );
  }

  for (const embedding of pack.ragChunkEmbeddings) {
    statements.push(
      [
        'INSERT INTO rag_chunk_embeddings (chunk_id, provider, model, dimensions, cache_key, created_at, vector_json)',
        'VALUES (',
        `${sqlString(embedding.chunkId)},`,
        `${sqlString(embedding.provider)},`,
        `${sqlString(embedding.model)},`,
        `${sqlNumber(embedding.dimensions)},`,
        `${sqlString(embedding.cacheKey)},`,
        `${sqlNumber(embedding.createdAt)},`,
        `${sqlJson(embedding.vector)}`,
        ');'
      ].join(' ')
    );
  }

  statements.push('COMMIT;');
  return statements;
}

function createScript(pack: ScopePack): string {
  return [...createSchemaSql(), ...createInsertSql(pack)].join('\n');
}

export class SqlitePackExporter {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  async exportScopePack(pack: ScopePack, outputPath: string): Promise<string> {
    const absolutePath = resolveAbsoluteOutputPath(this.app, outputPath);
    ensureParentDirectory(absolutePath);

    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }

    const script = createScript(pack);
    await runSqliteScript(absolutePath, script);
    return absolutePath;
  }
}
