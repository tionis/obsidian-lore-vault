import { ItemView, Notice, Setting, WorkspaceLeaf } from 'obsidian';
import LoreBookConverterPlugin from './main';
import {
  applyImportedWikiPages,
  buildImportedWikiPages,
  parseSillyTavernLorebookJson
} from './sillytavern-import';
import { openVaultFolderPicker } from './folder-suggest-modal';
import { LorebookScopeSuggestModal } from './lorebook-scope-suggest-modal';

export const LOREVAULT_IMPORT_VIEW_TYPE = 'lorevault-import-view';

export class LorevaultImportView extends ItemView {
  private plugin: LoreBookConverterPlugin;
  private targetFolder = 'LoreVault/import';
  private defaultTags = '';
  private selectedLorebooks: string[] = [];
  private lorebookJson = '';
  private skipDisabled = true;
  private selectedCompletionPresetId = '';
  private running = false;
  private runningMode: 'preview' | 'import' | null = null;
  private progressStage = '';
  private progressDetails = '';
  private progressLastUpdated = 0;
  private previewSummary = '';
  private previewWarnings: string[] = [];
  private previewPaths: string[] = [];
  private importSummary = '';
  private lastError = '';

  constructor(leaf: WorkspaceLeaf, plugin: LoreBookConverterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LOREVAULT_IMPORT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'LoreVault Import';
  }

