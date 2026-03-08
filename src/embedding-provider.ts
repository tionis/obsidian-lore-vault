import { ConverterSettings } from './models';
import {
  CompletionUsageReport,
  CompletionOperationLogAttempt,
  CompletionOperationLogRecord,
  CompletionOperationLogger
} from './completion-provider';

export interface EmbeddingRequest {
  texts: string[];
  instruction: string;
  operationName?: string;
  onOperationLog?: CompletionOperationLogger;
  onUsage?: (usage: CompletionUsageReport) => void;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function createOperationId(): string {
  return `embedding-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
    console.warn('LoreVault: Failed to write embedding operation log:', error);
  }
}

function withInstruction(text: string, instruction: string): string {
  if (!instruction) {
    return text;
  }
  return `${instruction}\n\n${text}`;
}

function parseOpenAiStyleEmbeddings(payload: any): number[][] {
  if (Array.isArray(payload?.data)) {
    const rows = payload.data
      .map((item: any) => item?.embedding)
      .filter((vector: any) => Array.isArray(vector));
    if (rows.length > 0) {
      return rows;
    }
  }

  if (Array.isArray(payload?.embeddings)) {
    return payload.embeddings;
  }

  throw new Error('Embedding response did not contain data[].embedding or embeddings[].');
}

function parseOllamaEmbeddings(payload: any): number[][] {
  if (Array.isArray(payload?.embeddings)) {
    return payload.embeddings;
  }
  if (Array.isArray(payload?.embedding)) {
    return [payload.embedding];
  }
  return parseOpenAiStyleEmbeddings(payload);
}

function ensureVectorCount(vectors: number[][], expected: number): number[][] {
  if (vectors.length !== expected) {
    throw new Error(`Embedding vector count mismatch: expected ${expected}, got ${vectors.length}.`);
  }
  return vectors;
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
  const totalTokensRaw = asFiniteNumber(usage.total_tokens);
  const completionTokensRaw = asFiniteNumber(usage.completion_tokens ?? usage.output_tokens);

  if (promptTokensRaw === null && totalTokensRaw === null && completionTokensRaw === null) {
    return null;
  }

  const promptTokens = Math.max(
    0,
    Math.floor(promptTokensRaw ?? Math.max(0, (totalTokensRaw ?? 0) - (completionTokensRaw ?? 0)))
  );
  const completionTokens = Math.max(0, Math.floor(completionTokensRaw ?? 0));
  const totalTokens = Math.max(
    0,
    Math.floor(totalTokensRaw ?? (promptTokens + completionTokens))
  );

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    reportedCostUsd: extractReportedCostUsd(payload),
    cachedReadTokens: 0,
    cacheWriteTokens: 0
  };
}

function parseOllamaUsage(payload: any): Omit<CompletionUsageReport, 'provider' | 'model' | 'source'> | null {
  const promptTokensRaw = asFiniteNumber(
    payload?.prompt_eval_count
    ?? payload?.usage?.prompt_tokens
    ?? payload?.usage?.input_tokens
  );
  const completionTokensRaw = asFiniteNumber(
    payload?.eval_count
    ?? payload?.usage?.completion_tokens
    ?? payload?.usage?.output_tokens
  );
  const totalTokensRaw = asFiniteNumber(payload?.usage?.total_tokens);

  if (promptTokensRaw === null && completionTokensRaw === null && totalTokensRaw === null) {
    return null;
  }

  const promptTokens = Math.max(
    0,
    Math.floor(promptTokensRaw ?? Math.max(0, (totalTokensRaw ?? 0) - (completionTokensRaw ?? 0)))
  );
  const completionTokens = Math.max(0, Math.floor(completionTokensRaw ?? 0));
  const totalTokens = Math.max(
    0,
    Math.floor(totalTokensRaw ?? (promptTokens + completionTokens))
  );

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    reportedCostUsd: extractReportedCostUsd(payload),
    cachedReadTokens: 0,
    cacheWriteTokens: 0
  };
}

async function fetchJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
  attempt: CompletionOperationLogAttempt
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text();
      attempt.responseText = text;
      try {
        attempt.responseBody = JSON.parse(text);
      } catch (_error) {
        // Keep responseText when payload is not JSON.
      }
      throw new Error(`Embedding request failed (${response.status}): ${text}`);
    }

    const payload = await response.json();
    attempt.responseBody = payload;
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function resolveOpenAiEmbeddingsUrl(endpoint: string): string {
  const trimmed = trimTrailingSlash(endpoint);
  if (trimmed.endsWith('/embeddings')) {
    return trimmed;
  }
  return `${trimmed}/embeddings`;
}

function resolveOllamaEmbedUrl(endpoint: string): string {
  const trimmed = trimTrailingSlash(endpoint);
  if (trimmed.endsWith('/api/embed')) {
    return trimmed;
  }
  if (trimmed.endsWith('/api')) {
    return `${trimmed}/embed`;
  }
  return `${trimmed}/api/embed`;
}

export async function requestEmbeddings(
  config: ConverterSettings['embeddings'],
  request: EmbeddingRequest
): Promise<number[][]> {
  const operationId = createOperationId();
  const operationName = request.operationName?.trim() || 'embeddings';
  const startedAt = Date.now();
  const texts = request.texts.map(text => withInstruction(text, request.instruction));
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const attempts: CompletionOperationLogAttempt[] = [];
  let finalError = '';
  let aborted = false;
  let vectors: number[][] = [];
  let usage: CompletionUsageReport | null = null;

  try {
    if (config.provider === 'ollama') {
      const url = resolveOllamaEmbedUrl(config.endpoint);
      const body = {
        model: config.model,
        input: texts
      };
      const attempt: CompletionOperationLogAttempt = {
        index: 1,
        url,
        requestBody: body
      };
      attempts.push(attempt);
      const payload = await fetchJson(url, body, headers, config.timeoutMs, attempt);
      vectors = ensureVectorCount(parseOllamaEmbeddings(payload), texts.length);
      const parsedUsage = parseOllamaUsage(payload);
      if (parsedUsage) {
        usage = {
          provider: config.provider,
          model: config.model,
          source: 'ollama_usage',
          ...parsedUsage
        };
        request.onUsage?.(usage);
      }
      return vectors;
    }

    const url = resolveOpenAiEmbeddingsUrl(config.endpoint);
    const body = {
      model: config.model,
      input: texts
    };
    const attempt: CompletionOperationLogAttempt = {
      index: 1,
      url,
      requestBody: body
    };
    attempts.push(attempt);
    const payload = await fetchJson(url, body, headers, config.timeoutMs, attempt);
    vectors = ensureVectorCount(parseOpenAiStyleEmbeddings(payload), texts.length);
    const parsedUsage = parseOpenAiUsage(payload);
    if (parsedUsage) {
      usage = {
        provider: config.provider,
        model: config.model,
        source: 'openai_usage',
        ...parsedUsage
      };
      request.onUsage?.(usage);
    }
    return vectors;
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
      kind: 'embedding',
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
        texts,
        textCount: texts.length,
        instruction: request.instruction
      },
      usage,
      attempts
    });
  }
}
