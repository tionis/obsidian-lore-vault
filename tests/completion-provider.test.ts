import test from 'node:test';
import assert from 'node:assert/strict';
import { requestStoryContinuation } from '../src/completion-provider';

type FetchLike = typeof fetch;

function ensureWindowShim(): void {
  const globalAny = globalThis as any;
  if (!globalAny.window) {
    globalAny.window = globalAny;
  }
  if (typeof globalAny.window.setTimeout !== 'function') {
    globalAny.window.setTimeout = setTimeout;
  }
  if (typeof globalAny.window.clearTimeout !== 'function') {
    globalAny.window.clearTimeout = clearTimeout;
  }
}

function createConfig(): any {
  return {
    enabled: true,
    provider: 'openrouter',
    endpoint: 'https://example.test/v1',
    apiKey: 'test-key',
    model: 'test-model',
    temperature: 0.2,
    maxOutputTokens: 256,
    timeoutMs: 10000
  };
}

async function withMockedFetch(payload: any, run: () => Promise<void>): Promise<void> {
  ensureWindowShim();
  const globalAny = globalThis as any;
  const previousFetch = globalAny.fetch as FetchLike | undefined;

  globalAny.fetch = async () => {
    return {
      ok: true,
      json: async () => payload
    };
  };

  try {
    await run();
  } finally {
    globalAny.fetch = previousFetch;
  }
}

test('requestStoryContinuation reads standard choices[0].message.content', async () => {
  await withMockedFetch({
    choices: [
      {
        message: {
          content: 'Standard completion text.'
        }
      }
    ]
  }, async () => {
    const text = await requestStoryContinuation(createConfig(), {
      systemPrompt: 'sys',
      userPrompt: 'user'
    });
    assert.equal(text, 'Standard completion text.');
  });
});

test('requestStoryContinuation reads responses-api style output', async () => {
  await withMockedFetch({
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: 'Response API style text.'
          }
        ]
      }
    ]
  }, async () => {
    const text = await requestStoryContinuation(createConfig(), {
      systemPrompt: 'sys',
      userPrompt: 'user'
    });
    assert.equal(text, 'Response API style text.');
  });
});

test('requestStoryContinuation handles object content values and nested usage', async () => {
  let usageReport: any = null;

  await withMockedFetch({
    choices: [
      {
        message: {
          content: {
            type: 'text',
            value: 'Object-shaped content value.'
          }
        }
      }
    ],
    response: {
      usage: {
        input_tokens: 12,
        output_tokens: 4,
        total_tokens: 16
      }
    }
  }, async () => {
    const text = await requestStoryContinuation(createConfig(), {
      systemPrompt: 'sys',
      userPrompt: 'user',
      onUsage: usage => {
        usageReport = usage;
      }
    });
    assert.equal(text, 'Object-shaped content value.');
    assert.ok(usageReport);
    assert.equal(usageReport.promptTokens, 12);
    assert.equal(usageReport.completionTokens, 4);
    assert.equal(usageReport.totalTokens, 16);
  });
});
