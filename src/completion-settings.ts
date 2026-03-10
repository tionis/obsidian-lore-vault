import { CompletionPreset, ConverterSettings, DEFAULT_SETTINGS } from './models';

const VALID_REASONING_EFFORTS = new Set([
  'xhigh',
  'high',
  'medium',
  'low',
  'minimal',
  'none'
]);

export function cloneReasoningConfig(
  reasoning: ConverterSettings['completion']['reasoning'] | CompletionPreset['reasoning'] | null | undefined
): ConverterSettings['completion']['reasoning'] {
  if (!reasoning) {
    return undefined;
  }
  return {
    ...reasoning
  };
}

export function normalizeReasoningConfig(
  value: unknown
): ConverterSettings['completion']['reasoning'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Partial<NonNullable<ConverterSettings['completion']['reasoning']>>;
  if (!candidate.enabled) {
    return undefined;
  }
  const effort = typeof candidate.effort === 'string' && VALID_REASONING_EFFORTS.has(candidate.effort)
    ? candidate.effort
    : 'medium';
  const maxTokensCandidate = Number(candidate.maxTokens);
  const maxTokens = Number.isFinite(maxTokensCandidate)
    ? Math.max(0, Math.floor(maxTokensCandidate))
    : 0;
  return {
    enabled: true,
    effort,
    ...(maxTokens > 0 ? { maxTokens } : {}),
    ...(candidate.exclude ? { exclude: true } : {})
  };
}

export function normalizeCompletionPreset(
  rawPreset: unknown,
  options: {
    buildDefaultSecretName: (presetId: string) => string;
    normalizeSecretIdentifier: (value: unknown, fallback: string) => string;
    fallbackId: () => string;
  }
): CompletionPreset | null {
  if (!rawPreset || typeof rawPreset !== 'object') {
    return null;
  }
  const candidate = rawPreset as Partial<CompletionPreset>;
  const id = typeof candidate.id === 'string' && candidate.id.trim()
    ? candidate.id.trim()
    : options.fallbackId();
  const name = typeof candidate.name === 'string' && candidate.name.trim()
    ? candidate.name.trim()
    : 'Preset';
  const provider: CompletionPreset['provider'] = (
    candidate.provider === 'ollama' ||
    candidate.provider === 'openai_compatible'
  ) ? candidate.provider : 'openrouter';
  return {
    id,
    name,
    provider,
    endpoint: (candidate.endpoint ?? DEFAULT_SETTINGS.completion.endpoint).toString().trim() || DEFAULT_SETTINGS.completion.endpoint,
    apiKey: (candidate.apiKey ?? '').toString().trim(),
    apiKeySecretName: options.normalizeSecretIdentifier(
      candidate.apiKeySecretName,
      options.buildDefaultSecretName(id)
    ),
    model: (candidate.model ?? DEFAULT_SETTINGS.completion.model).toString().trim() || DEFAULT_SETTINGS.completion.model,
    systemPrompt: (candidate.systemPrompt ?? DEFAULT_SETTINGS.completion.systemPrompt).toString().trim() || DEFAULT_SETTINGS.completion.systemPrompt,
    temperature: Math.max(0, Math.min(2, Number(candidate.temperature ?? DEFAULT_SETTINGS.completion.temperature))),
    maxOutputTokens: Math.max(64, Math.floor(Number(candidate.maxOutputTokens ?? DEFAULT_SETTINGS.completion.maxOutputTokens))),
    contextWindowTokens: Math.max(
      Math.max(64, Math.floor(Number(candidate.maxOutputTokens ?? DEFAULT_SETTINGS.completion.maxOutputTokens))) + 512,
      Math.floor(Number(candidate.contextWindowTokens ?? DEFAULT_SETTINGS.completion.contextWindowTokens))
    ),
    promptReserveTokens: Math.max(0, Math.floor(Number(candidate.promptReserveTokens ?? DEFAULT_SETTINGS.completion.promptReserveTokens))),
    timeoutMs: Math.max(1000, Math.floor(Number(candidate.timeoutMs ?? DEFAULT_SETTINGS.completion.timeoutMs))),
    promptCachingEnabled: Boolean(
      candidate.promptCachingEnabled
      ?? DEFAULT_SETTINGS.completion.promptCachingEnabled
    ),
    providerRouting: (candidate.providerRouting ?? DEFAULT_SETTINGS.completion.providerRouting)
      .toString()
      .trim(),
    reasoning: normalizeReasoningConfig(candidate.reasoning)
  };
}
