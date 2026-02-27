import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../src/models';
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

test('resolveWorldInfoContent precedence is manual summary > generated summary > note body', () => {
  const body = 'Body fallback';
  assert.equal(
    resolveWorldInfoContent(body, 'Manual summary', 'Generated summary'),
    'Manual summary'
  );
  assert.equal(
    resolveWorldInfoContent(body, '', 'Generated summary'),
    'Generated summary'
  );
  assert.equal(
    resolveWorldInfoContent(body, undefined, ''),
    body
  );
});

test('ChapterSummaryStore precedence is frontmatter > generated > excerpt', async () => {
  const file = createMockFile('story/ch01.md');
  const app = createMockApp({
    'story/ch01.md': [
      '---',
      'title: Chapter 1',
      '---',
      'This chapter body is used for generated or excerpt fallback.'
    ].join('\n'),
    'story/ch02.md': [
      '---',
      'title: Chapter 2',
      '---',
      'This chapter body should resolve to generated summary.'
    ].join('\n')
  });

  const generatedStore = {
    getAcceptedSummary: async (_path: string, _mode: string, _signature: string) => 'Generated chapter summary'
  } as any;

  const store = new ChapterSummaryStore(
    app,
    () => ({
      ...DEFAULT_SETTINGS,
      summaries: {
        ...DEFAULT_SETTINGS.summaries,
        chapter: {
          useGeneratedSummary: true
        }
      }
    }),
    generatedStore
  );

  const frontmatterWithSummary: FrontmatterData = {
    summary: 'Manual chapter summary'
  };
  const withFrontmatter = await store.resolveSummary(
    file,
    frontmatterWithSummary,
    body => body.slice(0, 30)
  );
  assert.equal(withFrontmatter?.source, 'frontmatter');
  assert.equal(withFrontmatter?.text, 'Manual chapter summary');

  const withoutFrontmatter = await store.resolveSummary(
    { ...file, path: 'story/ch02.md', stat: { mtime: 2000 } } as any,
    {},
    body => body.slice(0, 30)
  );
  assert.equal(withoutFrontmatter?.source, 'generated');
  assert.equal(withoutFrontmatter?.text, 'Generated chapter summary');

  const excerptOnlyStore = new ChapterSummaryStore(
    createMockApp({
      'story/ch03.md': [
        '---',
        'title: Chapter 3',
        '---',
        'Excerpt fallback should be used here.'
      ].join('\n')
    }),
    () => ({
      ...DEFAULT_SETTINGS,
      summaries: {
        ...DEFAULT_SETTINGS.summaries,
        chapter: {
          useGeneratedSummary: true
        }
      }
    }),
    {
      getAcceptedSummary: async () => null
    } as any
  );

  const excerptResult = await excerptOnlyStore.resolveSummary(
    { path: 'story/ch03.md', stat: { mtime: 3000 } } as any,
    {},
    body => body.slice(0, 18)
  );
  assert.equal(excerptResult?.source, 'excerpt');
  assert.equal(excerptResult?.text, 'Excerpt fallback s');
});
