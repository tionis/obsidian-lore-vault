import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRetrievalMode, resolveRetrievalTargets } from '../src/retrieval-routing';

test('parseRetrievalMode supports aliases and normalization', () => {
  assert.equal(parseRetrievalMode(undefined), undefined);
  assert.equal(parseRetrievalMode('auto'), 'auto');
  assert.equal(parseRetrievalMode('WORLD INFO'), 'world_info');
  assert.equal(parseRetrievalMode('world-info'), 'world_info');
  assert.equal(parseRetrievalMode('lorebook'), 'world_info');
  assert.equal(parseRetrievalMode('rag'), 'rag');
  assert.equal(parseRetrievalMode('both'), 'both');
  assert.equal(parseRetrievalMode('disabled'), 'none');
  assert.equal(parseRetrievalMode('not-a-mode'), undefined);
});

test('resolveRetrievalTargets applies auto routing by keyword presence', () => {
  assert.deepEqual(resolveRetrievalTargets('auto', true), {
    includeWorldInfo: true,
    includeRag: false
  });
  assert.deepEqual(resolveRetrievalTargets('auto', false), {
    includeWorldInfo: false,
    includeRag: true
  });
});

test('resolveRetrievalTargets respects explicit routing modes', () => {
  assert.deepEqual(resolveRetrievalTargets('world_info', false), {
    includeWorldInfo: true,
    includeRag: false
  });
  assert.deepEqual(resolveRetrievalTargets('rag', true), {
    includeWorldInfo: false,
    includeRag: true
  });
  assert.deepEqual(resolveRetrievalTargets('both', false), {
    includeWorldInfo: true,
    includeRag: true
  });
  assert.deepEqual(resolveRetrievalTargets('none', true), {
    includeWorldInfo: false,
    includeRag: false
  });
});
