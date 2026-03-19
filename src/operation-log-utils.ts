import type { CompletionOperationLogRecord } from './completion-provider';

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

export function buildOperationLogSearchText(record: CompletionOperationLogRecord): string {
  const parts = [
    record.id,
    record.costProfile ?? '',
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

export function tokenizeOperationLogSearchQuery(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function buildOperationLogFtsMatchQuery(tokens: readonly string[]): string {
  return tokens
    .map(token => token.trim())
    .filter(Boolean)
    .map(token => `"${token.replace(/"/g, '""')}"`)
    .join(' AND ');
}
