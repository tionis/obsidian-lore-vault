import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import LoreBookConverterPlugin from './main';
import { StorySteeringReviewModal, StorySteeringReviewResult } from './story-steering-review-modal';
import {
  createEmptyStorySteeringState,
  normalizeStorySteeringState,
  StorySteeringEffectiveState,
  StorySteeringScope,
  StorySteeringState
} from './story-steering';

export const LOREVAULT_STORY_STEERING_VIEW_TYPE = 'lorevault-story-steering-view';

function formatScope(scope: StorySteeringScope): string {
  return `note:${scope.key || '(default)'}`;
}

export class StorySteeringView extends ItemView {
  private plugin: LoreBookConverterPlugin;
  private selectedScopeKey = '';
  private loadedScope: StorySteeringScope = { type: 'note', key: '' };
  private state: StorySteeringState = createEmptyStorySteeringState();
  private isLoading = false;
  private scopeSyncInFlight = false;
  private scopeSyncQueued = false;
  private activeNotePath = '';
  private hasPendingEdits = false;
  private autosaveTimer: number | null = null;
  private saveInFlight = false;
  private saveQueued = false;
  private extractionInFlight = false;
  private extractionSource: 'active_note' | 'story_window' | null = null;
  private extractionAbortController: AbortController | null = null;
  private extractionInstruction = '';

  constructor(leaf: WorkspaceLeaf, plugin: LoreBookConverterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LOREVAULT_STORY_STEERING_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Story Steering';
  }

  getIcon(): string {
    return 'sliders-horizontal';
  }

