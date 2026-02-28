export function normalizeVaultPath(value: string): string {
  return value.replace(/\\/g, '/');
}

export function joinVaultPath(...parts: string[]): string {
  const normalizedParts: string[] = [];
  for (const part of parts) {
    const normalized = normalizeVaultPath(part ?? '');
    if (!normalized) {
      continue;
    }
    for (const segment of normalized.split('/')) {
      const trimmed = segment.trim();
      if (!trimmed) {
        continue;
      }
      normalizedParts.push(trimmed);
    }
  }
  return normalizedParts.join('/');
}

export function getVaultBasename(value: string): string {
  const normalized = normalizeVaultPath(value ?? '').replace(/\/+$/, '');
  if (!normalized) {
    return '';
  }
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

export function getVaultDirname(value: string): string {
  const normalized = normalizeVaultPath(value ?? '').replace(/\/+$/, '');
  if (!normalized) {
    return '';
  }
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash < 0) {
    return '';
  }
  return normalized.slice(0, lastSlash);
}

export function getVaultExtname(value: string): string {
  const basename = getVaultBasename(value);
  const lastDot = basename.lastIndexOf('.');
  if (lastDot <= 0) {
    return '';
  }
  return basename.slice(lastDot);
}

export function normalizeVaultPathForComparison(value: string): string {
  const normalized = normalizeVaultPath(value ?? '');
  const segments = normalized.split('/');
  const resolved: string[] = [];
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed || trimmed === '.') {
      continue;
    }
    if (trimmed === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(trimmed);
  }
  return resolved.join('/');
}

export function isAbsoluteFilesystemPath(value: string): boolean {
  if (!value) {
    return false;
  }
  if (value.startsWith('/')) {
    return true;
  }
  return /^[A-Za-z]:[\\/]/.test(value);
}

export function normalizeVaultRelativePath(pathValue: string): string {
  const normalized = normalizeVaultPath((pathValue ?? '').trim());
  if (!normalized) {
    throw new Error('Output path is required.');
  }
  if (isAbsoluteFilesystemPath(normalized)) {
    throw new Error('Absolute filesystem paths are not supported. Use a vault-relative path.');
  }
  return normalized.replace(/^\/+/, '');
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
