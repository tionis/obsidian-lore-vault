import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../src/models';
import {
  buildGeneratedSummarySignature,
  normalizeGeneratedSummaryText
} from '../src/summary-utils';

test('buildGeneratedSummarySignature is deterministic and sensitive to settings/model/body', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    completion: {
      ...DEFAULT_SETTINGS.completion,
      model: 'model-a'
    }
  };

  const base = buildGeneratedSummarySignature('world_info', 'Body text', settings);
  const same = buildGeneratedSummarySignature('world_info', 'Body text', settings);
  assert.equal(base, same);

  const differentBody = buildGeneratedSummarySignature('world_info', 'Body text 2', settings);
  assert.notEqual(base, differentBody);

  const differentMode = buildGeneratedSummarySignature('chapter', 'Body text', settings);
  assert.notEqual(base, differentMode);

  const differentModel = buildGeneratedSummarySignature('world_info', 'Body text', {
    ...settings,
    completion: {
      ...settings.completion,
      model: 'model-b'
    }
  });
  assert.notEqual(base, differentModel);
});

test('normalizeGeneratedSummaryText flattens whitespace and enforces max chars', () => {
  const normalized = normalizeGeneratedSummaryText('  Line 1\n\nLine   2\tLine 3  ', 80);
  assert.equal(normalized, 'Line 1 Line 2 Line 3');

  const clipped = normalizeGeneratedSummaryText('A'.repeat(200), 100);
  assert.ok(clipped.length <= 103);
  assert.ok(clipped.endsWith('...'));
});
