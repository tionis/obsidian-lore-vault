import { App, FuzzySuggestModal, ItemView, Notice, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import LoreBookConverterPlugin from './main';
import { requestStoryContinuation } from './completion-provider';
import {
  applyImportedWikiPages,
  buildImportedWikiPages,
  ImportedWikiPage,
  parseSillyTavernLorebookJson
} from './sillytavern-import';
import { openVaultFolderPicker } from './folder-suggest-modal';
import { LorebookScopeSuggestModal } from './lorebook-scope-suggest-modal';
import { readVaultBinary } from './vault-binary-io';
import {
  buildCharacterCardImportPlan,
  buildCharacterCardRewriteSystemPrompt,
  buildCharacterCardRewriteUserPrompt,
  CharacterCardImportPlan,
  parseCharacterCardRewriteResponse,
  parseSillyTavernCharacterCardJson,
  parseSillyTavernCharacterCardPngBytes
} from './sillytavern-character-card';
import { normalizeVaultPath } from './vault-path-utils';
import { ConverterSettings } from './models';

export const LOREVAULT_IMPORT_VIEW_TYPE = 'lorevault-import-view';

type ImportMode = 'lorebook_json' | 'character_card';

interface ImportCompletionResolution {
  completion: ConverterSettings['completion'];
  profileLabel: string;
  profileSource: string;
  profileId: string;
  profileName: string;
  costProfile: string;
  autoCostProfile: string;
}

class CharacterCardFileSuggestModal extends FuzzySuggestModal<TFile> {
  private readonly files: TFile[];
  private readonly placeholder: string;
  private resolver: ((value: TFile | null) => void) | null = null;
  private resolved = false;
  private selectedFile: TFile | null = null;

  constructor(app: App, files: TFile[], placeholder = 'Pick a character card...') {
    super(app);
    this.files = files;
    this.placeholder = placeholder;
    this.setPlaceholder(this.placeholder);
  }

  waitForSelection(): Promise<TFile | null> {
    return new Promise(resolve => {
      this.resolver = resolve;
    });
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.selectedFile = file;
    this.finish(file);
  }

  onClose(): void {
    super.onClose();
    window.setTimeout(() => {
      this.finish(this.selectedFile);
    }, 0);
  }

  private finish(file: TFile | null): void {
    if (this.resolved || !this.resolver) {
      return;
    }
    this.resolved = true;
    const resolve = this.resolver;
    this.resolver = null;
    resolve(file);
  }
}

export class LorevaultImportView extends ItemView {
  private plugin: LoreBookConverterPlugin;
  private targetFolder = '';
  private defaultTags = '';
  private selectedLorebooks: string[] = [];
  private importMode: ImportMode = 'lorebook_json';

  private lorebookJson = '';
  private skipDisabled = true;

  private characterCardPath = '';
  private includeEmbeddedLorebook = true;

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

  private preparedPages: ImportedWikiPage[] = [];
  private preparedKey = '';

  constructor(leaf: WorkspaceLeaf, plugin: LoreBookConverterPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.targetFolder = this.plugin.getDefaultLorebookImportLocation();
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

  public setImportMode(mode: ImportMode): void {
    if (this.importMode === mode) {
      return;
    }
    this.importMode = mode;
    this.clearOutput();
    this.invalidatePreparedPages();
    this.render();
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

  private invalidatePreparedPages(): void {
    this.preparedPages = [];
    this.preparedKey = '';
  }

  private getPreparedKey(): string {
    if (this.importMode === 'lorebook_json') {
      return [
        this.importMode,
        this.targetFolder.trim(),
        this.defaultTags,
        this.lorebookJson,
        String(this.skipDisabled),
        this.getNormalizedLorebooks().join(','),
        this.plugin.settings.tagScoping.tagPrefix,
        String(this.plugin.settings.summaries.maxSummaryChars)
      ].join('\u0000');
    }

    return [
      this.importMode,
      this.targetFolder.trim(),
      this.defaultTags,
      this.characterCardPath.trim(),
      String(this.includeEmbeddedLorebook),
      this.selectedCompletionPresetId.trim(),
      this.getNormalizedLorebooks().join(','),
      this.plugin.settings.tagScoping.tagPrefix,
      String(this.plugin.settings.summaries.maxSummaryChars),
      this.plugin.getStorySteeringFolderPath()
    ].join('\u0000');
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
    this.invalidatePreparedPages();
    this.render();
  }

  private removeLorebook(scope: string): void {
    const normalized = scope.trim().toLowerCase();
    this.selectedLorebooks = this.selectedLorebooks.filter(item => item.trim().toLowerCase() !== normalized);
    this.invalidatePreparedPages();
    this.render();
  }

  private async pickLorebookScope(scopes: string[]): Promise<string | null> {
    const uniqueScopes = [...new Set(scopes.map(scope => scope.trim()).filter(Boolean))]
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

  private resolveCompletionProfileLabel(): string {
    const selectedId = this.selectedCompletionPresetId.trim();
    if (!selectedId) {
      return 'workspace effective profile';
    }
    const preset = this.plugin.getCompletionPresetById(selectedId);
    return preset?.name ?? selectedId;
  }

  private async resolveCompletionConfig(): Promise<ImportCompletionResolution> {
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

    const profileLabel = resolved.presetName || 'workspace effective profile';
    return {
      completion,
      profileLabel,
      profileSource: resolved.source,
      profileId: resolved.presetId,
      profileName: resolved.presetName,
      costProfile: this.plugin.resolveEffectiveCostProfileForApiKey(completion.apiKey),
      autoCostProfile: this.plugin.buildAutoCostProfileForApiKey(completion.apiKey)
    };
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

  private async pickCharacterCardFile(): Promise<string | null> {
    const supported = new Set(['png', 'json']);
    const files = this.app.vault.getFiles()
      .filter(file => supported.has(file.extension.toLowerCase()))
      .sort((left, right) => left.path.localeCompare(right.path));
    if (files.length === 0) {
      new Notice('No `.png` or `.json` character-card files found in the vault.');
      return null;
    }
    const modal = new CharacterCardFileSuggestModal(this.app, files, 'Pick a SillyTavern character card...');
    const resultPromise = modal.waitForSelection();
    modal.open();
    const selected = await resultPromise;
    return selected?.path ?? null;
  }

  private buildSharedInputs(container: HTMLElement): void {
    if (!this.targetFolder.trim()) {
      this.targetFolder = this.plugin.getDefaultLorebookImportLocation();
    }
    const defaultTargetFolder = this.plugin.getDefaultLorebookImportLocation();
    let targetFolderInput: { setValue: (value: string) => void } | null = null;
    new Setting(container)
      .setName('Target Folder')
      .setDesc('Folder where imported wiki pages will be created/updated.')
      .addText(text => {
        targetFolderInput = text;
        text
          .setPlaceholder(defaultTargetFolder)
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
      .setName('Default Tags')
      .setDesc('Comma or newline separated tags applied to every imported note.')
      .addTextArea(text => {
        text.inputEl.rows = 2;
        text
          .setPlaceholder('wiki, imported')
          .setValue(this.defaultTags)
          .onChange(value => {
            this.defaultTags = value;
            this.invalidatePreparedPages();
          });
      });

    new Setting(container)
      .setName('Import Type')
      .setDesc('Choose what you are importing from SillyTavern.')
      .addDropdown(dropdown => dropdown
        .addOption('lorebook_json', 'Lorebook JSON')
        .addOption('character_card', 'Character Card')
        .setValue(this.importMode)
        .onChange(value => {
          this.importMode = value === 'character_card' ? 'character_card' : 'lorebook_json';
          this.clearOutput();
          this.invalidatePreparedPages();
          this.render();
        }));

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
            this.invalidatePreparedPages();
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

  private buildLorebookJsonInputs(container: HTMLElement): void {
    new Setting(container)
      .setName('Skip Disabled Entries')
      .setDesc('Ignore entries with disable=true in imported lorebook JSON.')
      .addToggle(toggle => toggle
        .setValue(this.skipDisabled)
        .onChange(value => {
          this.skipDisabled = value;
          this.invalidatePreparedPages();
        }));

    new Setting(container)
      .setName('Lorebook JSON')
      .setDesc('Paste the full SillyTavern lorebook JSON payload.')
      .addTextArea(text => {
        text.inputEl.rows = 12;
        text
          .setPlaceholder('{"entries": {...}}')
          .setValue(this.lorebookJson)
          .onChange(value => {
            this.lorebookJson = value;
            this.invalidatePreparedPages();
          });
      });
  }

  private buildCharacterCardInputs(container: HTMLElement): void {
    let pathInput: { setValue: (value: string) => void } | null = null;
    new Setting(container)
      .setName('Character Card File')
      .setDesc('Vault path to a `.png` or `.json` SillyTavern character card.')
      .addText(text => {
        pathInput = text;
        text
          .setPlaceholder('cards/character.png')
          .setValue(this.characterCardPath)
          .onChange(value => {
            this.characterCardPath = value.trim();
            this.invalidatePreparedPages();
          });
      })
      .addButton(button => button
        .setButtonText('Browse')
        .onClick(() => {
          void (async () => {
            const selectedPath = await this.pickCharacterCardFile();
            if (!selectedPath) {
              return;
            }
            this.characterCardPath = selectedPath;
            this.invalidatePreparedPages();
            pathInput?.setValue(selectedPath);
          })();
        }));

    new Setting(container)
      .setName('Import Embedded Lorebook')
      .setDesc('When the card contains an embedded lorebook, import it into wiki notes too.')
      .addToggle(toggle => toggle
        .setValue(this.includeEmbeddedLorebook)
        .onChange(value => {
          this.includeEmbeddedLorebook = value;
          this.invalidatePreparedPages();
        }));
  }

  private async buildLorebookImportPages(): Promise<ImportedWikiPage[]> {
    if (!this.lorebookJson.trim()) {
      throw new Error('Paste lorebook JSON before running import.');
    }
    const parsed = parseSillyTavernLorebookJson(this.lorebookJson);
    const entries = this.skipDisabled
      ? parsed.entries.filter(entry => !entry.disable)
      : parsed.entries;
    this.previewWarnings = parsed.warnings;
    if (entries.length === 0) {
      throw new Error('No importable entries found.');
    }
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
    this.previewPaths = pages.map(page => page.path);
    return pages;
  }

  private async buildCharacterCardImportPlan(): Promise<CharacterCardImportPlan> {
    const cardPath = normalizeVaultPath(this.characterCardPath.trim());
    if (!cardPath) {
      throw new Error('Choose a character-card file before preview/import.');
    }
    const abstract = this.app.vault.getAbstractFileByPath(cardPath);
    if (!(abstract instanceof TFile)) {
      throw new Error(`Character-card file not found: ${cardPath}`);
    }
    const extension = abstract.extension.toLowerCase();
    if (extension !== 'png' && extension !== 'json') {
      throw new Error(`Unsupported character-card file type: .${extension}. Use .png or .json.`);
    }

    const completionResolution = await this.resolveCompletionConfig();
    this.setProgress('Loading character card...', `Profile: ${completionResolution.profileLabel}`);

    const card = extension === 'json'
      ? parseSillyTavernCharacterCardJson(await this.app.vault.read(abstract))
      : parseSillyTavernCharacterCardPngBytes(await readVaultBinary(this.app, abstract.path));

    this.setProgress(
      'Rewriting card into freeform story format...',
      card.name || abstract.basename
    );
    const response = await requestStoryContinuation(completionResolution.completion, {
      systemPrompt: buildCharacterCardRewriteSystemPrompt(),
      userPrompt: buildCharacterCardRewriteUserPrompt(card),
      operationName: 'character_card_rewrite',
      onOperationLog: record => this.plugin.appendCompletionOperationLog(record, {
        costProfile: completionResolution.costProfile
      }),
      onUsage: usage => {
        void this.plugin.recordCompletionUsage('character_card_rewrite', usage, {
          cardPath: abstract.path,
          completionProfileSource: completionResolution.profileSource,
          completionProfileId: completionResolution.profileId,
          completionProfileName: completionResolution.profileName,
          autoCostProfile: completionResolution.autoCostProfile
        });
      }
    });

    const rewrite = parseCharacterCardRewriteResponse(response);
    const authorNoteFolder = this.plugin.getStorySteeringFolderPath();
    this.setProgress('Building import write plan...', card.name || abstract.basename);
    const plan = buildCharacterCardImportPlan(card, rewrite, {
      targetFolder: this.targetFolder,
      authorNoteFolder,
      defaultTagsRaw: this.defaultTags,
      lorebookNames: this.getNormalizedLorebooks(),
      tagPrefix: this.plugin.settings.tagScoping.tagPrefix,
      maxSummaryChars: this.plugin.settings.summaries.maxSummaryChars,
      includeEmbeddedLorebook: this.includeEmbeddedLorebook,
      sourceCardPath: abstract.path,
      completionPresetId: this.selectedCompletionPresetId.trim()
    });

    const embeddedCount = Math.max(0, plan.pages.length - 2);
    const rewriteNoteSuffix = rewrite.rewriteNotes.length > 0
      ? ` | rewrite notes: ${rewrite.rewriteNotes.length}`
      : '';
    this.previewSummary = `Preview: story note + author note${embeddedCount > 0 ? ` + ${embeddedCount} embedded lorebook note(s)` : ''}${rewriteNoteSuffix}.`;
    this.previewPaths = plan.pages.map(page => page.path);
    this.previewWarnings = [
      ...card.warnings,
      ...plan.warnings
    ];
    return plan;
  }

  private async computePreviewPages(): Promise<ImportedWikiPage[]> {
    if (this.importMode === 'lorebook_json') {
      return this.buildLorebookImportPages();
    }
    const plan = await this.buildCharacterCardImportPlan();
    return plan.pages;
  }

  private async runPreview(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    this.runningMode = 'preview';
    this.clearOutput();
    this.setProgress(
      this.importMode === 'character_card' ? 'Preparing character-card preview...' : 'Parsing lorebook JSON...',
      `Profile: ${this.resolveCompletionProfileLabel()}`
    );

    try {
      const pages = await this.computePreviewPages();
      this.preparedPages = pages;
      this.preparedKey = this.getPreparedKey();
      this.syncPreviewPathsFromPreparedPages();
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

    this.running = true;
    this.runningMode = 'import';
    this.clearOutput();
    this.setProgress(
      this.importMode === 'character_card' ? 'Preparing character-card import...' : 'Parsing lorebook JSON...',
      `Profile: ${this.resolveCompletionProfileLabel()}`
    );

    try {
      let pages: ImportedWikiPage[] = [];
      const preparedKey = this.getPreparedKey();
      if (this.preparedPages.length > 0 && this.preparedKey === preparedKey) {
        pages = this.normalizePagesForApply(this.preparedPages);
        this.preparedPages = pages;
        this.syncPreviewPathsFromPreparedPages();
        this.setProgress('Using preview plan...', `${pages.length} note(s)`);
      } else {
        pages = this.normalizePagesForApply(await this.computePreviewPages());
        this.preparedPages = pages;
        this.preparedKey = preparedKey;
        this.syncPreviewPathsFromPreparedPages();
      }

      if (pages.length === 0) {
        this.importSummary = 'No importable entries found.';
        new Notice('No importable entries found.');
        return;
      }

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
      this.setProgress('Import complete', `${applied.created} created, ${applied.updated} updated`);
      new Notice(this.importSummary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('LoreVault import failed:', error);
      this.lastError = `Import failed: ${message}`;
      this.setProgress('Import failed', message);
      new Notice(`LoreVault import failed: ${message}`);
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

    if (this.importMode === 'character_card' && this.preparedPages.length > 0) {
      this.renderEditablePlannedWrites(container);
    } else if (this.previewPaths.length > 0) {
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
      container.createEl('p', {
        text: this.importMode === 'character_card'
          ? 'Choose a character-card file, then run Preview or Import.'
          : 'Paste lorebook JSON, then run Preview or Import.'
      });
    }
  }

  private renderEditablePlannedWrites(container: HTMLElement): void {
    const details = container.createEl('details', { cls: 'lorevault-import-planned-writes' });
    details.open = true;
    details.createEl('summary', { text: `Planned Writes (Editable) (${this.preparedPages.length})` });
    details.createEl('p', {
      cls: 'lorevault-import-planned-writes-note',
      text: 'Adjust paths/content before Import. Edited values are written as-is.'
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
      contentInput.rows = Math.max(8, Math.min(18, lineCount + 1));
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
    contentEl.createEl('h2', {
      text: this.importMode === 'character_card'
        ? 'Import SillyTavern Character Card'
        : 'Import SillyTavern Lorebook'
    });

    this.buildSharedInputs(contentEl);
    if (this.importMode === 'character_card') {
      this.buildCharacterCardInputs(contentEl);
    } else {
      this.buildLorebookJsonInputs(contentEl);
    }

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

    const clearButton = actions.createEl('button', {
      text: this.importMode === 'character_card' ? 'Clear Card' : 'Clear JSON'
    });
    clearButton.disabled = this.running;
    clearButton.addEventListener('click', () => {
      if (this.importMode === 'character_card') {
        this.characterCardPath = '';
      } else {
        this.lorebookJson = '';
      }
      this.invalidatePreparedPages();
      this.render();
    });

    this.renderOutput(output);
  }
}
