import test from 'node:test';
import assert from 'node:assert/strict';
import { isActiveGenerationState } from '../src/generation-state';

test('isActiveGenerationState returns true only while a run is in flight', () => {
  assert.equal(isActiveGenerationState('idle'), false);
  assert.equal(isActiveGenerationState('preparing'), true);
  assert.equal(isActiveGenerationState('retrieving'), true);
  assert.equal(isActiveGenerationState('generating'), true);
  assert.equal(isActiveGenerationState('error'), false);
});
