import { LorebookNoteMetadata } from './lorebooks-manager-data';
import { normalizeScope } from './lorebook-scoping';

export interface LorebookScopeSnapshot {
  notes: LorebookNoteMetadata[];
  scopes: string[];
}

interface LorebookScopeCacheParams {
  computeNotes: () => LorebookNoteMetadata[];
  getActiveScope: () => string;
}

export class LorebookScopeCache {
  private computeNotes: () => LorebookNoteMetadata[];
  private getActiveScope: () => string;
  private revision = 0;
  private cachedRevision = -1;
  private cachedSnapshot: LorebookScopeSnapshot | null = null;

  constructor(params: LorebookScopeCacheParams) {
    this.computeNotes = params.computeNotes;
    this.getActiveScope = params.getActiveScope;
  }

  invalidate(): void {
    this.revision += 1;
  }

  getSnapshot(): LorebookScopeSnapshot {
    if (this.cachedSnapshot && this.cachedRevision === this.revision) {
      return this.cachedSnapshot;
    }

    const notes = this.computeNotes();
    const scopes = new Set<string>();
    for (const note of notes) {
      for (const scope of note.scopes) {
        const normalized = normalizeScope(scope);
        if (normalized) {
          scopes.add(normalized);
        }
      }
    }

    const activeScope = normalizeScope(this.getActiveScope());
    if (activeScope) {
      scopes.add(activeScope);
    }

    const snapshot: LorebookScopeSnapshot = {
      notes,
      scopes: [...scopes].sort((a, b) => a.localeCompare(b))
    };
    this.cachedSnapshot = snapshot;
    this.cachedRevision = this.revision;
    return snapshot;
  }

  getNotes(): LorebookNoteMetadata[] {
    return this.getSnapshot().notes;
  }

  getScopes(): string[] {
    return this.getSnapshot().scopes;
  }
}
