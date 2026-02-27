import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGeneratedKeywords, upsertKeywordsFrontmatter } from '../src/keyword-utils';

test('parseGeneratedKeywords accepts JSON object payload', () => {
  const parsed = parseGeneratedKeywords('{"keywords":["Aurelia","Yggdrasil","Aurelia"]}');
  assert.deepEqual(parsed, ['Aurelia', 'Yggdrasil']);
});

test('parseGeneratedKeywords accepts markdown-ish fallback text', () => {
  const parsed = parseGeneratedKeywords([
    '- Baalthasar',
    '- Archmage',
    '- Ashglass',
    '-  Archmage'
  ].join('\n'));
  assert.deepEqual(parsed, ['Baalthasar', 'Archmage', 'Ashglass']);
});

test('upsertKeywordsFrontmatter inserts frontmatter when absent', () => {
  const raw = '# Note\n\nBody text.\n';
  const next = upsertKeywordsFrontmatter(raw, ['Aurelia', 'Yggdrasil']);
  assert.match(next, /^---\nkeywords:\n {2}- "Aurelia"\n {2}- "Yggdrasil"\n---\n\n# Note/);
});

test('upsertKeywordsFrontmatter replaces existing keywords and key fields', () => {
  const raw = [
    '---',
    'title: Example',
    'keywords:',
    '  - "Old"',
    'key:',
    '  - "Legacy"',
    'tags:',
    '  - lorebook/universe',
    '---',
    '',
    '# Example',
    '',
    'Body.'
  ].join('\n');

  const next = upsertKeywordsFrontmatter(raw, ['New One', 'New Two']);
  assert.match(next, /title: Example/);
  assert.match(next, /tags:\n {2}- lorebook\/universe/);
  assert.match(next, /keywords:\n {2}- "New One"\n {2}- "New Two"/);
  assert.equal(next.includes('Legacy'), false);
  assert.equal(next.includes('Old'), false);
});
