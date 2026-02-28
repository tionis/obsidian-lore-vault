import test from 'node:test';
import assert from 'node:assert/strict';
import { ConverterSettings, RagDocument } from '../src/models';
import { chunkRagDocuments } from '../src/rag-chunker';

function baseEmbeddingSettings(overrides: Partial<ConverterSettings['embeddings']> = {}): ConverterSettings['embeddings'] {
  return {
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
    maxChunkChars: 800,
    overlapChars: 120,
    ...overrides
  };
}

function doc(uid: number, title: string, content: string): RagDocument {
  return {
    uid,
    title,
    path: `notes/${title.toLowerCase().replace(/\s+/g, '-')}.md`,
    content,
    scope: 'universe'
  };
}

test('auto chunking keeps short notes as one chunk', async () => {
  const chunks = await chunkRagDocuments([
    doc(1, 'Aurelia', 'A short lore note.')
  ], baseEmbeddingSettings({ chunkingMode: 'auto' }));

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunkIndex, 0);
  assert.equal(chunks[0].title, 'Aurelia');
});

test('section chunking is heading-aware', async () => {
  const content = [
    '# Appearance',
    'Silver hair and blue eyes.',
    '',
    '# Backstory',
    'Born in the floating city and trained as a navigator.'
  ].join('\n');

  const chunks = await chunkRagDocuments([
    doc(2, 'Character Sheet', content)
  ], baseEmbeddingSettings({
    chunkingMode: 'section',
    minChunkChars: 10,
    maxChunkChars: 500
  }));

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].heading, 'Appearance');
  assert.equal(chunks[1].heading, 'Backstory');
});

test('note chunking splits long notes deterministically', async () => {
  const longText = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(120);
  const settings = baseEmbeddingSettings({
    chunkingMode: 'note',
    maxChunkChars: 600,
    overlapChars: 100
  });

  const firstRun = await chunkRagDocuments([doc(3, 'Long Note', longText)], settings);
  const secondRun = await chunkRagDocuments([doc(3, 'Long Note', longText)], settings);

  assert.ok(firstRun.length > 1);
  assert.deepEqual(
    firstRun.map(chunk => chunk.chunkId),
    secondRun.map(chunk => chunk.chunkId)
  );
});
