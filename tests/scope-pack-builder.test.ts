import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../src/models';
import { buildNoteEmbeddings, buildScopePackMetadata } from '../src/scope-pack-metadata';

test('buildNoteEmbeddings aggregates chunk vectors per uid/provider/model deterministically', () => {
  const embeddings = buildNoteEmbeddings({
    scope: 'universe/main',
    ragChunks: [
      {
        chunkId: 'c-1',
        docUid: 10,
        scope: 'universe/main',
        path: 'Notes/A.md',
        title: 'A',
        chunkIndex: 0,
        heading: '',
        text: 'alpha',
        textHash: 'h1',
        tokenEstimate: 10,
        startOffset: 0,
        endOffset: 5
      },
      {
        chunkId: 'c-2',
        docUid: 10,
        scope: 'universe/main',
        path: 'Notes/A.md',
        title: 'A',
        chunkIndex: 1,
        heading: '',
        text: 'beta',
        textHash: 'h2',
        tokenEstimate: 10,
        startOffset: 6,
        endOffset: 10
      },
      {
        chunkId: 'c-3',
        docUid: 11,
        scope: 'universe/main',
        path: 'Notes/B.md',
        title: 'B',
        chunkIndex: 0,
        heading: '',
        text: 'gamma',
        textHash: 'h3',
        tokenEstimate: 10,
        startOffset: 0,
        endOffset: 5
      }
    ],
    ragChunkEmbeddings: [
      {
        chunkId: 'c-1',
        provider: 'openrouter',
        model: 'qwen/qwen3-embedding-8b',
        dimensions: 2,
        vector: [1, 0],
        cacheKey: 'k1',
        createdAt: 100
      },
      {
        chunkId: 'c-2',
        provider: 'openrouter',
        model: 'qwen/qwen3-embedding-8b',
        dimensions: 2,
        vector: [0, 1],
        cacheKey: 'k2',
        createdAt: 110
      },
      {
        chunkId: 'c-3',
        provider: 'openrouter',
        model: 'qwen/qwen3-embedding-8b',
        dimensions: 2,
        vector: [1, 1],
        cacheKey: 'k3',
        createdAt: 120
      }
    ]
  });

  assert.equal(embeddings.length, 2);
  const first = embeddings[0];
  const second = embeddings[1];

  assert.equal(first.uid, 10);
  assert.equal(first.aggregation, 'mean_normalized');
  assert.equal(first.sourceChunkCount, 2);
  assert.equal(first.createdAt, 110);
  assert.equal(first.vector.length, 2);
  assert(Math.abs(first.vector[0] - Math.SQRT1_2) < 0.000001);
  assert(Math.abs(first.vector[1] - Math.SQRT1_2) < 0.000001);
  assert.match(first.cacheKey, /^[a-f0-9]{64}$/);

  assert.equal(second.uid, 11);
  assert.equal(second.sourceChunkCount, 1);
  assert(Math.abs(second.vector[0] - Math.SQRT1_2) < 0.000001);
  assert(Math.abs(second.vector[1] - Math.SQRT1_2) < 0.000001);
});

test('buildScopePackMetadata snapshots deterministic non-secret settings', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    tagScoping: { ...DEFAULT_SETTINGS.tagScoping },
    weights: { ...DEFAULT_SETTINGS.weights },
    defaultEntry: { ...DEFAULT_SETTINGS.defaultEntry },
    retrieval: {
      ...DEFAULT_SETTINGS.retrieval,
      toolCalls: { ...DEFAULT_SETTINGS.retrieval.toolCalls }
    },
    summaries: { ...DEFAULT_SETTINGS.summaries },
    embeddings: { ...DEFAULT_SETTINGS.embeddings, apiKey: 'secret-should-not-export' }
  };

  const baseline = buildScopePackMetadata(
    settings,
    'universe/main',
    false,
    42,
    17,
    3,
    { pluginId: 'lore-vault', pluginVersion: '1.2.3' }
  );

  assert.equal(baseline.schemaVersion, 2);
  assert.equal(baseline.pluginId, 'lore-vault');
  assert.equal(baseline.pluginVersion, '1.2.3');
  assert.equal(baseline.buildMode, 'single_scope');
  assert.equal(baseline.sourceFileCount, 42);
  assert.equal(baseline.sourceNoteCount, 17);
  assert.equal(baseline.explicitRootUid, 3);
  assert.equal((baseline.settingsSnapshot.embeddings as any).apiKey, undefined);
  assert.match(baseline.settingsSignature, /^[a-f0-9]{64}$/);

  const changed = buildScopePackMetadata(
    {
      ...settings,
      embeddings: { ...settings.embeddings, model: 'different/model' }
    },
    'universe/main',
    false,
    42,
    17,
    3,
    { pluginId: 'lore-vault', pluginVersion: '1.2.3' }
  );

  assert.notEqual(baseline.settingsSignature, changed.settingsSignature);
});
