import test from 'node:test';
import assert from 'node:assert/strict';
import { ScopePack } from '../src/models';
import { buildScopeExportManifest, serializeScopeExportManifest } from '../src/export-manifest';
import { resolveScopeOutputPaths } from '../src/scope-output-paths';

function createPack(): ScopePack {
  return {
    schemaVersion: 1,
    scope: 'universe/yggdrasil',
    generatedAt: 1700000000000,
    worldInfoEntries: [
      {
        uid: 1,
        key: ['Alice'],
        keysecondary: [],
        comment: 'Alice',
        content: 'Alice details',
        constant: false,
        vectorized: false,
        selective: true,
        selectiveLogic: 0,
        addMemo: true,
        order: 100,
        position: 0,
        disable: false,
        excludeRecursion: false,
        preventRecursion: false,
        delayUntilRecursion: false,
        probability: 100,
        useProbability: true,
        depth: 4,
        group: '',
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        automationId: '',
        role: null,
        sticky: 0,
        cooldown: 0,
        delay: 0,
        displayIndex: 0,
        wikilinks: []
      }
    ],
    ragDocuments: [
      {
        uid: 10,
        title: 'Alice',
        path: 'characters/alice.md',
        content: 'Alice biography',
        scope: 'universe/yggdrasil'
      }
    ],
    ragChunks: [
      {
        chunkId: 'c1',
        docUid: 10,
        scope: 'universe/yggdrasil',
        path: 'characters/alice.md',
        title: 'Alice',
        chunkIndex: 0,
        heading: '',
        text: 'Alice biography',
        textHash: 'h1',
        tokenEstimate: 20,
        startOffset: 0,
        endOffset: 20
      }
    ],
    ragChunkEmbeddings: [
      {
        chunkId: 'c1',
        provider: 'openrouter',
        model: 'qwen/qwen3-embedding-8b',
        dimensions: 2,
        vector: [0.1, 0.2],
        cacheKey: 'k1',
        createdAt: 1700000000000
      }
    ]
  };
}

test('buildScopeExportManifest produces stable scope artifact contract', () => {
  const paths = resolveScopeOutputPaths('sillytavern/lorevault.json', 'universe/yggdrasil', false);
  const manifest = buildScopeExportManifest(createPack(), paths);

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.scope, 'universe/yggdrasil');
  assert.equal(manifest.scopeSlug, 'universe-yggdrasil');
  assert.equal(manifest.canonicalArtifact, 'sqlite');
  assert.equal(manifest.artifacts.sqlite, 'lorebooks/universe-yggdrasil.db');
  assert.equal(manifest.artifacts.worldInfo, 'lorebooks/sillytavern/lorevault-universe-yggdrasil.json');
  assert.equal(manifest.artifacts.rag, 'lorebooks/sillytavern/lorevault-universe-yggdrasil.rag.md');
  assert.deepEqual(manifest.stats, {
    worldInfoEntries: 1,
    ragDocuments: 1,
    ragChunks: 1,
    ragChunkEmbeddings: 1
  });
});

test('serializeScopeExportManifest is deterministic for identical inputs', () => {
  const paths = resolveScopeOutputPaths('sillytavern/lorevault.json', 'universe/yggdrasil', false);
  const manifest = buildScopeExportManifest(createPack(), paths);

  const first = serializeScopeExportManifest(manifest);
  const second = serializeScopeExportManifest(manifest);
  assert.equal(first, second);
  assert.ok(first.includes('"canonicalArtifact": "sqlite"'));
  assert.ok(first.endsWith('\n'));
});
