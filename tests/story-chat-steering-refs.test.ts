import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractNoteRefsFromStoryChatSteeringRefs,
  normalizeStoryChatSteeringRefs,
  parseStoryChatSteeringRef
} from '../src/story-chat-steering-refs';

test('parseStoryChatSteeringRef supports explicit and implicit note refs', () => {
  assert.equal(parseStoryChatSteeringRef('story:chronicles-main'), null);
  assert.equal(parseStoryChatSteeringRef('chapter:chronicles-main::chapter:4'), null);
  assert.deepEqual(parseStoryChatSteeringRef('note:stories/ch01.md'), {
    type: 'note',
    key: 'stories/ch01.md'
  });
  assert.deepEqual(parseStoryChatSteeringRef('stories/ch02.md'), {
    type: 'note',
    key: 'stories/ch02.md'
  });
});

test('normalizeStoryChatSteeringRefs canonicalizes refs deterministically', () => {
  const normalized = normalizeStoryChatSteeringRefs([
    'story:chronicles-main',
    'stories/ch02.md',
    'note:stories/ch02.md',
    'chapter:chronicles-main::chapter:2',
    '  '
  ]);
  assert.deepEqual(normalized, [
    'note:stories/ch02.md'
  ]);
});

test('extractNoteRefsFromStoryChatSteeringRefs returns deduped note keys', () => {
  const noteRefs = extractNoteRefsFromStoryChatSteeringRefs([
    'story:chronicles-main',
    'note:stories/ch01.md',
    'stories/ch01.md',
    'chapter:chronicles-main::chapter:1'
  ]);
  assert.deepEqual(noteRefs, ['stories/ch01.md']);
});
