import { App } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import { ScopePack } from './models';
import { ScopeOutputPaths, slugifyScope } from './scope-output-paths';
import { ensureParentVaultFolderForFile, normalizeVaultPath } from './vault-path-utils';

export interface ScopeExportManifest {
  schemaVersion: number;
  generatedAt: number;
  scope: string;
  scopeSlug: string;
  canonicalArtifact: 'sqlite';
  artifacts: {
    sqlite: string;
    worldInfo: string;
    rag: string;
  };
  stats: {
    worldInfoEntries: number;
    ragDocuments: number;
    ragChunks: number;
    ragChunkEmbeddings: number;
  };
}

export function buildScopeExportManifest(
  pack: ScopePack,
  outputPaths: ScopeOutputPaths
): ScopeExportManifest {
  return {
    schemaVersion: 1,
    generatedAt: pack.generatedAt,
    scope: pack.scope,
    scopeSlug: slugifyScope(pack.scope),
    canonicalArtifact: 'sqlite',
    artifacts: {
      sqlite: normalizeVaultPath(outputPaths.sqlitePath),
      worldInfo: normalizeVaultPath(outputPaths.worldInfoPath),
      rag: normalizeVaultPath(outputPaths.ragPath)
    },
    stats: {
      worldInfoEntries: pack.worldInfoEntries.length,
      ragDocuments: pack.ragDocuments.length,
      ragChunks: pack.ragChunks.length,
      ragChunkEmbeddings: pack.ragChunkEmbeddings.length
    }
  };
}

export function serializeScopeExportManifest(manifest: ScopeExportManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function writeScopeExportManifest(
  app: App,
  manifest: ScopeExportManifest,
  outputPath: string
): Promise<void> {
  const normalizedOutputPath = normalizeVaultPath(outputPath);
  const serialized = serializeScopeExportManifest(manifest);

  if (!path.isAbsolute(outputPath)) {
    await ensureParentVaultFolderForFile(app, normalizedOutputPath);
    await app.vault.adapter.write(normalizedOutputPath, serialized);
    return;
  }

  const dirPath = path.dirname(outputPath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  fs.writeFileSync(outputPath, serialized, 'utf8');
}
