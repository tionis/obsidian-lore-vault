import test from 'node:test';
import assert from 'node:assert/strict';
import { LorebookScopeCache } from '../src/lorebook-scope-cache';
import { LorebookNoteMetadata } from '../src/lorebooks-manager-data';

function makeNote(index: number): LorebookNoteMetadata {
  const scopeGroup = index % 5;
  return {
    path: `notes/${index.toString().padStart(4, '0')}.md`,
    basename: `note-${index}`,
    scopes: [
      `universe/world-${scopeGroup}`,
      `universe/world-${scopeGroup}/region-${index % 20}`
    ],
    frontmatter: {}
  };
}

test('lorebook scope cache avoids repeated full scans until invalidated', () => {
  const notes = Array.from({ length: 1500 }, (_, index) => makeNote(index));
  let computeCalls = 0;

  const cache = new LorebookScopeCache({
    computeNotes: () => {
      computeCalls += 1;
      return notes;
    },
    getActiveScope: () => 'universe'
  });

  const firstScopes = cache.getScopes();
  const secondScopes = cache.getScopes();
  const thirdNotes = cache.getNotes();

  assert.equal(computeCalls, 1);
  assert.deepEqual(secondScopes, firstScopes);
  assert.equal(thirdNotes.length, 1500);
  assert.ok(firstScopes.includes('universe'));

  cache.invalidate();
  const afterInvalidate = cache.getScopes();
  assert.equal(computeCalls, 2);
  assert.deepEqual(afterInvalidate, firstScopes);
});
