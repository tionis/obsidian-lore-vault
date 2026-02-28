import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVaultFilePath } from '../src/vault-binary-io';

test('normalizeVaultFilePath normalizes relative vault paths', () => {
  assert.equal(normalizeVaultFilePath(' lorebooks\\universe.db '), 'lorebooks/universe.db');
});

test('normalizeVaultFilePath rejects absolute paths', () => {
  assert.throws(() => normalizeVaultFilePath('C:\\tmp\\pack.db'));
  assert.throws(() => normalizeVaultFilePath('/tmp/pack.db'));
  assert.throws(() => normalizeVaultFilePath('/lorebooks/universe.db'));
});

test('normalizeVaultFilePath rejects empty paths', () => {
  assert.throws(() => normalizeVaultFilePath('   '));
});
