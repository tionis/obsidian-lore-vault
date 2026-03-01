import test from 'node:test';
import assert from 'node:assert/strict';
import { App } from 'obsidian';
import {
  EmbeddingService,
  averageEmbeddingVectors,
  splitQueryTextForEmbedding
} from '../src/embedding-service';
import { ConverterSettings } from '../src/models';

type FetchLike = typeof fetch;

function createEmbeddingConfig(): ConverterSettings['embeddings'] {
  return {
    enabled: true,
    provider: 'openrouter',
    endpoint: 'https://example.test/v1',
    apiKey: 'test-key',
    model: 'embedding-model',
    instruction: '',
    batchSize: 8,
    timeoutMs: 15000,
    cacheDir: '.obsidian/plugins/lore-vault/cache/embeddings',
    chunkingMode: 'auto',
    minChunkChars: 300,
    maxChunkChars: 1800,
    overlapChars: 200
  };
}

function createAppStub(): App {
  return {
    vault: {
      adapter: {
        exists: async () => false,
        read: async () => '',
        write: async () => undefined
      }
    }
  } as unknown as App;
}

test('splitQueryTextForEmbedding keeps bounded chunk count and preserves recent text', () => {
  const input = [
    '# Story',
    '',
    '## Chapter 1',
    'A'.repeat(4000),
    '',
    '## Chapter 2',
    'B'.repeat(4000),
    '',
    '## Chapter 3',
    `Final marker ${'C'.repeat(4000)}`
  ].join('\n');

  const chunks = splitQueryTextForEmbedding(input);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.length <= 6);
  assert.ok(chunks.every(chunk => chunk.length <= 5000));
  assert.ok(chunks[chunks.length - 1].includes('Final marker'));
});

test('averageEmbeddingVectors computes weighted mean deterministically', () => {
  const averaged = averageEmbeddingVectors(
    [
      [1, 3, 5],
      [3, 5, 7]
    ],
    [1, 3]
  );
  assert.deepEqual(averaged, [2.5, 4.5, 6.5]);
});

test('embedQuery retries with recent-tail fallback when chunked request fails', async () => {
  const service = new EmbeddingService(createAppStub(), createEmbeddingConfig());
  const input = [
    '# Story',
    '',
    '## Chapter 1',
    'A'.repeat(4200),
    '',
    '## Chapter 2',
    'B'.repeat(4200),
    '',
    '## Chapter 3',
    `TAIL ${'C'.repeat(4200)}`
  ].join('\n');
  const expectedTail = splitQueryTextForEmbedding(input).slice(-1)[0];

  const globalAny = globalThis as any;
  const previousFetch = globalAny.fetch as FetchLike | undefined;
  const calls: Array<{ url: string; body: any }> = [];

  globalAny.fetch = async (url: string, init?: { body?: string }) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    if (calls.length === 1) {
      return {
        ok: false,
        status: 404,
        text: async () => 'No provider answered.'
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { embedding: [0.2, 0.4, 0.6] }
        ]
      }),
      text: async () => '{"data":[{"embedding":[0.2,0.4,0.6]}]}'
    };
  };

  try {
    const vector = await service.embedQuery(input);
    assert.deepEqual(vector, [0.2, 0.4, 0.6]);
    assert.equal(calls.length, 2);
    assert.ok(Array.isArray(calls[0].body?.input));
    assert.ok(calls[0].body.input.length > 1);
    assert.deepEqual(calls[1].body?.input, [expectedTail]);
  } finally {
    globalAny.fetch = previousFetch;
  }
});

test('embedQuery returns null when all embedding attempts fail', async () => {
  const service = new EmbeddingService(createAppStub(), createEmbeddingConfig());
  const input = [
    '# Story',
    '',
    '## Chapter 1',
    'A'.repeat(4200),
    '',
    '## Chapter 2',
    'B'.repeat(4200)
  ].join('\n');

  const globalAny = globalThis as any;
  const previousFetch = globalAny.fetch as FetchLike | undefined;
  globalAny.fetch = async () => ({
    ok: false,
    status: 404,
    text: async () => 'No provider answered.'
  });

  try {
    const vector = await service.embedQuery(input);
    assert.equal(vector, null);
  } finally {
    globalAny.fetch = previousFetch;
  }
});
