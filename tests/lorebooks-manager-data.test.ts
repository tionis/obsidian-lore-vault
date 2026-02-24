import test from 'node:test';
import assert from 'node:assert/strict';
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
    outputPath: '',
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
    ...overrides
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
  assert.equal(summary.worldInfoEntries, 3);
  assert.equal(summary.ragDocuments, 1);

  const byPath = new Map(summary.notes.map(entry => [entry.path, entry]));

  assert.equal(byPath.get('a.md')?.reason, 'included');
  assert.equal(byPath.get('a.md')?.includeWorldInfo, true);
  assert.equal(byPath.get('a.md')?.includeRag, false);

  assert.equal(byPath.get('b.md')?.reason, 'included');
  assert.equal(byPath.get('b.md')?.includeWorldInfo, false);
  assert.equal(byPath.get('b.md')?.includeRag, true);

  assert.equal(byPath.get('d.md')?.reason, 'retrieval_disabled');
  assert.equal(byPath.get('e.md')?.reason, 'included');
  assert.equal(byPath.get('e.md')?.includeWorldInfo, true);
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
