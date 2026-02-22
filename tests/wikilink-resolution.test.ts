import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import * as path from 'path';
import { LinkTargetIndex, extractWikilinks, normalizeLinkTarget } from '../src/link-target-index';

interface LinkIndexInputFixture {
  files: Array<{
    path: string;
    basename: string;
    uid: number;
  }>;
}

function readFixture(relativePath: string): string {
  return readFileSync(path.join(__dirname, '..', '..', 'fixtures', relativePath), 'utf8');
}

test('extractWikilinks normalizes anchors, extensions, and space variants', () => {
  const input = readFixture(path.join('wikilinks', 'extract-input.md'));
  const expected = JSON.parse(readFixture(path.join('wikilinks', 'extract-expected.json'))) as { links: string[] };

  assert.deepEqual(extractWikilinks(input), expected.links);
});

test('normalizeLinkTarget strips heading refs and normalizes path separators', () => {
  assert.equal(normalizeLinkTarget('Characters\\Alice.md#Biography'), 'Characters/Alice');
  assert.equal(normalizeLinkTarget('World#^anchor'), 'World');
  assert.equal(normalizeLinkTarget(' Places/New London.md '), 'Places/New London');
});

test('LinkTargetIndex keeps unique paths and drops ambiguous basenames', () => {
  const input = JSON.parse(readFixture(path.join('wikilinks', 'index-input.json'))) as LinkIndexInputFixture;
  const expected = JSON.parse(readFixture(path.join('wikilinks', 'index-expected.json'))) as {[key: string]: number};

  const index = new LinkTargetIndex();
  for (const file of input.files) {
    index.registerFileMappings(file.path, file.basename, file.uid);
  }

  assert.deepEqual(index.getMappings(), expected);
});