  getIcon(): string {
    return 'inbox';
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
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const lorebook of this.selectedLorebooks) {
      const normalized = lorebook.trim();
      if (!normalized) {
        continue;
      }
      const key = normalized.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(normalized);
    }
    deduped.sort((left, right) => left.localeCompare(right));
    return deduped;
  }

  private addLorebook(scope: string): void {
    const normalized = scope.trim();
    if (!normalized) {
      return;
    }
    const exists = this.selectedLorebooks.some(item => item.trim().toLowerCase() === normalized.toLowerCase());
    if (exists) {
      return;
    }
    this.selectedLorebooks.push(normalized);
    this.selectedLorebooks = this.getNormalizedLorebooks();
    this.render();
  }

  private removeLorebook(scope: string): void {
    const normalized = scope.trim().toLowerCase();
    this.selectedLorebooks = this.selectedLorebooks.filter(item => item.trim().toLowerCase() !== normalized);
    this.render();
  }

  private async pickLorebookScope(scopes: string[]): Promise<string | null> {
    const uniqueScopes = [...new Set(scopes.map(scope => scope.trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
    if (uniqueScopes.length === 0) {
      new Notice('No additional lorebooks available.');
      return null;
    }
    const modal = new LorebookScopeSuggestModal(this.app, uniqueScopes, 'Pick a lorebook scope to add...');
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

  private resolveCompletionProfileLabel(): string {
    const selectedId = this.selectedCompletionPresetId.trim();
    if (!selectedId) {
      return 'workspace effective profile';
    }
    const preset = this.plugin.getCompletionPresetById(selectedId);
    return preset?.name ?? selectedId;
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
    this.previewPaths = [];
    this.importSummary = '';
    this.lastError = '';
  }

  private buildSharedInputs(container: HTMLElement): void {
    let targetFolderInput: { setValue: (value: string) => void } | null = null;
    new Setting(container)
      .setName('Target Folder')
      .setDesc('Folder where imported wiki pages will be created/updated.')
      .addText(text => {
        targetFolderInput = text;
        text
          .setPlaceholder('LoreVault/import')
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

    new Setting(container)
      .setName('Default Tags')
      .setDesc('Comma or newline separated tags applied to every imported note.')
      .addTextArea(text => {
        text.inputEl.rows = 2;
        text
          .setPlaceholder('wiki, imported')
          .setValue(this.defaultTags)
          .onChange(value => {
            this.defaultTags = value;
          });
      });

    new Setting(container)
      .setName('Completion Profile')
      .setDesc('Profile selection for model-assisted import operations.')
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

    const availableScopes = this.plugin.getCachedLorebookScopes();
    const selectedScopes = this.getNormalizedLorebooks();
    const unselectedScopes = availableScopes.filter(scope => !selectedScopes.includes(scope));

    const lorebookSetting = new Setting(container)
      .setName('Lorebooks')
      .setDesc('Lorebook tags added to every imported note.');
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
  }

  private async runPreview(): Promise<void> {
    if (this.running) {
      return;
    }
    if (!this.lorebookJson.trim()) {
      new Notice('Paste lorebook JSON to preview import results.');
      return;
    }

    this.running = true;
    this.runningMode = 'preview';
    this.clearOutput();
    this.setProgress('Parsing lorebook JSON...', `Profile: ${this.resolveCompletionProfileLabel()}`);

    try {
      const parsed = parseSillyTavernLorebookJson(this.lorebookJson);
      const entries = this.skipDisabled
        ? parsed.entries.filter(entry => !entry.disable)
        : parsed.entries;
      this.setProgress('Building import plan...', `${entries.length} entries`);
      const pages = buildImportedWikiPages(entries, {
        targetFolder: this.targetFolder,
        defaultTagsRaw: this.defaultTags,
        lorebookName: '',
        lorebookNames: this.getNormalizedLorebooks(),
        tagPrefix: this.plugin.settings.tagScoping.tagPrefix,
        maxSummaryChars: this.plugin.settings.summaries.maxSummaryChars
      });

      this.previewSummary = `Preview: ${entries.length} entries -> ${pages.length} wiki note(s).`;
      this.previewWarnings = parsed.warnings;
      this.previewPaths = pages.map(page => page.path);
      this.setProgress('Preview complete', `${pages.length} note(s)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = `Preview failed: ${message}`;
      this.setProgress('Preview failed', message);
    } finally {
      this.running = false;
      this.runningMode = null;
      this.render();
    }
  }

  private async runImport(): Promise<void> {
    if (this.running) {
      return;
    }
    if (!this.lorebookJson.trim()) {
      new Notice('Paste lorebook JSON before importing.');
      return;
    }

    this.running = true;
    this.runningMode = 'import';
    this.clearOutput();
    this.setProgress('Parsing lorebook JSON...', `Profile: ${this.resolveCompletionProfileLabel()}`);

    try {
      const parsed = parseSillyTavernLorebookJson(this.lorebookJson);
      const entries = this.skipDisabled
        ? parsed.entries.filter(entry => !entry.disable)
        : parsed.entries;
      if (entries.length === 0) {
        new Notice('No importable entries found.');
        this.importSummary = 'No importable entries found.';
        return;
      }

      this.setProgress('Building import write plan...', `${entries.length} entries`);
      const pages = buildImportedWikiPages(entries, {
        targetFolder: this.targetFolder,
        defaultTagsRaw: this.defaultTags,
        lorebookName: '',
        lorebookNames: this.getNormalizedLorebooks(),
        tagPrefix: this.plugin.settings.tagScoping.tagPrefix,
        maxSummaryChars: this.plugin.settings.summaries.maxSummaryChars
      });

      this.setProgress('Applying imported notes...', `${pages.length} note(s)`);
      const applied = await applyImportedWikiPages(this.app, pages, {
        onProgress: event => {
          this.setProgress(
            'Applying imported notes...',
            `${event.index}/${event.total} | ${event.action} ${event.path}`
          );
        }
      });

      this.importSummary = `Import finished: ${applied.created} created, ${applied.updated} updated (${pages.length} total).`;
      this.previewWarnings = parsed.warnings;
      this.setProgress('Import complete', `${applied.created} created, ${applied.updated} updated`);
      new Notice(this.importSummary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Lorebook import failed:', error);
      this.lastError = `Import failed: ${message}`;
      this.setProgress('Import failed', message);
      new Notice(`Lorebook import failed: ${message}`);
    } finally {
      this.running = false;
      this.runningMode = null;
      this.render();
    }
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
    if (this.importSummary) {
      container.createEl('p', { text: this.importSummary });
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

    if (this.previewPaths.length > 0) {
      const details = container.createEl('details');
      details.createEl('summary', { text: `Planned File Paths (${this.previewPaths.length})` });
      const list = details.createEl('ul');
      for (const path of this.previewPaths.slice(0, 80)) {
        list.createEl('li', { text: path });
      }
      if (this.previewPaths.length > 80) {
        details.createEl('p', { text: `... ${this.previewPaths.length - 80} more` });
      }
    }

    if (!this.previewSummary && !this.importSummary && !this.running) {
      container.createEl('p', { text: 'Paste lorebook JSON, then run Preview or Import.' });
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-import-view');
    contentEl.createEl('h2', { text: 'Import SillyTavern Lorebook' });

    this.buildSharedInputs(contentEl);

    new Setting(contentEl)
      .setName('Skip Disabled Entries')
      .setDesc('Ignore entries with disable=true in imported lorebook JSON.')
      .addToggle(toggle => toggle
        .setValue(this.skipDisabled)
        .onChange(value => {
          this.skipDisabled = value;
        }));

    new Setting(contentEl)
      .setName('Lorebook JSON')
      .setDesc('Paste the full SillyTavern lorebook JSON payload.')
      .addTextArea(text => {
        text.inputEl.rows = 12;
        text
          .setPlaceholder('{"entries": {...}}')
          .setValue(this.lorebookJson)
          .onChange(value => {
            this.lorebookJson = value;
          });
      });

    const actions = contentEl.createDiv({ cls: 'lorevault-import-actions' });
    const output = contentEl.createDiv({ cls: 'lorevault-import-output' });

    const previewLabel = this.running
      ? (this.runningMode === 'preview' ? 'Preview Running...' : 'Import Running...')
      : 'Preview';
    const previewButton = actions.createEl('button', { text: previewLabel });
    previewButton.disabled = this.running;
    previewButton.addEventListener('click', () => {
      void this.runPreview();
    });

    const importLabel = this.runningMode === 'import' ? 'Import Running...' : 'Import';
    const importButton = actions.createEl('button', { text: importLabel });
    importButton.addClass('mod-cta');
    importButton.disabled = this.running;
    importButton.addEventListener('click', () => {
      void this.runImport();
    });

    const clearButton = actions.createEl('button', { text: 'Clear JSON' });
    clearButton.disabled = this.running;
    clearButton.addEventListener('click', () => {
      this.lorebookJson = '';
      this.render();
    });

    this.renderOutput(output);
  }
}
