import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import * as path from 'path';
import {
  parseStoryThreadNodeFromFrontmatter,
  resolveStoryThread,
  StoryThreadNode
} from '../src/story-thread-resolver';

interface StoryThreadFixture {
  cases: Array<{
    name: string;
    currentPath: string;
    nodes: StoryThreadNode[];
    expectedOrderedPaths: string[];
    expectedCurrentIndex: number;
  }>;
}

function readFixture<T>(relativePath: string): T {
  const fixturePath = path.join(__dirname, '..', '..', 'fixtures', relativePath);
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as T;
}

test('parseStoryThreadNodeFromFrontmatter parses story/chapter schema and refs', () => {
  const node = parseStoryThreadNodeFromFrontmatter(
    'story/ch02.md',
    'Ch 2',
    {
      storyId: 'Chronicles',
      chapter: '2',
      chapterTitle: 'The Crossing',
      previousChapter: ['[[story/ch01]]', 'story/ch01'],
      nextChapter: 'story/ch03'
    }
  );

  assert.ok(node);
  assert.equal(node?.storyId, 'chronicles');
  assert.equal(node?.chapter, 2);
  assert.equal(node?.chapterTitle, 'The Crossing');
  assert.deepEqual(node?.previousChapterRefs, ['story/ch01']);
  assert.deepEqual(node?.nextChapterRefs, ['story/ch03']);
});

test('resolveStoryThread orders deterministically by chapter when no links exist', () => {
  const nodes: StoryThreadNode[] = [
    {
      path: 'story/ch02.md',
      title: 'Ch2',
      storyId: 'chronicles',
      chapter: 2,
      chapterTitle: '',
      previousChapterRefs: [],
      nextChapterRefs: []
    },
    {
      path: 'story/ch01.md',
      title: 'Ch1',
      storyId: 'chronicles',
      chapter: 1,
      chapterTitle: '',
      previousChapterRefs: [],
      nextChapterRefs: []
    },
    {
      path: 'story/ch03.md',
      title: 'Ch3',
      storyId: 'chronicles',
      chapter: 3,
      chapterTitle: '',
      previousChapterRefs: [],
      nextChapterRefs: []
    }
  ];

  const resolution = resolveStoryThread(nodes, 'story/ch02.md');
  assert.ok(resolution);
  assert.deepEqual(resolution?.orderedPaths, [
    'story/ch01.md',
    'story/ch02.md',
    'story/ch03.md'
  ]);
  assert.equal(resolution?.currentIndex, 1);
});

test('resolveStoryThread respects prev/next links with deterministic tie-breaks', () => {
  const nodes: StoryThreadNode[] = [
    {
      path: 'story/alpha.md',
      title: 'Alpha',
      storyId: 'chronicles',
      chapter: null,
      chapterTitle: '',
      previousChapterRefs: [],
      nextChapterRefs: ['story/gamma']
    },
    {
      path: 'story/gamma.md',
      title: 'Gamma',
      storyId: 'chronicles',
      chapter: null,
      chapterTitle: '',
      previousChapterRefs: ['story/alpha'],
      nextChapterRefs: []
    },
    {
      path: 'story/beta.md',
      title: 'Beta',
      storyId: 'chronicles',
      chapter: null,
      chapterTitle: '',
      previousChapterRefs: [],
      nextChapterRefs: []
    }
  ];

  const resolution = resolveStoryThread(nodes, 'story/gamma.md');
  assert.ok(resolution);
  assert.deepEqual(resolution?.orderedPaths, [
    'story/alpha.md',
    'story/beta.md',
    'story/gamma.md'
  ]);
  assert.equal(resolution?.currentIndex, 2);
});

test('resolveStoryThread fixture suite covers multi-chapter coherence deterministically', () => {
  const fixture = readFixture<StoryThreadFixture>(path.join('story-thread', 'cases.json'));

  for (const fixtureCase of fixture.cases) {
    const resolution = resolveStoryThread(fixtureCase.nodes, fixtureCase.currentPath);
    assert.ok(resolution, `${fixtureCase.name}: expected resolution`);
    assert.deepEqual(resolution?.orderedPaths, fixtureCase.expectedOrderedPaths, `${fixtureCase.name}: ordered paths`);
    assert.equal(resolution?.currentIndex, fixtureCase.expectedCurrentIndex, `${fixtureCase.name}: current index`);
  }
});
