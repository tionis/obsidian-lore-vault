import { ConverterSettings } from './models';
import {
  FrontmatterData,
  asBoolean,
  asStringArray,
  getFrontmatterValue
} from './frontmatter-utils';
import {
  normalizeScope,
  shouldIncludeInScope
} from './lorebook-scoping';
import { parseRetrievalMode, resolveRetrievalTargets, RetrievalMode } from './retrieval-routing';

export type ScopeDecisionReason =
  | 'included'
  | 'excluded_by_frontmatter'
  | 'scope_mismatch'
  | 'untagged_excluded'
  | 'retrieval_disabled';

export interface LorebookNoteMetadata {
  path: string;
  basename: string;
  scopes: string[];
  frontmatter: FrontmatterData;
}

export interface ScopeDebugNote {
  path: string;
  basename: string;
  scopes: string[];
  included: boolean;
  reason: ScopeDecisionReason;
  retrievalMode: RetrievalMode;
  hasKeywords: boolean;
  includeWorldInfo: boolean;
  includeRag: boolean;
}

export interface ScopeSummary {
  scope: string;
  includedNotes: number;
  worldInfoEntries: number;
  ragDocuments: number;
  warnings: string[];
  notes: ScopeDebugNote[];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function discoverScopesFromMetadata(notes: LorebookNoteMetadata[]): string[] {
  const scopes = new Set<string>();

  for (const note of notes) {
    for (const scope of note.scopes) {
      if (scope) {
        scopes.add(scope);
      }
    }
  }

  return [...scopes].sort((a, b) => a.localeCompare(b));
}

function reasonForExclusion(scopes: string[], includeUntagged: boolean): ScopeDecisionReason {
  if (scopes.length === 0 && !includeUntagged) {
    return 'untagged_excluded';
  }
  return 'scope_mismatch';
}

export function buildScopeSummaries(
  notes: LorebookNoteMetadata[],
  settings: ConverterSettings,
  scopeOverride?: string
): ScopeSummary[] {
  const sortedNotes = [...notes].sort((a, b) => a.path.localeCompare(b.path));
  const configuredScope = normalizeScope(scopeOverride ?? settings.tagScoping.activeScope);
  const discoveredScopes = discoverScopesFromMetadata(sortedNotes);
  const buildAllScopes = configuredScope.length === 0 && discoveredScopes.length > 0;

  const scopesToBuild = configuredScope
    ? [configuredScope]
    : (discoveredScopes.length > 0 ? discoveredScopes : ['']);

  return scopesToBuild.map(scope => {
    const includeUntagged = buildAllScopes ? false : settings.tagScoping.includeUntagged;
    const debugNotes: ScopeDebugNote[] = [];
    let includedNotes = 0;
    let worldInfoEntries = 0;
    let ragDocuments = 0;

    for (const note of sortedNotes) {
      const isExcluded = asBoolean(getFrontmatterValue(note.frontmatter, 'exclude')) === true;
      const rawKeywords = asStringArray(getFrontmatterValue(note.frontmatter, 'key', 'keywords'));
      const hasKeywords = rawKeywords.length > 0;
      const retrievalMode = parseRetrievalMode(getFrontmatterValue(note.frontmatter, 'retrieval')) ?? 'auto';

      if (isExcluded) {
        debugNotes.push({
          path: note.path,
          basename: note.basename,
          scopes: uniqueSorted(note.scopes),
          included: false,
          reason: 'excluded_by_frontmatter',
          retrievalMode,
          hasKeywords,
          includeWorldInfo: false,
          includeRag: false
        });
        continue;
      }

      const inScope = shouldIncludeInScope(
        note.scopes,
        scope,
        settings.tagScoping.membershipMode,
        includeUntagged
      );

      if (!inScope) {
        debugNotes.push({
          path: note.path,
          basename: note.basename,
          scopes: uniqueSorted(note.scopes),
          included: false,
          reason: reasonForExclusion(note.scopes, includeUntagged),
          retrievalMode,
          hasKeywords,
          includeWorldInfo: false,
          includeRag: false
        });
        continue;
      }

      const routing = resolveRetrievalTargets(retrievalMode, hasKeywords);
      const includeWorldInfo = routing.includeWorldInfo;
      const includeRag = routing.includeRag;
      const included = includeWorldInfo || includeRag;

      if (included) {
        includedNotes += 1;
      }
      if (includeWorldInfo) {
        worldInfoEntries += 1;
      }
      if (includeRag) {
        ragDocuments += 1;
      }

      debugNotes.push({
        path: note.path,
        basename: note.basename,
        scopes: uniqueSorted(note.scopes),
        included,
        reason: included ? 'included' : 'retrieval_disabled',
        retrievalMode,
        hasKeywords,
        includeWorldInfo,
        includeRag
      });
    }

    const warnings: string[] = [];
    if (includedNotes === 0) {
      warnings.push('No notes are included in this scope.');
    }
    if (worldInfoEntries === 0) {
      warnings.push('No world_info entries in this scope.');
    }
    if (ragDocuments === 0) {
      warnings.push('No rag documents in this scope.');
    }

    return {
      scope,
      includedNotes,
      worldInfoEntries,
      ragDocuments,
      warnings,
      notes: debugNotes
    };
  });
}
