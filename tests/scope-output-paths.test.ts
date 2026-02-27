import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertUniqueOutputPaths,
  resolveScopeOutputPaths,
  slugifyScope
} from '../src/scope-output-paths';

test('resolveScopeOutputPaths keeps deterministic extensions', () => {
  const resolved = resolveScopeOutputPaths('sillytavern/lorevault.json', 'universe/yggdrasil', false);
  assert.equal(resolved.worldInfoPath, 'lorebooks/sillytavern/lorevault-universe-yggdrasil.json');
  assert.equal(resolved.ragPath, 'lorebooks/sillytavern/lorevault-universe-yggdrasil.rag.md');
  assert.equal(resolved.sqlitePath, 'lorebooks/universe-yggdrasil.db');
});

test('resolveScopeOutputPaths appends slug regardless of build mode', () => {
  const singleScope = resolveScopeOutputPaths('sillytavern/lorevault.json', 'universe/yggdrasil', false);
  const multiScope = resolveScopeOutputPaths('sillytavern/lorevault.json', 'universe/yggdrasil', true);
  assert.equal(singleScope.worldInfoPath, multiScope.worldInfoPath);
  assert.equal(singleScope.ragPath, multiScope.ragPath);
  assert.equal(singleScope.sqlitePath, multiScope.sqlitePath);
});

test('resolveScopeOutputPaths supports {scope} token', () => {
  const resolved = resolveScopeOutputPaths('{scope}/pack', 'Universe/Árc', false);
  assert.equal(resolved.worldInfoPath, 'lorebooks/universe-rc/pack.json');
  assert.equal(resolved.ragPath, 'lorebooks/universe-rc/pack.rag.md');
  assert.equal(resolved.sqlitePath, 'lorebooks/universe-rc.db');
});

test('resolveScopeOutputPaths supports custom sqlite base path', () => {
  const resolved = resolveScopeOutputPaths(
    'sillytavern/pack.json',
    'universe/yggdrasil',
    true,
    'packs/{scope}/canon.db'
  );
  assert.equal(resolved.worldInfoPath, 'packs/universe-yggdrasil/sillytavern/pack-universe-yggdrasil.json');
  assert.equal(resolved.ragPath, 'packs/universe-yggdrasil/sillytavern/pack-universe-yggdrasil.rag.md');
  assert.equal(resolved.sqlitePath, 'packs/universe-yggdrasil/canon.db');
});

test('resolveScopeOutputPaths normalizes backslash separators to vault-style paths', () => {
  const resolved = resolveScopeOutputPaths(
    'sillytavern\\lorevault.json',
    'characters/minor',
    false,
    'lorebooks\\'
  );
  assert.equal(resolved.worldInfoPath, 'lorebooks/sillytavern/lorevault-characters-minor.json');
  assert.equal(resolved.ragPath, 'lorebooks/sillytavern/lorevault-characters-minor.rag.md');
  assert.equal(resolved.sqlitePath, 'lorebooks/characters-minor.db');
});

test('assertUniqueOutputPaths throws on collisions', () => {
  const first = resolveScopeOutputPaths('sillytavern/lorevault-{scope}', 'World A', false);
  const second = resolveScopeOutputPaths('sillytavern/lorevault-{scope}', 'world-a', false);

  assert.throws(
    () => assertUniqueOutputPaths([
      { scope: 'World A', paths: first },
      { scope: 'world-a', paths: second }
    ]),
    /Output path collision detected/
  );
});

test('assertUniqueOutputPaths can ignore sqlite collisions when disabled', () => {
  const first = resolveScopeOutputPaths('one.json', 'World A', false, 'pack.db');
  const second = resolveScopeOutputPaths('two.json', 'world-a', false, 'pack.db');

  assert.doesNotThrow(() => assertUniqueOutputPaths([
    { scope: 'World A', paths: first },
    { scope: 'world-a', paths: second }
  ], { includeSqlite: false }));
});

test('slugifyScope maps empty scope to root', () => {
  assert.equal(slugifyScope(''), 'root');
});
