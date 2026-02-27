import * as path from 'path';
import { normalizeScope } from './lorebook-scoping';

export interface ScopeOutputPaths {
  worldInfoPath: string;
  ragPath: string;
  sqlitePath: string;
  manifestPath: string;
}

export interface ScopeOutputAssignment {
  scope: string;
  paths: ScopeOutputPaths;
}

const DEFAULT_SQLITE_OUTPUT_DIR = 'lorebooks';
const DEFAULT_DOWNSTREAM_SUBPATH = 'sillytavern/lorevault.json';

function normalizeVaultPathSeparators(value: string): string {
  return value.replace(/\\/g, '/');
}

export function slugifyScope(scope: string): string {
  const normalized = normalizeScope(scope);
  const slug = normalized
    .replace(/[/\\]+/g, '-')
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'root';
}

function resolveSqlitePath(scopeSlug: string, sqliteBaseOutputPath?: string): string {
  const configured = normalizeVaultPathSeparators(sqliteBaseOutputPath?.trim() || DEFAULT_SQLITE_OUTPUT_DIR);
  const sqliteExt = path.extname(configured);
  const hasDbExt = sqliteExt.toLowerCase() === '.db';

  if (hasDbExt) {
    const rawStem = configured.slice(0, -sqliteExt.length);
    const stemWithScope = rawStem.includes('{scope}')
      ? rawStem.replace(/\{scope\}/g, scopeSlug)
      : `${rawStem}-${scopeSlug}`;
    return normalizeVaultPathSeparators(`${stemWithScope}.db`);
  }

  const outputDir = configured.includes('{scope}')
    ? configured.replace(/\{scope\}/g, scopeSlug)
    : configured;
  return normalizeVaultPathSeparators(path.join(outputDir, `${scopeSlug}.db`));
}

function resolveDownstreamBasePath(baseOutputPath: string, sqlitePath: string): string {
  const configured = normalizeVaultPathSeparators((baseOutputPath || '').trim() || DEFAULT_DOWNSTREAM_SUBPATH);
  const relativeSubpath = path.isAbsolute(configured)
    ? (path.basename(configured) || path.basename(DEFAULT_DOWNSTREAM_SUBPATH))
    : configured.replace(/^[/\\]+/, '');
  return normalizeVaultPathSeparators(path.join(path.dirname(sqlitePath), relativeSubpath));
}

function resolveManifestPath(sqlitePath: string): string {
  const ext = path.extname(sqlitePath);
  if (ext.toLowerCase() === '.db') {
    return normalizeVaultPathSeparators(`${sqlitePath.slice(0, -ext.length)}.manifest.json`);
  }
  return normalizeVaultPathSeparators(`${sqlitePath}.manifest.json`);
}

export function resolveScopeOutputPaths(
  baseOutputPath: string,
  scope: string,
  _buildAllScopes: boolean,
  sqliteBaseOutputPath?: string
): ScopeOutputPaths {
  const scopeSlug = slugifyScope(scope);
  const sqlitePath = resolveSqlitePath(scopeSlug, sqliteBaseOutputPath);
  const downstreamBasePath = resolveDownstreamBasePath(baseOutputPath, sqlitePath);
  const ext = path.extname(downstreamBasePath);
  const hasJsonExt = ext.toLowerCase() === '.json';
  const stem = hasJsonExt
    ? downstreamBasePath.slice(0, -ext.length)
    : downstreamBasePath;

  let stemWithScope = stem;
  if (stem.includes('{scope}')) {
    stemWithScope = stem.replace(/\{scope\}/g, scopeSlug);
  } else {
    stemWithScope = `${stem}-${scopeSlug}`;
  }

  return {
    worldInfoPath: normalizeVaultPathSeparators(`${stemWithScope}.json`),
    ragPath: normalizeVaultPathSeparators(`${stemWithScope}.rag.md`),
    sqlitePath: normalizeVaultPathSeparators(sqlitePath),
    manifestPath: resolveManifestPath(sqlitePath)
  };
}

function toCollisionKey(outputPath: string): string {
  // Use normalized lowercase keys for Windows-safe collision detection.
  return path.normalize(outputPath).toLowerCase();
}

export function assertUniqueOutputPaths(
  assignments: ScopeOutputAssignment[],
  options?: { includeSqlite?: boolean; includeManifest?: boolean }
): void {
  const includeSqlite = options?.includeSqlite ?? true;
  const includeManifest = options?.includeManifest ?? true;
  const seenByPath = new Map<string, string>();
  const collisions = new Set<string>();

  for (const assignment of assignments) {
    const targets: Array<[string, string]> = [
      ['world_info', assignment.paths.worldInfoPath],
      ['rag', assignment.paths.ragPath]
    ];
    if (includeSqlite) {
      targets.push(['sqlite', assignment.paths.sqlitePath]);
    }
    if (includeManifest) {
      targets.push(['manifest', assignment.paths.manifestPath]);
    }

    for (const [kind, outputPath] of targets) {
      const key = `${kind}:${toCollisionKey(outputPath)}`;
      const existingScope = seenByPath.get(key);
      if (existingScope && existingScope !== assignment.scope) {
        collisions.add(`${kind} path "${outputPath}" from scopes "${existingScope}" and "${assignment.scope}"`);
      } else if (!existingScope) {
        seenByPath.set(key, assignment.scope);
      }
    }
  }

  if (collisions.size > 0) {
    const sorted = [...collisions].sort((a, b) => a.localeCompare(b));
    throw new Error(`Output path collision detected:\n- ${sorted.join('\n- ')}`);
  }
}
