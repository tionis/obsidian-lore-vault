import test from 'node:test';
import assert from 'node:assert/strict';
import { LoreBookEntry } from '../src/models';
import {
  createRetrievalToolCatalog,
  RetrievalToolPlanner,
  runModelDrivenRetrievalHooks
} from '../src/retrieval-tool-hooks';

function createEntry(
  uid: number,
  title: string,
  keys: string[],
  content: string,
  order: number,
  wikilinks: string[] = []
): LoreBookEntry {
  return {
    uid,
    key: keys,
    keysecondary: [],
    comment: title,
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
    wikilinks
  };
}

test('runModelDrivenRetrievalHooks executes tool sequence and builds deterministic context', async () => {
  const catalog = createRetrievalToolCatalog([
    {
      scope: 'universe/core',
      entries: [
        createEntry(1, 'Alice', ['alice', 'captain'], 'Alice commands the vanguard fleet.', 300, ['Bob']),
        createEntry(2, 'Bob', ['bob'], 'Bob is Alice\'s strategist and close ally.', 280, ['Alice']),
        createEntry(3, 'Sunreach', ['sunreach'], 'Sunreach is the capital city.', 100, [])
      ]
    }
  ]);

  let turn = 0;
  const planner: RetrievalToolPlanner = async () => {
    turn += 1;
    if (turn === 1) {
      return {
        assistantText: '',
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call-1',
            name: 'search_entries',
            argumentsJson: JSON.stringify({ query: 'alice captain', limit: 2 })
          }
        ]
      };
    }
    if (turn === 2) {
      return {
        assistantText: '',
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call-2',
            name: 'expand_neighbors',
            argumentsJson: JSON.stringify({ uid: 1, scope: 'universe/core', depth: 1, limit: 2 })
          }
        ]
      };
    }
    return {
      assistantText: 'done',
      finishReason: 'stop',
      toolCalls: []
    };
  };

  const result = await runModelDrivenRetrievalHooks({
    queryText: 'Focus on Alice and immediate allies',
    selectedScopes: ['universe/core'],
    contextTokenBudget: 600,
    catalog,
    planner,
    limits: {
      maxCalls: 4,
      maxResultTokens: 1200,
      maxPlanningTimeMs: 8000,
      maxInjectedEntries: 6
    }
  });

  assert.equal(result.stopReason, 'completed');
  assert.equal(result.executedCalls, 2);
  assert.ok(result.markdown.includes('## Tool Retrieval Context'));
  assert.ok(result.markdown.includes('Alice'));
  assert.ok(result.selectedItems.some(item => item.includes('Alice')));
  assert.ok(result.trace.some(item => item.includes('search_entries')));
  assert.ok(result.trace.some(item => item.includes('expand_neighbors')));
});

test('runModelDrivenRetrievalHooks enforces maxCalls per turn', async () => {
  const catalog = createRetrievalToolCatalog([
    {
      scope: 'universe',
      entries: [
        createEntry(1, 'Alice', ['alice'], 'Alice details.', 300),
        createEntry(2, 'Bob', ['bob'], 'Bob details.', 200)
      ]
    }
  ]);

  const planner: RetrievalToolPlanner = async () => ({
    assistantText: '',
    finishReason: 'tool_calls',
    toolCalls: [
      { id: 'c1', name: 'search_entries', argumentsJson: JSON.stringify({ query: 'alice', limit: 1 }) },
      { id: 'c2', name: 'get_entry', argumentsJson: JSON.stringify({ uid: 1 }) }
    ]
  });

  const result = await runModelDrivenRetrievalHooks({
    queryText: 'alice',
    selectedScopes: ['universe'],
    contextTokenBudget: 500,
    catalog,
    planner,
    limits: {
      maxCalls: 1,
      maxResultTokens: 1200,
      maxPlanningTimeMs: 8000,
      maxInjectedEntries: 6
    }
  });

  assert.equal(result.executedCalls, 1);
  assert.equal(result.stopReason, 'call_limit');
});

test('runModelDrivenRetrievalHooks enforces maxResultTokens per turn', async () => {
  const catalog = createRetrievalToolCatalog([
    {
      scope: 'universe',
      entries: [
        createEntry(1, 'Archive', ['archive'], 'A'.repeat(5000), 100)
      ]
    }
  ]);

  const planner: RetrievalToolPlanner = async () => ({
    assistantText: '',
    finishReason: 'tool_calls',
    toolCalls: [
      { id: 'c1', name: 'get_entry', argumentsJson: JSON.stringify({ uid: 1, contentChars: 4000 }) }
    ]
  });

  const result = await runModelDrivenRetrievalHooks({
    queryText: 'archive',
    selectedScopes: ['universe'],
    contextTokenBudget: 600,
    catalog,
    planner,
    limits: {
      maxCalls: 3,
      maxResultTokens: 24,
      maxPlanningTimeMs: 8000,
      maxInjectedEntries: 6
    }
  });

  assert.equal(result.executedCalls, 0);
  assert.equal(result.stopReason, 'result_token_limit');
  assert.equal(result.markdown, '');
});

test('runModelDrivenRetrievalHooks enforces maxPlanningTimeMs per turn', async () => {
  const catalog = createRetrievalToolCatalog([
    {
      scope: 'universe',
      entries: [
        createEntry(1, 'Alice', ['alice'], 'Alice details.', 100)
      ]
    }
  ]);

  const planner: RetrievalToolPlanner = async () => {
    await new Promise(resolve => setTimeout(resolve, 560));
    return {
      assistantText: '',
      finishReason: 'tool_calls',
      toolCalls: [
        { id: 'c1', name: 'search_entries', argumentsJson: JSON.stringify({ query: 'alice' }) }
      ]
    };
  };

  const result = await runModelDrivenRetrievalHooks({
    queryText: 'alice',
    selectedScopes: ['universe'],
    contextTokenBudget: 600,
    catalog,
    planner,
    limits: {
      maxCalls: 3,
      maxResultTokens: 1200,
      maxPlanningTimeMs: 500,
      maxInjectedEntries: 6
    }
  });

  assert.equal(result.stopReason, 'time_limit');
  assert.equal(result.executedCalls, 0);
});

test('runModelDrivenRetrievalHooks supports non-English search tokens', async () => {
  const catalog = createRetrievalToolCatalog([
    {
      scope: 'multiverse',
      entries: [
        createEntry(1, 'Герой', ['герой'], 'Описание героя.', 200),
        createEntry(2, '東京', ['東京'], '都市の説明。', 180)
      ]
    }
  ]);

  let turn = 0;
  const planner: RetrievalToolPlanner = async () => {
    turn += 1;
    if (turn === 1) {
      return {
        assistantText: '',
        finishReason: 'tool_calls',
        toolCalls: [
          { id: 'c1', name: 'search_entries', argumentsJson: JSON.stringify({ query: 'герой 東京', limit: 4 }) }
        ]
      };
    }
    return {
      assistantText: 'done',
      finishReason: 'stop',
      toolCalls: []
    };
  };

  const result = await runModelDrivenRetrievalHooks({
    queryText: 'герой 東京',
    selectedScopes: ['multiverse'],
    contextTokenBudget: 700,
    catalog,
    planner,
    limits: {
      maxCalls: 3,
      maxResultTokens: 1200,
      maxPlanningTimeMs: 3000,
      maxInjectedEntries: 6
    }
  });

  assert.equal(result.executedCalls, 1);
  assert.ok(result.selectedItems.some(item => item.includes('Герой')));
  assert.ok(result.selectedItems.some(item => item.includes('東京')));
});
