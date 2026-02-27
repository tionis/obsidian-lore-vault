import { ConverterSettings } from './models';

export interface StoryCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
}

export interface StoryCompletionStreamRequest extends StoryCompletionRequest {
  onDelta: (delta: string) => void;
  abortSignal?: AbortSignal;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveOpenAiCompletionsUrl(endpoint: string): string {
  const trimmed = trimTrailingSlash(endpoint);
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

function resolveOllamaChatUrl(endpoint: string): string {
  const trimmed = trimTrailingSlash(endpoint);
  if (trimmed.endsWith('/api/chat')) {
    return trimmed;
  }
  if (trimmed.endsWith('/api')) {
    return `${trimmed}/chat`;
  }
  return `${trimmed}/api/chat`;
}

function normalizeContentValue(content: any): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    const textParts = content
      .map((item: any) => {
        if (typeof item === 'string') {
          return item;
        }
        if (typeof item?.text === 'string') {
          return item.text;
        }
        if (typeof item?.content === 'string') {
          return item.content;
        }
        return '';
      })
      .filter((part: string) => part.length > 0);
    return textParts.join('\n').trim();
  }
  return '';
}

function extractOpenAiCompletionText(payload: any): string {
  const first = payload?.choices?.[0];
  const messageContent = normalizeContentValue(first?.message?.content);
  if (messageContent) {
    return messageContent;
  }
  const textContent = normalizeContentValue(first?.text);
  if (textContent) {
    return textContent;
  }
  throw new Error('Completion response did not contain choices[0].message.content.');
}

function extractOpenAiDeltaText(payload: any): string {
  const first = payload?.choices?.[0];
  const deltaContent = normalizeContentValue(first?.delta?.content);
  if (deltaContent) {
    return deltaContent;
  }
  const messageContent = normalizeContentValue(first?.message?.content);
  if (messageContent) {
    return messageContent;
  }
  const textContent = normalizeContentValue(first?.text);
  if (textContent) {
    return textContent;
  }
  return '';
}

function extractOllamaCompletionText(payload: any): string {
  const messageContent = normalizeContentValue(payload?.message?.content);
  if (messageContent) {
    return messageContent;
  }
  const responseContent = normalizeContentValue(payload?.response);
  if (responseContent) {
    return responseContent;
  }
  return extractOpenAiCompletionText(payload);
}

function extractOllamaDeltaText(payload: any): string {
  const messageContent = normalizeContentValue(payload?.message?.content);
  if (messageContent) {
    return messageContent;
  }
  const responseContent = normalizeContentValue(payload?.response);
  if (responseContent) {
    return responseContent;
  }
  return '';
}

function safeParseJson(value: string): any | null {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

async function consumeOpenAiSseStream(
  response: Response,
  onDelta: (delta: string) => void
): Promise<string> {
  if (!response.body) {
    const payload = await response.json();
    const text = extractOpenAiCompletionText(payload).trim();
    if (text) {
      onDelta(text);
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let combined = '';
  let completed = false;

  const consumeDataLine = (line: string): void => {
    if (!line.startsWith('data:')) {
      return;
    }
    const payloadText = line.slice(5).trim();
    if (!payloadText) {
      return;
    }
    if (payloadText === '[DONE]') {
      completed = true;
      return;
    }
    const payload = safeParseJson(payloadText);
    if (!payload) {
      return;
    }
    const delta = extractOpenAiDeltaText(payload);
    if (!delta) {
      return;
    }
    combined += delta;
    onDelta(delta);
  };

  while (!completed) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
    } else if (done) {
      buffer += decoder.decode();
    }

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const line = rawLine.trim();
      if (line.length > 0) {
        consumeDataLine(line);
      }
      if (completed) {
        break;
      }
      newlineIndex = buffer.indexOf('\n');
    }

    if (done) {
      break;
    }
  }

  const finalLine = buffer.trim();
  if (!completed && finalLine.length > 0) {
    consumeDataLine(finalLine);
  }

  return combined.trim();
}

