import test from 'node:test';
import assert from 'node:assert/strict';
import { CompletionPreset, ConverterSettings, DEFAULT_SETTINGS } from '../src/models';
import {
  cloneReasoningConfig,
  normalizeCompletionPreset,
  resolveDeviceCompletionFallback
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

test('resolveDeviceCompletionFallback applies the Story Writing device preset', () => {
  const baseCompletion: ConverterSettings['completion'] = {
    ...DEFAULT_SETTINGS.completion,
    model: 'base-model',
    contextWindowTokens: 32000,
    maxOutputTokens: 1200,
    promptReserveTokens: 1500
  };
  const devicePreset = createPreset({
    id: 'device-preset',
    name: 'Device Preset',
    model: 'device-model',
    contextWindowTokens: 128000,
    maxOutputTokens: 4096,
    promptReserveTokens: 2048
  });

  const resolution = resolveDeviceCompletionFallback(
    baseCompletion,
    'device-preset',
    presetId => (presetId === devicePreset.id ? devicePreset : null),
    (base, preset) => ({
      ...base,
      model: preset.model,
      contextWindowTokens: preset.contextWindowTokens,
      maxOutputTokens: preset.maxOutputTokens,
      promptReserveTokens: preset.promptReserveTokens
    })
  );

  assert.equal(resolution.source, 'device');
  assert.equal(resolution.presetId, 'device-preset');
  assert.equal(resolution.presetName, 'Device Preset');
  assert.equal(resolution.completion.model, 'device-model');
  assert.equal(resolution.completion.contextWindowTokens, 128000);
  assert.equal(resolution.completion.maxOutputTokens, 4096);
  assert.equal(resolution.completion.promptReserveTokens, 2048);
});
