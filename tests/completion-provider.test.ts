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
  await withMockedFetchSequence([payload], async () => {
    await run();
  });
}

interface FetchCallRecord {
  url: string;
  body: any;
}

async function withMockedFetchSequence(
  payloads: any[],
  run: (calls: FetchCallRecord[]) => Promise<void>
): Promise<void> {
  ensureWindowShim();
  const globalAny = globalThis as any;
  const previousFetch = globalAny.fetch as FetchLike | undefined;
  const calls: FetchCallRecord[] = [];
  let callIndex = 0;

  globalAny.fetch = async (url: string, init?: { body?: string }) => {
    const payload = payloads[Math.min(callIndex, payloads.length - 1)];
    callIndex += 1;
    const parsedBody = typeof init?.body === 'string'
      ? JSON.parse(init.body)
      : null;
    calls.push({
      url,
      body: parsedBody
    });
    return {
      ok: true,
      json: async () => payload,
      text: async () => JSON.stringify(payload)
    };
  };

  try {
    await run(calls);
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

test('requestStoryContinuation retries openrouter abort responses with provider ignore fallback', async () => {
  const firstAbortPayload = {
    id: 'gen-1',
    provider: 'Friendli',
    model: 'z-ai/glm-5',
    choices: [
      {
        finish_reason: 'error',
        native_finish_reason: 'abort',
        message: {
          role: 'assistant',
          content: '',
          refusal: null,
          reasoning: null
        }
      }
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    }
  };

  const secondSuccessPayload = {
    id: 'gen-2',
    provider: 'OpenAI',
    model: 'z-ai/glm-5',
    choices: [
      {
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: 'Recovered summary text.'
        }
      }
    ],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 8,
      total_tokens: 28
    }
  };

  await withMockedFetchSequence(
    [firstAbortPayload, secondSuccessPayload],
    async (calls) => {
      const text = await requestStoryContinuation(createConfig(), {
        systemPrompt: 'sys',
        userPrompt: 'user'
      });
      assert.equal(text, 'Recovered summary text.');
      assert.equal(calls.length, 2);
      assert.equal(calls[1].body?.provider?.allow_fallbacks, true);
      assert.deepEqual(calls[1].body?.provider?.ignore, ['friendli']);
    }
  );
});
