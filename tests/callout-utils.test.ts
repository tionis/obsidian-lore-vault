import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildThinkingCallout,
  normalizeIgnoredCalloutTypes,
  stripIgnoredCallouts
} from '../src/callout-utils';

test('normalizeIgnoredCalloutTypes parses strings and preserves deterministic order', () => {
  const normalized = normalizeIgnoredCalloutTypes('LV-Thinking, note\nlv-ignore\nnote');
  assert.deepEqual(normalized, ['lv-thinking', 'note', 'lv-ignore']);
});

test('stripIgnoredCallouts removes matching callout blocks case-insensitively', () => {
  const source = [
    'Before.',
    '',
    '> [!NOTE]- Draft Note',
    '> hidden text',
    '> still hidden',
    '',
    '> [!warning] Keep this',
    '> visible',
    '',
    'After.'
  ].join('\n');

  const stripped = stripIgnoredCallouts(source, ['note']);
  assert.equal(stripped.includes('hidden text'), false);
  assert.equal(stripped.includes('still hidden'), false);
  assert.equal(stripped.includes('[!NOTE]'), false);
  assert.equal(stripped.includes('[!warning]'), true);
  assert.equal(stripped.includes('Before.'), true);
  assert.equal(stripped.includes('After.'), true);
});

test('buildThinkingCallout renders a collapsed lv-thinking callout', () => {
  const rendered = buildThinkingCallout('First line.\n\nSecond line.');
  assert.equal(rendered.startsWith('> [!lv-thinking]- Thinking'), true);
  assert.equal(rendered.includes('> First line.'), true);
  assert.equal(rendered.includes('>\n> Second line.'), true);
});
