export function normalizeVaultPath(value: string): string {
  return value.replace(/\\/g, '/');
}

interface VaultAdapterLike {
  getAbstractFileByPath(path: string): unknown | null;
  createFolder(path: string): Promise<unknown>;
}

interface AppLike {
  vault: VaultAdapterLike;
}

export async function ensureVaultFolderExists(app: AppLike, folderPath: string): Promise<void> {
  const normalizedParts = normalizeVaultPath(folderPath)
    .split('/')
    .map(part => part.trim())
    .filter(Boolean);

  if (normalizedParts.length === 0) {
    return;
  }

  let current = '';
  for (const part of normalizedParts) {
    current = current ? `${current}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (!existing) {
      await app.vault.createFolder(current);
      continue;
    }

    const maybeFolderLike = existing as { children?: unknown };
    if (!('children' in maybeFolderLike)) {
      throw new Error(`Expected folder at "${current}" but found a file.`);
    }
  }
}

export async function ensureParentVaultFolderForFile(app: AppLike, filePath: string): Promise<void> {
  const normalizedPath = normalizeVaultPath(filePath);
  const slashIndex = normalizedPath.lastIndexOf('/');
  if (slashIndex <= 0) {
    return;
  }

  const parentPath = normalizedPath.slice(0, slashIndex);
  await ensureVaultFolderExists(app, parentPath);
}
