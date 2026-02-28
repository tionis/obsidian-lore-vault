import test from 'node:test';
import assert from 'node:assert/strict';
import { ScopePack } from '../src/models';
import { buildScopePackMetadata, collectScopePackMetaRows } from '../src/scope-pack-metadata';
import { DEFAULT_SETTINGS } from '../src/models';

function createMinimalPack(): ScopePack {
  const metadata = buildScopePackMetadata(
    DEFAULT_SETTINGS,
    'universe/main',
    true,
    12,
    1,
    null,
    {
      pluginId: 'lore-vault',
      pluginVersion: '9.9.9'
    }
  );

  return {
    schemaVersion: 2,
    scope: 'universe/main',
    generatedAt: 1700000000000,
    metadata,
    worldInfoEntries: [],
    ragDocuments: [],
    ragChunks: [],
    ragChunkEmbeddings: [],
    sourceNotes: [
      {
        uid: 0,
        scope: 'universe/main',
        path: 'World/A.md',
        basename: 'A',
        title: 'A',
        tags: ['#lorebook/universe/main'],
        lorebookScopes: ['universe/main'],
        aliases: ['Alias A'],
        keywords: ['a'],
        keysecondary: [],
        retrievalMode: 'auto',
        includeWorldInfo: true,
        includeRag: true,
        summary: 'Summary A',
        summarySource: 'section',
        summaryHash: 'sumhash-a',
        noteBody: 'Body A',
        noteBodyHash: 'bodyhash-a',
        wikilinks: ['world/b'],
        modifiedTime: 123,
        sizeBytes: 456
      }
    ],
    noteEmbeddings: [
      {
        uid: 0,
        scope: 'universe/main',
        provider: 'openrouter',
        model: 'qwen/qwen3-embedding-8b',
        dimensions: 3,
        aggregation: 'mean_normalized',
        sourceChunkCount: 2,
        cacheKey: 'cache-a',
        createdAt: 1000,
        vector: [0.1, 0.2, 0.3]
      }
    ]
  };
}

test('collectMetaRows exposes deterministic schema and settings metadata keys', () => {
  const rows = collectScopePackMetaRows(createMinimalPack());
  const keys = rows.map(([key]) => key);
  const sortedKeys = [...keys].sort((left, right) => left.localeCompare(right));
  assert.deepEqual(keys, sortedKeys);

  const meta = new Map(rows);
  assert.equal(meta.get('format'), 'lorevault.scope-pack');
  assert.equal(meta.get('schema_version'), '2');
  assert.equal(meta.get('scope'), 'universe/main');
  assert.equal(meta.get('plugin_id'), 'lore-vault');
  assert.equal(meta.get('plugin_version'), '9.9.9');
  assert.equal(meta.get('source_file_count'), '12');
  assert.equal(meta.get('source_note_count'), '1');
  assert.equal(meta.get('world_info_entries_count'), '0');
  assert.equal(meta.get('rag_documents_count'), '0');
  assert.equal(meta.get('rag_chunks_count'), '0');
  assert.equal(meta.get('rag_chunk_embeddings_count'), '0');
  assert.equal(meta.get('source_notes_count'), '1');
  assert.equal(meta.get('note_embeddings_count'), '1');

  const settingsSnapshot = JSON.parse(meta.get('settings_snapshot_json') || '{}');
  assert.equal(settingsSnapshot?.tagScoping?.tagPrefix, DEFAULT_SETTINGS.tagScoping.tagPrefix);
  const embeddingProfiles = JSON.parse(meta.get('embedding_profiles_json') || '[]');
  assert.deepEqual(embeddingProfiles, ['openrouter::qwen/qwen3-embedding-8b::3']);
  assert.match(meta.get('content_signature') || '', /^[a-f0-9]{64}$/);
});

test('collectMetaRows content signature changes when canonical content changes', () => {
  const basePack = createMinimalPack();
  const baseMeta = new Map(collectScopePackMetaRows(basePack));

  const changedPack: ScopePack = {
    ...basePack,
    sourceNotes: basePack.sourceNotes.map(note => ({ ...note }))
  };
  changedPack.sourceNotes[0].noteBodyHash = 'bodyhash-b';

  const changedMeta = new Map(collectScopePackMetaRows(changedPack));
  assert.notEqual(baseMeta.get('content_signature'), changedMeta.get('content_signature'));
});