async function consumeOllamaNdjsonStream(
  response: Response,
  onDelta: (delta: string) => void
): Promise<string> {
  if (!response.body) {
    const payload = await response.json();
    const text = extractOllamaCompletionText(payload).trim();
    if (text) {
      onDelta(text);
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let combined = '';
  let completed = false;

  const consumeJsonLine = (line: string): void => {
    const payload = safeParseJson(line);
    if (!payload) {
      return;
    }
    const delta = extractOllamaDeltaText(payload);
    if (delta) {
      combined += delta;
      onDelta(delta);
    }
    if (payload?.done === true) {
      completed = true;
    }
  };

  while (!completed) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
    } else if (done) {
      buffer += decoder.decode();
    }

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const line = rawLine.trim();
      if (line.length > 0) {
        consumeJsonLine(line);
      }
      if (completed) {
        break;
      }
      newlineIndex = buffer.indexOf('\n');
    }

    if (done) {
      break;
    }
  }

  const finalLine = buffer.trim();
  if (!completed && finalLine.length > 0) {
    consumeJsonLine(finalLine);
  }

  return combined.trim();
}

function normalizeRequestError(error: unknown, timeoutMs: number): Error {
  if (error instanceof Error && error.name === 'AbortError') {
    return new Error(`Completion request timed out after ${timeoutMs}ms.`);
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

async function fetchJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<any> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Completion request failed (${response.status}): ${text}`);
    }

    return await response.json();
  } finally {
    window.clearTimeout(timer);
  }
}

export async function requestStoryContinuation(
  config: ConverterSettings['completion'],
  request: StoryCompletionRequest
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const messages = [
    { role: 'system', content: request.systemPrompt },
    { role: 'user', content: request.userPrompt }
  ];

  if (config.provider === 'ollama') {
    const payload = await fetchJson(
      resolveOllamaChatUrl(config.endpoint),
      {
        model: config.model,
        stream: false,
        messages,
        options: {
          temperature: config.temperature,
          num_predict: config.maxOutputTokens
        }
      },
      headers,
      config.timeoutMs
    );
    return extractOllamaCompletionText(payload).trim();
  }

  const payload = await fetchJson(
    resolveOpenAiCompletionsUrl(config.endpoint),
    {
      model: config.model,
      messages,
      temperature: config.temperature,
      max_tokens: config.maxOutputTokens
    },
    headers,
    config.timeoutMs
  );
  return extractOpenAiCompletionText(payload).trim();
}

export async function requestStoryContinuationStream(
  config: ConverterSettings['completion'],
  request: StoryCompletionStreamRequest
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const messages = [
    { role: 'system', content: request.systemPrompt },
    { role: 'user', content: request.userPrompt }
  ];

  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs);
  const abortHandler = () => controller.abort();
  request.abortSignal?.addEventListener('abort', abortHandler);

  try {
    if (config.provider === 'ollama') {
      const response = await fetch(resolveOllamaChatUrl(config.endpoint), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          stream: true,
          messages,
          options: {
            temperature: config.temperature,
            num_predict: config.maxOutputTokens
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Completion request failed (${response.status}): ${text}`);
      }

      return await consumeOllamaNdjsonStream(response, request.onDelta);
    }

    const response = await fetch(resolveOpenAiCompletionsUrl(config.endpoint), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: config.temperature,
        max_tokens: config.maxOutputTokens,
        stream: true
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Completion request failed (${response.status}): ${text}`);
    }

    return await consumeOpenAiSseStream(response, request.onDelta);
  } catch (error) {
    if (timedOut) {
      throw new Error(`Completion request timed out after ${config.timeoutMs}ms.`);
    }
    if (request.abortSignal?.aborted) {
      throw new Error('Completion request was aborted.');
    }
    throw normalizeRequestError(error, config.timeoutMs);
  } finally {
    request.abortSignal?.removeEventListener('abort', abortHandler);
    window.clearTimeout(timer);
  }
}
