import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureParentVaultFolderForFile } from '../src/vault-path-utils';

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
