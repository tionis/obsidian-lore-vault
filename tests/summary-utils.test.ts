import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGeneratedSummaryText,
  sanitizeSummaryModelOutput
} from '../src/summary-utils';

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
