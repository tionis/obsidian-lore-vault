import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorldInfoContent } from '../src/summary-utils';
import { ChapterSummaryStore } from '../src/chapter-summary-store';
import { FrontmatterData } from '../src/frontmatter-utils';

function createMockFile(path: string): any {
  return {
    path,
    stat: {
      mtime: 1000
    }
  };
}

function createMockApp(contentByPath: {[key: string]: string}): any {
  return {
    vault: {
      cachedRead: async (file: any) => contentByPath[file.path] ?? ''
    }
  };
}

test('resolveWorldInfoContent precedence is summary section > frontmatter > note body', () => {
  const bodyWithSection = [
    '# Character',
    '',
    '## Summary',
    '',
    'Section summary text.',
    '',
    '## Details',
    '',
    'Body fallback'
  ].join('\n');
  const bodyWithoutSection = 'Body fallback';
  assert.equal(
    resolveWorldInfoContent(bodyWithSection, 'Frontmatter summary'),
    'Section summary text.'
  );
  assert.equal(
    resolveWorldInfoContent(bodyWithoutSection, 'Frontmatter summary'),
    'Frontmatter summary'
  );
  assert.equal(
    resolveWorldInfoContent(bodyWithoutSection, ''),
    bodyWithoutSection
  );
});

test('ChapterSummaryStore precedence is summary section > frontmatter > excerpt', async () => {
  const fileWithSection = createMockFile('story/ch01.md');
  const fileWithFrontmatterOnly = createMockFile('story/ch02.md');
  const fileWithExcerptOnly = createMockFile('story/ch03.md');
  const app = createMockApp({
    'story/ch01.md': [
      '---',
      'title: Chapter 1',
      '---',
      '# Chapter 1',
      '',
      '## Summary',
      '',
      'Section chapter summary',
      '',
      'This chapter body is used for generated or excerpt fallback.'
    ].join('\n'),
    'story/ch02.md': [
      '---',
      'title: Chapter 2',
      '---',
      'This chapter body is used for generated or excerpt fallback.'
    ].join('\n'),
    'story/ch03.md': [
      '---',
      'title: Chapter 3',
      '---',
      'This chapter body is used for generated or excerpt fallback.'
    ].join('\n')
  });

  const store = new ChapterSummaryStore(app);

  const frontmatterWithSummaryForSectionCase: FrontmatterData = {
    summary: 'Manual chapter summary'
  };
  const withSection = await store.resolveSummary(
    fileWithSection,
    frontmatterWithSummaryForSectionCase,
    body => body.slice(0, 30)
  );
  assert.equal(withSection?.source, 'section');
  assert.equal(withSection?.text, 'Section chapter summary');

  const frontmatterWithSummary: FrontmatterData = {
    summary: 'Manual chapter summary'
  };
  const withFrontmatter = await store.resolveSummary(
    fileWithFrontmatterOnly,
    frontmatterWithSummary,
    body => body.slice(0, 30)
  );
  assert.equal(withFrontmatter?.source, 'frontmatter');
  assert.equal(withFrontmatter?.text, 'Manual chapter summary');

  const withoutFrontmatter = await store.resolveSummary(
    fileWithExcerptOnly,
    {},
    body => body.slice(0, 30)
  );
  assert.equal(withoutFrontmatter?.source, 'excerpt');
  assert.equal(withoutFrontmatter?.text, 'This chapter body is used for');
});
