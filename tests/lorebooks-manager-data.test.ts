import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import * as path from 'path';
import { ConverterSettings } from '../src/models';
import {
  LorebookNoteMetadata,
  buildScopeSummaries
} from '../src/lorebooks-manager-data';

function createSettings(overrides: Partial<ConverterSettings> = {}): ConverterSettings {
  return {
    tagScoping: {
      tagPrefix: 'lorebook',
      activeScope: '',
      membershipMode: 'cascade',
      includeUntagged: false,
      ...(overrides.tagScoping ?? {})
    },
    weights: {
      hierarchy: 8000,
      in_degree: 4000,
      pagerank: 2000,
      betweenness: 1000,
      out_degree: 500,
      total_degree: 100,
      file_depth: 2000,
      ...(overrides.weights ?? {})
    },
    outputPath: overrides.outputPath ?? '',
    defaultLoreBook: {
      orderByTitle: false,
      useDroste: true,
      useRecursion: true,
      tokenBudget: 2048,
      recursionBudget: 100,
      ...(overrides.defaultLoreBook ?? {})
    },
    defaultEntry: {
      constant: false,
      vectorized: false,
      selective: true,
      selectiveLogic: 0,
      probability: 100,
      depth: 4,
      groupWeight: 100,
      ...(overrides.defaultEntry ?? {})
    },
    sqlite: {
      enabled: true,
      outputPath: '',
      ...(overrides.sqlite ?? {})
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
      overlapChars: 200,
      ...(overrides.embeddings ?? {})
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
      },
      ...(overrides.retrieval ?? {})
    },
    summaries: {
      promptVersion: 1,
      maxInputChars: 12000,
      maxSummaryChars: 320,
      ...(overrides.summaries ?? {})
    },
    costTracking: {
      enabled: false,
      ledgerPath: '.obsidian/plugins/lore-vault/cache/usage-ledger.json',
      defaultInputCostPerMillionUsd: 0,
      defaultOutputCostPerMillionUsd: 0,
      reportOutputDir: '.obsidian/plugins/lore-vault/reports',
      dailyBudgetUsd: 0,
      sessionBudgetUsd: 0,
      ...(overrides.costTracking ?? {})
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
      presets: [],
      activePresetId: '',
      ...(overrides.completion ?? {})
    },
    storyChat: {
      chatFolder: 'LoreVault/chat',
      activeConversationPath: '',
      selectedScopes: [],
      useLorebookContext: true,
      manualContext: '',
      noteContextRefs: [],
      messages: [],
      forkSnapshots: [],
      maxMessages: 80,
      ...(overrides.storyChat ?? {})
    },
    textCommands: {
      autoAcceptEdits: false,
      defaultIncludeLorebookContext: false,
      maxContextTokens: 1400,
      systemPrompt: 'You are a precise editing assistant.',
      promptsFolder: 'LoreVault/prompts/text-commands',
      ...(overrides.textCommands ?? {})
    }
  };
}

function note(
  path: string,
  scopes: string[],
  frontmatter: LorebookNoteMetadata['frontmatter']
): LorebookNoteMetadata {
  const basename = path.split('/').pop()?.replace(/\.md$/i, '') ?? path;
  return { path, basename, scopes, frontmatter };
}

function readFixture<T>(relativePath: string): T {
  const fixturePath = path.join(__dirname, '..', '..', 'fixtures', relativePath);
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as T;
}

interface MixedRoutingFixture {
  settings: {
    activeScope: string;
    membershipMode: 'exact' | 'cascade';
    includeUntagged: boolean;
  };
  notes: Array<{
    path: string;
    scopes: string[];
    frontmatter: LorebookNoteMetadata['frontmatter'];
    expected: {
      reason: string;
      includeWorldInfo: boolean;
      includeRag: boolean;
    };
  }>;
  expectedSummary: {
    scope: string;
    includedNotes: number;
    worldInfoEntries: number;
    ragDocuments: number;
    keywordlessEntries: number;
  };
}

