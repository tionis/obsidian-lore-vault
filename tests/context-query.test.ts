import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import * as path from 'path';
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

interface GraphFixture {
  query: string;
  tokenBudget: number;
  maxGraphHops: number;
  graphHopDecay: number;
  worldInfo: Array<{
    uid: number;
    key: string[];
    comment: string;
    order: number;
    constant?: boolean;
    content: string;
    wikilinks?: string[];
  }>;
  expectedWorldInfoOrder: number[];
  expectedSeedUids: number[];
  expectedPathByUid: {[key: string]: number[]};
}

function readFixture<T>(relativePath: string): T {
  const fixturePath = path.join(__dirname, '..', '..', 'fixtures', relativePath);
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as T;
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
    tokenBudget: 1024,
    ragFallbackPolicy: 'always'
  });

  assert.equal(context.scope, 'universe');
  assert.equal(context.worldInfo[0].entry.uid, 1);
  assert.equal(context.worldInfo[1].entry.uid, 2);
  assert.equal(context.rag[0].document.uid, 10);
  assert.equal(context.rag[1].document.uid, 11);
  assert.ok(context.worldInfo[0].reasons.length > 0);
  assert.ok(
    context.worldInfo[0].contentTier === 'short' ||
    context.worldInfo[0].contentTier === 'medium' ||
    context.worldInfo[0].contentTier === 'full' ||
    context.worldInfo[0].contentTier === 'full_body'
  );
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
    worldInfoBudgetRatio: 0.5,
    maxWorldInfoEntries: 10,
    maxRagDocuments: 10,
    ragFallbackPolicy: 'always'
  });

  assert.ok(context.usedTokens <= 256);
  assert.ok(context.worldInfo.length <= 2);
  assert.ok(context.rag.length <= 1);
  assert.ok(context.explainability.worldInfoBudget.droppedByBudget >= 1);
});

test('assembleScopeContext applies deterministic graph expansion and explainability', () => {
  const fixture = readFixture<GraphFixture>(path.join('context-query', 'graph-expansion.json'));
  const pack: ScopeContextPack = {
    scope: 'universe',
    builtAt: 1,
    worldInfoEntries: fixture.worldInfo.map(item => createWorldInfoEntry(
      item.uid,
      item.key,
      item.content,
      item.order,
      {
        comment: item.comment,
        constant: Boolean(item.constant),
        wikilinks: item.wikilinks ?? []
      }
    )),
    ragDocuments: [
      createRagDocument(10, 'Background', 'notes/background.md', 'General background details.')
    ],
    ragChunks: [],
    ragChunkEmbeddings: []
  };

  const first = assembleScopeContext(pack, {
    queryText: fixture.query,
    tokenBudget: fixture.tokenBudget,
    maxGraphHops: fixture.maxGraphHops,
    graphHopDecay: fixture.graphHopDecay,
    ragFallbackPolicy: 'off'
  });
  const second = assembleScopeContext(pack, {
    queryText: fixture.query,
    tokenBudget: fixture.tokenBudget,
    maxGraphHops: fixture.maxGraphHops,
    graphHopDecay: fixture.graphHopDecay,
    ragFallbackPolicy: 'off'
  });

  const firstOrder = first.worldInfo.map(item => item.entry.uid);
  const secondOrder = second.worldInfo.map(item => item.entry.uid);
  assert.deepEqual(firstOrder, fixture.expectedWorldInfoOrder);
  assert.deepEqual(secondOrder, fixture.expectedWorldInfoOrder);
  assert.deepEqual(first.explainability.seeds.map(seed => seed.uid), fixture.expectedSeedUids);
  assert.equal(first.explainability.rag.enabled, false);
  assert.equal(first.rag.length, 0);

  for (const [uid, expectedPath] of Object.entries(fixture.expectedPathByUid)) {
    const selected = first.worldInfo.find(item => item.entry.uid === Number(uid));
    assert.ok(selected, `missing uid ${uid}`);
    assert.deepEqual(selected?.pathUids, expectedPath);
    if (expectedPath.length > 0) {
      assert.ok((selected?.reasons ?? []).length > 0);
    }
  }
});

