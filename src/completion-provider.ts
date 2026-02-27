import { ConverterSettings } from './models';

export interface StoryCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
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
