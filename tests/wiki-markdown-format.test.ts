import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStructuredWikiBody,
  deriveWikiTitleFromPageKey,
  sanitizeWikiTitle
} from '../src/wiki-markdown-format';

test('sanitizeWikiTitle strips common type prefixes', () => {
  assert.equal(sanitizeWikiTitle('Character: Alice', 'Alice'), 'Alice');
  assert.equal(sanitizeWikiTitle('Faction - Iron Accord', 'Iron Accord'), 'Iron Accord');
  assert.equal(sanitizeWikiTitle('Alice', 'Fallback'), 'Alice');
});

test('deriveWikiTitleFromPageKey converts page keys to readable title', () => {
  assert.equal(deriveWikiTitleFromPageKey('character/alice-rain'), 'Alice Rain');
  assert.equal(deriveWikiTitleFromPageKey('location/old_tower'), 'Old Tower');
});

test('buildStructuredWikiBody enforces top title and section heading', () => {
  const body = buildStructuredWikiBody(
    'Alice',
    'character/alice',
    'Alice arrives in the city.',
    '(no extracted content)'
  );

  assert.match(body, /^# Alice$/m);
  assert.match(body, /## Backstory\n\nAlice arrives in the city\./);
});

