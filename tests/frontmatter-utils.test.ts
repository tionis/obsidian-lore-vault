import test from 'node:test';
import assert from 'node:assert/strict';
import {
  asStringArray,
  getFrontmatterValue,
  normalizeFrontmatter,
  uniqueStrings
} from '../src/frontmatter-utils';

test('normalizeFrontmatter and getFrontmatterValue handle edge-case key shapes', () => {
  const normalized = normalizeFrontmatter({
    'Key-Words': ['герой', '東京'],
    'Lorebook Root': true,
    Position: { start: 0 },
    'custom_key': 'value'
  });

  assert.deepEqual(getFrontmatterValue(normalized, 'keywords', 'key'), ['герой', '東京']);
  assert.equal(getFrontmatterValue(normalized, 'lorebookRoot'), true);
  assert.equal(getFrontmatterValue(normalized, 'position'), undefined);
  assert.equal(getFrontmatterValue(normalized, 'custom key'), 'value');
});

test('asStringArray and uniqueStrings preserve non-English metadata values', () => {
  const values = asStringArray(['  герой ', '東京', 42, true, '', null]);
  assert.deepEqual(values, ['герой', '東京', '42', 'true']);

  const deduped = uniqueStrings(['герой', '東京', 'герой', '  東京 ', '']);
  assert.deepEqual(deduped, ['герой', '東京']);
});
