import test from 'node:test';
import assert from 'node:assert/strict';
import { requestEmbeddings } from '../src/embedding-provider';
import { ConverterSettings } from '../src/models';

type FetchLike = typeof fetch;

function createConfig(): ConverterSettings['embeddings'] {
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

test('requestEmbeddings emits embedding operation log records', async () => {
  const globalAny = globalThis as any;
  const previousFetch = globalAny.fetch as FetchLike | undefined;
  let logRecord: any = null;

  globalAny.fetch = async (url: string, init?: { body?: string }) => {
    assert.equal(url, 'https://example.test/v1/embeddings');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    assert.deepEqual(body, {
      model: 'embedding-model',
      input: ['search query instruction\n\nhello world']
    });

    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { embedding: [0.1, 0.2, 0.3] }
        ]
      }),
      text: async () => '{"data":[{"embedding":[0.1,0.2,0.3]}]}'
    };
  };

  try {
    const vectors = await requestEmbeddings(createConfig(), {
      texts: ['hello world'],
      instruction: 'search query instruction',
      operationName: 'embeddings_embed_query',
      onOperationLog: async (record) => {
        logRecord = record;
      }
    });

    assert.deepEqual(vectors, [[0.1, 0.2, 0.3]]);
    assert.ok(logRecord);
    assert.equal(logRecord.kind, 'embedding');
    assert.equal(logRecord.operationName, 'embeddings_embed_query');
    assert.equal(logRecord.status, 'ok');
    assert.equal(logRecord.aborted, false);
    assert.deepEqual(logRecord.request, {
      texts: ['search query instruction\n\nhello world'],
      textCount: 1,
      instruction: 'search query instruction'
    });
    assert.equal(logRecord.attempts.length, 1);
    assert.equal(logRecord.attempts[0].url, 'https://example.test/v1/embeddings');
    assert.deepEqual(logRecord.attempts[0].requestBody, {
      model: 'embedding-model',
      input: ['search query instruction\n\nhello world']
    });
    assert.deepEqual(logRecord.attempts[0].responseBody, {
      data: [
        { embedding: [0.1, 0.2, 0.3] }
      ]
    });
  } finally {
    globalAny.fetch = previousFetch;
  }
});
