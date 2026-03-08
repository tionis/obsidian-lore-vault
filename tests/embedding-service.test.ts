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
    apiKeySecretName: 'lorevault-embeddings-default',
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

test('EmbeddingService forwards usage reports from embedding requests', async () => {
  const usageEvents: Array<{
    operationName: string;
    usage: any;
    metadata: Record<string, unknown>;
  }> = [];
  const service = new EmbeddingService(createAppStub(), createEmbeddingConfig(), {
    onUsage: (operationName, usage, metadata) => {
      usageEvents.push({ operationName, usage, metadata });
    }
  });

  const globalAny = globalThis as any;
  const previousFetch = globalAny.fetch as FetchLike | undefined;
  globalAny.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      usage: {
        prompt_tokens: 12,
        total_tokens: 12,
        total_cost: 0.0002
      },
      data: [
        { embedding: [0.3, 0.6, 0.9] }
      ]
    }),
    text: async () => '{"usage":{"prompt_tokens":12,"total_tokens":12,"total_cost":0.0002},"data":[{"embedding":[0.3,0.6,0.9]}]}'
  });

  try {
    const vector = await service.embedQuery('hello world');
    assert.deepEqual(vector, [0.3, 0.6, 0.9]);
    assert.equal(usageEvents.length, 1);
    assert.equal(usageEvents[0].operationName, 'embeddings_embed_query');
    assert.deepEqual(usageEvents[0].metadata, { textCount: 1 });
    assert.deepEqual(usageEvents[0].usage, {
      provider: 'openrouter',
      model: 'embedding-model',
      promptTokens: 12,
      completionTokens: 0,
      totalTokens: 12,
      reportedCostUsd: 0.0002,
      source: 'openai_usage',
      cachedReadTokens: 0,
      cacheWriteTokens: 0
    });
  } finally {
    globalAny.fetch = previousFetch;
  }
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
