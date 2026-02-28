import { ConverterSettings } from './models';
import {
  RetrievalToolPlanner,
  RetrievalToolPlannerRequest,
  RetrievalToolPlannerResponse
} from './retrieval-tool-hooks';

export interface StoryCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  operationName?: string;
  onUsage?: (usage: CompletionUsageReport) => void;
  onOperationLog?: CompletionOperationLogger;
  abortSignal?: AbortSignal;
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

export type CompletionOperationKind = 'completion' | 'completion_stream' | 'tool_planner';

export interface CompletionOperationLogAttempt {
  index: number;
  url: string;
  requestBody: unknown;
  responseBody?: unknown;
  responseText?: string;
  error?: string;
}

export interface CompletionOperationLogRecord {
  id: string;
  kind: CompletionOperationKind;
  operationName: string;
  provider: ConverterSettings['completion']['provider'];
  model: string;
  endpoint: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  status: 'ok' | 'error';
  aborted: boolean;
  error?: string;
  request: Record<string, unknown>;
  attempts: CompletionOperationLogAttempt[];
  finalText?: string;
  usage?: CompletionUsageReport | null;
}

export type CompletionOperationLogger = (
  record: CompletionOperationLogRecord
) => void | Promise<void>;

export interface CompletionToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface CompletionToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface CompletionToolPlannerMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: CompletionToolCall[];
}

export interface CompletionToolPlannerRequest {
  messages: CompletionToolPlannerMessage[];
  toolDefinitions: CompletionToolDefinition[];
  timeoutMs: number;
  abortSignal?: AbortSignal;
}

export interface CompletionToolPlannerResponse {
  assistantText: string;
  toolCalls: CompletionToolCall[];
  finishReason: string;
}

export type CompletionToolPlanner = (
  request: CompletionToolPlannerRequest
) => Promise<CompletionToolPlannerResponse>;

