import { App, FuzzySuggestModal, ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import LoreBookConverterPlugin from './main';
import { UsageLedgerReportSnapshot, UsageLedgerTotals } from './usage-ledger-report';
import { formatRelativeTime } from './time-format';

export const LOREVAULT_STORY_STEERING_VIEW_TYPE = 'lorevault-story-steering-view';

function formatTokenValue(value: number): string {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)).toString() : '0';
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '$0.0000';
  }
  return `$${value.toFixed(4)}`;
}

function formatCostSummaryValue(totals: UsageLedgerTotals): string {
  return `${totals.requests} req | tokens ${formatTokenValue(totals.totalTokens)} | known ${formatUsd(totals.costUsdKnown)}`;
}

class LorebookScopeSuggestModal extends FuzzySuggestModal<string> {
  private readonly scopes: string[];
  private resolveResult: ((value: string | null) => void) | null = null;
  private resolved = false;
  private selectedScope: string | null = null;

  constructor(
    app: App,
    scopes: string[]
  ) {
    super(app);
    this.scopes = [...scopes].sort((a, b) => a.localeCompare(b));
    this.setPlaceholder('Pick a lorebook scope to add...');
  }

  waitForSelection(): Promise<string | null> {
    return new Promise(resolve => {
      this.resolveResult = resolve;
    });
  }

  getItems(): string[] {
    return this.scopes;
  }

  getItemText(scope: string): string {
    return scope || '(all)';
  }

  onChooseItem(scope: string): void {
    this.selectedScope = scope;
    this.finish(scope);
  }

  onClose(): void {
    super.onClose();
    window.setTimeout(() => {
      this.finish(this.selectedScope);
    }, 0);
  }

  private finish(value: string | null): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    if (this.resolveResult) {
      this.resolveResult(value);
      this.resolveResult = null;
    }
  }
}

export class StorySteeringView extends ItemView {
  private plugin: LoreBookConverterPlugin;
  private activeNotePath = '';
  private isRendering = false;
  private telemetryTimer: number | null = null;
  private usageSummary: UsageLedgerReportSnapshot | null = null;
  private usageSummaryError = '';
  private usageFetchInFlight = false;
  private lastUsageFetchAt = 0;
  private generationDetailsOpen = false;
  private costDetailsOpen = false;

  constructor(leaf: WorkspaceLeaf, plugin: LoreBookConverterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LOREVAULT_STORY_STEERING_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Story Writing';
  }

  getIcon(): string {
    return 'pen-square';
  }

