import test from 'node:test';
import assert from 'node:assert/strict';
import { CompletionPreset, ConverterSettings, DEFAULT_SETTINGS } from '../src/models';
import {
  cloneReasoningConfig,
  normalizeCompletionPreset
} from '../src/completion-settings';

function createPreset(overrides: Partial<CompletionPreset> = {}): CompletionPreset {
  return {
    id: 'preset-test',
    name: 'Preset Test',
    provider: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1',
    apiKey: '',
    apiKeySecretName: 'preset-test-secret',
    model: 'openai/o3-mini',
    systemPrompt: 'Write clean prose.',
    temperature: 0.7,
    maxOutputTokens: 2048,
    contextWindowTokens: 128000,
    promptReserveTokens: 1024,
    timeoutMs: 45000,
    promptCachingEnabled: false,
    providerRouting: 'anthropic,google',
    reasoning: {
      enabled: true,
      effort: 'high',
      maxTokens: 4096,
      exclude: true
    },
    ...overrides
  };
}

test('mergeSettings preserves preset reasoning and provider request options', () => {
  const preset = normalizeCompletionPreset(createPreset(), {
    buildDefaultSecretName: id => `default-${id}`,
    normalizeSecretIdentifier: (value, fallback) => String(value ?? fallback).trim(),
    fallbackId: () => 'fallback-id'
  });

  assert.ok(preset);
  assert.equal(preset?.promptCachingEnabled, false);
  assert.equal(preset?.providerRouting, 'anthropic,google');
  assert.deepEqual(preset?.reasoning, {
    enabled: true,
    effort: 'high',
    maxTokens: 4096,
    exclude: true
  });
});

test('cloneReasoningConfig returns an independent copy', () => {
  const preset = createPreset();
  const applied = {
    ...DEFAULT_SETTINGS.completion,
    reasoning: cloneReasoningConfig(preset.reasoning)
  } satisfies ConverterSettings['completion'];

  assert.notEqual(applied.reasoning, preset.reasoning);
  assert.deepEqual(applied.reasoning, preset.reasoning);

  if (!applied.reasoning) {
    throw new Error('Expected reasoning config to be present.');
  }
  applied.reasoning.effort = 'minimal';
  assert.equal(preset.reasoning?.effort, 'high');
});
