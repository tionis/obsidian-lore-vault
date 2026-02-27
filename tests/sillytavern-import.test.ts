import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyImportedWikiPages,
  buildImportedWikiPages,
  parseSillyTavernLorebookJson
} from '../src/sillytavern-import';

test('parseSillyTavernLorebookJson parses object-style entries and sorts deterministically', () => {
  const input = JSON.stringify({
    entries: {
      '20': {
        uid: 20,
        comment: 'Gamma',
        content: 'Gamma content',
        key: ['Gamma'],
        keysecondary: ['G']
      },
      '2': {
        uid: 2,
        comment: 'Alpha',
        content: 'Alpha content',
        key: ['Alpha']
      }
    }
  });

  const result = parseSillyTavernLorebookJson(input);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].uid, 2);
  assert.equal(result.entries[0].comment, 'Alpha');
  assert.equal(result.entries[1].uid, 20);
});

test('buildImportedWikiPages maps tags/keywords/aliases/content deterministically', () => {
  const pages = buildImportedWikiPages([
    {
      uid: 7,
      comment: 'Captain Sol',
      content: 'Captain Sol leads the Third Fleet.',
      key: ['Captain Sol', 'Sol'],
      keysecondary: ['The Captain'],
      disable: false
    }
  ], {
    targetFolder: 'wiki/imported',
    defaultTagsRaw: 'wiki, imported',
    lorebookName: 'characters/major',
    tagPrefix: 'lorebook',
    maxSummaryChars: 120
  });

  assert.equal(pages.length, 1);
  assert.equal(pages[0].path, 'wiki/imported/000007-captain-sol.md');
  assert.match(pages[0].content, /title: "Captain Sol"/);
  assert.match(pages[0].content, /keywords:\n {2}- "Captain Sol"\n {2}- "Sol"/);
  assert.match(pages[0].content, /aliases:\n {2}- "The Captain"/);
  assert.match(pages[0].content, /tags:\n {2}- "wiki"\n {2}- "imported"\n {2}- "lorebook\/characters\/major"/);
  assert.equal(/^summary:/m.test(pages[0].content), false);
  assert.match(pages[0].content, /## Summary\n\nCaptain Sol leads the Third Fleet\./);
  assert.match(pages[0].content, /Captain Sol leads the Third Fleet\./);
});

function createMockApp() {
  const files = new Map<string, string>();
  const folders = new Set<string>();

  const vault = {
    getAbstractFileByPath(path: string): unknown | null {
      if (files.has(path)) {
        return { path };
      }
      if (folders.has(path)) {
        return { path, children: [] };
      }
      return null;
    },
    async createFolder(path: string): Promise<void> {
      folders.add(path);
    },
    async create(path: string, data: string): Promise<void> {
      files.set(path, data);
    },
    async modify(file: { path: string }, data: string): Promise<void> {
      files.set(file.path, data);
    }
  };

  return {
    app: {
      vault
    } as any,
    files,
    folders
  };
}

test('applyImportedWikiPages creates and updates notes', async () => {
  const { app, files } = createMockApp();
  files.set('wiki/imported/000001-alpha.md', 'old');

  const result = await applyImportedWikiPages(app, [
    {
      path: 'wiki/imported/000001-alpha.md',
      content: 'updated',
      uid: 1
    },
    {
      path: 'wiki/imported/000002-beta.md',
      content: 'created',
      uid: 2
    }
  ]);

  assert.equal(result.created, 1);
  assert.equal(result.updated, 1);
  assert.equal(files.get('wiki/imported/000001-alpha.md'), 'updated');
  assert.equal(files.get('wiki/imported/000002-beta.md'), 'created');
});
