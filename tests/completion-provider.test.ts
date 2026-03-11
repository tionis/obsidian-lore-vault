import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requestStoryContinuation,
  requestStoryContinuationStream
} from '../src/completion-provider';

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

test('requestStoryContinuationStream keeps reasoning separate from visible text', async () => {
  let streamedText = '';
  let reasoningText = '';

  await withMockedFetch({
    choices: [
      {
        message: {
          content: 'Visible streamed text.',
          reasoning: 'Hidden chain of thought.'
        }
      }
    ]
  }, async () => {
    const text = await requestStoryContinuationStream(createConfig(), {
      systemPrompt: 'sys',
      userPrompt: 'user',
      onDelta: delta => {
        streamedText += delta;
      },
      onReasoning: delta => {
        reasoningText += delta;
      }
    });
    assert.equal(text, 'Visible streamed text.');
    assert.equal(streamedText, 'Visible streamed text.');
    assert.equal(reasoningText, 'Hidden chain of thought.');
  });
});

test('requestStoryContinuation does not treat reasoning-only payloads as visible completion text', async () => {
  await withMockedFetch({
    choices: [
      {
        message: {
          content: '',
          reasoning: 'Hidden chain of thought.'
        }
      }
    ]
  }, async () => {
    await assert.rejects(
      requestStoryContinuation(createConfig(), {
        systemPrompt: 'sys',
        userPrompt: 'user'
      }),
      /did not contain text content/i
    );
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

test('requestStoryContinuation includes cache_control for openrouter by default', async () => {
  await withMockedFetchSequence(
    [{ choices: [{ message: { content: 'ok' } }] }],
    async (calls) => {
      await requestStoryContinuation(createConfig(), {
        systemPrompt: 'sys',
        userPrompt: 'user'
      });
      assert.deepEqual(calls[0].body?.cache_control, { type: 'ephemeral' });
    }
  );
});

test('requestStoryContinuation omits cache_control when promptCachingEnabled is false', async () => {
  await withMockedFetchSequence(
    [{ choices: [{ message: { content: 'ok' } }] }],
    async (calls) => {
      const config = { ...createConfig(), promptCachingEnabled: false };
      await requestStoryContinuation(config, {
        systemPrompt: 'sys',
        userPrompt: 'user'
      });
      assert.equal(calls[0].body?.cache_control, undefined);
    }
  );
});

test('requestStoryContinuation includes provider.order when providerRouting is set', async () => {
  await withMockedFetchSequence(
    [{ choices: [{ message: { content: 'ok' } }] }],
    async (calls) => {
      const config = { ...createConfig(), providerRouting: 'anthropic, openai' };
      await requestStoryContinuation(config, {
        systemPrompt: 'sys',
        userPrompt: 'user'
      });
      assert.deepEqual(calls[0].body?.provider, { order: ['anthropic', 'openai'], allow_fallbacks: false });
    }
  );
});

test('requestStoryContinuation omits OpenRouter extras for openai_compatible provider', async () => {
  await withMockedFetchSequence(
    [{ choices: [{ message: { content: 'ok' } }] }],
    async (calls) => {
      const config = { ...createConfig(), provider: 'openai_compatible', promptCachingEnabled: true, providerRouting: 'anthropic' };
      await requestStoryContinuation(config, {
        systemPrompt: 'sys',
        userPrompt: 'user'
      });
      assert.equal(calls[0].body?.cache_control, undefined);
      assert.equal(calls[0].body?.provider, undefined);
    }
  );
});

test('requestStoryContinuation parses cachedReadTokens from prompt_tokens_details', async () => {
  let usageReport: any = null;
  await withMockedFetch({
    choices: [{ message: { content: 'ok' } }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      prompt_tokens_details: {
        cached_tokens: 80,
        cache_write_tokens: 15
      }
    }
  }, async () => {
    await requestStoryContinuation(createConfig(), {
      systemPrompt: 'sys',
      userPrompt: 'user',
      onUsage: usage => { usageReport = usage; }
    });
    assert.ok(usageReport);
    assert.equal(usageReport.cachedReadTokens, 80);
    assert.equal(usageReport.cacheWriteTokens, 15);
  });
});

test('requestStoryContinuation parses cacheWriteTokens from cache_creation_input_tokens (Anthropic field)', async () => {
  let usageReport: any = null;
  await withMockedFetch({
    choices: [{ message: { content: 'ok' } }],
    usage: {
      prompt_tokens: 200,
      completion_tokens: 10,
      total_tokens: 210,
      prompt_tokens_details: {
        cached_tokens: 0,
        cache_creation_input_tokens: 50
      }
    }
  }, async () => {
    await requestStoryContinuation(createConfig(), {
      systemPrompt: 'sys',
      userPrompt: 'user',
      onUsage: usage => { usageReport = usage; }
    });
    assert.ok(usageReport);
    assert.equal(usageReport.cachedReadTokens, 0);
    assert.equal(usageReport.cacheWriteTokens, 50);
  });
});

test('requestStoryContinuation supports external abort signal', async () => {
  ensureWindowShim();
  const globalAny = globalThis as any;
  const previousFetch = globalAny.fetch as FetchLike | undefined;
  globalAny.fetch = async (_url: string, init?: { signal?: AbortSignal }) => {
    return await new Promise((_resolve, reject) => {
      const onAbort = () => {
        const error = new Error('Aborted');
        (error as any).name = 'AbortError';
        reject(error);
      };
      if (init?.signal?.aborted) {
        onAbort();
        return;
      }
      init?.signal?.addEventListener('abort', onAbort, { once: true });
    });
  };

  try {
    const controller = new AbortController();
    const requestPromise = requestStoryContinuation(createConfig(), {
      systemPrompt: 'sys',
      userPrompt: 'user',
      abortSignal: controller.signal
    });
    controller.abort();
    await assert.rejects(
      requestPromise,
      /Completion request was aborted\./
    );
  } finally {
    globalAny.fetch = previousFetch;
  }
});
