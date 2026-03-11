import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowInsertInlineDirectiveContextAction } from '../src/editor-action-visibility';

test('insert inline directive action stays available without a linked author note', () => {
  assert.equal(
    shouldShowInsertInlineDirectiveContextAction({
      isAuthorNote: false
    }),
    true
  );
});

test('insert inline directive action stays hidden on author-note documents', () => {
  assert.equal(
    shouldShowInsertInlineDirectiveContextAction({
      isAuthorNote: true
    }),
    false
  );
});
