import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleScopeContext, ScopeContextPack } from '../src/context-query';
import { LoreBookEntry, RagDocument } from '../src/models';

function createWorldInfoEntry(
  uid: number,
  key: string[],
  content: string,
  order: number,
  overrides: Partial<LoreBookEntry> = {}
): LoreBookEntry {
  return {
    uid,
    key,
    keysecondary: [],
    comment: `Entry ${uid}`,
    content,
    constant: false,
    vectorized: false,
    selective: true,
    selectiveLogic: 0,
    addMemo: true,
    order,
    position: 0,
    disable: false,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: false,
    probability: 100,
    useProbability: true,
    depth: 4,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    role: null,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    displayIndex: 0,
    ...overrides
  };
}

function createRagDocument(uid: number, title: string, path: string, content: string): RagDocument {
  return {
    uid,
    title,
    path,
    content,
    scope: 'universe'
  };
}

test('assembleScopeContext selects deterministic world_info and rag matches', () => {
  const pack: ScopeContextPack = {
    scope: 'universe',
    builtAt: 1,
    worldInfoEntries: [
      createWorldInfoEntry(1, ['Aurelia'], 'Aurelia is a radiant world.', 500),
      createWorldInfoEntry(2, ['Yggdrasil'], 'Yggdrasil is the world tree.', 450),
      createWorldInfoEntry(3, ['Background'], 'Generic context.', 900, { constant: true })
    ],
    ragDocuments: [
      createRagDocument(10, 'Aurelia Chronicle', 'notes/aurelia.md', 'Aurelia appears in chapter one.'),
      createRagDocument(11, 'Tree Notes', 'notes/yggdrasil.md', 'Yggdrasil roots connect many realms.')
    ],
    ragChunks: [],
    ragChunkEmbeddings: []
  };

  const context = assembleScopeContext(pack, {
    queryText: 'Aurelia enters Yggdrasil',
    tokenBudget: 1024
  });

  assert.equal(context.scope, 'universe');
  assert.equal(context.worldInfo[0].entry.uid, 1);
  assert.equal(context.worldInfo[1].entry.uid, 2);
  assert.equal(context.rag[0].document.uid, 10);
  assert.equal(context.rag[1].document.uid, 11);
  assert.ok(context.markdown.includes('### world_info'));
  assert.ok(context.markdown.includes('### rag'));
});

test('assembleScopeContext enforces token budget caps', () => {
  const largeContent = 'Long lore content '.repeat(400);
  const pack: ScopeContextPack = {
    scope: 'universe',
    builtAt: 1,
    worldInfoEntries: [
      createWorldInfoEntry(1, ['Aurelia'], largeContent, 1000),
      createWorldInfoEntry(2, ['Aurelia'], largeContent, 900)
    ],
    ragDocuments: [
      createRagDocument(10, 'Aurelia Chronicle', 'notes/aurelia.md', largeContent),
      createRagDocument(11, 'Aurelia Addendum', 'notes/aurelia-2.md', largeContent)
    ],
    ragChunks: [],
    ragChunkEmbeddings: []
  };

  const context = assembleScopeContext(pack, {
    queryText: 'Aurelia',
    tokenBudget: 256,
    maxWorldInfoEntries: 10,
    maxRagDocuments: 10
  });

  assert.ok(context.usedTokens <= 256);
  assert.ok(context.worldInfo.length <= 1);
  assert.ok(context.rag.length <= 1);
});
