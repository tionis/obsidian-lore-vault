import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDeterministicOverflow,
  estimateTextTokens,
  toPromptLayerUsage,
  trimTextForTokenBudget
} from '../src/prompt-staging';

test('applyDeterministicOverflow trims in deterministic order and keeps locked layer', () => {
  const long = 'x'.repeat(1200);
  const segments = [
    {
      key: 'pinned',
      label: 'Pinned',
      content: long,
      reservedTokens: 500,
      placement: 'system' as const,
      trimMode: 'head' as const,
      minTokens: 40,
      locked: true
    },
    {
      key: 'retrieval',
      label: 'Retrieval',
      content: long,
      reservedTokens: 500,
      placement: 'pre_response' as const,
      trimMode: 'head' as const,
      minTokens: 0
    },
    {
      key: 'history',
      label: 'History',
      content: long,
      reservedTokens: 500,
      placement: 'pre_history' as const,
      trimMode: 'tail' as const,
      minTokens: 30
    }
  ];

  const maxTokens = 400;
  const result = applyDeterministicOverflow(segments, maxTokens, ['retrieval', 'history', 'pinned']);

  assert.ok(result.totalTokens <= maxTokens);
  const pinned = result.segments.find(item => item.key === 'pinned');
  const retrieval = result.segments.find(item => item.key === 'retrieval');
  const history = result.segments.find(item => item.key === 'history');

  assert.ok(pinned);
  assert.ok(retrieval);
  assert.ok(history);
  assert.equal(Boolean(pinned?.trimmed), false);
  assert.equal(Boolean(retrieval?.trimmed), true);
  assert.ok(result.trace[0]?.startsWith('retrieval: trimmed'));
});

test('trimTextForTokenBudget keeps head/tail deterministically', () => {
  const source = 'AAAA BBBB CCCC DDDD EEEE FFFF';
  const head = trimTextForTokenBudget(source, 4, 'head');
  const tail = trimTextForTokenBudget(source, 4, 'tail');
  assert.notEqual(head, tail);
  assert.ok(head.startsWith('AAAA'));
  assert.ok(tail.endsWith('FFFF'));
});

test('toPromptLayerUsage reports headroom and trim metadata', () => {
  const usage = toPromptLayerUsage([
    {
      key: 'scene',
      label: 'Scene Intent',
      content: 'Keep tension high.',
      reservedTokens: 60,
      placement: 'pre_response',
      trimmed: true,
      trimReason: 'overflow (40 -> 20)'
    }
  ]);

  assert.equal(usage.length, 1);
  assert.equal(usage[0].layer, 'Scene Intent');
  assert.equal(usage[0].placement, 'pre_response');
  assert.equal(usage[0].reservedTokens, 60);
  assert.equal(usage[0].usedTokens, estimateTextTokens('Keep tension high.'));
  assert.equal(usage[0].trimmed, true);
  assert.equal(usage[0].trimReason, 'overflow (40 -> 20)');
  assert.ok(usage[0].headroomTokens >= 0);
});

