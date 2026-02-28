import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import LoreBookConverterPlugin from './main';
import { collectLorebookNoteMetadata } from './lorebooks-manager-collector';
import { normalizeScope } from './lorebook-scoping';
import { StorySteeringReviewModal, StorySteeringReviewResult } from './story-steering-review-modal';
import {
  createEmptyStorySteeringState,
  normalizeStorySteeringState,
  StorySteeringEffectiveState,
  StorySteeringScope,
  StorySteeringScopeType,
  StorySteeringState
} from './story-steering';

export const LOREVAULT_STORY_STEERING_VIEW_TYPE = 'lorevault-story-steering-view';

function formatScopeTypeLabel(type: StorySteeringScopeType): string {
  if (type === 'thread') {
    return 'story';
  }
  return type;
}

function formatScope(scope: StorySteeringScope): string {
  return `${formatScopeTypeLabel(scope.type)}:${scope.key || '(default)'}`;
}

export class StorySteeringView extends ItemView {
  private plugin: LoreBookConverterPlugin;
  private selectedScopeType: StorySteeringScopeType = 'note';
  private selectedScopeKey = '';
  private state: StorySteeringState = createEmptyStorySteeringState();
  private isLoading = false;
  private extractionInFlight = false;
  private extractionSource: 'active_note' | 'story_window' | null = null;
  private extractionAbortController: AbortController | null = null;

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
    const suggested = await this.plugin.getSuggestedStorySteeringScope('note');
    this.selectedScopeType = suggested.type;
    this.selectedScopeKey = suggested.key;
    await this.loadSelectedScope();
    await this.render();
  }

  async onClose(): Promise<void> {
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
      new Notice('Steering extraction is already running.');
      return;
    }
    const controller = new AbortController();
    this.extractionInFlight = true;
    this.extractionSource = source;
    this.extractionAbortController = controller;
    await this.render();

    try {
      const proposal = await this.plugin.extractStorySteeringProposal(source, this.state, controller.signal);
      const review = await this.reviewExtraction(
        proposal.sourceLabel,
        proposal.notePath,
        proposal.proposal
      );
      if (review.action === 'cancel') {
        return;
      }
      this.state = normalizeStorySteeringState(review.state);
      await this.render();
      new Notice('Applied extracted steering to panel. Click Save Scope to persist.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/aborted/i.test(message)) {
        new Notice('Steering extraction aborted.');
      } else {
        new Notice(`Steering extraction failed: ${message}`);
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

  private parseListInput(value: string): string[] {
    const lines = value
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    const deduped: string[] = [];
    for (const line of lines) {
      if (!deduped.includes(line)) {
        deduped.push(line);
      }
    }
    return deduped;
  }

  private formatListInput(values: string[]): string {
    return values.join('\n');
  }

  private getNormalizedActiveLorebooks(): string[] {
    const normalized = this.state.activeLorebooks
      .map(scope => normalizeScope(scope))
      .filter(Boolean);
    return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
  }

  private addActiveLorebook(scope: string): void {
    const normalized = normalizeScope(scope);
    if (!normalized) {
      return;
    }
    const next = this.getNormalizedActiveLorebooks();
    if (next.includes(normalized)) {
      return;
    }
    next.push(normalized);
    next.sort((left, right) => left.localeCompare(right));
    this.state.activeLorebooks = next;
    void this.render();
  }

  private removeActiveLorebook(scope: string): void {
    const normalized = normalizeScope(scope);
    if (!normalized) {
      return;
    }
    this.state.activeLorebooks = this.getNormalizedActiveLorebooks()
      .filter(item => item !== normalized);
    void this.render();
  }

  private getAvailableLorebookScopes(): string[] {
    const scopes = new Set<string>();
    const notes = collectLorebookNoteMetadata(this.app, this.plugin.settings);
    for (const note of notes) {
      for (const scope of note.scopes) {
        const normalized = normalizeScope(scope);
        if (normalized) {
          scopes.add(normalized);
        }
      }
    }
    const activeScope = normalizeScope(this.plugin.settings.tagScoping.activeScope);
    if (activeScope) {
      scopes.add(activeScope);
    }
    return [...scopes].sort((left, right) => left.localeCompare(right));
  }

  private getSelectedScope(): StorySteeringScope {
    return {
      type: this.selectedScopeType,
      key: this.selectedScopeType === 'global' ? 'global' : this.selectedScopeKey.trim()
    };
  }

  private async loadSelectedScope(): Promise<void> {
    const scope = this.getSelectedScope();
    if (scope.type !== 'global' && !scope.key) {
      this.state = createEmptyStorySteeringState();
      return;
    }
    this.state = await this.plugin.loadStorySteeringScope(scope);
  }

  private renderEffectiveState(container: HTMLElement, effective: StorySteeringEffectiveState): void {
    const layers = container.createDiv({ cls: 'lorevault-help-note' });
    layers.createEl('strong', { text: 'Effective Scope Chain' });
    const list = layers.createEl('ul');
    for (const layer of effective.layers) {
      const textSnippets = [
        layer.state.pinnedInstructions ? 'pinned' : '',
        layer.state.storyNotes ? 'notes' : '',
        layer.state.sceneIntent ? 'intent' : '',
        layer.state.activeLorebooks.length > 0 ? `lorebooks:${layer.state.activeLorebooks.length}` : '',
        layer.state.plotThreads.length > 0 ? `threads:${layer.state.plotThreads.length}` : '',
        layer.state.openLoops.length > 0 ? `loops:${layer.state.openLoops.length}` : '',
        layer.state.canonDeltas.length > 0 ? `deltas:${layer.state.canonDeltas.length}` : ''
      ].filter(Boolean).join(', ') || 'empty';
      list.createEl('li', {
        text: `${formatScope(layer.scope)} -> ${layer.filePath} (${textSnippets})`
      });
    }

    const merged = container.createDiv({ cls: 'lorevault-help-note' });
    merged.createEl('strong', { text: 'Merged Effective Steering' });
    merged.createEl('p', {
      text: `Pinned: ${effective.merged.pinnedInstructions ? 'yes' : 'no'} | Notes: ${effective.merged.storyNotes ? 'yes' : 'no'} | Intent: ${effective.merged.sceneIntent ? 'yes' : 'no'}`
    });
    merged.createEl('p', {
      text: `Active lorebooks: ${effective.merged.activeLorebooks.length > 0 ? effective.merged.activeLorebooks.join(', ') : '(none)'}`
    });
    merged.createEl('p', {
      text: `Plot threads: ${effective.merged.plotThreads.length} | Open loops: ${effective.merged.openLoops.length} | Canon deltas: ${effective.merged.canonDeltas.length}`
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
      titleRow.createEl('h2', { text: 'Story Steering' });

      const scopeSection = contentEl.createDiv({ cls: 'lorevault-help-section' });
      scopeSection.createEl('h3', { text: 'Scope' });

      const scopeTypeRow = scopeSection.createDiv({ cls: 'lorevault-chat-scope-row' });
      scopeTypeRow.createEl('label', { text: 'Scope Type' });
      const scopeTypeSelect = scopeTypeRow.createEl('select', { cls: 'dropdown' });
      const scopeOptions: StorySteeringScopeType[] = ['global', 'thread', 'chapter', 'note'];
      for (const option of scopeOptions) {
        const element = scopeTypeSelect.createEl('option');
        element.value = option;
        element.text = formatScopeTypeLabel(option);
      }
      scopeTypeSelect.value = this.selectedScopeType;
      scopeTypeSelect.addEventListener('change', () => {
        const next = scopeTypeSelect.value as StorySteeringScopeType;
        this.selectedScopeType = next;
        if (next === 'global') {
          this.selectedScopeKey = 'global';
        }
        void this.render();
      });

      const scopeKeyRow = scopeSection.createDiv({ cls: 'lorevault-chat-scope-row' });
      scopeKeyRow.createEl('label', { text: 'Scope Key' });
      const scopeKeyInput = scopeKeyRow.createEl('input', { type: 'text' });
      scopeKeyInput.disabled = this.selectedScopeType === 'global';
      scopeKeyInput.placeholder = this.selectedScopeType === 'thread'
        ? 'story key (for example chronicles-main)'
        : this.selectedScopeType === 'chapter'
          ? 'chapter scope key (for example chronicles-main::chapter:7)'
          : 'note scope key (for example note:lvn-...)';
      scopeKeyInput.value = this.selectedScopeType === 'global' ? 'global' : this.selectedScopeKey;
      scopeKeyInput.addEventListener('input', () => {
        this.selectedScopeKey = scopeKeyInput.value;
      });

      const actions = scopeSection.createDiv({ cls: 'lorevault-help-actions' });

      const useActiveButton = actions.createEl('button', { text: 'Use Active Note' });
      useActiveButton.addEventListener('click', () => {
        void (async () => {
          try {
            const suggested = await this.plugin.getSuggestedStorySteeringScope(this.selectedScopeType);
            this.selectedScopeType = suggested.type;
            this.selectedScopeKey = suggested.key;
            await this.render();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`Failed to resolve active-note scope: ${message}`);
          }
        })();
      });

      const loadButton = actions.createEl('button', { text: 'Load Scope' });
      loadButton.addEventListener('click', async () => {
        try {
          await this.loadSelectedScope();
          await this.render();
          new Notice(`Loaded steering scope: ${formatScope(this.getSelectedScope())}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`Failed to load steering scope: ${message}`);
        }
      });

      const saveButton = actions.createEl('button', { text: 'Save Scope' });
      saveButton.addClass('mod-cta');
      saveButton.addEventListener('click', async () => {
        try {
          const path = await this.plugin.saveStorySteeringScope(this.getSelectedScope(), this.state);
          new Notice(`Saved steering scope: ${path}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`Failed to save steering scope: ${message}`);
        }
      });

      const openButton = actions.createEl('button', { text: 'Open Scope Note' });
      openButton.addEventListener('click', () => {
        void this.plugin.openStorySteeringScopeNote(this.getSelectedScope());
      });

      const activeLorebooksSection = contentEl.createDiv({ cls: 'lorevault-help-section' });
      activeLorebooksSection.createEl('h3', { text: 'Active Lorebooks' });
      activeLorebooksSection.createEl('p', {
        text: 'These scopes are saved in this steering note and used as primary lorebook selection for continuation.'
      });
      const selectedLorebooks = this.getNormalizedActiveLorebooks();
      const availableLorebooks = this.getAvailableLorebookScopes();
      const unselectedLorebooks = availableLorebooks.filter(scope => !selectedLorebooks.includes(scope));
      const selectedLorebookList = activeLorebooksSection.createDiv({ cls: 'lorevault-import-review-list' });
      if (selectedLorebooks.length === 0) {
        selectedLorebookList.createEl('p', { text: 'No active lorebooks selected.' });
      } else {
        for (const scope of selectedLorebooks) {
          const row = selectedLorebookList.createDiv({ cls: 'lorevault-import-review-item lorevault-steering-lorebook-row' });
          row.createEl('code', { text: scope });
          const removeButton = row.createEl('button', { text: 'Remove' });
          removeButton.addClass('lorevault-steering-remove-button');
          removeButton.addEventListener('click', () => {
            this.removeActiveLorebook(scope);
          });
        }
      }
      const lorebookActions = activeLorebooksSection.createDiv({ cls: 'lorevault-import-actions' });
      const lorebookSelect = lorebookActions.createEl('select', {
        cls: 'dropdown lorevault-steering-lorebook-select'
      });
      if (unselectedLorebooks.length === 0) {
        const option = lorebookSelect.createEl('option');
        option.value = '';
        option.text = availableLorebooks.length === 0
          ? 'No lorebooks found'
          : 'All lorebooks already selected';
        lorebookSelect.disabled = true;
      } else {
        const option = lorebookSelect.createEl('option');
        option.value = '';
        option.text = 'Select lorebook scope...';
        for (const scope of unselectedLorebooks) {
          const scopeOption = lorebookSelect.createEl('option');
          scopeOption.value = scope;
          scopeOption.text = scope;
        }
      }
      const addLorebookButton = lorebookActions.createEl('button', { text: 'Add Lorebook' });
      addLorebookButton.disabled = unselectedLorebooks.length === 0 || !lorebookSelect.value.trim();
      lorebookSelect.addEventListener('change', () => {
        addLorebookButton.disabled = !lorebookSelect.value.trim();
      });
      addLorebookButton.addEventListener('click', () => {
        const value = lorebookSelect.value.trim();
        if (!value) {
          return;
        }
        this.addActiveLorebook(value);
      });

      const editorSection = contentEl.createDiv({ cls: 'lorevault-help-section' });
      editorSection.createEl('h3', { text: 'Steering Content' });

      editorSection.createEl('label', { text: 'Pinned Instructions' });
      const pinnedInput = editorSection.createEl('textarea', { cls: 'lorevault-chat-manual-input' });
      pinnedInput.value = this.state.pinnedInstructions;
      pinnedInput.placeholder = 'Stable constraints for this scope.';
      pinnedInput.addEventListener('input', () => {
        this.state.pinnedInstructions = pinnedInput.value.trim();
      });

      editorSection.createEl('label', { text: 'Story Notes' });
      const notesInput = editorSection.createEl('textarea', { cls: 'lorevault-chat-manual-input' });
      notesInput.value = this.state.storyNotes;
      notesInput.placeholder = 'Author-note style guidance.';
      notesInput.addEventListener('input', () => {
        this.state.storyNotes = notesInput.value.trim();
      });

      editorSection.createEl('label', { text: 'Scene Intent' });
      const intentInput = editorSection.createEl('textarea', { cls: 'lorevault-chat-manual-input' });
      intentInput.value = this.state.sceneIntent;
      intentInput.placeholder = 'What this scene/chapter should accomplish.';
      intentInput.addEventListener('input', () => {
        this.state.sceneIntent = intentInput.value.trim();
      });

      editorSection.createEl('label', { text: 'Active Plot Threads (one per line)' });
      const threadsInput = editorSection.createEl('textarea', { cls: 'lorevault-chat-manual-input' });
      threadsInput.value = this.formatListInput(this.state.plotThreads);
      threadsInput.addEventListener('input', () => {
        this.state.plotThreads = this.parseListInput(threadsInput.value);
      });

      editorSection.createEl('label', { text: 'Open Loops (one per line)' });
      const loopsInput = editorSection.createEl('textarea', { cls: 'lorevault-chat-manual-input' });
      loopsInput.value = this.formatListInput(this.state.openLoops);
      loopsInput.addEventListener('input', () => {
        this.state.openLoops = this.parseListInput(loopsInput.value);
      });

      editorSection.createEl('label', { text: 'Canon Deltas (one per line)' });
      const deltasInput = editorSection.createEl('textarea', { cls: 'lorevault-chat-manual-input' });
      deltasInput.value = this.formatListInput(this.state.canonDeltas);
      deltasInput.addEventListener('input', () => {
        this.state.canonDeltas = this.parseListInput(deltasInput.value);
      });

      const extractionSection = contentEl.createDiv({ cls: 'lorevault-help-section' });
      extractionSection.createEl('h3', { text: 'LLM Assistance' });
      extractionSection.createEl('p', {
        text: 'Extract proposed steering from story text, review/edit in a modal, then optionally save.'
      });
      if (this.extractionInFlight) {
        const label = this.extractionSource === 'active_note'
          ? 'active note'
          : this.extractionSource === 'story_window'
            ? 'story window'
            : 'source text';
        extractionSection.createEl('p', {
          cls: 'lorevault-help-note',
          text: `Running extraction from ${label}...`
        });
      }
      const extractionActions = extractionSection.createDiv({ cls: 'lorevault-help-actions' });
      const extractNoteButton = extractionActions.createEl('button', {
        text: this.extractionInFlight && this.extractionSource === 'active_note'
          ? 'Extracting...'
          : 'Extract from Active Note'
      });
      extractNoteButton.disabled = this.extractionInFlight;
      extractNoteButton.addEventListener('click', () => {
        void this.runSteeringExtraction('active_note');
      });
      const extractWindowButton = extractionActions.createEl('button', {
        text: this.extractionInFlight && this.extractionSource === 'story_window'
          ? 'Extracting...'
          : 'Extract from Story Window'
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
      effectiveSection.createEl('h3', { text: 'Effective Steering for Active Note' });
      const effective = await this.plugin.resolveEffectiveStorySteeringForActiveNote();
      this.renderEffectiveState(effectiveSection, effective);
    } finally {
      this.isLoading = false;
    }
  }
}
