import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import * as path from 'path';
import { stripFrontmatter } from '../src/frontmatter-utils';
import { discoverScopesFromTags, extractLorebookScopesFromTags, shouldIncludeInScope } from '../src/lorebook-scoping';

interface LorebookScopingFixture {
  tagPrefix: string;
  cases: Array<{
    name: string;
    tags: string[];
    activeScope: string;
    membershipMode: 'exact' | 'cascade';
    includeUntagged: boolean;
    expectedInclude: boolean;
  }>;
  expectedScopes: string[];
}

function readFixture<T>(relativePath: string): T {
  const fixturePath = path.join(__dirname, '..', '..', 'fixtures', relativePath);
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as T;
}

test('hierarchical lorebook scope inclusion is deterministic', () => {
  const fixture = readFixture<LorebookScopingFixture>(path.join('lorebook-scoping', 'cases.json'));

  for (const fixtureCase of fixture.cases) {
    const noteScopes = extractLorebookScopesFromTags(fixtureCase.tags, fixture.tagPrefix);
    const include = shouldIncludeInScope(
      noteScopes,
      fixtureCase.activeScope,
      fixtureCase.membershipMode,
      fixtureCase.includeUntagged
    );
    assert.equal(include, fixtureCase.expectedInclude, fixtureCase.name);
  }
});

test('scope discovery deduplicates and sorts scopes', () => {
  const fixture = readFixture<LorebookScopingFixture>(path.join('lorebook-scoping', 'cases.json'));
  const discovered = discoverScopesFromTags(
    [
      '#lorebook/universe/yggdrasil',
      '#lorebook/universe',
      '#lorebook/universe/yggdrasil/regions',
      '#lorebook/universe/yggdrasil',
      '#other/tag'
    ],
    fixture.tagPrefix
  );

  assert.deepEqual(discovered, fixture.expectedScopes);
});

test('stripFrontmatter removes YAML block and preserves note body', () => {
  const markdown = `---
title: Test Note
lorebook: true
tags: [lorebook/universe]
---
Line 1
## Heading
Line 2
`;

  assert.equal(stripFrontmatter(markdown), 'Line 1\n## Heading\nLine 2\n');
});
