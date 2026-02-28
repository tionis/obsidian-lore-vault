import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAdaptiveQueryWindow,
  extractAdaptiveStoryWindow
} from '../src/context-window-strategy';

function makeText(length: number, char: string): string {
  return char.repeat(Math.max(0, length));
}

test('extractAdaptiveQueryWindow scales with token budget and keeps latest tail', () => {
  const source = makeText(160000, 'a') + 'TAIL';
  const small = extractAdaptiveQueryWindow(source, 1200);
  const large = extractAdaptiveQueryWindow(source, 12000);

  assert.ok(large.length > small.length);
  assert.ok(small.endsWith('TAIL'));
  assert.ok(large.endsWith('TAIL'));
});

test('extractAdaptiveStoryWindow includes opening and recent context for long documents', () => {
  const opening = 'OPENING '.repeat(1200);
  const middle = [
    '## Chapter 4',
    '',
    'The middle section has lore details and progress updates that matter for continuity.',
    '',
    '## Chapter 5',
    '',
    'Another turning point with additional details and relationships.'
  ].join('\n');
  const tail = 'RECENT '.repeat(1800);
  const source = `${opening}\n\n${middle}\n\n${tail}`;

  const windowed = extractAdaptiveStoryWindow(source, 2200);
  assert.ok(windowed.includes('OPENING'));
  assert.ok(windowed.includes('RECENT'));
  assert.ok(windowed.includes('middle story highlights') || windowed.includes('Chapter 4'));
  assert.ok(windowed.length <= 12000);
});

test('extractAdaptiveStoryWindow grows with larger budgets', () => {
  const source = [
    makeText(30000, 'h'),
    '\n\n## Mid\n\n',
    makeText(30000, 'm'),
    '\n\n',
    makeText(30000, 't')
  ].join('');

  const small = extractAdaptiveStoryWindow(source, 1800);
  const large = extractAdaptiveStoryWindow(source, 9000);

  assert.ok(large.length > small.length);
  assert.ok(large.length <= 9000 * 4);
});
