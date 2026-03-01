import { App } from 'obsidian';
import { ensureParentVaultFolderForFile, normalizeVaultRelativePath } from './vault-path-utils';

export function normalizeVaultFilePath(pathValue: string): string {
  return normalizeVaultRelativePath(pathValue);
}

export async function writeVaultBinary(
  app: App,
  outputPath: string,
  bytes: Uint8Array
): Promise<string> {
  const normalizedPath = normalizeVaultFilePath(outputPath);
  await ensureParentVaultFolderForFile(app, normalizedPath);
  const payload = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(payload).set(bytes);
  await app.vault.adapter.writeBinary(
    normalizedPath,
    payload
  );
  return normalizedPath;
}

export async function readVaultBinary(
  app: App,
  inputPath: string
): Promise<Uint8Array> {
  const normalizedPath = normalizeVaultFilePath(inputPath);
  const bytes = await app.vault.adapter.readBinary(normalizedPath);
  return new Uint8Array(bytes);
}
