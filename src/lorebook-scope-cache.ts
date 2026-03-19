import { LorebookNoteMetadata } from './lorebooks-manager-data';
import { normalizeScope } from './lorebook-scoping';

export interface LorebookScopeSnapshot {
  notes: LorebookNoteMetadata[];
  scopes: string[];
}

interface LorebookScopeCacheParams {
  computeNotes: () => LorebookNoteMetadata[];
  computeNote: (path: string) => LorebookNoteMetadata | null;
  getActiveScope: () => string;
}

export class LorebookScopeCache {
  private computeNotes: () => LorebookNoteMetadata[];
  private computeNote: (path: string) => LorebookNoteMetadata | null;
  private getActiveScope: () => string;
  private notesByPath = new Map<string, LorebookNoteMetadata>();
  private dirtyPaths = new Set<string>();
  private needsFullRebuild = true;
  private revision = 0;
  private cachedRevision = -1;
  private cachedSnapshot: LorebookScopeSnapshot | null = null;

  constructor(params: LorebookScopeCacheParams) {
    this.computeNotes = params.computeNotes;
    this.computeNote = params.computeNote;
    this.getActiveScope = params.getActiveScope;
  }

  invalidate(): void {
    this.notesByPath.clear();
    this.dirtyPaths.clear();
    this.needsFullRebuild = true;
    this.revision += 1;
  }

  invalidatePath(path: string): void {
    if (!path.toLowerCase().endsWith('.md')) {
      return;
    }
    this.dirtyPaths.add(path);
    this.revision += 1;
  }

  removePath(path: string): void {
    if (!path.toLowerCase().endsWith('.md')) {
      return;
    }
    const removed = this.notesByPath.delete(path);
    const removedDirty = this.dirtyPaths.delete(path);
    if (removed || removedDirty) {
      this.revision += 1;
    }
  }

  renamePath(oldPath: string, newPath: string): void {
    if (oldPath !== newPath) {
      this.removePath(oldPath);
    }
    this.invalidatePath(newPath);
  }

  private ensureNotesCurrent(): LorebookNoteMetadata[] {
    if (this.needsFullRebuild) {
      this.notesByPath = new Map(
        this.computeNotes().map(note => [note.path, note] as const)
      );
      this.dirtyPaths.clear();
      this.needsFullRebuild = false;
    } else if (this.dirtyPaths.size > 0) {
      const pending = [...this.dirtyPaths].sort((left, right) => left.localeCompare(right));
      this.dirtyPaths.clear();
      for (const path of pending) {
        const note = this.computeNote(path);
        if (note) {
          this.notesByPath.set(path, note);
        } else {
          this.notesByPath.delete(path);
        }
      }
    }

    return [...this.notesByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
  }

  getSnapshot(): LorebookScopeSnapshot {
    if (this.cachedSnapshot && this.cachedRevision === this.revision) {
      return this.cachedSnapshot;
    }

    const notes = this.ensureNotesCurrent();
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
