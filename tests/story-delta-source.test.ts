import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStoryDeltaSourcePaths } from '../src/story-delta-source';
import { StoryThreadResolution } from '../src/story-thread-resolver';

function buildResolution(): StoryThreadResolution {
  return {
    storyId: 'chronicles-main',
    currentPath: 'stories/ch02.md',
    currentIndex: 1,
    orderedPaths: [
      'stories/ch01.md',
      'stories/ch02.md',
      'stories/ch03.md'
    ]
  };
}

test('resolveStoryDeltaSourcePaths returns selected note for note mode', () => {
  const paths = resolveStoryDeltaSourcePaths('note', 'stories/ch02.md', null);
  assert.deepEqual(paths, ['stories/ch02.md']);
});

test('resolveStoryDeltaSourcePaths returns selected chapter path for chapter mode', () => {
  const paths = resolveStoryDeltaSourcePaths('chapter', 'stories/ch02.md', buildResolution());
  assert.deepEqual(paths, ['stories/ch02.md']);
});

test('resolveStoryDeltaSourcePaths returns ordered story paths for story mode', () => {
  const paths = resolveStoryDeltaSourcePaths('story', 'stories/ch02.md', buildResolution());
  assert.deepEqual(paths, ['stories/ch01.md', 'stories/ch02.md', 'stories/ch03.md']);
});

test('resolveStoryDeltaSourcePaths requires thread resolution for chapter/story modes', () => {
  assert.deepEqual(resolveStoryDeltaSourcePaths('chapter', 'stories/ch02.md', null), []);
  assert.deepEqual(resolveStoryDeltaSourcePaths('story', 'stories/ch02.md', null), []);
});
