import { App } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';

function execFileAsync(cmd: string, args: string[], input?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const message = stderr || error.message;
        reject(new Error(message));
        return;
      }
      resolve({ stdout, stderr });
    });

    if (input !== undefined && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

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

export async function runSqliteScript(databasePath: string, script: string): Promise<void> {
  await execFileAsync('sqlite3', [databasePath], script);
}

export async function runSqliteJsonQuery<T>(databasePath: string, sql: string): Promise<T[]> {
  const { stdout } = await execFileAsync('sqlite3', ['-json', databasePath, sql]);
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }
  return JSON.parse(trimmed) as T[];
}
