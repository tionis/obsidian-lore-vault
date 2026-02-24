import * as path from 'path';
import { normalizeScope } from './lorebook-scoping';

export interface ScopeOutputPaths {
  worldInfoPath: string;
  ragPath: string;
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
  buildAllScopes: boolean
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

  return {
    worldInfoPath: `${stemWithScope}.json`,
    ragPath: `${stemWithScope}.rag.md`
  };
}

function toCollisionKey(outputPath: string): string {
  // Use normalized lowercase keys for Windows-safe collision detection.
  return path.normalize(outputPath).toLowerCase();
}

export function assertUniqueOutputPaths(assignments: ScopeOutputAssignment[]): void {
  const seenByPath = new Map<string, string>();
  const collisions = new Set<string>();

  for (const assignment of assignments) {
    const targets: Array<[string, string]> = [
      ['world_info', assignment.paths.worldInfoPath],
      ['rag', assignment.paths.ragPath]
    ];

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