export interface CompletionToolPlannerOptions {
  operationName?: string;
  onOperationLog?: CompletionOperationLogger;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function createOperationId(kind: CompletionOperationKind): string {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isAbortLikeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /aborted|cancelled/i.test(message);
}

async function emitOperationLog(
  logger: CompletionOperationLogger | undefined,
  record: CompletionOperationLogRecord
): Promise<void> {
  if (!logger) {
    return;
  }
  try {
    await logger(record);
  } catch (error) {
    console.warn('LoreVault: Failed to write completion operation log:', error);
  }
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
  if (content && typeof content === 'object') {
    const pieces: string[] = [];
    const maybeAdd = (value: any): void => {
      const normalized = normalizeContentValue(value);
      if (normalized) {
        pieces.push(normalized);
      }
    };
    maybeAdd(content.text);
    maybeAdd(content.value);
    maybeAdd(content.output_text);
    maybeAdd(content.content);
    maybeAdd(content.delta);
    maybeAdd(content.parts);
    maybeAdd(content.segments);
    maybeAdd(content.items);
    maybeAdd(content.message?.content);
    if (pieces.length > 0) {
      const seen = new Set<string>();
      const deduped = pieces.filter(piece => {
        const key = piece.trim();
        if (!key || seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
      return deduped.join('\n').trim();
    }
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
        if (typeof item?.value === 'string') {
          return item.value;
        }
        if (typeof item?.output_text === 'string') {
          return item.output_text;
        }
        if (typeof item?.content === 'string') {
          return item.content;
        }
        const nested = normalizeContentValue(item);
        if (nested) {
          return nested;
        }
        return '';
      })
      .filter((part: string) => part.length > 0);
    return textParts.join('\n').trim();
  }
  return '';
}

function extractResponseApiOutputText(payload: any): string {
  const directCandidates = [
    normalizeContentValue(payload?.output_text),
    normalizeContentValue(payload?.response?.output_text),
    normalizeContentValue(payload?.result?.output_text)
  ];
  for (const candidate of directCandidates) {
    if (candidate) {
      return candidate;
    }
  }

  const outputs = [
    payload?.output,
    payload?.response?.output,
    payload?.result?.output
  ];

  for (const output of outputs) {
    if (!Array.isArray(output)) {
      continue;
    }
    const combined = output
      .map((entry: any) => normalizeContentValue(entry))
      .filter((entry: string) => entry.length > 0)
      .join('\n')
      .trim();
    if (combined) {
      return combined;
    }
  }

  return '';
}

function summarizeCompletionPayloadShape(payload: any): string {
  try {
    const topKeys = payload && typeof payload === 'object'
      ? Object.keys(payload).slice(0, 12)
      : [];
    const choiceKeys = payload?.choices?.[0] && typeof payload.choices[0] === 'object'
      ? Object.keys(payload.choices[0]).slice(0, 12)
      : [];
    const messageKeys = payload?.choices?.[0]?.message && typeof payload.choices[0].message === 'object'
      ? Object.keys(payload.choices[0].message).slice(0, 12)
      : [];
    return `topKeys=[${topKeys.join(', ')}] choiceKeys=[${choiceKeys.join(', ')}] messageKeys=[${messageKeys.join(', ')}]`;
  } catch (_error) {
    return 'shape_unavailable';
  }
}

function summarizeCompletionFailure(payload: any): string {
  const choice = payload?.choices?.[0] ?? {};
  const finishReason = String(choice?.finish_reason ?? '').trim();
  const nativeFinishReason = String(choice?.native_finish_reason ?? '').trim();
  const provider = String(payload?.provider ?? '').trim();
  const model = String(payload?.model ?? '').trim();
  const refusal = normalizeContentValue(choice?.message?.refusal);
  const reasoning = normalizeContentValue(choice?.message?.reasoning);
  const parts = [
    finishReason ? `finish_reason=${finishReason}` : '',
    nativeFinishReason ? `native_finish_reason=${nativeFinishReason}` : '',
    provider ? `provider=${provider}` : '',
    model ? `model=${model}` : '',
    refusal ? `refusal=${JSON.stringify(refusal.slice(0, 160))}` : '',
    reasoning ? `reasoning=${JSON.stringify(reasoning.slice(0, 160))}` : ''
  ].filter(Boolean);
  if (parts.length === 0) {
    return 'failure_details_unavailable';
  }
  return parts.join(' ');
}

function isAbortLikeCompletionFailure(payload: any): boolean {
  const choice = payload?.choices?.[0] ?? {};
  const finishReason = String(choice?.finish_reason ?? '').trim().toLowerCase();
  const nativeFinishReason = String(choice?.native_finish_reason ?? '').trim().toLowerCase();
  return (
    finishReason === 'error' ||
    finishReason === 'abort' ||
    nativeFinishReason === 'error' ||
    nativeFinishReason === 'abort'
  );
}

function extractOpenRouterProviderId(payload: any): string {
  const raw = String(payload?.provider ?? '').trim();
  if (!raw) {
    return '';
  }
  return raw.toLowerCase();
}

function extractOpenAiCompletionTextOrEmpty(payload: any): string {
  try {
    return extractOpenAiCompletionText(payload).trim();
  } catch (_error) {
    return '';
  }
}

function extractOpenAiCompletionText(payload: any): string {
  const first = payload?.choices?.[0];
  const messageContent = normalizeContentValue(first?.message?.content);
  if (messageContent) {
    return messageContent;
  }
  const refusalContent = normalizeContentValue(first?.message?.refusal);
  if (refusalContent) {
    return refusalContent;
  }
  const reasoningContent = normalizeContentValue(first?.message?.reasoning);
  if (reasoningContent) {
    return reasoningContent;
  }
  const textContent = normalizeContentValue(first?.text);
  if (textContent) {
    return textContent;
  }
  const responseApiText = extractResponseApiOutputText(payload);
  if (responseApiText) {
    return responseApiText;
  }
  throw new Error(
    `Completion response did not contain text content. ${summarizeCompletionFailure(payload)} ${summarizeCompletionPayloadShape(payload)}`
  );
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
  const responseDelta = normalizeContentValue(payload?.delta) || normalizeContentValue(payload?.output_text);
  if (responseDelta) {
    return responseDelta;
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
  const usage = payload?.usage ?? payload?.response?.usage ?? payload?.result?.usage;
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

function convertPlannerMessages(messages: CompletionToolPlannerMessage[]): any[] {
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

function parsePlannerResponse(payload: any): CompletionToolPlannerResponse {
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
    toolCalls,
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
  timeoutMs: number,
  abortSignal?: AbortSignal
): Promise<any> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortHandler = () => controller.abort();
  abortSignal?.addEventListener('abort', abortHandler);

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
  } catch (error) {
    if (timedOut) {
      throw new Error(`Completion request timed out after ${timeoutMs}ms.`);
    }
    if (abortSignal?.aborted) {
      throw new Error('Completion request was aborted.');
    }
    throw normalizeRequestError(error, timeoutMs);
  } finally {
    abortSignal?.removeEventListener('abort', abortHandler);
    window.clearTimeout(timer);
  }
}

export async function requestStoryContinuation(
  config: ConverterSettings['completion'],
  request: StoryCompletionRequest
): Promise<string> {
  const operationId = createOperationId('completion');
  const operationName = request.operationName?.trim() || 'completion';
  const startedAt = Date.now();
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
  const attempts: CompletionOperationLogAttempt[] = [];
  let usageForLog: CompletionUsageReport | null = null;
  let finalText = '';
  let finalError = '';
  let aborted = false;

  try {
    if (config.provider === 'ollama') {
      const url = resolveOllamaChatUrl(config.endpoint);
      const body: Record<string, unknown> = {
        model: config.model,
        stream: false,
        messages,
        options: {
          temperature: config.temperature,
          num_predict: config.maxOutputTokens
        }
      };
      const attempt: CompletionOperationLogAttempt = {
        index: 1,
        url,
        requestBody: body
      };
      attempts.push(attempt);
      const payload = await fetchJson(
        url,
        body,
        headers,
        config.timeoutMs,
        request.abortSignal
      );
      attempt.responseBody = payload;
      const usage = parseOllamaUsage(payload);
      if (usage) {
        usageForLog = {
          provider: config.provider,
          model: config.model,
          source: 'ollama_usage',
          ...usage
        };
        if (request.onUsage) {
          request.onUsage(usageForLog);
        }
      }
      finalText = extractOllamaCompletionText(payload).trim();
      return finalText;
    }

    const url = resolveOpenAiCompletionsUrl(config.endpoint);
    const baseBody: Record<string, unknown> = {
      model: config.model,
      messages,
      temperature: config.temperature,
      max_tokens: config.maxOutputTokens
    };

    const reportUsage = (payload: any): void => {
      const usage = parseOpenAiUsage(payload);
      if (usage) {
        usageForLog = {
          provider: config.provider,
          model: config.model,
          source: 'openai_usage',
          ...usage
        };
        if (request.onUsage) {
          request.onUsage(usageForLog);
        }
      }
    };

    const firstAttempt: CompletionOperationLogAttempt = {
      index: 1,
      url,
      requestBody: baseBody
    };
    attempts.push(firstAttempt);
    const firstPayload = await fetchJson(
      url,
      baseBody,
      headers,
      config.timeoutMs,
      request.abortSignal
    );
    firstAttempt.responseBody = firstPayload;
    reportUsage(firstPayload);

    const firstText = extractOpenAiCompletionTextOrEmpty(firstPayload);
    if (firstText) {
      finalText = firstText;
      return finalText;
    }

    if (config.provider === 'openrouter' && isAbortLikeCompletionFailure(firstPayload)) {
      const providerId = extractOpenRouterProviderId(firstPayload);
      const retryBody: Record<string, unknown> = {
        ...baseBody,
        provider: providerId
          ? {
            allow_fallbacks: true,
            ignore: [providerId]
          }
          : {
            allow_fallbacks: true
          }
      };

      const retryAttempt: CompletionOperationLogAttempt = {
        index: 2,
        url,
        requestBody: retryBody
      };
      attempts.push(retryAttempt);
      const retryPayload = await fetchJson(
        url,
        retryBody,
        headers,
        config.timeoutMs,
        request.abortSignal
      );
      retryAttempt.responseBody = retryPayload;
      reportUsage(retryPayload);

      const retryText = extractOpenAiCompletionTextOrEmpty(retryPayload);
      if (retryText) {
        finalText = retryText;
        return finalText;
      }

      throw new Error(
        `Completion failed after OpenRouter provider retry. first=(${summarizeCompletionFailure(firstPayload)}) retry=(${summarizeCompletionFailure(retryPayload)})`
      );
    }

    finalText = extractOpenAiCompletionText(firstPayload).trim();
    return finalText;
  } catch (error) {
    finalError = error instanceof Error ? error.message : String(error);
    aborted = isAbortLikeError(error);
    if (attempts.length > 0) {
      attempts[attempts.length - 1].error = finalError;
    }
    throw error;
  } finally {
    const finishedAt = Date.now();
    await emitOperationLog(request.onOperationLog, {
      id: operationId,
      kind: 'completion',
      operationName,
      provider: config.provider,
      model: config.model,
      endpoint: config.endpoint,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
      status: finalError ? 'error' : 'ok',
      aborted,
      ...(finalError ? { error: finalError } : {}),
      request: {
        messages
      },
      attempts,
      ...(finalText ? { finalText } : {}),
      usage: usageForLog
    });
  }
}

export async function requestStoryContinuationStream(
  config: ConverterSettings['completion'],
  request: StoryCompletionStreamRequest
): Promise<string> {
  const operationId = createOperationId('completion_stream');
  const operationName = request.operationName?.trim() || 'completion_stream';
  const startedAt = Date.now();
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
  const attempts: CompletionOperationLogAttempt[] = [];
  let usageForLog: CompletionUsageReport | null = null;
  let finalText = '';
  let finalError = '';
  let aborted = false;

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
      const url = resolveOllamaChatUrl(config.endpoint);
      const body: Record<string, unknown> = {
        model: config.model,
        stream: true,
        messages,
        options: {
          temperature: config.temperature,
          num_predict: config.maxOutputTokens
        }
      };
      const attempt: CompletionOperationLogAttempt = {
        index: 1,
        url,
        requestBody: body
      };
      attempts.push(attempt);
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        attempt.error = text;
        throw new Error(`Completion request failed (${response.status}): ${text}`);
      }

      const result = await consumeOllamaNdjsonStream(response, request.onDelta);
      finalText = result.text;
      attempt.responseText = result.text;
      if (result.usage && request.onUsage) {
        const usage = {
          provider: config.provider,
          model: config.model,
          source: 'ollama_usage',
          ...result.usage
        } as CompletionUsageReport;
        usageForLog = usage;
        request.onUsage(usage);
      } else if (result.usage) {
        usageForLog = {
          provider: config.provider,
          model: config.model,
          source: 'ollama_usage',
          ...result.usage
        };
      }
      return finalText;
    }

    const streamOptions = config.provider === 'openrouter'
      ? { include_usage: true }
      : undefined;

    const url = resolveOpenAiCompletionsUrl(config.endpoint);
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      temperature: config.temperature,
      max_tokens: config.maxOutputTokens,
      stream: true,
      stream_options: streamOptions
    };
    const attempt: CompletionOperationLogAttempt = {
      index: 1,
      url,
      requestBody: body
    };
    attempts.push(attempt);
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text();
      attempt.error = text;
      throw new Error(`Completion request failed (${response.status}): ${text}`);
    }

    const result = await consumeOpenAiSseStream(response, request.onDelta);
    finalText = result.text;
    attempt.responseText = result.text;
    if (result.usage && request.onUsage) {
      const usage = {
        provider: config.provider,
        model: config.model,
        source: 'openai_usage',
        ...result.usage
      } as CompletionUsageReport;
      usageForLog = usage;
      request.onUsage(usage);
    } else if (result.usage) {
      usageForLog = {
        provider: config.provider,
        model: config.model,
        source: 'openai_usage',
        ...result.usage
      };
    }
    return finalText;
  } catch (error) {
    if (timedOut) {
      finalError = `Completion request timed out after ${config.timeoutMs}ms.`;
      if (attempts.length > 0) {
        attempts[attempts.length - 1].error = finalError;
      }
      throw new Error(finalError);
    }
    if (request.abortSignal?.aborted) {
      finalError = 'Completion request was aborted.';
      aborted = true;
      if (attempts.length > 0) {
        attempts[attempts.length - 1].error = finalError;
      }
      throw new Error(finalError);
    }
    const normalized = normalizeRequestError(error, config.timeoutMs);
    finalError = normalized.message;
    aborted = isAbortLikeError(normalized);
    if (attempts.length > 0) {
      attempts[attempts.length - 1].error = finalError;
    }
    throw normalized;
  } finally {
    request.abortSignal?.removeEventListener('abort', abortHandler);
    window.clearTimeout(timer);
    const finishedAt = Date.now();
    await emitOperationLog(request.onOperationLog, {
      id: operationId,
      kind: 'completion_stream',
      operationName,
      provider: config.provider,
      model: config.model,
      endpoint: config.endpoint,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
      status: finalError ? 'error' : 'ok',
      aborted,
      ...(finalError ? { error: finalError } : {}),
      request: {
        messages
      },
      attempts,
      ...(finalText ? { finalText } : {}),
      usage: usageForLog
    });
  }
}

