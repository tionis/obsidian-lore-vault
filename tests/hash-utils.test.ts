import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex, stableJsonHash } from '../src/hash-utils';

function nodeSha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

test('sha256Hex matches node crypto for representative strings', () => {
  const values = [
    '',
    'abc',
    'hello world',
    'The quick brown fox jumps over the lazy dog',
    'The quick brown fox jumps over the lazy dog.',
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
    'こんにちは世界',
    '🚀 LoreVault mobile hashing'
  ];

  for (const value of values) {
    assert.equal(sha256Hex(value), nodeSha256Hex(value), `hash mismatch for "${value}"`);
  }
});

test('sha256Hex matches node crypto for long multiline unicode text', () => {
  const value = [
    '# Chapter 12',
    '',
    'Aurelia crossed the ridge and saw the torchlines below.',
    'This line contains unicode: äöü ß 你好 世界',
    'And emoji for stress-testing: 🔥🌌🧭',
    '',
    '---',
    '',
    'Repeat block '.repeat(500)
  ].join('\n');

  assert.equal(sha256Hex(value), nodeSha256Hex(value));
});

test('stableJsonHash is deterministic and consistent with sha256(JSON.stringify)', () => {
  const payload = {
    scope: 'universe/yggdrasil',
    entries: [1, 2, 3],
    flags: { fallback: 'auto', backlinks: true }
  };

  const expected = nodeSha256Hex(JSON.stringify(payload));
  assert.equal(stableJsonHash(payload), expected);
  assert.equal(stableJsonHash(payload), stableJsonHash(payload));
});
