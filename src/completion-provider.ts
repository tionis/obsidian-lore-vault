import { ConverterSettings } from './models';
import {
  RetrievalToolPlanner,
  RetrievalToolPlannerMessage,
  RetrievalToolPlannerRequest,
  RetrievalToolPlannerResponse
} from './retrieval-tool-hooks';

export interface StoryCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  onUsage?: (usage: CompletionUsageReport) => void;
}

export interface StoryCompletionStreamRequest extends StoryCompletionRequest {
  onDelta: (delta: string) => void;
  abortSignal?: AbortSignal;
}

export interface CompletionUsageReport {
  provider: 'openrouter' | 'ollama' | 'openai_compatible';
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reportedCostUsd: number | null;
  source: 'openai_usage' | 'ollama_usage';
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

function asFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function extractReportedCostUsd(payload: any): number | null {
  const candidates = [
    payload?.usage?.cost,
    payload?.usage?.total_cost,
    payload?.usage?.estimated_cost,
    payload?.cost,
    payload?.total_cost
  ];
  for (const candidate of candidates) {
    const parsed = asFiniteNumber(candidate);
    if (parsed !== null && parsed >= 0) {
      return parsed;
    }
  }
  return null;
}

function parseOpenAiUsage(payload: any): Omit<CompletionUsageReport, 'provider' | 'model' | 'source'> | null {
  const usage = payload?.usage;
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const promptTokensRaw = asFiniteNumber(usage.prompt_tokens ?? usage.input_tokens);
  const completionTokensRaw = asFiniteNumber(usage.completion_tokens ?? usage.output_tokens);
  const totalTokensRaw = asFiniteNumber(usage.total_tokens);

  if (promptTokensRaw === null && completionTokensRaw === null && totalTokensRaw === null) {
    return null;
  }

  const promptTokens = Math.max(
    0,
    Math.floor(promptTokensRaw ?? Math.max(0, (totalTokensRaw ?? 0) - (completionTokensRaw ?? 0)))
  );
  const completionTokens = Math.max(
    0,
    Math.floor(completionTokensRaw ?? Math.max(0, (totalTokensRaw ?? 0) - promptTokens))
  );
  const totalTokens = Math.max(
    0,
    Math.floor(totalTokensRaw ?? (promptTokens + completionTokens))
  );

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    reportedCostUsd: extractReportedCostUsd(payload)
  };
}

function parseOllamaUsage(payload: any): Omit<CompletionUsageReport, 'provider' | 'model' | 'source'> | null {
  const promptTokensRaw = asFiniteNumber(payload?.prompt_eval_count);
  const completionTokensRaw = asFiniteNumber(payload?.eval_count);
  if (promptTokensRaw === null && completionTokensRaw === null) {
    return null;
  }

  const promptTokens = Math.max(0, Math.floor(promptTokensRaw ?? 0));
  const completionTokens = Math.max(0, Math.floor(completionTokensRaw ?? 0));
  const totalTokens = promptTokens + completionTokens;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    reportedCostUsd: extractReportedCostUsd(payload)
  };
}

function convertPlannerMessages(messages: RetrievalToolPlannerMessage[]): any[] {
  return messages.map((message) => {
    if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: message.content || '',
        tool_calls: message.toolCalls.map(call => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: call.argumentsJson
          }
        }))
      };
    }

    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId || '',
        name: message.toolName || '',
        content: message.content
      };
    }

    return {
      role: message.role,
      content: message.content
    };
  });
}

function parsePlannerResponse(payload: any): RetrievalToolPlannerResponse {
  const choice = payload?.choices?.[0] ?? {};
  const message = choice?.message ?? {};
  const finishReason = String(choice?.finish_reason ?? '');
  const assistantText = normalizeContentValue(message?.content);
  const toolCallsRaw = Array.isArray(message?.tool_calls) ? message.tool_calls : [];

  const toolCalls = toolCallsRaw
    .map((call: any, index: number) => {
      const name = typeof call?.function?.name === 'string' ? call.function.name.trim() : '';
      const rawArgs = call?.function?.arguments;
      const argumentsJson = typeof rawArgs === 'string'
        ? rawArgs
        : JSON.stringify(rawArgs ?? {});
      return {
        id: typeof call?.id === 'string' && call.id.trim().length > 0
          ? call.id.trim()
          : `tool-call-${index + 1}`,
        name,
        argumentsJson
      };
    })
    .filter((call: { id: string; name: string; argumentsJson: string }) => call.name.length > 0);

  return {
    assistantText,
    toolCalls: toolCalls as RetrievalToolPlannerResponse['toolCalls'],
    finishReason
  };
}

