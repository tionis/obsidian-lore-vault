import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import * as path from 'path';
import { normalizeFrontmatter, stripFrontmatter } from '../src/frontmatter-utils';
import { shouldIncludeSourceFile } from '../src/source-selection';

interface SourceSelectionFixture {
  rules: {
    requireLorebookFlag: boolean;
    includeFolders: string[];
    excludeFolders: string[];
    includeTags: string[];
    excludeTags: string[];
  };
  cases: Array<{
    name: string;
    path: string;
    frontmatter: {[key: string]: unknown};
    expectedInclude: boolean;
    expectedReason: string;
  }>;
}

function readFixture<T>(relativePath: string): T {
  const fixturePath = path.join(__dirname, '..', '..', 'fixtures', relativePath);
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as T;
}

test('frontmatter source-selection rules are applied deterministically', () => {
  const fixture = readFixture<SourceSelectionFixture>(path.join('source-selection', 'cases.json'));

  for (const fixtureCase of fixture.cases) {
    const normalized = normalizeFrontmatter(fixtureCase.frontmatter);
    const decision = shouldIncludeSourceFile(fixtureCase.path, normalized, fixture.rules);
    assert.equal(decision.include, fixtureCase.expectedInclude, fixtureCase.name);
    assert.equal(decision.reason, fixtureCase.expectedReason, fixtureCase.name);
  }
});

test('stripFrontmatter removes YAML block and preserves note body', () => {
  const markdown = `---
title: Test Note
lorebook: true
tags: [canon]
---
Line 1
## Heading
Line 2
`;

  assert.equal(stripFrontmatter(markdown), 'Line 1\n## Heading\nLine 2\n');
});
