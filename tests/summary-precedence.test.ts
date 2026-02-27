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

test('resolveWorldInfoContent precedence is manual summary > note body', () => {
  const body = 'Body fallback';
  assert.equal(
    resolveWorldInfoContent(body, 'Manual summary'),
    'Manual summary'
  );
  assert.equal(
    resolveWorldInfoContent(body, ''),
    body
  );
});

test('ChapterSummaryStore precedence is frontmatter > excerpt', async () => {
  const file = createMockFile('story/ch01.md');
  const app = createMockApp({
    'story/ch01.md': [
      '---',
      'title: Chapter 1',
      '---',
      'This chapter body is used for generated or excerpt fallback.'
    ].join('\n')
  });

  const store = new ChapterSummaryStore(app);

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
    { ...file, stat: { mtime: 2000 } } as any,
    {},
    body => body.slice(0, 30)
  );
  assert.equal(withoutFrontmatter?.source, 'excerpt');
  assert.equal(withoutFrontmatter?.text, 'This chapter body is used for');
});