async function consumeOpenAiSseStream(
  response: Response,
  onDelta: (delta: string) => void
): Promise<{
  text: string;
  usage: Omit<CompletionUsageReport, 'provider' | 'model' | 'source'> | null;
}> {
  if (!response.body) {
    const payload = await response.json();
    const text = extractOpenAiCompletionText(payload).trim();
    if (text) {
      onDelta(text);
    }
    return {
      text,
      usage: parseOpenAiUsage(payload)
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let combined = '';
  let completed = false;
  let usage: Omit<CompletionUsageReport, 'provider' | 'model' | 'source'> | null = null;

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
    const parsedUsage = parseOpenAiUsage(payload);
    if (parsedUsage) {
      usage = parsedUsage;
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

  return {
    text: combined.trim(),
    usage
  };
}

async function consumeOllamaNdjsonStream(
  response: Response,
  onDelta: (delta: string) => void
): Promise<{
  text: string;
  usage: Omit<CompletionUsageReport, 'provider' | 'model' | 'source'> | null;
}> {
  if (!response.body) {
    const payload = await response.json();
    const text = extractOllamaCompletionText(payload).trim();
    if (text) {
      onDelta(text);
    }
    return {
      text,
      usage: parseOllamaUsage(payload)
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let combined = '';
  let completed = false;
  let usage: Omit<CompletionUsageReport, 'provider' | 'model' | 'source'> | null = null;

  const consumeJsonLine = (line: string): void => {
    const payload = safeParseJson(line);
    if (!payload) {
      return;
    }
    const parsedUsage = parseOllamaUsage(payload);
    if (parsedUsage) {
      usage = parsedUsage;
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

  return {
    text: combined.trim(),
    usage
  };
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
    const usage = parseOllamaUsage(payload);
    if (usage && request.onUsage) {
      request.onUsage({
        provider: config.provider,
        model: config.model,
        source: 'ollama_usage',
        ...usage
      });
    }
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
  const usage = parseOpenAiUsage(payload);
  if (usage && request.onUsage) {
    request.onUsage({
      provider: config.provider,
      model: config.model,
      source: 'openai_usage',
      ...usage
    });
  }
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

      const result = await consumeOllamaNdjsonStream(response, request.onDelta);
      if (result.usage && request.onUsage) {
        request.onUsage({
          provider: config.provider,
          model: config.model,
          source: 'ollama_usage',
          ...result.usage
        });
      }
      return result.text;
    }

    const streamOptions = config.provider === 'openrouter'
      ? { include_usage: true }
      : undefined;

    const response = await fetch(resolveOpenAiCompletionsUrl(config.endpoint), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: config.temperature,
        max_tokens: config.maxOutputTokens,
        stream: true,
        stream_options: streamOptions
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Completion request failed (${response.status}): ${text}`);
    }

    const result = await consumeOpenAiSseStream(response, request.onDelta);
    if (result.usage && request.onUsage) {
      request.onUsage({
        provider: config.provider,
        model: config.model,
        source: 'openai_usage',
        ...result.usage
      });
    }
    return result.text;
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

export function createCompletionRetrievalToolPlanner(
  config: ConverterSettings['completion']
): RetrievalToolPlanner | null {
  if (config.provider === 'ollama') {
    return null;
  }

  return async (request: RetrievalToolPlannerRequest): Promise<RetrievalToolPlannerResponse> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutMs = Math.max(500, Math.min(config.timeoutMs, request.timeoutMs));
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abortHandler = () => controller.abort();
    request.abortSignal?.addEventListener('abort', abortHandler);

    try {
      const response = await fetch(resolveOpenAiCompletionsUrl(config.endpoint), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          messages: convertPlannerMessages(request.messages),
          tools: request.toolDefinitions,
          tool_choice: 'auto',
          temperature: 0,
          max_tokens: 240,
          stream: false
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Retrieval tool planner request failed (${response.status}): ${text}`);
      }

      const payload = await response.json();
      return parsePlannerResponse(payload);
    } catch (error) {
      if (timedOut) {
        throw new Error(`Retrieval tool planner request timed out after ${timeoutMs}ms.`);
      }
      if (request.abortSignal?.aborted) {
        throw new Error('Retrieval tool planner request was aborted.');
      }
      throw normalizeRequestError(error, timeoutMs);
    } finally {
      request.abortSignal?.removeEventListener('abort', abortHandler);
      window.clearTimeout(timer);
    }
  };
}
