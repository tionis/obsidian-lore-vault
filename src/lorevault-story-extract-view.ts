import { ItemView, Notice, Setting, WorkspaceLeaf } from 'obsidian';
import LoreBookConverterPlugin from './main';
import { requestStoryContinuation } from './completion-provider';
import { applyImportedWikiPages, ImportedWikiPage } from './sillytavern-import';
import {
  extractWikiPagesFromStory,
  StoryExtractionProgressEvent,
  StoryExtractionResult
} from './story-extraction';
import { openVaultFolderPicker } from './folder-suggest-modal';
import { ConverterSettings } from './models';

export const LOREVAULT_STORY_EXTRACT_VIEW_TYPE = 'lorevault-story-extract-view';

export class LorevaultStoryExtractView extends ItemView {
  private plugin: LoreBookConverterPlugin;
  private targetFolder = '';
  private defaultTags = '';
  private lorebookName = '';
  private storyMarkdown = '';
  private maxChunkChars = 5000;
  private maxOperationsPerChunk = 12;
  private maxExistingPagesInPrompt = 80;
  private selectedCompletionPresetId = '';
  private running = false;
  private runningMode: 'preview' | 'apply' | null = null;
  private progressStage = '';
  private progressDetails = '';
  private progressLastUpdated = 0;
  private previewError = '';
  private applyMessage = '';
  private lastPreview: StoryExtractionResult | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: LoreBookConverterPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.targetFolder = this.plugin.getDefaultLorebookImportLocation();
  }

  getViewType(): string {
    return LOREVAULT_STORY_EXTRACT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'LoreVault Story Extraction';
  }

  getIcon(): string {
    return 'file-search';
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

  private setProgress(stage: string, details = ''): void {
    this.progressStage = stage;
    this.progressDetails = details;
    this.progressLastUpdated = Date.now();
    this.render();
  }

  private onExtractionProgress(event: StoryExtractionProgressEvent): void {
    const chunkLabel = event.chunkTotal
      ? `chunk ${event.chunkIndex ?? 0}/${event.chunkTotal}`
      : (event.chunkIndex ? `chunk ${event.chunkIndex}` : '');
    if (event.stage === 'starting') {
      this.setProgress('Preparing extraction preview...', event.chunkTotal ? `${event.chunkTotal} chunk(s)` : '');
      return;
    }
    if (event.stage === 'chunk_start') {
      this.setProgress('Processing extraction chunk...', chunkLabel);
      return;
    }
    if (event.stage === 'chunk_success') {
      const opLabel = typeof event.operationCount === 'number'
        ? `${event.operationCount} operation(s)`
        : '';
      this.setProgress('Chunk processed', [chunkLabel, opLabel].filter(Boolean).join(' | '));
      return;
    }
    if (event.stage === 'chunk_error') {
      this.setProgress('Chunk failed', [chunkLabel, event.warning ?? 'unknown error'].filter(Boolean).join(' | '));
      return;
    }
    if (event.stage === 'rendering_pages') {
      this.setProgress('Rendering extracted pages...');
      return;
    }
    if (event.stage === 'completed') {
      this.setProgress(
        'Extraction preview complete',
        event.pageCount !== undefined ? `${event.pageCount} page(s)` : ''
      );
    }
  }

  private async resolveCompletionConfig(): Promise<{
    completion: ConverterSettings['completion'];
    profileLabel: string;
    profileSource: string;
    profileId: string;
    profileName: string;
    costProfile: string;
    autoCostProfile: string;
  }> {
    const selectedPresetId = this.selectedCompletionPresetId.trim();
    if (selectedPresetId) {
      const selectedPreset = this.plugin.getCompletionPresetById(selectedPresetId);
      if (!selectedPreset) {
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
        profileLabel: selectedPreset.name,
        profileSource: resolved.source,
        profileId: resolved.presetId,
        profileName: resolved.presetName,
        costProfile: this.plugin.resolveEffectiveCostProfileForApiKey(completion.apiKey),
        autoCostProfile: this.plugin.buildAutoCostProfileForApiKey(completion.apiKey)
      };
    }

    const resolution = await this.plugin.resolveEffectiveCompletionForFile();
    const completion = resolution.completion;
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
      profileLabel: resolution.presetName || 'workspace effective profile',
      profileSource: resolution.source,
      profileId: resolution.presetId,
      profileName: resolution.presetName,
      costProfile: this.plugin.resolveEffectiveCostProfileForApiKey(completion.apiKey),
      autoCostProfile: this.plugin.buildAutoCostProfileForApiKey(completion.apiKey)
    };
  }

  private async runPreview(): Promise<void> {
    if (this.running) {
      return;
    }
    if (!this.storyMarkdown.trim()) {
      new Notice('Paste story markdown before running extraction.');
      return;
    }
    let completionResolution: {
      completion: ConverterSettings['completion'];
      profileLabel: string;
      profileSource: string;
      profileId: string;
      profileName: string;
      costProfile: string;
      autoCostProfile: string;
    };
    try {
      completionResolution = await this.resolveCompletionConfig();
    } catch {
      return;
    }

    this.running = true;
    this.runningMode = 'preview';
    this.progressStage = 'Starting extraction preview...';
    this.progressDetails = `Profile: ${completionResolution.profileLabel}`;
    this.progressLastUpdated = Date.now();
    this.previewError = '';
    this.applyMessage = '';
    this.render();

    try {
      const result = await extractWikiPagesFromStory({
        storyMarkdown: this.storyMarkdown,
        targetFolder: this.targetFolder,
        defaultTagsRaw: this.defaultTags,
        lorebookName: this.lorebookName,
        tagPrefix: this.plugin.settings.tagScoping.tagPrefix,
        maxChunkChars: this.maxChunkChars,
        maxSummaryChars: this.plugin.settings.summaries.maxSummaryChars,
        maxOperationsPerChunk: this.maxOperationsPerChunk,
        maxExistingPagesInPrompt: this.maxExistingPagesInPrompt,
        callModel: (systemPrompt, userPrompt) => requestStoryContinuation(completionResolution.completion, {
          systemPrompt,
          userPrompt,
          operationName: 'story_extract_preview',
          onOperationLog: record => this.plugin.appendCompletionOperationLog(record, {
            costProfile: completionResolution.costProfile
          }),
          onUsage: usage => {
            void this.plugin.recordCompletionUsage('story_extract_preview', usage, {
              lorebookName: this.lorebookName.trim(),
              targetFolder: this.targetFolder.trim(),
              completionProfileSource: completionResolution.profileSource,
              completionProfileId: completionResolution.profileId,
              completionProfileName: completionResolution.profileName,
              autoCostProfile: completionResolution.autoCostProfile
            });
          }
        }),
        onProgress: event => this.onExtractionProgress(event)
      });
      this.lastPreview = result;
      this.previewError = '';
      this.applyMessage = '';
      new Notice(`Preview complete: ${result.pages.length} page(s), ${result.chunks.length} chunk(s).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Story extraction preview failed:', error);
      this.lastPreview = null;
      this.previewError = message;
      new Notice(`Story extraction preview failed: ${message}`);
    } finally {
      this.running = false;
      this.runningMode = null;
      this.render();
    }
  }

  private async applyPreview(): Promise<void> {
    if (this.running) {
      return;
    }
    if (!this.lastPreview) {
      new Notice('Run preview before applying extracted pages.');
      return;
    }
    this.running = true;
    this.runningMode = 'apply';
    this.progressStage = 'Applying extracted pages...';
    this.progressDetails = '';
    this.progressLastUpdated = Date.now();
    this.applyMessage = '';
    this.render();

    const wikiPages: ImportedWikiPage[] = this.lastPreview.pages.map((page, index) => ({
      path: page.path,
      content: page.content,
      uid: index
    }));

    try {
      const applied = await applyImportedWikiPages(this.app, wikiPages, {
        onProgress: event => {
          this.setProgress(
            'Applying extracted pages...',
            `${event.index}/${event.total} | ${event.action} ${event.path}`
          );
        }
      });
      this.applyMessage = `Applied: ${applied.created} created, ${applied.updated} updated.`;
      new Notice(`Story extraction applied: ${applied.created} created, ${applied.updated} updated.`);
      this.setProgress('Apply complete', `${applied.created} created, ${applied.updated} updated`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Story extraction apply failed:', error);
      this.applyMessage = `Apply failed: ${message}`;
      new Notice(`Story extraction apply failed: ${message}`);
      this.setProgress('Apply failed', message);
    } finally {
      this.running = false;
      this.runningMode = null;
      this.render();
    }
  }

  private renderPreviewOutput(container: HTMLElement): void {
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

    if (this.running && this.runningMode === 'preview') {
      container.createEl('p', { text: 'Running extraction preview...' });
      return;
    }
    if (this.running && this.runningMode === 'apply') {
      container.createEl('p', { text: 'Applying extracted pages...' });
      return;
    }

    if (this.previewError) {
      container.createEl('p', { text: `Preview failed: ${this.previewError}` });
      return;
    }

    if (!this.lastPreview) {
      container.createEl('p', {
        text: 'Run preview to inspect extracted page plan before applying writes.'
      });
      return;
    }

    const { lastPreview } = this;
    container.createEl('p', {
      text: `Preview complete: ${lastPreview.pages.length} page(s), ${lastPreview.chunks.length} chunk(s).`
    });

    if (this.applyMessage) {
      container.createEl('p', { text: this.applyMessage });
    }

    const chunkDetails = container.createEl('details');
    chunkDetails.createEl('summary', { text: `Chunk Summary (${lastPreview.chunks.length})` });
    const chunkList = chunkDetails.createEl('ul');
    for (const chunk of lastPreview.chunks) {
      const warningSuffix = chunk.warnings.length > 0 ? ` | warnings: ${chunk.warnings.join('; ')}` : '';
      chunkList.createEl('li', {
        text: `Chunk ${chunk.chunkIndex}: ${chunk.operationCount} operation(s)${warningSuffix}`
      });
    }

    if (lastPreview.warnings.length > 0) {
      const warningDetails = container.createEl('details');
      warningDetails.createEl('summary', { text: `Warnings (${lastPreview.warnings.length})` });
      const warningList = warningDetails.createEl('ul');
      for (const warning of lastPreview.warnings.slice(0, 80)) {
        warningList.createEl('li', { text: warning });
      }
      if (lastPreview.warnings.length > 80) {
        warningDetails.createEl('p', { text: `... ${lastPreview.warnings.length - 80} more warnings` });
      }
    }

    const details = container.createEl('details');
    details.createEl('summary', { text: `Planned File Paths (${lastPreview.pages.length})` });
    const list = details.createEl('ul');
    for (const page of lastPreview.pages.slice(0, 120)) {
      list.createEl('li', { text: page.path });
    }
    if (lastPreview.pages.length > 120) {
      details.createEl('p', { text: `... ${lastPreview.pages.length - 120} more` });
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-import-view');
    contentEl.createEl('h2', { text: 'Extract Wiki Pages from Story' });

    if (!this.targetFolder.trim()) {
      this.targetFolder = this.plugin.getDefaultLorebookImportLocation();
    }
    const defaultTargetFolder = this.plugin.getDefaultLorebookImportLocation();
    let targetFolderInput: { setValue: (value: string) => void } | null = null;
    new Setting(contentEl)
      .setName('Target Folder')
      .setDesc('Folder where extracted wiki pages will be created/updated.')
      .addText(text => {
        targetFolderInput = text;
        text
          .setPlaceholder(defaultTargetFolder)
          .setValue(this.targetFolder)
          .onChange(value => {
            this.targetFolder = value.trim();
          });
      })
      .addButton(button => button
        .setButtonText('Browse')
        .onClick(() => {
          openVaultFolderPicker(this.app, path => {
            this.targetFolder = path;
            targetFolderInput?.setValue(path);
          });
        }));

    new Setting(contentEl)
      .setName('Default Tags')
      .setDesc('Comma or newline separated tags applied to generated notes.')
      .addTextArea(text => {
        text.inputEl.rows = 2;
        text
          .setPlaceholder('wiki, extracted')
          .setValue(this.defaultTags)
          .onChange(value => {
            this.defaultTags = value;
          });
      });

    new Setting(contentEl)
      .setName('Lorebook Name')
      .setDesc(`Converted into one lorebook tag under prefix "${this.plugin.settings.tagScoping.tagPrefix}".`)
      .addText(text => text
        .setPlaceholder('story-extract')
        .setValue(this.lorebookName)
        .onChange(value => {
          this.lorebookName = value;
        }));

    new Setting(contentEl)
      .setName('Completion Profile')
      .setDesc('Profile used for model calls in extraction preview.')
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
          });
      });

    new Setting(contentEl)
      .setName('Story Markdown')
      .setDesc('Paste story markdown to extract/update wiki notes chunk-by-chunk.')
      .addTextArea(text => {
        text.inputEl.rows = 14;
        text
          .setPlaceholder('# Chapter 1\n...')
          .setValue(this.storyMarkdown)
          .onChange(value => {
            this.storyMarkdown = value;
          });
      });

    new Setting(contentEl)
      .setName('Max Chunk Chars')
      .setDesc('Deterministic chunk size target for story extraction.')
      .addText(text => text
        .setValue(this.maxChunkChars.toString())
        .onChange(value => {
          const parsed = parseInt(value, 10);
          if (!isNaN(parsed) && parsed >= 200) {
            this.maxChunkChars = parsed;
          }
        }));

    new Setting(contentEl)
      .setName('Max Operations Per Chunk')
      .setDesc('Upper bound on extracted page operations from each chunk.')
      .addText(text => text
        .setValue(this.maxOperationsPerChunk.toString())
        .onChange(value => {
          const parsed = parseInt(value, 10);
          if (!isNaN(parsed) && parsed >= 1) {
            this.maxOperationsPerChunk = parsed;
          }
        }));

    new Setting(contentEl)
      .setName('Max Existing Pages In Prompt')
      .setDesc('Cap on existing extracted page state included per chunk prompt.')
      .addText(text => text
        .setValue(this.maxExistingPagesInPrompt.toString())
        .onChange(value => {
          const parsed = parseInt(value, 10);
          if (!isNaN(parsed) && parsed >= 1) {
            this.maxExistingPagesInPrompt = parsed;
          }
        }));

    const actions = contentEl.createDiv({ cls: 'lorevault-import-actions' });
    const output = contentEl.createDiv({ cls: 'lorevault-import-output' });
    this.renderPreviewOutput(output);

    const previewButton = actions.createEl('button', { text: this.running ? 'Preview Running...' : 'Preview Extraction' });
    previewButton.addClass('mod-cta');
    previewButton.disabled = this.running;
    previewButton.addEventListener('click', () => {
      void this.runPreview();
    });

    const applyButton = actions.createEl('button', { text: 'Apply Preview' });
    applyButton.disabled = this.running || !this.lastPreview;
    applyButton.addEventListener('click', () => {
      void this.applyPreview();
    });

    const clearButton = actions.createEl('button', { text: 'Clear Preview' });
    clearButton.disabled = this.running || !this.lastPreview;
    clearButton.addEventListener('click', () => {
      this.lastPreview = null;
      this.previewError = '';
      this.applyMessage = '';
      this.render();
    });
  }
}
