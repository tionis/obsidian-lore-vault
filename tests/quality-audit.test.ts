import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQualityAuditRows, describeQualityAuditSimilarityMode } from '../src/quality-audit';
import { LoreBookEntry, RagChunk, RagChunkEmbedding, RagDocument } from '../src/models';

function entry(uid: number, comment: string, key: string[], content: string): LoreBookEntry {
  return {
    uid,
    key,
    keysecondary: [],
    comment,
    content,
    constant: false,
    vectorized: false,
    selective: true,
    selectiveLogic: 0,
    addMemo: true,
    order: 100,
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
    displayIndex: 0
  };
}

test('buildQualityAuditRows marks missing keywords and duplicate-like entries', () => {
  const entries = [
    entry(1, 'Aurelia', ['Aurelia'], 'A bright world with multiple factions and arcstone trade routes.'),
    entry(2, 'Aurelia Duplicate', [], 'A bright world with multiple factions and arcstone trade routes.'),
    entry(3, 'Sparse Note', [], 'Short.')
  ];
  const ragDocuments: RagDocument[] = [
    { uid: 1, title: 'Aurelia', path: 'aurelia.md', content: 'Doc A', scope: 'universe' },
    { uid: 2, title: 'Aurelia Duplicate', path: 'aurelia-dup.md', content: 'Doc B', scope: 'universe' },
    { uid: 3, title: 'Sparse Note', path: 'sparse.md', content: 'Doc C', scope: 'universe' }
  ];
  const ragChunks: RagChunk[] = [
    { chunkId: 'c1', docUid: 1, scope: 'universe', path: 'aurelia.md', title: 'A', chunkIndex: 0, heading: '', text: 'A', textHash: 'h1', tokenEstimate: 4, startOffset: 0, endOffset: 1 },
    { chunkId: 'c2', docUid: 2, scope: 'universe', path: 'aurelia-dup.md', title: 'B', chunkIndex: 0, heading: '', text: 'B', textHash: 'h2', tokenEstimate: 4, startOffset: 0, endOffset: 1 },
    { chunkId: 'c3', docUid: 3, scope: 'universe', path: 'sparse.md', title: 'C', chunkIndex: 0, heading: '', text: 'C', textHash: 'h3', tokenEstimate: 4, startOffset: 0, endOffset: 1 }
  ];
  const ragChunkEmbeddings: RagChunkEmbedding[] = [
    { chunkId: 'c1', provider: 'p', model: 'm', dimensions: 3, vector: [1, 0, 0], cacheKey: 'k1', createdAt: 1 },
    { chunkId: 'c2', provider: 'p', model: 'm', dimensions: 3, vector: [0.999, 0.001, 0], cacheKey: 'k2', createdAt: 1 },
    { chunkId: 'c3', provider: 'p', model: 'm', dimensions: 3, vector: [0, 1, 0], cacheKey: 'k3', createdAt: 1 }
  ];

  const rows = buildQualityAuditRows({
    entries,
    ragDocuments,
    ragChunks,
    ragChunkEmbeddings,
    worldInfoBodyByUid: {
      1: 'Longer body text for aurelia.',
      2: 'Longer body text for duplicate.',
      3: 'Short.'
    }
  });

  const duplicate = rows.find(row => row.uid === 2);
  assert.ok(duplicate);
  assert.equal(duplicate?.canGenerateKeywords, true);
  assert.equal(Boolean(duplicate?.path), true);
  assert.equal(Boolean(duplicate?.bestSimilarPath), true);
  assert.ok((duplicate?.reasons ?? []).some(reason => {
    const lowered = reason.toLowerCase();
    return lowered.includes('similar') || lowered.includes('duplicate');
  }));

  const sparse = rows.find(row => row.uid === 3);
  assert.ok(sparse);
  assert.ok((sparse?.reasons ?? []).some(reason => reason.toLowerCase().includes('missing explicit keywords')));
  assert.ok((sparse?.reasons ?? []).some(reason => reason.toLowerCase().includes('very short')));
});

test('quality audit similarity mode message reflects embeddings presence', () => {
  const withEmbeddings = describeQualityAuditSimilarityMode({
    ragChunks: [{ chunkId: 'c1', docUid: 1, scope: 's', path: 'p', title: 't', chunkIndex: 0, heading: '', text: 'x', textHash: 'h', tokenEstimate: 1, startOffset: 0, endOffset: 1 }],
    ragChunkEmbeddings: [{ chunkId: 'c1', provider: 'p', model: 'm', dimensions: 1, vector: [1], cacheKey: 'k', createdAt: 1 }]
  });
  assert.match(withEmbeddings, /embeddings \+ heuristics/i);

  const heuristicsOnly = describeQualityAuditSimilarityMode({
    ragChunks: [{ chunkId: 'c1', docUid: 1, scope: 's', path: 'p', title: 't', chunkIndex: 0, heading: '', text: 'x', textHash: 'h', tokenEstimate: 1, startOffset: 0, endOffset: 1 }],
    ragChunkEmbeddings: []
  });
  assert.match(heuristicsOnly, /heuristics only/i);
});
