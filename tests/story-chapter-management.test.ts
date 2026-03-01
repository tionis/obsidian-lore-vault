import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChapterFileStem,
  buildStoryChapterNoteMarkdown,
  deriveStoryIdFromTitle,
  formatStoryChapterRef,
  splitStoryMarkdownIntoChapterSections,
  upsertStoryChapterFrontmatter
} from '../src/story-chapter-management';

test('splitStoryMarkdownIntoChapterSections splits H2 chapters and carries prologue into first chapter', () => {
  const raw = [
    '---',
    'title: "Chronicles"',
    'tags:',
    '  - "story"',
    '---',
    '',
    '# Chronicles',
    '',
    'Prologue paragraph.',
    '',
    '## The Arrival',
    'Scene one details.',
    '',
    '## The Reckoning',
    'Scene two details.'
  ].join('\n');

  const chapters = splitStoryMarkdownIntoChapterSections(raw);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].chapterNumber, 1);
  assert.equal(chapters[0].chapterTitle, 'The Arrival');
  assert.match(chapters[0].chapterBody, /Prologue paragraph\./);
  assert.match(chapters[0].chapterBody, /Scene one details\./);
  assert.equal(chapters[1].chapterNumber, 2);
  assert.equal(chapters[1].chapterTitle, 'The Reckoning');
  assert.equal(chapters[1].chapterBody, 'Scene two details.');
});

test('upsertStoryChapterFrontmatter preserves unrelated keys and rewrites managed chapter keys', () => {
  const raw = [
    '---',
    'title: "Chronicles"',
    'tags:',
    '  - "story"',
    'storyId: "old-story"',
    'chapter: 1',
    'nextChapter: "[[stories/old-next]]"',
    '---',
    '',
    '# Chronicles',
    '',
    'Body'
  ].join('\n');

  const updated = upsertStoryChapterFrontmatter(raw, {
    storyId: 'chronicles-main',
    chapter: 2,
    chapterTitle: 'The Arrival',
    previousChapterRefs: ['[[stories/ch01]]'],
    nextChapterRefs: ['[[stories/ch03]]']
  });

  assert.match(updated, /title: "Chronicles"/);
  assert.match(updated, /tags:\n {2}- "story"/);
  assert.match(updated, /storyId: "chronicles-main"/);
  assert.match(updated, /chapter: 2/);
  assert.match(updated, /chapterTitle: "The Arrival"/);
  assert.match(updated, /previousChapter: "\[\[stories\/ch01\]\]"/);
  assert.match(updated, /nextChapter: "\[\[stories\/ch03\]\]"/);
  assert.ok(!updated.includes('old-next'));
});

test('buildStoryChapterNoteMarkdown renders chapter note with H1 title and chapter frontmatter', () => {
  const source = [
    '---',
    'title: "Chronicles"',
    'tags:',
    '  - "story"',
    '---',
    '',
    '# Chronicles',
    '',
    'Long source text'
  ].join('\n');

  const chapterNote = buildStoryChapterNoteMarkdown(
    source,
    {
      storyId: 'chronicles-main',
      chapter: 3,
      chapterTitle: 'Into the Vale',
      previousChapterRefs: ['[[stories/ch02]]']
    },
    'Into the Vale',
    'The chapter begins here.'
  );

  assert.match(chapterNote, /storyId: "chronicles-main"/);
  assert.match(chapterNote, /chapter: 3/);
  assert.match(chapterNote, /chapterTitle: "Into the Vale"/);
  assert.match(chapterNote, /# Into the Vale/);
  assert.match(chapterNote, /The chapter begins here\./);
});

test('chapter helper formatting stays deterministic', () => {
  assert.equal(deriveStoryIdFromTitle('  My Story: Arc I  '), 'my-story-arc-i');
  assert.equal(formatStoryChapterRef('stories/ch01.md'), '[[stories/ch01]]');
  assert.equal(
    buildChapterFileStem('chronicles-main', 4, 'Into the Vale'),
    'chronicles-main-ch04-into-the-vale'
  );
});
