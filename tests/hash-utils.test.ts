import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex, sha256HexAsync, stableJsonHash, stableJsonHashAsync } from '../src/hash-utils';

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

test('sha256HexAsync matches node crypto and sync helper', async () => {
  const values = [
    '',
    'story context',
    'unicode ✅ lore',
    'Large line '.repeat(120)
  ];

  for (const value of values) {
    const expected = nodeSha256Hex(value);
    assert.equal(await sha256HexAsync(value), expected);
    assert.equal(await sha256HexAsync(value), sha256Hex(value));
  }
});

test('sha256HexAsync falls back to sync hashing when WebCrypto is unavailable', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    enumerable: true,
    value: undefined
  });

  try {
    const value = 'fallback path check';
    assert.equal(await sha256HexAsync(value), sha256Hex(value));
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, 'crypto', descriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'crypto');
    }
  }
});

test('stableJsonHashAsync matches sync stable hash', async () => {
  const payload = {
    chapter: 12,
    directives: ['Keep pace brisk', 'Reveal motive at midpoint'],
    scope: 'universe/yggdrasil'
  };

  assert.equal(await stableJsonHashAsync(payload), stableJsonHash(payload));
});
