import type {
  CompletionOperationKind,
  CompletionOperationLogAttempt,
  CompletionOperationLogRecord,
  CompletionUsageReport
} from './completion-provider';

export interface ParsedOperationLogEntry {
  lineNumber: number;
  record: CompletionOperationLogRecord;
  searchText: string;
}

export interface OperationLogParseIssue {
  lineNumber: number;
  reason: string;
  linePreview: string;
}

export interface ParseOperationLogJsonlResult {
  entries: ParsedOperationLogEntry[];
  issues: OperationLogParseIssue[];
  totalLines: number;
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  return fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  return fallback;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function coerceKind(value: unknown): CompletionOperationKind {
  if (value === 'completion' || value === 'completion_stream' || value === 'tool_planner') {
    return value;
  }
  return 'completion';
}

function coerceProvider(value: unknown): 'openrouter' | 'ollama' | 'openai_compatible' {
  if (value === 'ollama' || value === 'openai_compatible') {
    return value;
  }
  return 'openrouter';
}

function coerceStatus(value: unknown): 'ok' | 'error' {
  return value === 'error' ? 'error' : 'ok';
}

function coerceUsage(value: unknown): CompletionUsageReport | null {
  const source = asObject(value);
  if (!source) {
    return null;
  }
  return {
    provider: coerceProvider(source.provider),
    model: asString(source.model, ''),
    promptTokens: Math.max(0, Math.floor(asNumber(source.promptTokens, 0))),
    completionTokens: Math.max(0, Math.floor(asNumber(source.completionTokens, 0))),
    totalTokens: Math.max(0, Math.floor(asNumber(source.totalTokens, 0))),
    reportedCostUsd: typeof source.reportedCostUsd === 'number' && Number.isFinite(source.reportedCostUsd)
      ? source.reportedCostUsd
      : null,
    source: source.source === 'ollama_usage' ? 'ollama_usage' : 'openai_usage'
  };
}

function coerceAttempt(value: unknown, index: number): CompletionOperationLogAttempt {
  const source = asObject(value) ?? {};
  const attempt: CompletionOperationLogAttempt = {
    index: Math.max(0, Math.floor(asNumber(source.index, index))),
    url: asString(source.url, ''),
    requestBody: source.requestBody ?? null
  };
  if ('responseBody' in source) {
    attempt.responseBody = source.responseBody;
  }
  if (typeof source.responseText === 'string') {
    attempt.responseText = source.responseText;
  }
  if (typeof source.error === 'string') {
    attempt.error = source.error;
  }
  return attempt;
}

function clampPreview(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}...`;
}

function safeJsonString(value: unknown, maxChars: number): string {
  try {
    return clampPreview(JSON.stringify(value), maxChars);
  } catch {
    return '';
  }
}

function buildSearchText(record: CompletionOperationLogRecord): string {
  const parts = [
    record.id,
    record.kind,
    record.operationName,
    record.provider,
    record.model,
    record.endpoint,
    record.status,
    record.error ?? '',
    record.finalText ?? '',
    safeJsonString(record.request, 4000),
    safeJsonString(record.attempts, 4000)
  ]
    .filter(Boolean)
    .map(part => part.toLowerCase());
  return parts.join('\n');
}

function coerceRecord(value: unknown, lineNumber: number): CompletionOperationLogRecord | null {
  const source = asObject(value);
  if (!source) {
    return null;
  }

  const startedAt = Math.max(0, Math.floor(asNumber(source.startedAt, 0)));
  const finishedAtFallback = startedAt > 0 ? startedAt : Date.now();
  const finishedAt = Math.max(0, Math.floor(asNumber(source.finishedAt, finishedAtFallback)));
  const durationFallback = Math.max(0, finishedAt - startedAt);
  const durationMs = Math.max(0, Math.floor(asNumber(source.durationMs, durationFallback)));
  const requestObject = asObject(source.request);
  const attempts = Array.isArray(source.attempts)
    ? source.attempts.map((attempt, index) => coerceAttempt(attempt, index))
    : [];

  const record: CompletionOperationLogRecord = {
    id: asString(source.id, `line-${lineNumber}`),
    kind: coerceKind(source.kind),
    operationName: asString(source.operationName, 'unknown_operation'),
    provider: coerceProvider(source.provider),
    model: asString(source.model, ''),
    endpoint: asString(source.endpoint, ''),
    startedAt,
    finishedAt,
    durationMs,
    status: coerceStatus(source.status),
    aborted: asBoolean(source.aborted, false),
    request: requestObject ?? { value: source.request ?? null },
    attempts
  };

  if (typeof source.error === 'string') {
    record.error = source.error;
  }
  if (typeof source.finalText === 'string') {
    record.finalText = source.finalText;
  }
  const usage = coerceUsage(source.usage);
  if (usage) {
    record.usage = usage;
  }
  return record;
}

export function parseOperationLogJsonl(raw: string): ParseOperationLogJsonlResult {
  const normalized = raw.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const entries: ParsedOperationLogEntry[] = [];
  const issues: OperationLogParseIssue[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index].trim();
    if (!line) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      const record = coerceRecord(parsed, lineNumber);
      if (!record) {
        issues.push({
          lineNumber,
          reason: 'line is valid JSON but not an object record',
          linePreview: clampPreview(line, 160)
        });
        continue;
      }
      entries.push({
        lineNumber,
        record,
        searchText: buildSearchText(record)
      });
    } catch (error) {
      issues.push({
        lineNumber,
        reason: error instanceof Error ? error.message : 'invalid JSON',
        linePreview: clampPreview(line, 160)
      });
    }
  }

  entries.sort((a, b) =>
    b.record.startedAt - a.record.startedAt
    || b.record.finishedAt - a.record.finishedAt
    || b.lineNumber - a.lineNumber
  );

  return {
    entries,
    issues,
    totalLines: lines.length
  };
}