  async onOpen(): Promise<void> {
    this.activeNotePath = this.app.workspace.getActiveFile()?.path ?? '';
    this.registerEvent(this.app.workspace.on('file-open', file => {
      const nextPath = file?.path ?? '';
      if (nextPath === this.activeNotePath) {
        return;
      }
      this.activeNotePath = nextPath;
      void this.syncScopeToActiveNoteAndRender();
    }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
      const nextPath = this.app.workspace.getActiveFile()?.path ?? '';
      if (nextPath === this.activeNotePath) {
        return;
      }
      this.activeNotePath = nextPath;
      void this.syncScopeToActiveNoteAndRender();
    }));
    await this.syncScopeToActiveNote();
    await this.render();
  }

  async onClose(): Promise<void> {
    if (this.autosaveTimer !== null) {
      window.clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    await this.persistScopeIfDirty(true);
    this.contentEl.empty();
  }

  refresh(): void {
    void this.render();
  }

  private async reviewExtraction(
    sourceLabel: string,
    notePath: string,
    proposedState: StorySteeringState
  ): Promise<StorySteeringReviewResult> {
    return new Promise(resolve => {
      const modal = new StorySteeringReviewModal(
        this.app,
        sourceLabel,
        notePath,
        proposedState,
        this.state,
        result => resolve(result)
      );
      modal.open();
    });
  }

  private async runSteeringExtraction(source: 'active_note' | 'story_window'): Promise<void> {
    if (this.extractionInFlight) {
      new Notice('Author-note extraction is already running.');
      return;
    }
    const controller = new AbortController();
    this.extractionInFlight = true;
    this.extractionSource = source;
    this.extractionAbortController = controller;
    await this.render();

    try {
      const proposal = await this.plugin.extractStorySteeringProposal(
        source,
        this.state,
        this.extractionInstruction,
        controller.signal
      );
      const review = await this.reviewExtraction(
        proposal.sourceLabel,
        proposal.notePath,
        proposal.proposal
      );
      if (review.action === 'cancel') {
        return;
      }
      this.state = normalizeStorySteeringState(review.state);
      this.markDirty();
      await this.persistScopeIfDirty(true);
      await this.render();
      new Notice(`Updated author note: ${formatScope(this.loadedScope)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/aborted/i.test(message)) {
        new Notice('Author-note extraction aborted.');
      } else {
        new Notice(`Author-note extraction failed: ${message}`);
      }
    } finally {
      this.extractionInFlight = false;
      this.extractionSource = null;
      this.extractionAbortController = null;
      await this.render();
    }
  }

  private abortSteeringExtraction(): void {
    this.extractionAbortController?.abort();
  }

  private areScopesEqual(left: StorySteeringScope, right: StorySteeringScope): boolean {
    return (left.key || '').trim() === (right.key || '').trim();
  }

  private markDirty(): void {
    this.hasPendingEdits = true;
    this.scheduleAutosave();
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer !== null) {
      window.clearTimeout(this.autosaveTimer);
    }
    this.autosaveTimer = window.setTimeout(() => {
      this.autosaveTimer = null;
      void this.persistScopeIfDirty();
    }, 280);
  }

  private async persistScopeIfDirty(force = false): Promise<void> {
    if (!force && !this.hasPendingEdits) {
      return;
    }
    if (this.saveInFlight) {
      this.saveQueued = true;
      return;
    }

    const targetScope = this.loadedScope;
    if (!targetScope.key.trim()) {
      if (force && this.hasPendingEdits) {
        new Notice('Select an active markdown note so this author note can be resolved and saved.');
      }
      return;
    }

    this.saveInFlight = true;
    try {
      await this.plugin.saveStorySteeringScope(targetScope, this.state);
      this.hasPendingEdits = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to save author note: ${message}`);
    } finally {
      this.saveInFlight = false;
      if (this.saveQueued) {
        this.saveQueued = false;
        if (this.hasPendingEdits) {
          await this.persistScopeIfDirty(true);
        }
      }
    }
  }

  private async loadScope(scope: StorySteeringScope): Promise<void> {
    const normalizedScope: StorySteeringScope = {
      type: 'note',
      key: scope.key.trim()
    };
    if (!normalizedScope.key) {
      this.loadedScope = normalizedScope;
      this.state = createEmptyStorySteeringState();
      this.hasPendingEdits = false;
      return;
    }
    this.state = await this.plugin.loadStorySteeringScope(normalizedScope);
    this.loadedScope = normalizedScope;
    this.hasPendingEdits = false;
  }

  private async syncScopeToActiveNote(forceReload = false): Promise<void> {
    if (this.scopeSyncInFlight) {
      this.scopeSyncQueued = true;
      return;
    }

    this.scopeSyncInFlight = true;
    try {
      const suggested = await this.plugin.getSuggestedStorySteeringScope({
        ensureIds: true
      });
      this.selectedScopeKey = (suggested.key || '').trim();
      const nextScope: StorySteeringScope = {
        type: 'note',
        key: this.selectedScopeKey
      };
      if (!forceReload && this.areScopesEqual(this.loadedScope, nextScope)) {
        return;
      }
      await this.persistScopeIfDirty(true);
      await this.loadScope(nextScope);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to resolve active-note author note: ${message}`);
    } finally {
      this.scopeSyncInFlight = false;
      if (this.scopeSyncQueued) {
        this.scopeSyncQueued = false;
        await this.syncScopeToActiveNote(true);
      }
    }
  }

  private async syncScopeToActiveNoteAndRender(forceReload = false): Promise<void> {
    try {
      await this.syncScopeToActiveNote(forceReload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(message);
    } finally {
      await this.render();
    }
  }

  private renderEffectiveState(container: HTMLElement, effective: StorySteeringEffectiveState): void {
    const layers = container.createDiv({ cls: 'lorevault-help-note' });
    layers.createEl('strong', { text: 'Loaded Author Note Layer(s)' });
    const list = layers.createEl('ul');
    if (effective.layers.length === 0) {
      list.createEl('li', { text: 'No active markdown note selected.' });
    }
    for (const layer of effective.layers) {
      const hasContent = layer.state.authorNote.trim().length > 0;
      list.createEl('li', {
        text: `${formatScope(layer.scope)} -> ${layer.filePath} (${hasContent ? 'has content' : 'empty'})`
      });
    }

    const merged = container.createDiv({ cls: 'lorevault-help-note' });
    merged.createEl('strong', { text: 'Effective Author Note' });
    merged.createEl('p', {
      text: effective.merged.authorNote
        ? `Loaded (${effective.merged.authorNote.length} chars).`
        : 'Empty.'
    });
  }

  private async render(): Promise<void> {
    if (this.isLoading) {
      return;
    }
    this.isLoading = true;
    try {
      const { contentEl } = this;
      contentEl.empty();
      contentEl.addClass('lorevault-help-view');

      const titleRow = contentEl.createDiv({ cls: 'lorevault-help-title-row' });
      const icon = titleRow.createSpan({ cls: 'lorevault-help-icon' });
      setIcon(icon, 'sliders-horizontal');
      titleRow.createEl('h2', { text: 'Story Author Note' });

      const scopeSection = contentEl.createDiv({ cls: 'lorevault-help-section' });
      scopeSection.createEl('h3', { text: 'Active Note Scope' });

      const scopeKeyRow = scopeSection.createDiv({ cls: 'lorevault-chat-scope-row' });
      scopeKeyRow.createEl('label', { text: 'Resolved Scope Key' });
      scopeKeyRow.createEl('code', {
        text: this.selectedScopeKey || '(no active markdown note)'
      });

      const activeFile = this.app.workspace.getActiveFile();
      scopeSection.createEl('p', {
        cls: 'lorevault-help-note',
        text: activeFile
          ? `Active note: ${activeFile.path}`
          : 'No active markdown note is selected.'
      });

      const actions = scopeSection.createDiv({ cls: 'lorevault-help-actions' });
      const reloadButton = actions.createEl('button', { text: 'Reload Active Note Author Note' });
      reloadButton.addEventListener('click', () => {
        void this.syncScopeToActiveNoteAndRender(true);
      });

      const openButton = actions.createEl('button', { text: 'Open Author Note File' });
      openButton.disabled = !this.loadedScope.key.trim();
      openButton.addEventListener('click', () => {
        void (async () => {
          try {
            await this.persistScopeIfDirty(true);
            await this.plugin.openStorySteeringScopeNote(this.loadedScope);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`Failed to open author note file: ${message}`);
          }
        })();
      });

      scopeSection.createEl('p', {
        cls: 'lorevault-help-note',
        text: 'Edits autosave immediately. Switching active note autosaves current changes, then loads the next note-level author note.'
      });

      const editorSection = contentEl.createDiv({ cls: 'lorevault-help-section' });
      editorSection.createEl('h3', { text: 'Author Note (Markdown)' });
      editorSection.createEl('p', {
        text: 'Use your own markdown format. LoreVault passes this through as one steering block.'
      });
      const noteInput = editorSection.createEl('textarea', { cls: 'lorevault-chat-manual-input' });
      noteInput.value = this.state.authorNote;
      noteInput.placeholder = 'Example: ## Story Notes\n- ...\n\n## Scene Intent\n...';
      noteInput.addEventListener('input', () => {
        this.state.authorNote = noteInput.value.trim();
        this.markDirty();
      });

      const extractionSection = contentEl.createDiv({ cls: 'lorevault-help-section' });
      extractionSection.createEl('h3', { text: 'LLM Assistance' });
      extractionSection.createEl('p', {
        text: 'Update the author note from story text, review/edit in a modal, then save immediately to this note-level scope.'
      });
      extractionSection.createEl('p', {
        cls: 'lorevault-help-note',
        text: '`Near-Cursor Context` means story text before the cursor in the active editor; if unavailable, it uses the active note body.'
      });
      extractionSection.createEl('label', { text: 'Optional Update Prompt' });
      const extractionPromptInput = extractionSection.createEl('textarea', {
        cls: 'lorevault-chat-manual-input'
      });
      extractionPromptInput.placeholder = 'Optional: tell the LLM what should change in the author note.';
      extractionPromptInput.value = this.extractionInstruction;
      extractionPromptInput.addEventListener('input', () => {
        this.extractionInstruction = extractionPromptInput.value.trim();
      });
      if (this.extractionInFlight) {
        const label = this.extractionSource === 'active_note'
          ? 'active note'
          : this.extractionSource === 'story_window'
            ? 'near-cursor context'
            : 'source text';
        extractionSection.createEl('p', {
          cls: 'lorevault-help-note',
          text: `Running extraction from ${label}...`
        });
      }
      const extractionActions = extractionSection.createDiv({ cls: 'lorevault-help-actions' });
      const extractNoteButton = extractionActions.createEl('button', {
        text: this.extractionInFlight && this.extractionSource === 'active_note'
          ? 'Updating...'
          : 'Update from Active Note'
      });
      extractNoteButton.disabled = this.extractionInFlight;
      extractNoteButton.addEventListener('click', () => {
        void this.runSteeringExtraction('active_note');
      });
      const extractWindowButton = extractionActions.createEl('button', {
        text: this.extractionInFlight && this.extractionSource === 'story_window'
          ? 'Updating...'
          : 'Update from Near-Cursor Context'
      });
      extractWindowButton.disabled = this.extractionInFlight;
      extractWindowButton.addEventListener('click', () => {
        void this.runSteeringExtraction('story_window');
      });
      const abortExtractionButton = extractionActions.createEl('button', {
        text: 'Abort Extraction'
      });
      abortExtractionButton.disabled = !this.extractionInFlight;
      abortExtractionButton.addEventListener('click', () => {
        this.abortSteeringExtraction();
      });

      const effectiveSection = contentEl.createDiv({ cls: 'lorevault-help-section' });
      effectiveSection.createEl('h3', { text: 'Effective Author Note for Active Note' });
      const effective = await this.plugin.resolveEffectiveStorySteeringForActiveNote();
      this.renderEffectiveState(effectiveSection, effective);
    } finally {
      this.isLoading = false;
    }
  }
}
