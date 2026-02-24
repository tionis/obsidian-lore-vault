import * as path from 'path';
import { normalizeScope } from './lorebook-scoping';

export interface ScopeOutputPaths {
  worldInfoPath: string;
  ragPath: string;
  sqlitePath: string;
}

export interface ScopeOutputAssignment {
  scope: string;
  paths: ScopeOutputPaths;
}

export function slugifyScope(scope: string): string {
  const normalized = normalizeScope(scope);
  const slug = normalized
    .replace(/[\/\\]+/g, '-')
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'root';
}

export function resolveScopeOutputPaths(
  baseOutputPath: string,
  scope: string,
  buildAllScopes: boolean,
  sqliteBaseOutputPath?: string
): ScopeOutputPaths {
  const ext = path.extname(baseOutputPath);
  const hasJsonExt = ext.toLowerCase() === '.json';
  const stem = hasJsonExt
    ? baseOutputPath.slice(0, -ext.length)
    : baseOutputPath;
  const scopeSlug = slugifyScope(scope);

  let stemWithScope = stem;
  if (stem.includes('{scope}')) {
    stemWithScope = stem.replace(/\{scope\}/g, scopeSlug);
  } else if (buildAllScopes) {
    stemWithScope = `${stem}-${scopeSlug}`;
  }

  let sqliteStem = `${stemWithScope}.lorevault`;
  if (sqliteBaseOutputPath && sqliteBaseOutputPath.trim().length > 0) {
    const sqliteExt = path.extname(sqliteBaseOutputPath);
    const sqliteHasDbExt = sqliteExt.toLowerCase() === '.db';
    const rawSqliteStem = sqliteHasDbExt
      ? sqliteBaseOutputPath.slice(0, -sqliteExt.length)
      : sqliteBaseOutputPath;

    if (rawSqliteStem.includes('{scope}')) {
      sqliteStem = rawSqliteStem.replace(/\{scope\}/g, scopeSlug);
    } else if (buildAllScopes) {
      sqliteStem = `${rawSqliteStem}-${scopeSlug}`;
    } else {
      sqliteStem = rawSqliteStem;
    }
  }

  return {
    worldInfoPath: `${stemWithScope}.json`,
    ragPath: `${stemWithScope}.rag.md`,
    sqlitePath: `${sqliteStem}.db`
  };
}

function toCollisionKey(outputPath: string): string {
  // Use normalized lowercase keys for Windows-safe collision detection.
  return path.normalize(outputPath).toLowerCase();
}

export function assertUniqueOutputPaths(
  assignments: ScopeOutputAssignment[],
  options?: { includeSqlite?: boolean }
): void {
  const includeSqlite = options?.includeSqlite ?? true;
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