export function createCompletionToolPlanner(
  config: ConverterSettings['completion'],
  options?: CompletionToolPlannerOptions
): CompletionToolPlanner | null {
  if (config.provider === 'ollama') {
    return null;
  }

  return async (request: CompletionToolPlannerRequest): Promise<CompletionToolPlannerResponse> => {
    const operationId = createOperationId('tool_planner');
    const operationName = options?.operationName?.trim() || 'tool_planner';
    const startedAt = Date.now();
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

    let finalError = '';
    let aborted = false;
    const url = resolveOpenAiCompletionsUrl(config.endpoint);
    const requestBody: Record<string, unknown> = {
      model: config.model,
      messages: convertPlannerMessages(request.messages),
      tools: request.toolDefinitions,
      tool_choice: 'auto',
      temperature: 0,
      max_tokens: 240,
      stream: false
    };
    let responseBody: unknown;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        finalError = `Retrieval tool planner request failed (${response.status}): ${text}`;
        throw new Error(`Retrieval tool planner request failed (${response.status}): ${text}`);
      }

      const payload = await response.json();
      responseBody = payload;
      return parsePlannerResponse(payload);
    } catch (error) {
      if (timedOut) {
        finalError = `Retrieval tool planner request timed out after ${timeoutMs}ms.`;
        throw new Error(finalError);
      }
      if (request.abortSignal?.aborted) {
        finalError = 'Retrieval tool planner request was aborted.';
        aborted = true;
        throw new Error(finalError);
      }
      const normalized = normalizeRequestError(error, timeoutMs);
      finalError = normalized.message;
      aborted = isAbortLikeError(normalized);
      throw normalized;
    } finally {
      request.abortSignal?.removeEventListener('abort', abortHandler);
      window.clearTimeout(timer);
      const finishedAt = Date.now();
      await emitOperationLog(options?.onOperationLog, {
        id: operationId,
        kind: 'tool_planner',
        operationName,
        provider: config.provider,
        model: config.model,
        endpoint: config.endpoint,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        status: finalError ? 'error' : 'ok',
        aborted,
        ...(finalError ? { error: finalError } : {}),
        request: {
          messages: request.messages,
          toolDefinitions: request.toolDefinitions
        },
        attempts: [{
          index: 1,
          url,
          requestBody,
          ...(responseBody !== undefined ? { responseBody } : {}),
          ...(finalError ? { error: finalError } : {})
        }]
      });
    }
  };
}

export function createCompletionRetrievalToolPlanner(
  config: ConverterSettings['completion'],
  options?: CompletionToolPlannerOptions
): RetrievalToolPlanner | null {
  const planner = createCompletionToolPlanner(config, options);
  if (!planner) {
    return null;
  }

  return async (request: RetrievalToolPlannerRequest): Promise<RetrievalToolPlannerResponse> => {
    const response = await planner({
      messages: request.messages,
      toolDefinitions: request.toolDefinitions,
      timeoutMs: request.timeoutMs,
      abortSignal: request.abortSignal
    });
    return {
      assistantText: response.assistantText,
      toolCalls: response.toolCalls as RetrievalToolPlannerResponse['toolCalls'],
      finishReason: response.finishReason
    };
  };
}
