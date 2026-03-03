import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import * as path from 'path';
import {
  parseStoryThreadNodeFromFrontmatter,
  resolveStoryThread,
  resolveStoryThreadLineage,
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

test('parseStoryThreadNodeFromFrontmatter prefers authorNote link as thread anchor', () => {
  const node = parseStoryThreadNodeFromFrontmatter(
    'story/ch02.md',
    'Ch 2',
    {
      storyId: 'legacy-story-id',
      authorNote: '[[Lore/Story Author Note.md]]',
      chapter: 2
    }
  );

  assert.ok(node);
  assert.equal(node?.storyId, 'author-note:lore/story author note');
  assert.equal(node?.chapter, 2);
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

test('resolveStoryThreadLineage walks linked ancestors across author-note anchors without mixing sibling branches', () => {
  const nodes: StoryThreadNode[] = [
    {
      path: 'story/ch01.md',
      title: 'Ch1',
      storyId: 'author-note:origin-author-note',
      chapter: 1,
      chapterTitle: 'Old Chapter 1',
      previousChapterRefs: [],
      nextChapterRefs: ['story/ch02']
    },
    {
      path: 'story/ch02.md',
      title: 'Ch2',
      storyId: 'author-note:origin-author-note',
      chapter: 2,
      chapterTitle: 'Old Chapter 2',
      previousChapterRefs: ['story/ch01'],
      nextChapterRefs: ['story/ch03-origin']
    },
    {
      path: 'story/ch03-origin.md',
      title: 'Ch3 Origin',
      storyId: 'author-note:origin-author-note',
      chapter: 3,
      chapterTitle: 'Old Chapter 3',
      previousChapterRefs: ['story/ch02'],
      nextChapterRefs: ['story/ch04-origin']
    },
    {
      path: 'story/ch04-origin.md',
      title: 'Ch4 Origin',
      storyId: 'author-note:origin-author-note',
      chapter: 4,
      chapterTitle: 'Old Chapter 4',
      previousChapterRefs: ['story/ch03-origin'],
      nextChapterRefs: []
    },
    {
      path: 'story/ch03-fork.md',
      title: 'Ch3 Fork',
      storyId: 'author-note:fork-author-note',
      chapter: 3,
      chapterTitle: 'Fork Chapter 3',
      previousChapterRefs: ['story/ch02'],
      nextChapterRefs: []
    }
  ];

  const resolution = resolveStoryThreadLineage(nodes, 'story/ch03-fork.md');
  assert.ok(resolution);
  assert.deepEqual(resolution?.orderedPaths, [
    'story/ch01.md',
    'story/ch02.md',
    'story/ch03-fork.md'
  ]);
  assert.equal(resolution?.currentIndex, 2);
});

test('resolveStoryThreadLineage falls back to same-anchor deterministic chapter ordering when links are missing', () => {
  const nodes: StoryThreadNode[] = [
    {
      path: 'story/ch03.md',
      title: 'Ch3',
      storyId: 'author-note:main-author-note',
      chapter: 3,
      chapterTitle: '',
      previousChapterRefs: [],
      nextChapterRefs: []
    },
    {
      path: 'story/ch01.md',
      title: 'Ch1',
      storyId: 'author-note:main-author-note',
      chapter: 1,
      chapterTitle: '',
      previousChapterRefs: [],
      nextChapterRefs: []
    },
    {
      path: 'story/ch02.md',
      title: 'Ch2',
      storyId: 'author-note:main-author-note',
      chapter: 2,
      chapterTitle: '',
      previousChapterRefs: [],
      nextChapterRefs: []
    }
  ];

  const resolution = resolveStoryThreadLineage(nodes, 'story/ch03.md');
  assert.ok(resolution);
  assert.deepEqual(resolution?.orderedPaths, [
    'story/ch01.md',
    'story/ch02.md',
    'story/ch03.md'
  ]);
  assert.equal(resolution?.currentIndex, 2);
});
