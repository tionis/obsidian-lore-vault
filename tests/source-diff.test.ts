import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceDiffPreview } from '../src/source-diff';

test('buildSourceDiffPreview returns deterministic no-change result', () => {
  const diff = buildSourceDiffPreview('A\nB', 'A\nB');
  assert.equal(diff.addedLines, 0);
  assert.equal(diff.removedLines, 0);
  assert.equal(diff.truncated, false);
  assert.equal(diff.hunks.length, 0);
  assert.equal(diff.preview, '(no changes)');
});

test('buildSourceDiffPreview builds side-by-side hunks with replacements and additions', () => {
  const diff = buildSourceDiffPreview(
    ['Line A', 'Line B', 'Line C'].join('\n'),
    ['Line A', 'Line B revised', 'Line C', 'Line D'].join('\n')
  );

  assert.equal(diff.addedLines, 2);
  assert.equal(diff.removedLines, 1);
  assert.equal(diff.hunks.length > 0, true);
  assert.match(diff.preview, /-Line B/);
  assert.match(diff.preview, /\+Line B revised/);
  assert.match(diff.preview, /\+Line D/);
});

test('buildSourceDiffPreview inserts omitted markers when unchanged ranges are hidden', () => {
  const before = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'].join('\n');
  const after = ['A1', 'A2', 'A3', 'CHANGED', 'A5', 'A6', 'A7'].join('\n');
  const diff = buildSourceDiffPreview(before, after, {
    contextLines: 1
  });

  const rowTypes = diff.hunks.flatMap(hunk => hunk.rows.map(row => row.type));
  assert.equal(rowTypes.includes('omitted'), true);
  assert.match(diff.preview, /\.\.\. \[\d+ unchanged line\(s\) omitted\]/);
});

test('buildSourceDiffPreview enforces max render rows deterministically', () => {
  const before = Array.from({ length: 120 }, (_, index) => `line-${index + 1}`).join('\n');
  const after = Array.from({ length: 120 }, (_, index) => `line-${index + 1}-updated`).join('\n');
  const diff = buildSourceDiffPreview(before, after, {
    contextLines: 0,
    maxRenderRows: 40
  });

  assert.equal(diff.truncated, true);
  assert.match(diff.preview, /\.\.\. \[truncated\]$/);
});
