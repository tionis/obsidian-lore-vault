import { App } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';

export function resolveAbsoluteOutputPath(app: App, outputPath: string): string {
  if (path.isAbsolute(outputPath)) {
    return outputPath;
  }

  const adapter = app.vault.adapter as any;
  if (typeof adapter.getBasePath !== 'function') {
    throw new Error('Unable to resolve vault base path for SQLite output.');
  }

  const basePath = adapter.getBasePath() as string;
  return path.join(basePath, outputPath);
}

export function ensureParentDirectory(filePath: string): void {
  const dirPath = path.dirname(filePath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
