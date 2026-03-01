import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import * as path from 'path';
import { GraphAnalyzer } from '../src/graph-analyzer';
import { ConverterSettings, LoreBookEntry } from '../src/models';

interface DeterminismFixture {
  rootUid: number | null;
  weights: ConverterSettings['weights'];
  entries: Array<{
    uid: number;
    group: string;
    wikilinks: string[];
  }>;
  expectedOrders: {[key: string]: number};
}

function readFixture<T>(relativePath: string): T {
  const fixturePath = path.join(__dirname, '..', '..', 'fixtures', relativePath);
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as T;
}

function createEntry(uid: number, group: string, wikilinks: string[]): LoreBookEntry {
  return {
    uid,
    key: [`entry-${uid}`],
    keysecondary: [],
    comment: `Entry ${uid}`,
    content: `Content ${uid}`,
    constant: false,
    vectorized: false,
    selective: true,
    selectiveLogic: 0,
    addMemo: true,
    order: 0,
    position: 0,
    disable: false,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: false,
    probability: 100,
    useProbability: true,
    depth: 4,
    group,
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

function createSettings(weights: ConverterSettings['weights']): ConverterSettings {
  return {
    tagScoping: {
      tagPrefix: 'lorebook',
      activeScope: '',
      membershipMode: 'exact',
      includeUntagged: false
    },
    weights,
    outputPath: '',
    defaultLoreBook: {
      orderByTitle: false,
      useDroste: true,
      useRecursion: true,
      tokenBudget: 2048,
      recursionBudget: 100
    },
    defaultEntry: {
      constant: false,
      vectorized: false,
      selective: true,
      selectiveLogic: 0,
      probability: 100,
      depth: 4,
      groupWeight: 100
    },
    sqlite: {
      enabled: true,
      outputPath: ''
    },
    embeddings: {
      enabled: false,
      provider: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1',
      apiKey: '',
      model: 'qwen/qwen3-embedding-8b',
      instruction: '',
      batchSize: 16,
      timeoutMs: 45000,
      cacheDir: '.obsidian/plugins/lore-vault/cache/embeddings',
      chunkingMode: 'auto',
      minChunkChars: 300,
      maxChunkChars: 1800,
      overlapChars: 200
    },
    retrieval: {
      maxGraphHops: 2,
      graphHopDecay: 0.55,
      includeBacklinksInGraphExpansion: true,
      ragFallbackPolicy: 'auto',
      ragFallbackSeedScoreThreshold: 120,
      toolCalls: {
        enabled: false,
        maxCallsPerTurn: 4,
        maxResultTokensPerTurn: 1200,
        maxPlanningTimeMs: 8000
      }
    },
    summaries: {
      promptVersion: 1,
      maxInputChars: 12000,
      maxSummaryChars: 320
    },
    costTracking: {
      enabled: false,
      ledgerPath: '.obsidian/plugins/lore-vault/cache/usage-ledger.json',
      defaultInputCostPerMillionUsd: 0,
      defaultOutputCostPerMillionUsd: 0,
      reportOutputDir: '.obsidian/plugins/lore-vault/reports',
      dailyBudgetUsd: 0,
      sessionBudgetUsd: 0,
      modelPricingOverrides: [],
      budgetByOperationUsd: {},
      budgetByModelUsd: {},
      budgetByScopeUsd: {}
    },
    operationLog: {
      enabled: false,
      path: '.obsidian/plugins/lore-vault/cache/llm-operation-log.jsonl',
      maxEntries: 400,
      includeEmbeddings: false
    },
    completion: {
      enabled: false,
      provider: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1',
      apiKey: '',
      model: 'openai/gpt-4o-mini',
      systemPrompt: 'Continue the story.',
      temperature: 0.7,
      maxOutputTokens: 700,
      contextWindowTokens: 8192,
      promptReserveTokens: 400,
      timeoutMs: 60000,
      layerPlacement: {
        pinnedInstructions: 'system',
        storyNotes: 'pre_history',
        sceneIntent: 'pre_response',
        inlineDirectives: 'pre_response'
      },
      presets: [],
      activePresetId: ''
    },
    storyChat: {
      chatFolder: 'LoreVault/chat',
      activeConversationPath: '',
      selectedScopes: [],
      useLorebookContext: true,
      manualContext: '',
      steeringScopeRefs: [],
      pinnedInstructions: '',
      storyNotes: '',
      sceneIntent: '',
      continuityPlotThreads: [],
      continuityOpenLoops: [],
      continuityCanonDeltas: [],
      continuitySelection: {
        includePlotThreads: true,
        includeOpenLoops: true,
        includeCanonDeltas: true
      },
      noteContextRefs: [],
      messages: [],
      forkSnapshots: [],
      maxMessages: 80,
      toolCalls: {
        enabled: false,
        maxCallsPerTurn: 6,
        maxResultTokensPerTurn: 2400,
        maxPlanningTimeMs: 10000,
        allowWriteActions: false
      }
    },
    storySteering: {
      folder: 'LoreVault/steering',
      extractionSanitization: 'strict'
    },
    textCommands: {
      autoAcceptEdits: false,
      defaultIncludeLorebookContext: false,
      maxContextTokens: 1400,
      systemPrompt: 'You are a precise editing assistant.',
      promptsFolder: 'LoreVault/prompts/text-commands'
    }
  };
}

function calculateOrders(fixture: DeterminismFixture): {[key: string]: number} {
  const entries: {[key: number]: LoreBookEntry} = {};
  for (const entry of fixture.entries) {
    entries[entry.uid] = createEntry(entry.uid, entry.group, entry.wikilinks);
  }

  const analyzer = new GraphAnalyzer(entries, {}, createSettings(fixture.weights), fixture.rootUid);
  analyzer.buildGraph();
  analyzer.calculateEntryPriorities();

  const orders: {[key: string]: number} = {};
  for (const entry of fixture.entries) {
    orders[entry.uid.toString()] = entries[entry.uid].order;
  }

  return orders;
}

test('graph priority ties remain deterministic across repeated runs', () => {
  const fixture = readFixture<DeterminismFixture>(path.join('graph', 'deterministic-ties.json'));

  const runs = 10;
  const observed = Array.from({ length: runs }, () => calculateOrders(fixture));

  for (const result of observed) {
    assert.deepEqual(result, fixture.expectedOrders);
  }
});
