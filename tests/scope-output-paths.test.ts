import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertUniqueOutputPaths,
  resolveScopeOutputPaths,
  slugifyScope
} from '../src/scope-output-paths';

test('resolveScopeOutputPaths keeps deterministic extensions', () => {
  const resolved = resolveScopeOutputPaths('exports/lorevault.json', 'universe/yggdrasil', false);
  assert.equal(resolved.worldInfoPath, 'exports/lorevault.json');
  assert.equal(resolved.ragPath, 'exports/lorevault.rag.md');
  assert.equal(resolved.sqlitePath, 'exports/lorevault.lorevault.db');
});

test('resolveScopeOutputPaths appends slug for multi-scope builds', () => {
  const resolved = resolveScopeOutputPaths('exports/lorevault.json', 'universe/yggdrasil', true);
  assert.equal(resolved.worldInfoPath, 'exports/lorevault-universe-yggdrasil.json');
  assert.equal(resolved.ragPath, 'exports/lorevault-universe-yggdrasil.rag.md');
  assert.equal(resolved.sqlitePath, 'exports/lorevault-universe-yggdrasil.lorevault.db');
});

test('resolveScopeOutputPaths supports {scope} token', () => {
  const resolved = resolveScopeOutputPaths('exports/{scope}/pack', 'Universe/Árc', false);
  assert.equal(resolved.worldInfoPath, 'exports/universe-rc/pack.json');
  assert.equal(resolved.ragPath, 'exports/universe-rc/pack.rag.md');
  assert.equal(resolved.sqlitePath, 'exports/universe-rc/pack.lorevault.db');
});

test('resolveScopeOutputPaths supports custom sqlite base path', () => {
  const resolved = resolveScopeOutputPaths(
    'exports/{scope}/pack.json',
    'universe/yggdrasil',
    true,
    'packs/{scope}/canon.db'
  );
  assert.equal(resolved.sqlitePath, 'packs/universe-yggdrasil/canon.db');
});

test('assertUniqueOutputPaths throws on collisions', () => {
  const first = resolveScopeOutputPaths('exports/lorevault-{scope}', 'World A', false);
  const second = resolveScopeOutputPaths('exports/lorevault-{scope}', 'world-a', false);

  assert.throws(
    () => assertUniqueOutputPaths([
      { scope: 'World A', paths: first },
      { scope: 'world-a', paths: second }
    ]),
    /Output path collision detected/
  );
});

test('assertUniqueOutputPaths can ignore sqlite collisions when disabled', () => {
  const first = resolveScopeOutputPaths('exports/world-a.json', 'world-a', false, 'pack.db');
  const second = resolveScopeOutputPaths('exports/world-b.json', 'world-b', false, 'pack.db');

  assert.doesNotThrow(() => assertUniqueOutputPaths([
    { scope: 'world-a', paths: first },
    { scope: 'world-b', paths: second }
  ], { includeSqlite: false }));
});

test('slugifyScope maps empty scope to root', () => {
  assert.equal(slugifyScope(''), 'root');
});
