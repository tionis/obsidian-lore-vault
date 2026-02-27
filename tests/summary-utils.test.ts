import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSummarySectionFromBody,
  normalizeGeneratedSummaryText,
  sanitizeSummaryModelOutput,
  stripSummarySectionFromBody,
  upsertSummarySectionInMarkdown
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

test('summary section helpers extract and strip deterministic summary blocks', () => {
  const body = [
    '# Character',
    '',
    '## Summary',
    '',
    'Baalthasar is a dark elven archmage.',
    '',
    '## Details',
    '',
    'Full details body.'
  ].join('\n');

  assert.equal(
    extractSummarySectionFromBody(body),
    'Baalthasar is a dark elven archmage.'
  );
  assert.equal(
    stripSummarySectionFromBody(body),
    ['# Character', '', '## Details', '', 'Full details body.'].join('\n')
  );
});

test('summary section extraction only reads the first summary paragraph', () => {
  const delimited = [
    '# Character',
    '',
    '## Summary',
    '',
    'Line one of summary.',
    'Line two of same paragraph.',
    '',
    'Body paragraph starts here.',
    'More body.'
  ].join('\n');

  assert.equal(
    extractSummarySectionFromBody(delimited),
    'Line one of summary. Line two of same paragraph.'
  );
  assert.equal(
    stripSummarySectionFromBody(delimited),
    ['# Character', '', 'Body paragraph starts here.', 'More body.'].join('\n')
  );

  const noDelimiter = [
    '# Character',
    '',
    '## Summary',
    '',
    'Summary first line only.',
    'Body continues without blank delimiter.',
    'Still body content.'
  ].join('\n');

  assert.equal(
    extractSummarySectionFromBody(noDelimiter),
    'Summary first line only.'
  );
  assert.equal(
    stripSummarySectionFromBody(noDelimiter),
    ['# Character', '', 'Body continues without blank delimiter.', 'Still body content.'].join('\n')
  );
});

test('upsertSummarySectionInMarkdown places summary after first h1 and replaces existing summary section', () => {
  const withH1 = [
    '---',
    'title: Character',
    '---',
    '# Baalthasar',
    '',
    'Intro paragraph.',
    '',
    '## History',
    '',
    'Old history.'
  ].join('\n');

  const inserted = upsertSummarySectionInMarkdown(withH1, 'Canonical compact summary.');
  assert.ok(inserted.includes('# Baalthasar\n\n## Summary\n\nCanonical compact summary.\n\nIntro paragraph.'));

  const replaced = upsertSummarySectionInMarkdown(inserted, 'Updated summary text.');
  assert.ok(!replaced.includes('Canonical compact summary.'));
  assert.ok(replaced.includes('## Summary\n\nUpdated summary text.'));
});

test('upsertSummarySectionInMarkdown writes exactly one summary paragraph', () => {
  const source = [
    '# Title',
    '',
    'Body starts here.'
  ].join('\n');

  const inserted = upsertSummarySectionInMarkdown(
    source,
    'First summary line.\nSecond summary line.\n\nIgnored second paragraph.'
  );

  assert.ok(inserted.includes('## Summary\n\nFirst summary line. Second summary line.\n\nBody starts here.'));
  assert.equal(inserted.includes('Ignored second paragraph.'), false);
});
