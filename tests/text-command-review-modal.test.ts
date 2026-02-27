import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTextCommandDiffPreview } from '../src/text-command-diff';

test('buildTextCommandDiffPreview reports no-change case deterministically', () => {
  const preview = buildTextCommandDiffPreview('Line A\nLine B', 'Line A\nLine B');
  assert.equal(preview.addedLines, 0);
  assert.equal(preview.removedLines, 0);
  assert.equal(preview.preview, '(no changes)');
  assert.equal(preview.truncated, false);
});

test('buildTextCommandDiffPreview reports changed lines with unified snippet', () => {
  const preview = buildTextCommandDiffPreview(
    ['Line A', 'Line B', 'Line C'].join('\n'),
    ['Line A', 'Line B revised', 'Line C', 'Line D'].join('\n')
  );
  assert.equal(preview.addedLines > 0, true);
  assert.equal(preview.removedLines > 0, true);
  assert.match(preview.preview, /^@@ -2,\d+ \+2,\d+ @@/);
  assert.match(preview.preview, /-Line B/);
  assert.match(preview.preview, /\+Line B revised/);
  assert.match(preview.preview, /\+Line D/);
});