test('assembleScopeContext keeps auto fallback deterministic when seed confidence is low', () => {
  const pack: ScopeContextPack = {
    scope: 'universe',
    builtAt: 1,
    worldInfoEntries: [
      createWorldInfoEntry(1, ['Aurelia'], 'Aurelia details.', 100),
      createWorldInfoEntry(2, ['Yggdrasil'], 'Yggdrasil details.', 90)
    ],
    ragDocuments: [
      createRagDocument(11, 'Chronicle Primer', 'notes/primer.md', 'Arcstone and moonfall are central mystery terms.'),
      createRagDocument(12, 'Moonfall Incident', 'notes/moonfall.md', 'Moonfall event timeline and witness logs.'),
      createRagDocument(13, 'Arcstone Ledger', 'notes/arcstone.md', 'Arcstone transport records.')
    ],
    ragChunks: [],
    ragChunkEmbeddings: []
  };

  const query = 'arcstone moonfall witness';
  const first = assembleScopeContext(pack, {
    queryText: query,
    tokenBudget: 900,
    ragFallbackPolicy: 'auto',
    ragFallbackSeedScoreThreshold: 120
  });
  const second = assembleScopeContext(pack, {
    queryText: query,
    tokenBudget: 900,
    ragFallbackPolicy: 'auto',
    ragFallbackSeedScoreThreshold: 120
  });

  assert.equal(first.explainability.rag.enabled, true);
  assert.equal(second.explainability.rag.enabled, true);
  assert.deepEqual(
    first.rag.map(item => item.document.uid),
    second.rag.map(item => item.document.uid)
  );
  assert.deepEqual(
    first.rag.map(item => item.score),
    second.rag.map(item => item.score)
  );
});

test('assembleScopeContext supports non-English keyword tokenization', () => {
  const pack: ScopeContextPack = {
    scope: 'multiverse',
    builtAt: 1,
    worldInfoEntries: [
      createWorldInfoEntry(1, ['герой'], 'Русский профиль героя.', 500, { comment: 'Герой' }),
      createWorldInfoEntry(2, ['東京'], '東京の都市情報。', 450, { comment: '東京' }),
      createWorldInfoEntry(3, ['fallback'], 'Unrelated fallback entry.', 10)
    ],
    ragDocuments: [],
    ragChunks: [],
    ragChunkEmbeddings: []
  };

  const context = assembleScopeContext(pack, {
    queryText: 'герой отправляется в 東京',
    tokenBudget: 800,
    ragFallbackPolicy: 'off'
  });

  const selected = context.worldInfo.map(item => item.entry.uid);
  assert.ok(selected.includes(1));
  assert.ok(selected.includes(2));
});

test('assembleScopeContext lifts high-score entries to query-focused body excerpts', () => {
  const pack: ScopeContextPack = {
    scope: 'universe',
    builtAt: 1,
    worldInfoEntries: [
      createWorldInfoEntry(
        1,
        ['Baalthasar'],
        'Baalthasar is a dark elven archmage and strategist.',
        900,
        { comment: 'Baalthasar', wikilinks: ['Rin'] }
      ),
      createWorldInfoEntry(
        2,
        ['Rin'],
        'Rin is his ally.',
        650,
        { comment: 'Rin' }
      )
    ],
    worldInfoBodyByUid: {
      1: [
        'Baalthasar is a dark elven archmage and strategist.',
        '',
        'At the Siege of Ashglass, Baalthasar shattered the imperial vanguard and sealed the breach with mind and fate magic.',
        '',
        'He later negotiated the dragon armistice at the Obsidian Steps after recovering the void lens.'
      ].join('\n')
    },
    ragDocuments: [],
    ragChunks: [],
    ragChunkEmbeddings: []
  };

  const context = assembleScopeContext(pack, {
    queryText: 'What happened at the Siege of Ashglass for Baalthasar?',
    tokenBudget: 2400,
    ragFallbackPolicy: 'off'
  });

  const baalthasar = context.worldInfo.find(item => item.entry.uid === 1);
  assert.ok(baalthasar);
  assert.equal(baalthasar?.contentTier, 'full_body');
  assert.ok((baalthasar?.includedContent ?? '').includes('Siege of Ashglass'));
  assert.ok(context.explainability.worldInfoBudget.bodyLiftedUids.includes(1));
});
