import { ConverterSettings } from './models';

export interface EmbeddingRequest {
  texts: string[];
  instruction: string;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
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

async function fetchJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number
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
      throw new Error(`Embedding request failed (${response.status}): ${text}`);
    }

    return await response.json();
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
  const texts = request.texts.map(text => withInstruction(text, request.instruction));
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  if (config.provider === 'ollama') {
    const url = resolveOllamaEmbedUrl(config.endpoint);
    const payload = await fetchJson(url, {
      model: config.model,
      input: texts
    }, headers, config.timeoutMs);
    return ensureVectorCount(parseOllamaEmbeddings(payload), texts.length);
  }

  const url = resolveOpenAiEmbeddingsUrl(config.endpoint);
  const payload = await fetchJson(url, {
    model: config.model,
    input: texts
  }, headers, config.timeoutMs);
  return ensureVectorCount(parseOpenAiStyleEmbeddings(payload), texts.length);
}
