import { ItemView, Notice, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import LoreBookConverterPlugin from './main';
import { requestStoryContinuation } from './completion-provider';
import { ConverterSettings } from './models';
import { LorebookScopeSuggestModal } from './lorebook-scope-suggest-modal';
import { openVaultFolderPicker } from './folder-suggest-modal';
import { AssembledContext } from './context-query';
import { applyImportedWikiPages, ImportedWikiPage } from './sillytavern-import';
import {
  buildStoryStarterImportPlan,
  buildStoryStarterSystemPrompt,
  buildStoryStarterUserPrompt,
  parseStoryStarterResponse
} from './story-starter';
import { normalizeScope } from './lorebook-scoping';
import { normalizeVaultPath } from './vault-path-utils';

export const LOREVAULT_STORY_STARTER_VIEW_TYPE = 'lorevault-story-starter-view';

const DEFAULT_STORY_STARTER_TARGET_FOLDER = 'LoreVault/stories';

interface StoryStarterCompletionResolution {
  completion: ConverterSettings['completion'];
  profileLabel: string;
  profileSource: string;
  profileId: string;
  profileName: string;
  costProfile: string;
  autoCostProfile: string;
}

interface StoryStarterLoreContextResult {
  markdown: string;
  worldInfoCount: number;
  ragCount: number;
}

interface StoryStarterPreviewResult {
  pages: ImportedWikiPage[];
  summary: string;
  warnings: string[];
  notes: string[];
}

export class LorevaultStoryStarterView extends ItemView {
  private plugin: LoreBookConverterPlugin;
  private targetFolder = DEFAULT_STORY_STARTER_TARGET_FOLDER;
  private defaultTags = '';
  private requestedTitle = '';
  private storyIdea = '';
  private brainstormNotes = '';
  private selectedLorebooks: string[] = [];
  private selectedCompletionPresetId = '';
  private running = false;
  private runningMode: 'preview' | 'apply' | null = null;
  private progressStage = '';
  private progressDetails = '';
  private progressLastUpdated = 0;
  private previewSummary = '';
  private previewWarnings: string[] = [];
  private previewNotes: string[] = [];
  private previewPaths: string[] = [];
  private applySummary = '';
  private lastError = '';
  private preparedPages: ImportedWikiPage[] = [];
  private preparedKey = '';

  constructor(leaf: WorkspaceLeaf, plugin: LoreBookConverterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LOREVAULT_STORY_STARTER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'LoreVault Story Starter';
  }

  getIcon(): string {
    return 'sparkles';
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  refresh(): void {
    this.render();
  }

  private getNormalizedLorebooks(): string[] {
    return [...new Set(
      this.selectedLorebooks
        .map(value => normalizeScope(value))
        .filter(Boolean)
    )].sort((left, right) => left.localeCompare(right));
  }

  private addLorebook(scope: string): void {
    const normalized = normalizeScope(scope);
    if (!normalized || this.selectedLorebooks.includes(normalized)) {
      return;
    }
    this.selectedLorebooks = [...this.selectedLorebooks, normalized].sort((left, right) => left.localeCompare(right));
    this.invalidatePreparedPages();
    this.render();
  }

  private removeLorebook(scope: string): void {
    const normalized = normalizeScope(scope);
    this.selectedLorebooks = this.selectedLorebooks.filter(item => item !== normalized);
    this.invalidatePreparedPages();
    this.render();
  }

  private async pickLorebookScope(scopes: string[]): Promise<string | null> {
    const uniqueScopes = [...new Set(scopes.map(scope => normalizeScope(scope)).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
    if (uniqueScopes.length === 0) {
      new Notice('No additional lorebooks available.');
      return null;
    }
    const modal = new LorebookScopeSuggestModal(this.app, uniqueScopes, 'Pick a lorebook to add...');
    const selectionPromise = modal.waitForSelection();
    modal.open();
    return selectionPromise;
  }

  private getCompletionProfileOptions(): Array<{ value: string; label: string }> {
    const options: Array<{ value: string; label: string }> = [{
      value: '',
      label: '(Workspace effective profile)'
    }];
    for (const preset of this.plugin.getCompletionPresetItems()) {
      options.push({
        value: preset.id,
        label: preset.name
      });
    }
    return options;
  }

  private async resolveCompletionConfig(): Promise<StoryStarterCompletionResolution> {
    const selectedPresetId = this.selectedCompletionPresetId.trim();
    if (selectedPresetId && !this.plugin.getCompletionPresetById(selectedPresetId)) {
      new Notice(`Selected completion profile is missing: ${selectedPresetId}`);
      throw new Error(`Missing completion profile: ${selectedPresetId}`);
    }

    const resolved = this.plugin.resolveEffectiveCompletionForStoryChat(selectedPresetId);
    const completion = resolved.completion;
    if (!completion.enabled) {
      new Notice('Writing completion is disabled. Enable it in settings first.');
      throw new Error('Writing completion is disabled.');
    }
    if (completion.provider !== 'ollama' && !completion.apiKey) {
      new Notice('Missing completion API key. Configure it in settings first.');
      throw new Error('Missing completion API key.');
    }

    return {
      completion,
      profileLabel: resolved.presetName || 'workspace effective profile',
      profileSource: resolved.source,
      profileId: resolved.presetId,
      profileName: resolved.presetName,
      costProfile: this.plugin.resolveEffectiveCostProfileForApiKey(completion.apiKey),
      autoCostProfile: this.plugin.buildAutoCostProfileForApiKey(completion.apiKey)
    };
  }

  private invalidatePreparedPages(): void {
    this.preparedPages = [];
    this.preparedKey = '';
  }

  private getPreparedKey(): string {
    return [
      this.targetFolder.trim(),
      this.defaultTags,
      this.requestedTitle,
      this.storyIdea,
      this.brainstormNotes,
      this.getNormalizedLorebooks().join(','),
      this.selectedCompletionPresetId.trim(),
      this.plugin.getStorySteeringFolderPath()
    ].join('\u0000');
  }

  private setProgress(stage: string, details = ''): void {
    this.progressStage = stage;
    this.progressDetails = details;
    this.progressLastUpdated = Date.now();
    this.render();
  }

  private clearOutput(): void {
    this.previewSummary = '';
    this.previewWarnings = [];
    this.previewNotes = [];
    this.previewPaths = [];
    this.applySummary = '';
    this.lastError = '';
  }

  private syncPreviewPathsFromPreparedPages(): void {
    this.previewPaths = this.preparedPages.map(page => page.path);
  }

  private normalizePagesForApply(pages: ImportedWikiPage[]): ImportedWikiPage[] {
    const normalizedPages: ImportedWikiPage[] = [];
    const seenPaths = new Set<string>();
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const normalizedPath = normalizeVaultPath((page.path ?? '').trim());
      if (!normalizedPath) {
        throw new Error(`Planned file ${index + 1} is missing a target path.`);
      }
      const pathKey = normalizedPath.toLowerCase();
      if (seenPaths.has(pathKey)) {
        throw new Error(`Duplicate planned file path: ${normalizedPath}`);
      }
      seenPaths.add(pathKey);
      normalizedPages.push({
        ...page,
        path: normalizedPath,
        content: typeof page.content === 'string' ? page.content : ''
      });
    }
    return normalizedPages;
  }

  private async buildLoreContext(
    completion: ConverterSettings['completion'],
    queryText: string
  ): Promise<StoryStarterLoreContextResult> {
    const scopes = this.getNormalizedLorebooks();
    if (scopes.length === 0) {
      return {
        markdown: '',
        worldInfoCount: 0,
        ragCount: 0
      };
    }

    const maxInputTokens = Math.max(512, completion.contextWindowTokens - completion.maxOutputTokens);
    const totalBudget = Math.max(320, Math.min(9000, Math.floor(maxInputTokens * 0.28)));
    const perScopeBudget = Math.max(120, Math.floor(totalBudget / Math.max(1, scopes.length)));
    const contexts: AssembledContext[] = await Promise.all(scopes.map(scope => this.plugin.liveContextIndex.query({
      queryText,
      tokenBudget: perScopeBudget,
      maxWorldInfoEntries: 12,
      maxRagDocuments: 8
    }, scope)));

    return {
      markdown: contexts
        .map(context => context.markdown)
        .filter(Boolean)
        .join('\n\n---\n\n'),
      worldInfoCount: contexts.reduce((sum, context) => sum + context.worldInfo.length, 0),
      ragCount: contexts.reduce((sum, context) => sum + context.rag.length, 0)
    };
  }

  private async computePreviewResult(
    completionResolution: StoryStarterCompletionResolution
  ): Promise<StoryStarterPreviewResult> {
    const storyIdea = this.storyIdea.trim();
    if (!storyIdea) {
      throw new Error('Describe the story idea before running preview.');
    }

    const lorebooks = this.getNormalizedLorebooks();
    const querySeed = [
      this.requestedTitle.trim(),
      storyIdea,
      this.brainstormNotes.trim()
    ].filter(Boolean).join('\n\n');

    let loreContext: StoryStarterLoreContextResult = {
      markdown: '',
      worldInfoCount: 0,
      ragCount: 0
    };
    if (lorebooks.length > 0) {
      this.setProgress('Retrieving lore context...', `${lorebooks.length} lorebook(s)`);
      loreContext = await this.buildLoreContext(completionResolution.completion, querySeed || storyIdea);
    }

    this.setProgress('Generating story starter...', `Profile: ${completionResolution.profileLabel}`);
    const response = await requestStoryContinuation(completionResolution.completion, {
      systemPrompt: buildStoryStarterSystemPrompt(),
      userPrompt: buildStoryStarterUserPrompt({
        requestedTitle: this.requestedTitle,
        storyIdea: this.storyIdea,
        brainstormNotes: this.brainstormNotes,
        selectedLorebooks: lorebooks,
        loreContextMarkdown: loreContext.markdown
      }),
      operationName: 'story_starter_preview',
      onOperationLog: record => this.plugin.appendCompletionOperationLog(record, {
        costProfile: completionResolution.costProfile
      }),
      onUsage: usage => {
        void this.plugin.recordCompletionUsage('story_starter_preview', usage, {
          requestedTitle: this.requestedTitle.trim(),
          targetFolder: this.targetFolder.trim(),
          lorebookCount: lorebooks.length,
          lorebooks,
          worldInfoCount: loreContext.worldInfoCount,
          ragCount: loreContext.ragCount,
          completionProfileSource: completionResolution.profileSource,
          completionProfileId: completionResolution.profileId,
          completionProfileName: completionResolution.profileName,
          autoCostProfile: completionResolution.autoCostProfile
        });
      }
    });

    const parsed = parseStoryStarterResponse(response);
    this.setProgress('Building write plan...', parsed.title);

    const plan = buildStoryStarterImportPlan(parsed, {
      targetFolder: this.targetFolder,
      authorNoteFolder: this.plugin.getStorySteeringFolderPath(),
      defaultTagsRaw: this.defaultTags,
      lorebookNames: lorebooks,
      completionPresetId: this.selectedCompletionPresetId.trim()
    });

    const notes = [...parsed.starterNotes];
    const requestedTitle = this.requestedTitle.trim();
    if (requestedTitle && requestedTitle !== parsed.title) {
      notes.unshift(`Model adjusted the requested title to "${parsed.title}".`);
    }

    const warnings = [
      ...plan.warnings
    ];
    if (lorebooks.length > 0 && !loreContext.markdown.trim()) {
      warnings.push(`No lore context was retrieved from selected lorebooks: ${lorebooks.join(', ')}`);
    }

    const loreSummary = lorebooks.length > 0
      ? `lore ${loreContext.worldInfoCount} world_info, ${loreContext.ragCount} fallback from ${lorebooks.length} lorebook(s)`
      : 'no lorebooks selected';
    const summary = `Preview: story note + author note | ${loreSummary}${notes.length > 0 ? ` | starter notes: ${notes.length}` : ''}.`;

    return {
      pages: plan.pages,
      summary,
      warnings,
      notes
    };
  }

  private async runPreview(): Promise<void> {
    if (this.running) {
      return;
    }

    let completionResolution: StoryStarterCompletionResolution;
    try {
      completionResolution = await this.resolveCompletionConfig();
    } catch {
      return;
    }

    this.running = true;
    this.runningMode = 'preview';
    this.clearOutput();
    this.setProgress('Preparing story-starter preview...', `Profile: ${completionResolution.profileLabel}`);

    try {
      const result = await this.computePreviewResult(completionResolution);
      this.preparedPages = this.normalizePagesForApply(result.pages);
      this.preparedKey = this.getPreparedKey();
      this.previewSummary = result.summary;
      this.previewWarnings = result.warnings;
      this.previewNotes = result.notes;
      this.syncPreviewPathsFromPreparedPages();
      this.setProgress('Preview complete', `${this.preparedPages.length} note(s)`);
      new Notice('Story starter preview complete.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = `Preview failed: ${message}`;
      this.setProgress('Preview failed', message);
      new Notice(`Story starter preview failed: ${message}`);
    } finally {
      this.running = false;
      this.runningMode = null;
      this.render();
    }
  }

  private async runApply(): Promise<void> {
    if (this.running) {
      return;
    }

    let completionResolution: StoryStarterCompletionResolution;
    try {
      completionResolution = await this.resolveCompletionConfig();
    } catch {
      return;
    }

    this.running = true;
    this.runningMode = 'apply';
    this.lastError = '';
    this.applySummary = '';
    this.setProgress('Preparing story-starter apply...', `Profile: ${completionResolution.profileLabel}`);

    try {
      const preparedKey = this.getPreparedKey();
      let pages: ImportedWikiPage[] = [];
      if (this.preparedPages.length > 0 && this.preparedKey === preparedKey) {
        pages = this.normalizePagesForApply(this.preparedPages);
        this.preparedPages = pages;
        this.syncPreviewPathsFromPreparedPages();
        this.setProgress('Using preview plan...', `${pages.length} note(s)`);
      } else {
        const result = await this.computePreviewResult(completionResolution);
        pages = this.normalizePagesForApply(result.pages);
        this.preparedPages = pages;
        this.preparedKey = preparedKey;
        this.previewSummary = result.summary;
        this.previewWarnings = result.warnings;
        this.previewNotes = result.notes;
        this.syncPreviewPathsFromPreparedPages();
      }

      this.setProgress('Creating story starter notes...', `${pages.length} note(s)`);
      const applied = await applyImportedWikiPages(this.app, pages, {
        onProgress: event => {
          this.setProgress(
            'Creating story starter notes...',
            `${event.index}/${event.total} | ${event.action} ${event.path}`
          );
        }
      });
      this.applySummary = `Created/updated story starter notes: ${applied.created} created, ${applied.updated} updated.`;
      this.setProgress('Apply complete', `${applied.created} created, ${applied.updated} updated`);

      const storyPage = pages.find(page => !page.content.includes('lvDocType: "authorNote"')) ?? pages[0];
      const storyFile = storyPage
        ? this.app.vault.getAbstractFileByPath(storyPage.path)
        : null;
      if (storyFile instanceof TFile) {
        await this.app.workspace.getLeaf(true).openFile(storyFile);
      }

      new Notice('Story starter notes created.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = `Create failed: ${message}`;
      this.setProgress('Create failed', message);
      new Notice(`Story starter creation failed: ${message}`);
    } finally {
      this.running = false;
      this.runningMode = null;
      this.render();
    }
  }

  private buildInputs(container: HTMLElement): void {
    let targetFolderInput: { setValue: (value: string) => void } | null = null;
    new Setting(container)
      .setName('Target Folder')
      .setDesc('Folder where the first chapter note will be created or updated.')
      .addText(text => {
        targetFolderInput = text;
        text
          .setPlaceholder(DEFAULT_STORY_STARTER_TARGET_FOLDER)
          .setValue(this.targetFolder)
          .onChange(value => {
            this.targetFolder = value.trim();
            this.invalidatePreparedPages();
          });
      })
      .addButton(button => button
        .setButtonText('Browse')
        .onClick(() => {
          openVaultFolderPicker(this.app, path => {
            this.targetFolder = path;
            this.invalidatePreparedPages();
            targetFolderInput?.setValue(path);
          });
        }));

    new Setting(container)
      .setName('Author Note Folder')
      .setDesc(`Linked author note will be created in ${this.plugin.getStorySteeringFolderPath()}. Change it in LoreVault settings if needed.`);

    new Setting(container)
      .setName('Default Tags')
      .setDesc('Comma or newline separated tags applied to the generated story note and author note.')
      .addTextArea(text => {
        text.inputEl.rows = 2;
        text
          .setPlaceholder('draft, story')
          .setValue(this.defaultTags)
          .onChange(value => {
            this.defaultTags = value;
            this.invalidatePreparedPages();
          });
      });

    new Setting(container)
      .setName('Completion Profile')
      .setDesc('Profile used for the story-starter generation run.')
      .addDropdown(dropdown => {
        const options = this.getCompletionProfileOptions();
        for (const option of options) {
          dropdown.addOption(option.value, option.label);
        }
        const selected = this.selectedCompletionPresetId.trim();
        if (selected && !options.some(option => option.value === selected)) {
          dropdown.addOption(selected, `[Missing] ${selected}`);
        }
        dropdown
          .setValue(selected)
          .onChange(value => {
            this.selectedCompletionPresetId = value.trim();
            this.invalidatePreparedPages();
          });
      });

    const availableScopes = this.plugin.getCachedLorebookScopes();
    const selectedScopes = this.getNormalizedLorebooks();
    const unselectedScopes = availableScopes.filter(scope => !selectedScopes.includes(scope));

    const lorebookSetting = new Setting(container)
      .setName('Lorebooks')
      .setDesc('Optional lorebooks used both for retrieval and for the generated notes frontmatter.');
    const selectedList = lorebookSetting.controlEl.createDiv({ cls: 'lorevault-import-review-list' });
    if (selectedScopes.length === 0) {
      selectedList.createEl('p', { text: 'No lorebooks selected.' });
    } else {
      for (const scope of selectedScopes) {
        const row = selectedList.createDiv({ cls: 'lorevault-import-review-item' });
        row.createEl('code', { text: scope });
        const removeButton = row.createEl('button', { text: 'Delete' });
        removeButton.addEventListener('click', () => {
          this.removeLorebook(scope);
        });
      }
    }

    const lorebookActions = lorebookSetting.controlEl.createDiv({ cls: 'lorevault-import-actions' });
    const addLorebookButton = lorebookActions.createEl('button', { text: 'Add Lorebook' });
    addLorebookButton.disabled = unselectedScopes.length === 0;
    addLorebookButton.addEventListener('click', () => {
      void (async () => {
        const selected = await this.pickLorebookScope(unselectedScopes);
        if (!selected) {
          return;
        }
        this.addLorebook(selected);
      })();
    });

    const addLorebookInput = lorebookActions.createEl('input', {
      type: 'text',
      cls: 'lorevault-story-delta-scope-input'
    });
    addLorebookInput.placeholder = 'Add custom lorebook and press Enter';
    addLorebookInput.addEventListener('keydown', event => {
      if (event.key !== 'Enter') {
        return;
      }
      event.preventDefault();
      const value = addLorebookInput.value.trim();
      if (!value) {
        return;
      }
      this.addLorebook(value);
      addLorebookInput.value = '';
    });

    new Setting(container)
      .setName('Requested Title (Optional)')
      .setDesc('If provided, LoreVault asks the model to keep this as the story title.')
      .addText(text => text
        .setPlaceholder('The Glass Orchard')
        .setValue(this.requestedTitle)
        .onChange(value => {
          this.requestedTitle = value;
          this.invalidatePreparedPages();
        }));

    new Setting(container)
      .setName('Story Idea')
      .setDesc('Core premise, hook, or setup you want the story to start from.')
      .addTextArea(text => {
        text.inputEl.rows = 8;
        text
          .setPlaceholder('A disinherited heir returns to the frozen orchard where the family bells only ring for blood.')
          .setValue(this.storyIdea)
          .onChange(value => {
            this.storyIdea = value;
            this.invalidatePreparedPages();
          });
      });

    new Setting(container)
      .setName('Brainstorm Notes (Optional)')
      .setDesc('Paste extra notes, scene ideas, chat takeaways, or constraints you want reflected in the opening and author note.')
      .addTextArea(text => {
        text.inputEl.rows = 8;
        text
          .setPlaceholder('POV should stay close to Mira. Start with her arriving at dusk. The bells should hint at bloodline magic before anyone explains it.')
          .setValue(this.brainstormNotes)
          .onChange(value => {
            this.brainstormNotes = value;
            this.invalidatePreparedPages();
          });
      });
  }

  private renderOutput(container: HTMLElement): void {
    if (this.progressStage) {
      const suffix = this.progressLastUpdated > 0
        ? ` | updated ${new Date(this.progressLastUpdated).toLocaleTimeString()}`
        : '';
      container.createEl('p', {
        text: this.progressDetails
          ? `${this.progressStage} ${this.progressDetails}${suffix}`
          : `${this.progressStage}${suffix}`
      });
    }

    if (this.lastError) {
      container.createEl('p', { text: this.lastError });
      return;
    }

    if (this.previewSummary) {
      container.createEl('p', { text: this.previewSummary });
    }
    if (this.applySummary) {
      container.createEl('p', { text: this.applySummary });
    }

    if (this.previewNotes.length > 0) {
      const notesDetails = container.createEl('details');
      notesDetails.open = true;
      notesDetails.createEl('summary', { text: `Starter Notes (${this.previewNotes.length})` });
      const list = notesDetails.createEl('ul');
      for (const note of this.previewNotes) {
        list.createEl('li', { text: note });
      }
    }

    if (this.previewWarnings.length > 0) {
      const warningDetails = container.createEl('details');
      warningDetails.createEl('summary', { text: `Warnings (${this.previewWarnings.length})` });
      const warningList = warningDetails.createEl('ul');
      for (const warning of this.previewWarnings.slice(0, 80)) {
        warningList.createEl('li', { text: warning });
      }
      if (this.previewWarnings.length > 80) {
        warningDetails.createEl('p', { text: `... ${this.previewWarnings.length - 80} more warnings` });
      }
    }

    if (this.preparedPages.length > 0) {
      this.renderEditablePlannedWrites(container);
      return;
    }

    if (!this.previewSummary && !this.applySummary && !this.running) {
      container.createEl('p', {
        text: 'Describe the story idea, then run Preview or Create Notes.'
      });
    }
  }

  private renderEditablePlannedWrites(container: HTMLElement): void {
    const details = container.createEl('details', { cls: 'lorevault-import-planned-writes' });
    details.open = true;
    details.createEl('summary', { text: `Planned Writes (Editable) (${this.preparedPages.length})` });
    details.createEl('p', {
      cls: 'lorevault-import-planned-writes-note',
      text: 'Adjust paths or content before creating the starter notes. Edited values are written as-is.'
    });

    for (let index = 0; index < this.preparedPages.length; index += 1) {
      const page = this.preparedPages[index];
      const card = details.createDiv({ cls: 'lorevault-import-page-editor' });
      card.createEl('p', {
        cls: 'lorevault-import-page-editor-title',
        text: `File ${index + 1}`
      });

      const pathInput = card.createEl('input', {
        cls: 'lorevault-import-page-path',
        type: 'text'
      });
      pathInput.value = page.path;
      pathInput.disabled = this.running;
      pathInput.addEventListener('input', () => {
        page.path = pathInput.value;
        this.syncPreviewPathsFromPreparedPages();
      });

      const contentInput = card.createEl('textarea', {
        cls: 'lorevault-import-page-content'
      });
      const lineCount = page.content ? page.content.split('\n').length : 0;
      contentInput.rows = Math.max(8, Math.min(24, lineCount + 1));
      contentInput.value = page.content;
      contentInput.disabled = this.running;
      contentInput.addEventListener('input', () => {
        page.content = contentInput.value;
      });
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-import-view');
    contentEl.addClass('lorevault-story-starter-view');
    contentEl.createEl('h2', { text: 'Story Starter' });

    this.buildInputs(contentEl);

    const actions = contentEl.createDiv({ cls: 'lorevault-import-actions' });
    const output = contentEl.createDiv({ cls: 'lorevault-import-output' });

    const previewLabel = this.running
      ? (this.runningMode === 'preview' ? 'Preview Running...' : 'Working...')
      : 'Preview';
    const previewButton = actions.createEl('button', { text: previewLabel });
    previewButton.disabled = this.running;
    previewButton.addEventListener('click', () => {
      void this.runPreview();
    });

    const createLabel = this.runningMode === 'apply' ? 'Creating...' : 'Create Notes';
    const createButton = actions.createEl('button', { text: createLabel });
    createButton.addClass('mod-cta');
    createButton.disabled = this.running;
    createButton.addEventListener('click', () => {
      void this.runApply();
    });

    const clearButton = actions.createEl('button', { text: 'Clear Draft' });
    clearButton.disabled = this.running;
    clearButton.addEventListener('click', () => {
      this.requestedTitle = '';
      this.storyIdea = '';
      this.brainstormNotes = '';
      this.invalidatePreparedPages();
      this.clearOutput();
      this.render();
    });

    this.renderOutput(output);
  }
}
