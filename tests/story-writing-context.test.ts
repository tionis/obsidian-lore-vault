import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveStoryWritingContextPath,
  updateStoryWritingContextPath
} from '../src/story-writing-context';

test('updateStoryWritingContextPath keeps the previous note when the next path is empty', () => {
  assert.equal(
    updateStoryWritingContextPath('Stories/chapter-01.md', ''),
    'Stories/chapter-01.md'
  );
});

test('updateStoryWritingContextPath switches to a new markdown note path when available', () => {
  assert.equal(
    updateStoryWritingContextPath('Stories/chapter-01.md', 'Stories/chapter-02.md'),
    'Stories/chapter-02.md'
  );
});

test('resolveStoryWritingContextPath prefers the active markdown note and otherwise falls back to the remembered one', () => {
  assert.equal(
    resolveStoryWritingContextPath('Stories/chapter-02.md', 'Stories/chapter-01.md'),
    'Stories/chapter-02.md'
  );
  assert.equal(
    resolveStoryWritingContextPath('', 'Stories/chapter-01.md'),
    'Stories/chapter-01.md'
  );
});
