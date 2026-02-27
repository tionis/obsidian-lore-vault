import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStoryScopesFromFrontmatter } from '../src/story-scope-selector';

test('parseStoryScopesFromFrontmatter parses lorebooks array and normalizes scopes', () => {
  const scopes = parseStoryScopesFromFrontmatter({
    lorebooks: [
      'Universe/Yggdrasil',
      '#lorebook/universe',
      'lorebook/universe/yggdrasil'
    ]
  }, 'lorebook');

  assert.deepEqual(scopes, ['universe/yggdrasil', 'universe']);
});

test('parseStoryScopesFromFrontmatter supports comma-separated lorebookScopes', () => {
  const scopes = parseStoryScopesFromFrontmatter({
    lorebookScopes: ' world/a, world/b, world/a '
  }, 'lorebook');

  assert.deepEqual(scopes, ['world/a', 'world/b']);
});

test('parseStoryScopesFromFrontmatter supports custom tag prefix', () => {
  const scopes = parseStoryScopesFromFrontmatter({
    lorebooks: ['#lv/core', 'lv/world-1']
  }, 'lv');

  assert.deepEqual(scopes, ['core', 'world-1']);
});

test('parseStoryScopesFromFrontmatter ignores empty or invalid values', () => {
  const scopes = parseStoryScopesFromFrontmatter({
    lorebooks: ['', '   ', '#', '/']
  }, 'lorebook');

  assert.deepEqual(scopes, []);
});