  async onOpen(): Promise<void> {
    this.activeNotePath = this.app.workspace.getActiveFile()?.path ?? '';
    this.registerEvent(this.app.workspace.on('file-open', file => {
      const nextPath = file?.path ?? '';
      if (nextPath === this.activeNotePath) {
        return;
      }
      this.activeNotePath = nextPath;
      void this.render(true);
    }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
      const nextPath = this.app.workspace.getActiveFile()?.path ?? '';
      if (nextPath === this.activeNotePath) {
        return;
      }
      this.activeNotePath = nextPath;
      void this.render(true);
    }));
    this.startTelemetryPolling();
    await this.render(true);
  }

  async onClose(): Promise<void> {
    this.stopTelemetryPolling();
    this.contentEl.empty();
  }

  refresh(): void {
    void this.render(true);
  }

  private hasFocusedFormControl(): boolean {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) {
      return false;
    }
    if (!this.contentEl.contains(active)) {
      return false;
    }
    const tag = active.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || active.isContentEditable;
  }

  private startTelemetryPolling(): void {
    this.stopTelemetryPolling();
    this.telemetryTimer = window.setInterval(() => {
      if (this.hasFocusedFormControl()) {
        return;
      }
      void this.render(false);
    }, 900);
  }

  private stopTelemetryPolling(): void {
    if (this.telemetryTimer !== null) {
      window.clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
  }

  private async maybeRefreshUsageSummary(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastUsageFetchAt < 15000) {
      return;
    }
    if (this.usageFetchInFlight) {
      return;
    }

    this.usageFetchInFlight = true;
    this.lastUsageFetchAt = now;
    try {
      this.usageSummary = await this.plugin.getUsageReportSnapshot();
      this.usageSummaryError = '';
    } catch (error) {
      this.usageSummaryError = error instanceof Error ? error.message : String(error);
    } finally {
      this.usageFetchInFlight = false;
    }
  }

  private getMarkdownFileByPath(path: string): TFile | null {
    if (!path) {
      return null;
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  private async openOrCreateAuthorNote(): Promise<void> {
    try {
      await this.plugin.openOrCreateLinkedAuthorNoteForActiveNote();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to open/create author note: ${message}`);
    } finally {
      await this.render(true);
    }
  }

  private async linkExistingAuthorNote(): Promise<void> {
    try {
      await this.plugin.linkExistingAuthorNoteForActiveNote();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to link author note: ${message}`);
    } finally {
      await this.render(true);
    }
  }

  private async setDeviceCompletionProfile(presetId: string): Promise<void> {
    try {
      await this.plugin.setDeviceActiveCompletionPresetId(presetId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to switch device profile: ${message}`);
    } finally {
      await this.render(false);
    }
  }

  private async pickLorebookScope(scopes: string[]): Promise<string | null> {
    const uniqueScopes = [...new Set(scopes.map(scope => scope.trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
    if (uniqueScopes.length === 0) {
      new Notice('No additional lorebooks available.');
      return null;
    }
    const modal = new LorebookScopeSuggestModal(this.app, uniqueScopes);
    const selectionPromise = modal.waitForSelection();
    modal.open();
    return selectionPromise;
  }

  private async createNextChapter(): Promise<void> {
    try {
      await this.plugin.createNextStoryChapterForActiveNote();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to create next chapter: ${message}`);
    } finally {
      await this.render(true);
    }
  }

  private async generateChapterSummary(): Promise<void> {
    try {
      await this.plugin.generateSummaryForActiveNote('chapter');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to generate chapter summary: ${message}`);
    } finally {
      await this.render(true);
    }
  }

  private async rewriteAuthorNote(): Promise<void> {
    try {
      await this.plugin.rewriteAuthorNoteFromActiveNote();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Author-note rewrite failed: ${message}`);
    } finally {
      await this.render(true);
    }
  }

  private async continueStory(): Promise<void> {
    try {
      await this.plugin.continueStoryWithContext();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Story continuation failed: ${message}`);
    } finally {
      await this.render(false);
    }
  }

  private stopGeneration(): void {
    this.plugin.stopActiveGeneration();
    new Notice('Stopping active generation...');
    void this.render(false);
  }

  private async insertInlineDirective(): Promise<void> {
    try {
      await this.plugin.insertInlineDirectiveAtCursor();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to insert inline directive: ${message}`);
    } finally {
      await this.render(false);
    }
  }

  private async render(forceUsageRefresh: boolean): Promise<void> {
    if (!forceUsageRefresh && this.hasFocusedFormControl()) {
      return;
    }
    if (this.isRendering) {
      return;
    }
    this.isRendering = true;

    try {
      await this.maybeRefreshUsageSummary(forceUsageRefresh);

      const telemetry = this.plugin.getGenerationTelemetry();
      const generationRunning = telemetry.state !== 'idle';
      const workspaceContext = await this.plugin.resolveAuthorNoteWorkspaceContext();
      const linkedStoryItems = workspaceContext.mode === 'author_note' && workspaceContext.authorNotePath
        ? await this.plugin.resolveLinkedStoryDisplayForAuthorNote(workspaceContext.authorNotePath)
        : [];
      const workspaceFile = workspaceContext.activeFilePath
        ? this.getMarkdownFileByPath(workspaceContext.activeFilePath)
        : null;
      const completionStatus = await this.plugin.getCompletionProfileWorkspaceStatus(workspaceFile);
      const completionPresets = this.plugin.getCompletionPresetItems();

      let lorebookTargetPath = '';
      let selectedScopes: string[] = [];
      if (workspaceContext.authorNotePath) {
        const authorNoteFile = this.getMarkdownFileByPath(workspaceContext.authorNotePath);
        if (authorNoteFile) {
          lorebookTargetPath = authorNoteFile.path;
          const selection = await this.plugin.resolveStoryScopeSelection(authorNoteFile);
          selectedScopes = selection.scopes;
        }
      }

      const availableScopes = this.plugin.getAvailableScopes();
      const availableForAdd = availableScopes.filter(scope => !selectedScopes.includes(scope));

      const { contentEl } = this;
      contentEl.empty();
      contentEl.addClass('lorevault-manager-view');

      const titleRow = contentEl.createDiv({ cls: 'lorevault-manager-title-row' });
      const icon = titleRow.createSpan({ cls: 'lorevault-manager-icon' });
      setIcon(icon, 'pen-square');
      titleRow.createEl('h2', { text: 'Story Writing' });

      const actionCard = contentEl.createDiv({ cls: 'lorevault-chat-controls' });
      actionCard.createEl('h3', { text: 'Actions' });

      const generationActions = actionCard.createDiv({ cls: 'lorevault-manager-toolbar' });
      const continueOrStopButton = generationActions.createEl('button', {
        text: generationRunning ? 'Stop' : 'Continue Story'
      });
      if (!generationRunning) {
        continueOrStopButton.addClass('mod-cta');
      }
      continueOrStopButton.disabled = generationRunning ? false : !workspaceContext.activeFilePath;
      continueOrStopButton.addEventListener('click', () => {
        if (generationRunning) {
          this.stopGeneration();
          return;
        }
        void this.continueStory();
      });

      const directiveButton = generationActions.createEl('button', { text: 'Insert Directive' });
      directiveButton.disabled = !workspaceContext.activeFilePath;
      directiveButton.addEventListener('click', () => {
        void this.insertInlineDirective();
      });

      const authorNoteActions = actionCard.createDiv({ cls: 'lorevault-manager-toolbar' });
      const openAuthorNoteButton = authorNoteActions.createEl('button', {
        text: workspaceContext.authorNotePath ? 'Open Author Note' : 'Create Author Note'
      });
      openAuthorNoteButton.disabled = !workspaceContext.activeFilePath;
      openAuthorNoteButton.addEventListener('click', () => {
        void this.openOrCreateAuthorNote();
      });

      const linkAuthorNoteButton = authorNoteActions.createEl('button', { text: 'Link Author Note' });
      linkAuthorNoteButton.disabled = workspaceContext.mode !== 'story';
      linkAuthorNoteButton.addEventListener('click', () => {
        void this.linkExistingAuthorNote();
      });

      const rewriteAuthorNoteButton = authorNoteActions.createEl('button', { text: 'Rewrite Author Note' });
      rewriteAuthorNoteButton.disabled = !workspaceContext.activeFilePath;
      rewriteAuthorNoteButton.addEventListener('click', () => {
        void this.rewriteAuthorNote();
      });

      const chapterActions = actionCard.createDiv({ cls: 'lorevault-manager-toolbar' });
      const chapterSummaryButton = chapterActions.createEl('button', { text: 'Generate Chapter Summary' });
      chapterSummaryButton.disabled = generationRunning || !this.plugin.canCreateNextStoryChapterForActiveNote();
      chapterSummaryButton.addEventListener('click', () => {
        void this.generateChapterSummary();
      });

      const createNextChapterButton = chapterActions.createEl('button', { text: 'Create Next Chapter' });
      createNextChapterButton.disabled = generationRunning || !this.plugin.canCreateNextStoryChapterForActiveNote();
      createNextChapterButton.addEventListener('click', () => {
        void this.createNextChapter();
      });

      const activeNoteCard = contentEl.createDiv({ cls: 'lorevault-manager-card lorevault-manager-generation-card' });
      const activeHeader = activeNoteCard.createDiv({ cls: 'lorevault-manager-card-header' });
      activeHeader.createEl('h3', { text: 'Active Writing Note' });
      const stateBadge = activeHeader.createSpan({
        cls: `lorevault-manager-state lorevault-manager-state-${telemetry.state}`
      });
      stateBadge.setText(telemetry.state);

      activeNoteCard.createEl('p', {
        cls: 'lorevault-manager-generation-stats',
        text: workspaceContext.activeFilePath || 'No active markdown note selected.'
      });
      activeNoteCard.createEl('p', {
        cls: 'lorevault-manager-generation-stats',
        text: workspaceContext.authorNotePath
          ? `Author note: ${workspaceContext.authorNotePath}`
          : (workspaceContext.missingAuthorNoteRef
            ? `Author note ref unresolved: ${workspaceContext.missingAuthorNoteRef}`
            : 'Author note: (not linked yet)')
      });

      if (workspaceContext.mode === 'author_note') {
        activeNoteCard.createEl('p', {
          cls: 'lorevault-manager-generation-stats',
          text: 'Linked Chapters/Stories:'
        });
        if (linkedStoryItems.length === 0) {
          activeNoteCard.createEl('p', {
            cls: 'lorevault-manager-generation-stats',
            text: '(none)'
          });
        } else {
          const linkedList = activeNoteCard.createEl('ul');
          for (const linkedStory of linkedStoryItems) {
            const item = linkedList.createEl('li');
            const chapterLabel = typeof linkedStory.chapter === 'number'
              ? `Chapter ${linkedStory.chapter}`
              : 'Unnumbered';
            const titleSuffix = linkedStory.chapterTitle ? ` - ${linkedStory.chapterTitle}` : '';
            item.createSpan({ text: `${chapterLabel}${titleSuffix}: ${linkedStory.path} ` });
            const openButton = item.createEl('button', { text: 'Open' });
            openButton.addEventListener('click', () => {
              const file = this.getMarkdownFileByPath(linkedStory.path);
              if (!file) {
                new Notice(`Unable to open linked story: ${linkedStory.path}`);
                return;
              }
              void this.app.workspace.getLeaf(true).openFile(file);
            });
          }
        }
      } else if (workspaceContext.linkedStoryPaths.length > 0) {
        activeNoteCard.createEl('p', {
          cls: 'lorevault-manager-generation-stats',
          text: `Linked stories: ${workspaceContext.linkedStoryPaths.join(', ')}`
        });
      }

      activeNoteCard.createEl('p', {
        cls: 'lorevault-manager-generation-stats',
        text: `Model: ${completionStatus.effective.completion.provider}/${completionStatus.effective.completion.model}`
      });
      activeNoteCard.createEl('p', {
        cls: 'lorevault-manager-generation-stats',
        text: `Generation: ${telemetry.statusText} | updated ${formatRelativeTime(telemetry.updatedAt)}`
      });
      activeNoteCard.createEl('p', {
        cls: 'lorevault-manager-generation-stats',
        text: `Context: scopes ${telemetry.scopes.join(', ') || '(none)'} | used ${formatTokenValue(telemetry.contextUsedTokens)} | left ${formatTokenValue(telemetry.contextRemainingTokens)}`
      });
      activeNoteCard.createEl('p', {
        cls: 'lorevault-manager-generation-stats',
        text: `Output: ~${formatTokenValue(telemetry.generatedTokens)} / ${formatTokenValue(telemetry.maxOutputTokens)} | world_info ${formatTokenValue(telemetry.worldInfoCount)} | fallback ${formatTokenValue(telemetry.ragCount)}`
      });

      const generationDetails = activeNoteCard.createEl('details', { cls: 'lorevault-manager-debug' });
      generationDetails.open = this.generationDetailsOpen || generationRunning;
      generationDetails.addEventListener('toggle', () => {
        this.generationDetailsOpen = generationDetails.open;
      });
      generationDetails.createEl('summary', { text: 'Selected Context Items' });

      const wiHeading = generationDetails.createEl('h4', { text: 'world_info' });
      wiHeading.addClass('lorevault-manager-subheading');
      if (telemetry.worldInfoItems.length === 0) {
        generationDetails.createEl('p', { text: '(none)' });
      } else {
        const wiList = generationDetails.createEl('ul');
        for (const item of telemetry.worldInfoItems) {
          wiList.createEl('li', { text: item });
        }
      }

      const ragHeading = generationDetails.createEl('h4', { text: 'fallback entries' });
      ragHeading.addClass('lorevault-manager-subheading');
      if (telemetry.ragItems.length === 0) {
        generationDetails.createEl('p', { text: '(none)' });
      } else {
        const ragList = generationDetails.createEl('ul');
        for (const item of telemetry.ragItems) {
          ragList.createEl('li', { text: item });
        }
      }

      const scopeCard = contentEl.createDiv({ cls: 'lorevault-chat-controls' });
      scopeCard.createEl('h3', { text: 'Selected Lorebooks' });
      if (!lorebookTargetPath) {
        scopeCard.createEl('p', {
          text: 'Link an Author Note to edit lorebooks for writing.'
        });
      } else {
        const selectedList = scopeCard.createDiv({ cls: 'lorevault-chat-note-list' });
        if (selectedScopes.length === 0) {
          selectedList.createEl('p', { text: 'No lorebooks selected.' });
        } else {
          for (const scope of selectedScopes) {
            const row = selectedList.createDiv({ cls: 'lorevault-chat-note-row lorevault-steering-lorebook-row' });
            row.createEl('code', { text: scope });
            const removeButton = row.createEl('button', {
              cls: 'clickable-icon lorevault-steering-remove-icon',
              attr: {
                'aria-label': `Remove lorebook ${scope}`,
                title: `Remove lorebook ${scope}`
              }
            });
            setIcon(removeButton, 'trash-2');
            removeButton.addEventListener('click', () => {
              const nextScopes = selectedScopes.filter(item => item !== scope);
              void this.plugin.updateStoryNoteLorebookScopes(lorebookTargetPath, nextScopes)
                .then(() => this.render(true))
                .catch(error => {
                  const message = error instanceof Error ? error.message : String(error);
                  new Notice(`Failed to update lorebooks: ${message}`);
                });
            });
          }
        }

        const addRow = scopeCard.createDiv({ cls: 'lorevault-chat-scope-row' });
        const addButton = addRow.createEl('button', { text: 'Add Lorebook' });
        addButton.disabled = availableForAdd.length === 0;
        addButton.addEventListener('click', () => {
          void (async () => {
            try {
              const candidate = await this.pickLorebookScope(availableForAdd);
              if (!candidate) {
                return;
              }
              const nextScopes = [...selectedScopes, candidate];
              await this.plugin.updateStoryNoteLorebookScopes(lorebookTargetPath, nextScopes);
              await this.render(true);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              new Notice(`Failed to update lorebooks: ${message}`);
            }
          })();
        });
      }

      const profileCard = contentEl.createDiv({ cls: 'lorevault-chat-controls' });
      profileCard.createEl('h3', { text: 'Profile and Cost' });

      const deviceProfileRow = profileCard.createDiv({ cls: 'lorevault-chat-scope-row' });
      const deviceProfileSelect = deviceProfileRow.createEl('select', { cls: 'dropdown lorevault-profile-select' });
      deviceProfileSelect.createEl('option', { value: '', text: '(base settings)' });
      for (const preset of completionPresets) {
        deviceProfileSelect.createEl('option', {
          value: preset.id,
          text: preset.name
        });
      }
      const isAuthorNoteOverridden = completionStatus.effective.source === 'author_note';
      deviceProfileSelect.value = completionStatus.devicePresetId;
      deviceProfileSelect.disabled = generationRunning || isAuthorNoteOverridden;
      deviceProfileSelect.addEventListener('change', () => {
        void this.setDeviceCompletionProfile(deviceProfileSelect.value.trim());
      });
      if (isAuthorNoteOverridden) {
        profileCard.createEl('p', {
          cls: 'lorevault-profile-override-warning',
          text: 'Overridden by Author Note'
        });
      }

      const costDetails = profileCard.createEl('details', { cls: 'lorevault-manager-debug' });
      costDetails.open = this.costDetailsOpen;
      costDetails.addEventListener('toggle', () => {
        this.costDetailsOpen = costDetails.open;
      });
      costDetails.createEl('summary', { text: 'Cost Breakdown' });
      costDetails.createEl('p', {
        cls: 'lorevault-manager-generation-stats',
        text: completionStatus.costProfile
          ? `Cost profile in usage ledger: ${completionStatus.costProfile}`
          : `Cost profile in usage ledger: ${completionStatus.effectiveCostProfile || '(none)'} (auto from API key hash)`
      });

      if (this.usageSummary) {
        const updatedAt = costDetails.createEl('p', {
          cls: 'lorevault-manager-generation-stats lorevault-cost-breakdown-updated',
          text: `Updated ${formatRelativeTime(this.usageSummary.generatedAt)}`
        });
        updatedAt.addClass('is-muted');
        const costList = costDetails.createEl('ul', { cls: 'lorevault-cost-breakdown-list' });
        const items: Array<{ label: string; totals: UsageLedgerTotals }> = [
          { label: 'Session', totals: this.usageSummary.totals.session },
          { label: 'Today (UTC)', totals: this.usageSummary.totals.day },
          { label: 'This Week (UTC)', totals: this.usageSummary.totals.week },
          { label: 'This Month (UTC)', totals: this.usageSummary.totals.month },
          { label: 'Project', totals: this.usageSummary.totals.project }
        ];
        for (const item of items) {
          const row = costList.createEl('li', { cls: 'lorevault-cost-breakdown-row' });
          row.createEl('span', { cls: 'lorevault-cost-breakdown-label', text: item.label });
          row.createEl('span', {
            cls: 'lorevault-cost-breakdown-value',
            text: formatCostSummaryValue(item.totals)
          });
        }
        if (this.usageSummary.warnings.length > 0) {
          const warningList = costDetails.createEl('ul', { cls: 'lorevault-manager-warnings' });
          for (const warning of this.usageSummary.warnings.slice(0, 5)) {
            const li = warningList.createEl('li', { text: warning });
            li.addClass('lorevault-manager-warning-item');
          }
        }
      } else if (this.usageSummaryError) {
        costDetails.createEl('p', {
          cls: 'lorevault-manager-warning-item',
          text: `Failed to load usage summary: ${this.usageSummaryError}`
        });
      } else {
        costDetails.createEl('p', {
          cls: 'lorevault-manager-generation-stats',
          text: 'Loading usage summary...'
        });
      }
    } finally {
      this.isRendering = false;
    }
  }
}
