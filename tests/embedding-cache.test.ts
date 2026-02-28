import test from 'node:test';
import assert from 'node:assert/strict';
import { EmbeddingCache, CachedEmbeddingRecord } from '../src/embedding-cache';
import { ConverterSettings } from '../src/models';

interface MockApp {
  files: Map<string, string>;
  createdFolders: string[];
  app: any;
}

function createMockApp(): MockApp {
  const folders = new Set<string>();
  const files = new Map<string, string>();
  const createdFolders: string[] = [];

  const app = {
    vault: {
      adapter: {
        exists: async (path: string) => files.has(path),
        read: async (path: string) => {
          const value = files.get(path);
          if (value === undefined) {
            throw new Error(`File not found: ${path}`);
          }
          return value;
        },
        write: async (path: string, data: string) => {
          files.set(path, data);
        }
      },
      getAbstractFileByPath: (path: string) => {
        if (folders.has(path)) {
          return { path, children: [] };
        }
        if (files.has(path)) {
          return { path };
        }
        return null;
      },
      createFolder: async (path: string) => {
        folders.add(path);
        createdFolders.push(path);
      }
    }
  };

  return { files, createdFolders, app };
}

function createEmbeddingSettings(overrides: Partial<ConverterSettings['embeddings']> = {}): ConverterSettings['embeddings'] {
  return {
    enabled: true,
    provider: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: 'qwen/qwen3-embedding-8b',
    instruction: '',
    batchSize: 8,
    timeoutMs: 45000,
    cacheDir: '.obsidian/plugins/lore-vault/cache/embeddings',
    chunkingMode: 'auto',
    minChunkChars: 400,
    maxChunkChars: 1200,
    overlapChars: 120,
    ...overrides
  };
}

function createRecord(cacheKey: string): CachedEmbeddingRecord {
  return {
    cacheKey,
    provider: 'openrouter',
    model: 'qwen/qwen3-embedding-8b',
    chunkingSignature: 'chunk-signature',
    dimensions: 3,
    vector: [0.1, 0.2, 0.3],
    createdAt: 12345
  };
}

test('EmbeddingCache writes and reads records via vault adapter paths', async () => {
  const mock = createMockApp();
  const cache = new EmbeddingCache(mock.app, createEmbeddingSettings());
  const record = createRecord('abcdef123456');

  await cache.set(record);
  const loaded = await cache.get(record.cacheKey);

  assert.deepEqual(loaded, record);
  assert.deepEqual(mock.createdFolders, [
    '.obsidian',
    '.obsidian/plugins',
    '.obsidian/plugins/lore-vault',
    '.obsidian/plugins/lore-vault/cache',
    '.obsidian/plugins/lore-vault/cache/embeddings',
    '.obsidian/plugins/lore-vault/cache/embeddings/openrouter',
    '.obsidian/plugins/lore-vault/cache/embeddings/openrouter/qwen-qwen3-embedding-8b',
    '.obsidian/plugins/lore-vault/cache/embeddings/openrouter/qwen-qwen3-embedding-8b/auto-400-1200-120',
    '.obsidian/plugins/lore-vault/cache/embeddings/openrouter/qwen-qwen3-embedding-8b/auto-400-1200-120/ab'
  ]);
  assert.equal(mock.files.size, 1);
  assert.equal(
    [...mock.files.keys()][0],
    '.obsidian/plugins/lore-vault/cache/embeddings/openrouter/qwen-qwen3-embedding-8b/auto-400-1200-120/ab/abcdef123456.json'
  );
});

test('EmbeddingCache returns null for missing cache records', async () => {
  const mock = createMockApp();
  const cache = new EmbeddingCache(mock.app, createEmbeddingSettings());
  const loaded = await cache.get('missing');
  assert.equal(loaded, null);
});

test('EmbeddingCache rejects absolute cache directories', async () => {
  const mock = createMockApp();
  const cache = new EmbeddingCache(mock.app, createEmbeddingSettings({
    cacheDir: '/tmp/embeddings-cache'
  }));

  await assert.rejects(
    async () => cache.set(createRecord('abcdef123456')),
    /Absolute filesystem paths are not supported/
  );
});
