import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveQueryEmbedding } from '../src/query-embedding-utils';

test('resolveQueryEmbedding computes once when no precomputed embedding is supplied', async () => {
  let computeCalls = 0;
  const vector = await resolveQueryEmbedding(undefined, true, async () => {
    computeCalls += 1;
    return [0.4, 0.5, 0.6];
  });

  assert.deepEqual(vector, [0.4, 0.5, 0.6]);
  assert.equal(computeCalls, 1);
});

test('resolveQueryEmbedding reuses provided embeddings and skips recomputation', async () => {
  let computeCalls = 0;

  const vector = await resolveQueryEmbedding([0.9, 0.8, 0.7], true, async () => {
    computeCalls += 1;
    return [0.4, 0.5, 0.6];
  });
  const emptyVector = await resolveQueryEmbedding(null, true, async () => {
    computeCalls += 1;
    return [0.1, 0.2, 0.3];
  });

  assert.deepEqual(vector, [0.9, 0.8, 0.7]);
  assert.equal(emptyVector, null);
  assert.equal(computeCalls, 0);
});

test('resolveQueryEmbedding skips computation when semantic scoring is not needed', async () => {
  let computeCalls = 0;
  const vector = await resolveQueryEmbedding(undefined, false, async () => {
    computeCalls += 1;
    return [0.4, 0.5, 0.6];
  });

  assert.equal(vector, null);
  assert.equal(computeCalls, 0);
});
