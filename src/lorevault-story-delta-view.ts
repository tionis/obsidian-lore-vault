import { ItemView, Notice, Setting, TFile, getAllTags, WorkspaceLeaf } from 'obsidian';
import LoreBookConverterPlugin from './main';
import { requestStoryContinuation } from './completion-provider';
import { applyImportedWikiPages, ImportedWikiPage } from './sillytavern-import';
import {
  buildStoryDeltaPlan,
  StoryDeltaResult,
  StoryDeltaUpdatePolicy,
  StoryDeltaExistingPageInput
} from './story-delta-update';
import { normalizeVaultPath } from './vault-path-utils';

export const LOREVAULT_STORY_DELTA_VIEW_TYPE = 'lorevault-story-delta-view';

function normalizeTag(tag: string): string {
  return tag
    .trim()
    .replace(/^#+/, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

export class LorevaultStoryDeltaView extends ItemView {
  private plugin: LoreBookConverterPlugin;
  private sourceStoryNotePath = '';
  private storyMarkdown = '';
  private targetFolder = 'LoreVault/import';
  private requiredScopeTag = '';
  private updatePolicy: StoryDeltaUpdatePolicy = 'safe_append';
  private defaultTags = '';
  private lorebookName = '';
  private maxChunkChars = 5000;
  private maxOperationsPerChunk = 12;
  private maxExistingPagesInPrompt = 80;
  private lowConfidenceThreshold = 0.55;
  private running = false;
  private lastPreview: StoryDeltaResult | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: LoreBookConverterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LOREVAULT_STORY_DELTA_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'LoreVault Story Delta';
  }

  getIcon(): string {
    return 'file-plus-2';
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

  private canUseCompletion(): boolean {
    const completion = this.plugin.settings.completion;
    if (!completion.enabled) {
      new Notice('Writing completion is disabled. Enable it in settings first.');
      return false;
    }
    if (completion.provider !== 'ollama' && !completion.apiKey) {
      new Notice('Missing completion API key. Configure it in settings first.');
      return false;
    }
    return true;
  }

  private async resolveStoryMarkdown(): Promise<string> {
    const inline = this.storyMarkdown.trim();
    if (inline) {
      return inline;
    }

    const storyPath = normalizeVaultPath(this.sourceStoryNotePath.trim());
    if (!storyPath) {
      throw new Error('Paste story markdown or provide a source story note path.');
    }

    const file = this.app.vault.getAbstractFileByPath(storyPath);
    if (!(file instanceof TFile)) {
      throw new Error(`Story note not found: ${storyPath}`);
    }

    const raw = await this.app.vault.read(file);
    const resolved = raw.trim();
    if (!resolved) {
      throw new Error(`Story note is empty: ${storyPath}`);
    }

    return resolved;
  }

  private async collectTargetPages(): Promise<StoryDeltaExistingPageInput[]> {
    const normalizedTarget = normalizeVaultPath(this.targetFolder.trim().replace(/^\/+|\/+$/g, ''));
    if (!normalizedTarget) {
      throw new Error('Target folder is required.');
    }

    const scopeTag = normalizeTag(this.requiredScopeTag);
    const allFiles = this.app.vault.getMarkdownFiles();
    const files = allFiles
      .filter(file => file.path === normalizedTarget || file.path.startsWith(`${normalizedTarget}/`))
      .sort((left, right) => left.path.localeCompare(right.path));

    const selected: TFile[] = [];
    for (const file of files) {
      if (!scopeTag) {
        selected.push(file);
        continue;
      }
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) {
        continue;
      }
      const tags = getAllTags(cache) ?? [];
      const hasTag = tags.some(tag => normalizeTag(tag) === scopeTag);
      if (hasTag) {
        selected.push(file);
      }
    }

    const pages: StoryDeltaExistingPageInput[] = [];
    for (const file of selected) {
      const content = await this.app.vault.read(file);
      pages.push({
        path: file.path,
        content
      });
    }

    return pages;
  }

  private setStoryPathFromActiveNote(): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile)) {
      new Notice('No active markdown note to use as source.');
      return;
    }
    this.sourceStoryNotePath = activeFile.path;
    this.render();
  }

  private async runPreview(outputEl: HTMLElement): Promise<void> {
    if (this.running) {
      return;
    }
    if (!this.canUseCompletion()) {
      return;
    }

    this.running = true;
    outputEl.empty();
    outputEl.createEl('p', { text: 'Running story delta preview...' });
    this.render();

    try {
      const storyMarkdown = await this.resolveStoryMarkdown();
      const existingPages = await this.collectTargetPages();

      const completion = this.plugin.settings.completion;
      const result = await buildStoryDeltaPlan({
        storyMarkdown,
        targetFolder: this.targetFolder,
        defaultTagsRaw: this.defaultTags,
        lorebookName: this.lorebookName,
        tagPrefix: this.plugin.settings.tagScoping.tagPrefix,
        updatePolicy: this.updatePolicy,
        maxChunkChars: this.maxChunkChars,
        maxSummaryChars: this.plugin.settings.summaries.maxSummaryChars,
        maxOperationsPerChunk: this.maxOperationsPerChunk,
        maxExistingPagesInPrompt: this.maxExistingPagesInPrompt,
        lowConfidenceThreshold: this.lowConfidenceThreshold,
        existingPages,
        callModel: (systemPrompt, userPrompt) => requestStoryContinuation(completion, {
          systemPrompt,
          userPrompt
        })
      });

      this.lastPreview = result;
      outputEl.empty();

      const createCount = result.pages.filter(page => page.action === 'create').length;
      const updateCount = result.pages.filter(page => page.action === 'update').length;
      outputEl.createEl('p', {
        text: `Preview complete: ${result.pages.length} write(s) (${createCount} create, ${updateCount} update), ${result.skippedLowConfidence} low-confidence skipped.`
      });

      const chunkList = outputEl.createEl('ul');
      for (const chunk of result.chunks) {
        const warningSuffix = chunk.warnings.length > 0 ? ` | warnings: ${chunk.warnings.join('; ')}` : '';
        chunkList.createEl('li', {
          text: `Chunk ${chunk.chunkIndex}: ${chunk.operationCount} operation(s)${warningSuffix}`
        });
      }

      if (result.warnings.length > 0) {
        const warningsHeader = outputEl.createEl('p', { text: 'Warnings:' });
        warningsHeader.addClass('lorevault-import-output-warning');
        const warningList = outputEl.createEl('ul');
        for (const warning of result.warnings.slice(0, 80)) {
          warningList.createEl('li', { text: warning });
        }
        if (result.warnings.length > 80) {
          outputEl.createEl('p', { text: `... ${result.warnings.length - 80} more warnings` });
        }
      }

      const details = outputEl.createEl('details');
      details.createEl('summary', { text: 'Planned Changes' });
      const list = details.createEl('ul');
      for (const change of result.changes.slice(0, 120)) {
        const rationaleSuffix = change.rationales.length > 0
          ? ` | rationale: ${change.rationales[0]}`
          : '';
        list.createEl('li', {
          text: `[${change.action}] ${change.path} | ops=${change.appliedOperations} | confidence=${change.confidence.toFixed(2)}${rationaleSuffix}`
        });
      }
      if (result.changes.length > 120) {
        details.createEl('p', { text: `... ${result.changes.length - 120} more` });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Story delta preview failed:', error);
      this.lastPreview = null;
      outputEl.empty();
      outputEl.createEl('p', { text: `Preview failed: ${message}` });
      new Notice(`Story delta preview failed: ${message}`);
    } finally {
      this.running = false;
      this.render();
    }
  }

  private async applyPreview(outputEl: HTMLElement): Promise<void> {
    if (!this.lastPreview) {
      new Notice('Run preview before applying story delta updates.');
      return;
    }

    try {
      const pages: ImportedWikiPage[] = this.lastPreview.pages.map((page, index) => ({
        path: page.path,
        content: page.content,
        uid: index
      }));
      const applied = await applyImportedWikiPages(this.app, pages);
      outputEl.createEl('p', {
        text: `Applied: ${applied.created} created, ${applied.updated} updated.`
      });
      new Notice(`Story delta applied: ${applied.created} created, ${applied.updated} updated.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Story delta apply failed:', error);
      outputEl.createEl('p', { text: `Apply failed: ${message}` });
      new Notice(`Story delta apply failed: ${message}`);
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-import-view');
    contentEl.createEl('h2', { text: 'Apply Story Delta to Existing Wiki' });

    new Setting(contentEl)
      .setName('Source Story Note Path (Optional)')
      .setDesc('If set, this note is used when Story Markdown is empty.')
      .addText(text => text
        .setPlaceholder('Stories/Book One/Chapter 03.md')
        .setValue(this.sourceStoryNotePath)
        .onChange(value => {
          this.sourceStoryNotePath = value.trim();
        }))
      .addButton(button => button
        .setButtonText('Use Active Note')
        .onClick(() => {
          this.setStoryPathFromActiveNote();
        }));

    new Setting(contentEl)
      .setName('Story Markdown')
      .setDesc('Paste story markdown. Leave empty to load from Source Story Note Path.')
      .addTextArea(text => {
        text.inputEl.rows = 10;
        text
          .setPlaceholder('# Chapter\n...')
          .setValue(this.storyMarkdown)
          .onChange(value => {
            this.storyMarkdown = value;
          });
      });

    new Setting(contentEl)
      .setName('Target Wiki Folder')
      .setDesc('Only notes in this folder are considered for existing-page updates.')
      .addText(text => text
        .setPlaceholder('LoreVault/import')
        .setValue(this.targetFolder)
        .onChange(value => {
          this.targetFolder = value.trim();
        }));

    new Setting(contentEl)
      .setName('Optional Scope Tag Filter')
      .setDesc('If set, only notes with this tag are eligible for updates.')
      .addText(text => text
        .setPlaceholder('lorebook/universe')
        .setValue(this.requiredScopeTag)
        .onChange(value => {
          this.requiredScopeTag = value.trim();
        }));

    new Setting(contentEl)
      .setName('Update Policy')
      .setDesc('safe_append keeps existing metadata; structured_merge updates summary/keywords/aliases too.')
      .addDropdown(dropdown => {
        dropdown.addOption('safe_append', 'safe_append');
        dropdown.addOption('structured_merge', 'structured_merge');
        dropdown.setValue(this.updatePolicy);
        dropdown.onChange(value => {
          if (value === 'safe_append' || value === 'structured_merge') {
            this.updatePolicy = value;
          }
        });
      });

    new Setting(contentEl)
      .setName('Default Tags')
      .setDesc('Applied to newly created notes (comma/newline separated).')
      .addTextArea(text => {
        text.inputEl.rows = 2;
        text
          .setPlaceholder('wiki, updated')
          .setValue(this.defaultTags)
          .onChange(value => {
            this.defaultTags = value;
          });
      });

    new Setting(contentEl)
      .setName('Lorebook Name')
      .setDesc(`Converted into one lorebook tag under prefix "${this.plugin.settings.tagScoping.tagPrefix}" for newly created pages.`)
      .addText(text => text
        .setPlaceholder('story/main')
        .setValue(this.lorebookName)
        .onChange(value => {
          this.lorebookName = value;
        }));

    new Setting(contentEl)
      .setName('Max Chunk Chars')
      .setDesc('Deterministic chunk size target for story delta extraction.')
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
      .setDesc('Upper bound on proposed update operations for each chunk.')
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
      .setDesc('Cap on existing page snapshots injected per chunk.')
      .addText(text => text
        .setValue(this.maxExistingPagesInPrompt.toString())
        .onChange(value => {
          const parsed = parseInt(value, 10);
          if (!isNaN(parsed) && parsed >= 1) {
            this.maxExistingPagesInPrompt = parsed;
          }
        }));

    new Setting(contentEl)
      .setName('Low Confidence Threshold')
      .setDesc('Operations below this confidence are skipped and reported in preview warnings.')
      .addText(text => text
        .setValue(this.lowConfidenceThreshold.toString())
        .onChange(value => {
          const parsed = Number(value);
          if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
            this.lowConfidenceThreshold = parsed;
          }
        }));

    const actions = contentEl.createDiv({ cls: 'lorevault-import-actions' });
    const output = contentEl.createDiv({ cls: 'lorevault-import-output' });
    if (!this.lastPreview) {
      output.createEl('p', {
        text: 'Run preview to inspect deterministic story-delta changes before applying writes.'
      });
    }

    const previewButton = actions.createEl('button', { text: this.running ? 'Preview Running...' : 'Preview Story Delta' });
    previewButton.addClass('mod-cta');
    previewButton.disabled = this.running;
    previewButton.addEventListener('click', () => {
      void this.runPreview(output);
    });

    const applyButton = actions.createEl('button', { text: 'Apply Preview' });
    applyButton.disabled = this.running || !this.lastPreview;
    applyButton.addEventListener('click', () => {
      void this.applyPreview(output);
    });

    const clearButton = actions.createEl('button', { text: 'Clear Preview' });
    clearButton.disabled = this.running || !this.lastPreview;
    clearButton.addEventListener('click', () => {
      this.lastPreview = null;
      this.render();
    });
  }
}