test('buildScopeSummaries routes notes to world_info and rag with overrides', () => {
  const settings = createSettings({
    tagScoping: {
      tagPrefix: 'lorebook',
      activeScope: 'universe',
      membershipMode: 'cascade',
      includeUntagged: false
    }
  });

  const notes: LorebookNoteMetadata[] = [
    note('a.md', ['universe'], { keywords: ['A'] }),
    note('b.md', ['universe'], {}),
    note('c.md', ['universe/child'], { keywords: ['C'] }),
    note('d.md', ['universe'], { retrieval: 'none', keywords: ['D'] }),
    note('e.md', ['universe'], { retrieval: 'world_info' }),
    note('f.md', ['universe'], { exclude: true, keywords: ['F'] })
  ];

  const summaries = buildScopeSummaries(notes, settings);
  assert.equal(summaries.length, 1);

  const summary = summaries[0];
  assert.equal(summary.scope, 'universe');
  assert.equal(summary.includedNotes, 4);
  assert.equal(summary.worldInfoEntries, 4);
  assert.equal(summary.ragDocuments, 4);
  assert.equal(summary.keywordlessEntries, 2);

  const byPath = new Map(summary.notes.map(entry => [entry.path, entry]));

  assert.equal(byPath.get('a.md')?.reason, 'included');
  assert.equal(byPath.get('a.md')?.includeWorldInfo, true);
  assert.equal(byPath.get('a.md')?.includeRag, true);
  assert.equal(byPath.get('a.md')?.keywordCount, 1);

  assert.equal(byPath.get('b.md')?.reason, 'included');
  assert.equal(byPath.get('b.md')?.includeWorldInfo, true);
  assert.equal(byPath.get('b.md')?.includeRag, true);
  assert.equal(byPath.get('b.md')?.keywordCount, 0);

  assert.equal(byPath.get('d.md')?.reason, 'retrieval_disabled');
  assert.equal(byPath.get('e.md')?.reason, 'included');
  assert.equal(byPath.get('e.md')?.includeWorldInfo, true);
  assert.equal(byPath.get('e.md')?.includeRag, true);
  assert.equal(byPath.get('f.md')?.reason, 'excluded_by_frontmatter');
});

test('buildScopeSummaries disables includeUntagged while building all discovered scopes', () => {
  const settings = createSettings({
    tagScoping: {
      tagPrefix: 'lorebook',
      activeScope: '',
      membershipMode: 'exact',
      includeUntagged: true
    }
  });

  const notes: LorebookNoteMetadata[] = [
    note('tagged.md', ['universe'], { keywords: ['Tagged'] }),
    note('untagged.md', [], { keywords: ['Untagged'] })
  ];

  const summaries = buildScopeSummaries(notes, settings);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].scope, 'universe');

  const untagged = summaries[0].notes.find(entry => entry.path === 'untagged.md');
  assert.equal(untagged?.reason, 'untagged_excluded');
});

test('buildScopeSummaries follows fixture-defined mixed routing and cascade behavior', () => {
  const fixture = readFixture<MixedRoutingFixture>(path.join('lorebooks-manager-data', 'mixed-routing.json'));
  const settings = createSettings({
    tagScoping: {
      tagPrefix: 'lorebook',
      activeScope: fixture.settings.activeScope,
      membershipMode: fixture.settings.membershipMode,
      includeUntagged: fixture.settings.includeUntagged
    }
  });

  const notes: LorebookNoteMetadata[] = fixture.notes.map(item =>
    note(item.path, item.scopes, item.frontmatter)
  );

  const summaries = buildScopeSummaries(notes, settings);
  assert.equal(summaries.length, 1);

  const summary = summaries[0];
  assert.equal(summary.scope, fixture.expectedSummary.scope);
  assert.equal(summary.includedNotes, fixture.expectedSummary.includedNotes);
  assert.equal(summary.worldInfoEntries, fixture.expectedSummary.worldInfoEntries);
  assert.equal(summary.ragDocuments, fixture.expectedSummary.ragDocuments);
  assert.equal(summary.keywordlessEntries, fixture.expectedSummary.keywordlessEntries);

  const byPath = new Map(summary.notes.map(entry => [entry.path, entry]));
  for (const item of fixture.notes) {
    const actual = byPath.get(item.path);
    assert.ok(actual, `missing note debug row for ${item.path}`);
    assert.equal(actual?.reason, item.expected.reason, `${item.path}: reason mismatch`);
    assert.equal(actual?.includeWorldInfo, item.expected.includeWorldInfo, `${item.path}: includeWorldInfo mismatch`);
    assert.equal(actual?.includeRag, item.expected.includeRag, `${item.path}: includeRag mismatch`);
  }
});
