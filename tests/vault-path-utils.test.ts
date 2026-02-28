import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureParentVaultFolderForFile,
  getVaultBasename,
  getVaultDirname,
  getVaultExtname,
  joinVaultPath,
  normalizeVaultPathForComparison
} from '../src/vault-path-utils';

function createMockApp(existing: string[] = []) {
  const folders = new Set(existing);
  const created: string[] = [];
  const app = {
    vault: {
      getAbstractFileByPath: (targetPath: string) => {
        if (!folders.has(targetPath)) {
          return null;
        }
        return {
          path: targetPath,
          children: []
        };
      },
      createFolder: async (targetPath: string) => {
        folders.add(targetPath);
        created.push(targetPath);
      }
    }
  };

  return { app, created };
}

test('ensureParentVaultFolderForFile creates missing parent folders recursively', async () => {
  const { app, created } = createMockApp();

  await ensureParentVaultFolderForFile(app as any, 'lorebooks/sillytavern/world-info.json');

  assert.deepEqual(created, ['lorebooks', 'lorebooks/sillytavern']);
});

test('ensureParentVaultFolderForFile skips root-level files', async () => {
  const { app, created } = createMockApp();

  await ensureParentVaultFolderForFile(app as any, 'world-info.json');

  assert.deepEqual(created, []);
});

test('vault path helper functions normalize deterministic path semantics', () => {
  assert.equal(joinVaultPath('lorebooks/', '/sillytavern', 'pack.json'), 'lorebooks/sillytavern/pack.json');
  assert.equal(getVaultBasename('lorebooks/sillytavern/pack.json'), 'pack.json');
  assert.equal(getVaultDirname('lorebooks/sillytavern/pack.json'), 'lorebooks/sillytavern');
  assert.equal(getVaultExtname('lorebooks/sillytavern/pack.json'), '.json');
  assert.equal(normalizeVaultPathForComparison('lorebooks/./sillytavern/../sillytavern/pack.json'), 'lorebooks/sillytavern/pack.json');
});
