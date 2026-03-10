import test from 'node:test';
import assert from 'node:assert/strict';
import {
  doesTextCommandSelectionMatchSnapshot,
  replaceTextCommandTargetRange,
  TextCommandTargetSnapshot
} from '../src/text-command-target';

test('replaceTextCommandTargetRange replaces the captured selection deterministically', () => {
  const snapshot: TextCommandTargetSnapshot = {
    filePath: 'Stories/Scene.md',
    from: { line: 1, ch: 0 },
    to: { line: 1, ch: 6 },
    originalText: 'Line B'
  };

  const result = replaceTextCommandTargetRange(
    ['Line A', 'Line B', 'Line C'].join('\n'),
    snapshot,
    'Line B revised'
  );

  assert.deepEqual(result, {
    ok: true,
    text: ['Line A', 'Line B revised', 'Line C'].join('\n')
  });
});

test('replaceTextCommandTargetRange reports selection mismatch when source text drifted', () => {
  const snapshot: TextCommandTargetSnapshot = {
    filePath: 'Stories/Scene.md',
    from: { line: 1, ch: 0 },
    to: { line: 1, ch: 6 },
    originalText: 'Line B'
  };

  const result = replaceTextCommandTargetRange(
    ['Line A', 'Line X', 'Line C'].join('\n'),
    snapshot,
    'Line B revised'
  );

  assert.deepEqual(result, {
    ok: false,
    reason: 'selection_mismatch'
  });
});

test('replaceTextCommandTargetRange reports line overflow deterministically', () => {
  const snapshot: TextCommandTargetSnapshot = {
    filePath: 'Stories/Scene.md',
    from: { line: 4, ch: 0 },
    to: { line: 4, ch: 1 },
    originalText: 'X'
  };

  const result = replaceTextCommandTargetRange('Line A\nLine B', snapshot, 'Y');

  assert.deepEqual(result, {
    ok: false,
    reason: 'line_out_of_range'
  });
});

test('doesTextCommandSelectionMatchSnapshot requires exact file, range, and text match', () => {
  const snapshot: TextCommandTargetSnapshot = {
    filePath: 'Stories/Scene.md',
    from: { line: 0, ch: 1 },
    to: { line: 0, ch: 4 },
    originalText: 'ine'
  };

  assert.equal(
    doesTextCommandSelectionMatchSnapshot(
      snapshot,
      'Stories/Scene.md',
      { line: 0, ch: 1 },
      { line: 0, ch: 4 },
      'ine'
    ),
    true
  );

  assert.equal(
    doesTextCommandSelectionMatchSnapshot(
      snapshot,
      'Stories/Other.md',
      { line: 0, ch: 1 },
      { line: 0, ch: 4 },
      'ine'
    ),
    false
  );
});
