import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../src/models';
import {
  buildGeneratedSummarySignature,
  normalizeGeneratedSummaryText,
  sanitizeSummaryModelOutput
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

test('sanitizeSummaryModelOutput removes reasoning preambles and think blocks', () => {
  const reasoningOutput = [
    'I need to create a concise canonical summary of Baalthasar.',
    '1. Baalthasar is a dark elven Archmage.',
    '2. His mind magic is nearly unmatched.',
    'Baalthasar is a dark elven Archmage whose unrivaled mind magic and broad arcana mastery make him a decisive strategic force.'
  ].join(' ');

  const sanitizedReasoning = sanitizeSummaryModelOutput(reasoningOutput);
  assert.equal(
    sanitizedReasoning,
    'Baalthasar is a dark elven Archmage whose unrivaled mind magic and broad arcana mastery make him a decisive strategic force.'
  );

  const thinkTagged = '<think>internal reasoning</think> Summary: Rowan is a veteran captain who fortifies the old tower and coordinates city defense.';
  const sanitizedThink = sanitizeSummaryModelOutput(thinkTagged);
  assert.equal(
    sanitizedThink,
    'Rowan is a veteran captain who fortifies the old tower and coordinates city defense.'
  );
});
