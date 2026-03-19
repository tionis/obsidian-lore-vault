import {
  App,
  FuzzySuggestModal,
  Modal,
  Notice,
  PluginSettingTab,
  Setting,
  TextComponent,
  TFolder
} from 'obsidian';
import LoreBookConverterPlugin from './main';
import { openVaultFolderPicker } from './folder-suggest-modal';
import {
  CostProfileBudgetSettings,
  CompletionPreset,
  ConverterSettings,
  DEFAULT_SETTINGS,
  ReasoningEffort
} from './models';
import { cloneReasoningConfig } from './completion-settings';
import { normalizeIgnoredCalloutTypes } from './callout-utils';

function formatStorageBytes(value: number | null): string {
  if (!Number.isFinite(value) || value === null || value < 0) {
    return 'unknown';
  }
  if (value < 1024) {
    return `${Math.round(value)} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatStatusTimestamp(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return 'not synced yet';
  }
  return new Date(value).toLocaleString();
}

class FolderSuggestModal extends FuzzySuggestModal<string> {
  private readonly folders: string[];
  private readonly onChoosePath: (path: string) => void;

  constructor(app: App, onChoosePath: (path: string) => void) {
    super(app);
    this.onChoosePath = onChoosePath;
    this.folders = app.vault
      .getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder)
      .map(folder => folder.path)
      .sort((a, b) => a.localeCompare(b));
    this.setPlaceholder('Select existing folder');
  }

  getItems(): string[] {
    return this.folders;
  }

  getItemText(item: string): string {
    return item || '(vault root)';
  }

  onChooseItem(item: string): void {
    this.onChoosePath(item);
  }
}

class SecretNameSuggestModal extends FuzzySuggestModal<string> {
  private readonly secretNames: string[];
  private resolveResult: ((value: string | null) => void) | null = null;
  private finished = false;
  private selectedSecret: string | null = null;

  constructor(app: App, secretNames: string[]) {
    super(app);
    this.secretNames = secretNames;
    this.setPlaceholder('Select existing secret id');
  }

  waitForResult(): Promise<string | null> {
    return new Promise(resolve => {
      this.resolveResult = resolve;
    });
  }

  getItems(): string[] {
    return this.secretNames;
  }

  getItemText(item: string): string {
    return item;
  }

  onChooseItem(item: string): void {
    this.selectedSecret = item;
    this.finish(item);
  }

  onClose(): void {
    super.onClose();
    window.setTimeout(() => {
      this.finish(this.selectedSecret);
    }, 0);
  }

  private finish(value: string | null): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    if (this.resolveResult) {
      this.resolveResult(value);
      this.resolveResult = null;
    }
  }
}

class TextValueModal extends Modal {
  private readonly titleText: string;
  private readonly fieldLabel: string;
  private readonly placeholder: string;
  private readonly initialValue: string;
  private readonly submitLabel: string;
  private resolveResult: ((value: string | null) => void) | null = null;
  private finished = false;
  private input: TextComponent | null = null;

  constructor(
    app: App,
    titleText: string,
    fieldLabel: string,
    placeholder: string,
    initialValue: string,
    submitLabel: string
  ) {
    super(app);
    this.titleText = titleText;
    this.fieldLabel = fieldLabel;
    this.placeholder = placeholder;
    this.initialValue = initialValue;
    this.submitLabel = submitLabel;
  }

  waitForResult(): Promise<string | null> {
    return new Promise(resolve => {
      this.resolveResult = resolve;
    });
  }

  onOpen(): void {
    this.setTitle(this.titleText);
    this.contentEl.empty();

    new Setting(this.contentEl)
      .setName(this.fieldLabel)
      .addText(text => {
        this.input = text;
        text
          .setPlaceholder(this.placeholder)
          .setValue(this.initialValue);
        text.inputEl.addEventListener('keydown', event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            this.submit();
          }
        });
      });

    const actions = this.contentEl.createDiv({ cls: 'lorevault-modal-actions' });
    const cancelButton = actions.createEl('button', { text: 'Cancel' });
    cancelButton.addEventListener('click', () => this.close());

    const submitButton = actions.createEl('button', { text: this.submitLabel });
    submitButton.addClass('mod-cta');
    submitButton.addEventListener('click', () => this.submit());

    window.setTimeout(() => {
      this.input?.inputEl.focus();
      this.input?.inputEl.select();
    }, 0);
  }

  onClose(): void {
    this.finish(null);
  }

  private submit(): void {
    const value = this.input?.getValue().trim() ?? '';
    if (!value) {
      new Notice('Name cannot be empty.');
      return;
    }
    this.finish(value);
    this.close();
  }

  private finish(value: string | null): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.resolveResult?.(value);
  }
}

class ConfirmActionModal extends Modal {
  private readonly titleText: string;
  private readonly message: string;
  private readonly confirmLabel: string;
  private resolveResult: ((confirmed: boolean) => void) | null = null;
  private finished = false;

  constructor(app: App, titleText: string, message: string, confirmLabel: string) {
    super(app);
    this.titleText = titleText;
    this.message = message;
    this.confirmLabel = confirmLabel;
  }

  waitForResult(): Promise<boolean> {
    return new Promise(resolve => {
      this.resolveResult = resolve;
    });
  }

  onOpen(): void {
    this.setTitle(this.titleText);
    this.contentEl.empty();
    this.contentEl.createEl('p', { text: this.message });

    const actions = this.contentEl.createDiv({ cls: 'lorevault-modal-actions' });
    const cancelButton = actions.createEl('button', { text: 'Cancel' });
    cancelButton.addEventListener('click', () => this.close());

    const confirmButton = actions.createEl('button', { text: this.confirmLabel });
    confirmButton.addClass('mod-warning');
    confirmButton.addEventListener('click', () => {
      this.finish(true);
      this.close();
    });
  }

  onClose(): void {
    this.finish(false);
  }

  private finish(confirmed: boolean): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.resolveResult?.(confirmed);
  }
}

export class LoreBookConverterSettingTab extends PluginSettingTab {
  plugin: LoreBookConverterPlugin;
  private selectedCompletionPresetEditorId = '';
  private selectedCostBudgetProfileId = '';

  constructor(app: App, plugin: LoreBookConverterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private normalizePathInput(value: string): string {
    return value
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/+$/, '');
  }

  private parseBudgetMapInput(raw: string): {[key: string]: number} {
    const normalized: {[key: string]: number} = {};
    const lines = raw
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .filter(line => !line.startsWith('#'));
    for (const line of lines) {
      const separatorIndex = line.includes('=')
        ? line.indexOf('=')
        : line.indexOf(':');
      if (separatorIndex <= 0 || separatorIndex === line.length - 1) {
        throw new Error(`Invalid budget line "${line}". Use key=value.`);
      }
      const key = line.slice(0, separatorIndex).trim();
      const value = Number(line.slice(separatorIndex + 1).trim());
      if (!key || !Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid budget value for "${key || line}".`);
      }
      normalized[key] = value;
    }
    return normalized;
  }

  private formatBudgetMapInput(value: {[key: string]: number} | undefined): string {
    if (!value || typeof value !== 'object') {
      return '';
    }
    return Object.entries(value)
      .filter(([key, amount]) => key.trim().length > 0 && Number.isFinite(amount) && amount > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, amount]) => `${key} = ${amount}`)
      .join('\n');
  }

  private normalizeCostBudgetProfileId(value: string): string {
    return value.trim();
  }

  private getCostProfileBudgetMap(): {[costProfile: string]: CostProfileBudgetSettings} {
    const raw = this.plugin.settings.costTracking.budgetByCostProfileUsd;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      this.plugin.settings.costTracking.budgetByCostProfileUsd = {};
    }
    return this.plugin.settings.costTracking.budgetByCostProfileUsd ?? {};
  }

  private resolveCostBudgetProfileOptions(): string[] {
    const options = new Set<string>();
    const configured = this.getCostProfileBudgetMap();
    for (const key of Object.keys(configured)) {
      const normalized = this.normalizeCostBudgetProfileId(key);
      if (normalized) {
        options.add(normalized);
      }
    }
    const deviceEffective = this.normalizeCostBudgetProfileId(this.plugin.getDeviceEffectiveCostProfileLabel());
    if (deviceEffective) {
      options.add(deviceEffective);
    }
    const deviceExplicit = this.normalizeCostBudgetProfileId(this.plugin.getDeviceActiveCostProfile());
    if (deviceExplicit) {
      options.add(deviceExplicit);
    }
    const selected = this.normalizeCostBudgetProfileId(this.selectedCostBudgetProfileId);
    if (selected) {
      options.add(selected);
    }
    if (options.size === 0) {
      options.add('__default__');
    }
    return [...options].sort((left, right) => left.localeCompare(right));
  }

  private resolveSelectedCostBudgetProfileId(profileOptions: string[]): string {
    const selected = this.normalizeCostBudgetProfileId(this.selectedCostBudgetProfileId);
    if (selected && profileOptions.includes(selected)) {
      return selected;
    }
    const deviceEffective = this.normalizeCostBudgetProfileId(this.plugin.getDeviceEffectiveCostProfileLabel());
    if (deviceEffective && profileOptions.includes(deviceEffective)) {
      return deviceEffective;
    }
    return profileOptions[0] ?? '__default__';
  }

  private cloneCostProfileBudgetSettings(
    value: Partial<CostProfileBudgetSettings> | null | undefined
  ): CostProfileBudgetSettings {
    const source = value ?? {};
    const dailyBudgetCandidate = Number(source.dailyBudgetUsd);
    const sessionBudgetCandidate = Number(source.sessionBudgetUsd);
    const normalizeMap = (raw: {[key: string]: number} | undefined): {[key: string]: number} => {
      const normalized: {[key: string]: number} = {};
      if (!raw || typeof raw !== 'object') {
        return normalized;
      }
      for (const [key, amount] of Object.entries(raw)) {
        const normalizedKey = key.trim();
        const normalizedAmount = Number(amount);
        if (!normalizedKey || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
          continue;
        }
        normalized[normalizedKey] = normalizedAmount;
      }
      return normalized;
    };
    return {
      dailyBudgetUsd: Number.isFinite(dailyBudgetCandidate) && dailyBudgetCandidate >= 0
        ? dailyBudgetCandidate
        : 0,
      sessionBudgetUsd: Number.isFinite(sessionBudgetCandidate) && sessionBudgetCandidate >= 0
        ? sessionBudgetCandidate
        : 0,
      budgetByOperationUsd: normalizeMap(source.budgetByOperationUsd),
      budgetByModelUsd: normalizeMap(source.budgetByModelUsd),
      budgetByScopeUsd: normalizeMap(source.budgetByScopeUsd)
    };
  }

  private getCostProfileBudgetSettings(profileId: string): CostProfileBudgetSettings {
    const normalizedProfileId = this.normalizeCostBudgetProfileId(profileId);
    const configured = this.getCostProfileBudgetMap();
    return this.cloneCostProfileBudgetSettings(configured[normalizedProfileId]);
  }

  private isCostProfileBudgetSettingsEmpty(value: CostProfileBudgetSettings): boolean {
    return (
      value.dailyBudgetUsd <= 0 &&
      value.sessionBudgetUsd <= 0 &&
      Object.keys(value.budgetByOperationUsd).length === 0 &&
      Object.keys(value.budgetByModelUsd).length === 0 &&
      Object.keys(value.budgetByScopeUsd).length === 0
    );
  }

  private setCostProfileBudgetSettings(profileId: string, value: CostProfileBudgetSettings): void {
    const normalizedProfileId = this.normalizeCostBudgetProfileId(profileId);
    if (!normalizedProfileId) {
      return;
    }
    const configured = this.getCostProfileBudgetMap();
    if (this.isCostProfileBudgetSettingsEmpty(value)) {
      delete configured[normalizedProfileId];
      return;
    }
    configured[normalizedProfileId] = this.cloneCostProfileBudgetSettings(value);
  }

  private parseModelPricingOverridesInput(raw: string): ConverterSettings['costTracking']['modelPricingOverrides'] {
    const entries: ConverterSettings['costTracking']['modelPricingOverrides'] = [];
    const lines = raw
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .filter(line => !line.startsWith('#'));
    for (const line of lines) {
      const parts = line.split('|').map(part => part.trim());
      if (parts.length !== 4) {
        throw new Error(`Invalid pricing override line "${line}". Use provider | model-pattern | input | output.`);
      }
      const [providerRaw, modelPatternRaw, inputRaw, outputRaw] = parts;
      const provider = providerRaw.toLowerCase() || '*';
      const modelPattern = modelPatternRaw;
      const inputCostPerMillionUsd = Number(inputRaw);
      const outputCostPerMillionUsd = Number(outputRaw);
      if (!modelPattern) {
        throw new Error(`Missing model pattern in "${line}".`);
      }
      if (!Number.isFinite(inputCostPerMillionUsd) || inputCostPerMillionUsd < 0) {
        throw new Error(`Invalid input cost in "${line}".`);
      }
      if (!Number.isFinite(outputCostPerMillionUsd) || outputCostPerMillionUsd < 0) {
        throw new Error(`Invalid output cost in "${line}".`);
      }
      entries.push({
        provider,
        modelPattern,
        inputCostPerMillionUsd,
        outputCostPerMillionUsd,
        updatedAt: Date.now(),
        source: 'manual'
      });
    }
    return entries.sort((left, right) => (
      left.provider.localeCompare(right.provider) ||
      left.modelPattern.localeCompare(right.modelPattern)
    ));
  }

  private formatModelPricingOverridesInput(
    value: ConverterSettings['costTracking']['modelPricingOverrides'] | undefined
  ): string {
    if (!Array.isArray(value) || value.length === 0) {
      return '';
    }
    return [...value]
      .sort((left, right) => (
        left.provider.localeCompare(right.provider) ||
        left.modelPattern.localeCompare(right.modelPattern)
      ))
      .map(item => `${item.provider} | ${item.modelPattern} | ${item.inputCostPerMillionUsd} | ${item.outputCostPerMillionUsd}`)
      .join('\n');
  }

  private async persistSettings(): Promise<void> {
    await this.plugin.saveSettings(this.plugin.settings);
  }

  private openFolderPicker(onPick: (path: string) => void): void {
    new FolderSuggestModal(this.app, onPick).open();
  }

  private async requestPresetName(
    titleText: string,
    initialValue: string,
    submitLabel: string
  ): Promise<string | null> {
    const modal = new TextValueModal(
      this.app,
      titleText,
      'Preset Name',
      'My preset',
      initialValue,
      submitLabel
    );
    const result = modal.waitForResult();
    modal.open();
    return result;
  }

  private async requestCostBudgetProfileName(
    initialValue: string
  ): Promise<string | null> {
    const modal = new TextValueModal(
      this.app,
      'Set Budget Cost Profile',
      'Cost Profile',
      'profile-name',
      initialValue,
      'Apply'
    );
    const result = modal.waitForResult();
    modal.open();
    return result;
  }

  private async pickExistingSecretId(initialValue: string): Promise<string | null> {
    const known = new Set<string>();
    const seed = initialValue.trim();
    if (seed) {
      known.add(seed);
    }
    const listed = await this.plugin.listSecretIds();
    for (const id of listed) {
      const trimmed = id.trim();
      if (trimmed) {
        known.add(trimmed);
      }
    }
    const secretIds = [...known].sort((left, right) => left.localeCompare(right));
    if (secretIds.length === 0) {
      new Notice('No secrets found in Obsidian Secret Storage yet.');
      return null;
    }
    const modal = new SecretNameSuggestModal(this.app, secretIds);
    const result = modal.waitForResult();
    modal.open();
    return result;
  }

  private async requestConfirmation(
    titleText: string,
    message: string,
    confirmLabel: string
  ): Promise<boolean> {
    const modal = new ConfirmActionModal(this.app, titleText, message, confirmLabel);
    const result = modal.waitForResult();
    modal.open();
    return result;
  }

  private createPresetId(name: string): string {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `preset-${slug || 'model'}-${Date.now().toString(36)}`;
  }

  private snapshotCurrentCompletion(name: string, id?: string): CompletionPreset {
    const completion = this.plugin.settings.completion;
    return {
      id: id ?? this.createPresetId(name),
      name,
      provider: completion.provider,
      endpoint: completion.endpoint,
      apiKey: completion.apiKey,
      apiKeySecretName: completion.apiKeySecretName,
      model: completion.model,
      systemPrompt: completion.systemPrompt,
      temperature: completion.temperature,
      maxOutputTokens: completion.maxOutputTokens,
      contextWindowTokens: completion.contextWindowTokens,
      promptReserveTokens: completion.promptReserveTokens,
      timeoutMs: completion.timeoutMs,
      promptCachingEnabled: completion.promptCachingEnabled,
      providerRouting: completion.providerRouting,
      reasoning: cloneReasoningConfig(completion.reasoning)
    };
  }

  private applyCompletionPreset(preset: CompletionPreset): void {
    const completion = this.plugin.settings.completion;
    completion.provider = preset.provider;
    completion.endpoint = preset.endpoint;
    completion.apiKey = preset.apiKey;
    completion.apiKeySecretName = preset.apiKeySecretName;
    completion.model = preset.model;
    completion.systemPrompt = preset.systemPrompt;
    completion.temperature = preset.temperature;
    completion.maxOutputTokens = preset.maxOutputTokens;
    completion.contextWindowTokens = preset.contextWindowTokens;
    completion.promptReserveTokens = preset.promptReserveTokens;
    completion.timeoutMs = preset.timeoutMs;
    completion.promptCachingEnabled = preset.promptCachingEnabled ?? true;
    completion.providerRouting = preset.providerRouting ?? '';
    completion.reasoning = cloneReasoningConfig(preset.reasoning);
  }

  private syncSelectedCompletionPresetFromCurrent(): void {
    const selectedPresetId = this.selectedCompletionPresetEditorId.trim();
    if (!selectedPresetId) {
      return;
    }
    const index = this.plugin.settings.completion.presets.findIndex(item => item.id === selectedPresetId);
    if (index < 0) {
      return;
    }
    const existing = this.plugin.settings.completion.presets[index];
    const updated = this.snapshotCurrentCompletion(existing.name, existing.id);
    // Preset secret ids are edited explicitly in the preset secret field.
    updated.apiKeySecretName = existing.apiKeySecretName;
    this.plugin.settings.completion.presets[index] = updated;
  }

  private async persistCompletionSettings(): Promise<void> {
    this.syncSelectedCompletionPresetFromCurrent();
    await this.persistSettings();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('lorebook-converter-settings');

    containerEl.createEl('h2', { text: 'LoreVault Settings' });
    containerEl.createEl('p', {
      text: 'Need a quick guide? Open the embedded help view for commands, retrieval behavior, and export contracts.'
    });

    new Setting(containerEl)
      .setName('Help and Documentation')
      .setDesc('Open the in-plugin LoreVault Help panel. Repository docs: README.md, docs/documentation.md, docs/technical-reference.md.')
      .addButton(button => button
        .setButtonText('Open LoreVault Help')
        .onClick(() => {
          void this.plugin.openHelpView();
        }));

    containerEl.createEl('h3', { text: 'Device Local Settings' });
    containerEl.createEl('p', {
      text: 'These settings are stored per device and do not sync through shared vault settings.'
    });

    const activeDevicePresetId = this.plugin.getDeviceActiveCompletionPresetId();
    const completionPresetsSorted = [...this.plugin.settings.completion.presets]
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    if (completionPresetsSorted.length === 0) {
      this.selectedCompletionPresetEditorId = '';
    } else if (!completionPresetsSorted.some(item => item.id === this.selectedCompletionPresetEditorId)) {
      this.selectedCompletionPresetEditorId = completionPresetsSorted.some(item => item.id === activeDevicePresetId)
        ? activeDevicePresetId
        : completionPresetsSorted[0].id;
    }
    new Setting(containerEl)
      .setName('Active Completion Preset (This Device)')
      .setDesc('Per-device selection. Selecting a preset immediately applies provider/model/token settings in this vault on this device.')
      .addDropdown(dropdown => {
        dropdown.addOption('', '(none)');
        for (const preset of completionPresetsSorted) {
          dropdown.addOption(preset.id, preset.name);
        }
        dropdown.setValue(activeDevicePresetId || '');
        dropdown.onChange(async (value) => {
          const activeId = value.trim();
          if (!activeId) {
            await this.plugin.setDeviceActiveCompletionPresetId('');
            return;
          }

          const preset = this.plugin.settings.completion.presets.find(item => item.id === activeId);
          if (!preset) {
            new Notice('Preset not found.');
            return;
          }

          this.applyCompletionPreset(preset);
          await this.plugin.setDeviceActiveCompletionPresetId(preset.id);
          await this.persistSettings();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName('Device Cost Profile Label')
      .setDesc('Optional per-device label attached to usage metadata (for shared vaults across users/devices).')
      .addText(text => text
        .setPlaceholder('writer-a')
        .setValue(this.plugin.getDeviceActiveCostProfile())
        .onChange(async (value) => {
          await this.plugin.setDeviceActiveCostProfile(value);
        }));

    containerEl.createEl('h3', { text: 'Shared Vault Settings' });
    containerEl.createEl('p', {
      text: 'These settings are stored in plugin data and sync with the shared vault.'
    });

    new Setting(containerEl)
      .setName('Downstream Export Path Pattern')
      .setDesc('Relative path under each lorebook output folder (SQLite Output Directory). Example: sillytavern/{lorebook}.json -> sillytavern/<lorebook>.json and .rag.md.')
      .addText(text => text
        .setPlaceholder('sillytavern/{lorebook}.json')
        .setValue(this.plugin.settings.outputPath)
        .onChange(async (value) => {
          this.plugin.settings.outputPath = this.normalizePathInput(value);
          await this.persistSettings();
        }));

    new Setting(containerEl)
      .setName('Default Lorebook Import Location')
      .setDesc('Default target folder used by Lorebook Import, Story Extraction, and Lorebook Fork workflows.')
      .addText(text => text
        .setPlaceholder('LoreVault/import')
        .setValue(this.plugin.settings.defaultLorebookImportLocation)
        .onChange(async (value) => {
          this.plugin.settings.defaultLorebookImportLocation = this.normalizePathInput(value);
          await this.persistSettings();
        }))
      .addButton(button => button
        .setButtonText('Browse')
        .onClick(() => {
          openVaultFolderPicker(this.app, async path => {
            const normalized = this.normalizePathInput(path) || DEFAULT_SETTINGS.defaultLorebookImportLocation;
            this.plugin.settings.defaultLorebookImportLocation = normalized;
            await this.persistSettings();
            this.display();
          });
        }));

    containerEl.createEl('h3', { text: 'Character Card Library' });

    new Setting(containerEl)
      .setName('Character Card Source Folder')
      .setDesc('Folder scanned by `Sync Character Card Library` for `.png`/`.json` source cards.')
      .addText(text => text
        .setPlaceholder('LoreVault/character-cards/source')
        .setValue(this.plugin.settings.characterCards.sourceFolder)
        .onChange(async (value) => {
          this.plugin.settings.characterCards.sourceFolder = this.normalizePathInput(value);
          await this.persistSettings();
        }))
      .addButton(button => button
        .setButtonText('Browse')
        .onClick(() => {
          openVaultFolderPicker(this.app, async path => {
            const normalized = this.normalizePathInput(path) || DEFAULT_SETTINGS.characterCards.sourceFolder;
            this.plugin.settings.characterCards.sourceFolder = normalized;
            await this.persistSettings();
            this.display();
          });
        }));

    new Setting(containerEl)
      .setName('Character Card Meta Folder')
      .setDesc('Folder where synced character-card meta notes (`lvDocType: characterCard`) are stored.')
      .addText(text => text
        .setPlaceholder('LoreVault/character-cards/library')
        .setValue(this.plugin.settings.characterCards.metaFolder)
        .onChange(async (value) => {
          this.plugin.settings.characterCards.metaFolder = this.normalizePathInput(value);
          await this.persistSettings();
        }))
      .addButton(button => button
        .setButtonText('Browse')
        .onClick(() => {
          openVaultFolderPicker(this.app, async path => {
            const normalized = this.normalizePathInput(path) || DEFAULT_SETTINGS.characterCards.metaFolder;
            this.plugin.settings.characterCards.metaFolder = normalized;
            await this.persistSettings();
            this.display();
          });
        }));

    new Setting(containerEl)
      .setName('Auto-Generate Card Summaries on Sync')
      .setDesc('Generate short catalog summaries/themes/tone for character-card meta notes during library sync.')
      .addToggle(toggle => toggle
        .setValue(Boolean(this.plugin.settings.characterCards.autoSummaryEnabled))
        .onChange(async (value) => {
          this.plugin.settings.characterCards.autoSummaryEnabled = value;
          await this.persistSettings();
        }));

    new Setting(containerEl)
      .setName('Card Summary Completion Profile')
      .setDesc('Optional profile used for card-summary generation. Empty uses active device/default completion profile.')
      .addDropdown(dropdown => {
        dropdown.addOption('', '(Use active device/default)');
        for (const preset of completionPresetsSorted) {
          dropdown.addOption(preset.id, preset.name);
        }
        const configured = (this.plugin.settings.characterCards.summaryCompletionPresetId ?? '').trim();
        if (configured && !completionPresetsSorted.some(item => item.id === configured)) {
          dropdown.addOption(configured, `${configured} (missing)`);
        }
        dropdown.setValue(configured);
        dropdown.onChange(async (value) => {
          this.plugin.settings.characterCards.summaryCompletionPresetId = value.trim();
          await this.persistSettings();
        });
      });

    new Setting(containerEl)
      .setName('Regenerate Auto Summaries on Card Changes')
      .setDesc('If enabled, summaries generated by LoreVault are regenerated when card content hash changes. Manual summaries are never overwritten.')
      .addToggle(toggle => toggle
        .setValue(Boolean(this.plugin.settings.characterCards.summaryRegenerateOnHashChange))
        .onChange(async (value) => {
          this.plugin.settings.characterCards.summaryRegenerateOnHashChange = value;
          await this.persistSettings();
        }));

    new Setting(containerEl)
      .setName('Sync Character Card Library')
      .setDesc('Creates/updates one meta note per source card and marks missing-source records without deleting them.')
      .addButton(button => button
        .setButtonText('Run Sync')
        .onClick(() => {
          void this.plugin.syncCharacterCardLibrary();
        }));

    // Lorebook selection section
    containerEl.createEl('h3', { text: 'Lorebook Selection' });

    new Setting(containerEl)
      .setName('Lorebook Tag Prefix')
      .setDesc('Tag namespace used to detect lorebooks (without #), e.g. lorebook')
      .addText(text => text
        .setPlaceholder('lorebook')
        .setValue(this.plugin.settings.tagScoping.tagPrefix)
        .onChange(async (value) => {
          this.plugin.settings.tagScoping.tagPrefix = value.trim();
          await this.plugin.saveSettings(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Active Lorebook')
      .setDesc('Optional lorebook path under the tag prefix, e.g. universe/yggdrasil (empty = all lorebook tags)')
      .addText(text => text
        .setPlaceholder('universe/yggdrasil')
        .setValue(this.plugin.settings.tagScoping.activeScope)
        .onChange(async (value) => {
          this.plugin.settings.tagScoping.activeScope = value.trim();
          await this.plugin.saveSettings(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Membership Mode')
      .setDesc('Exact: include only exact lorebook tags. Cascade: include exact lorebook, parent lorebooks, and child lorebooks.')
      .addDropdown(dropdown => dropdown
        .addOptions({
          'exact': 'Exact',
          'cascade': 'Cascade'
        })
        .setValue(this.plugin.settings.tagScoping.membershipMode)
        .onChange(async (value) => {
          this.plugin.settings.tagScoping.membershipMode = value === 'cascade' ? 'cascade' : 'exact';
          await this.persistSettings();
        }));

    new Setting(containerEl)
      .setName('Include Untagged Notes')
      .setDesc('If enabled, notes without lorebook tags are included in the active build.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.tagScoping.includeUntagged)
        .onChange(async (value) => {
          this.plugin.settings.tagScoping.includeUntagged = value;
          await this.persistSettings();
        }));

    // Default LoreBook Settings section
    containerEl.createEl('h3', { text: 'Default LoreBook Settings' });
    
    new Setting(containerEl)
      .setName('Order By Title')
      .setDesc('Entries will be ordered by their titles instead of priority score')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.defaultLoreBook.orderByTitle)
        .onChange(async (value) => {
          this.plugin.settings.defaultLoreBook.orderByTitle = value;
          await this.plugin.saveSettings(this.plugin.settings);
        }));
    
    new Setting(containerEl)
      .setName('Use Droste Effect')
      .setDesc('Allow lorebook entries to trigger other lorebook entries')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.defaultLoreBook.useDroste)
        .onChange(async (value) => {
          this.plugin.settings.defaultLoreBook.useDroste = value;
          await this.plugin.saveSettings(this.plugin.settings);
        }));
    
    new Setting(containerEl)
      .setName('Use Recursion')
      .setDesc('Allow entries to call themselves recursively')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.defaultLoreBook.useRecursion)
        .onChange(async (value) => {
          this.plugin.settings.defaultLoreBook.useRecursion = value;
          await this.plugin.saveSettings(this.plugin.settings);
        }));
    
    new Setting(containerEl)
      .setName('Token Budget')
      .setDesc('Maximum tokens to spend on the lorebook')
      .addText(text => text
        .setValue(this.plugin.settings.defaultLoreBook.tokenBudget.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue > 0) {
            this.plugin.settings.defaultLoreBook.tokenBudget = numValue;
            await this.plugin.saveSettings(this.plugin.settings);
          }
        }));
    
    new Setting(containerEl)
      .setName('Recursion Budget')
      .setDesc('Maximum recursion depth for entries')
      .addText(text => text
        .setValue(this.plugin.settings.defaultLoreBook.recursionBudget.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue > 0) {
            this.plugin.settings.defaultLoreBook.recursionBudget = numValue;
            await this.plugin.saveSettings(this.plugin.settings);
          }
        }));

    // Default Entry Settings section
    containerEl.createEl('h3', { text: 'Default Entry Settings' });
    
    // Trigger method setting with radio buttons
    const triggerSetting = new Setting(containerEl)
      .setName('Default Trigger Method')
      .setDesc('How entries are triggered by default');
    
    // Create container for the radio buttons
    const triggerOptions = document.createDocumentFragment();
    
    // Helper for creating radio buttons
    const createRadio = (container: DocumentFragment, 
                         label: string, 
                         value: string, 
                         checked: boolean) => {
      const radioItem = container.createEl('div', { cls: 'radio-item' });
      const radio = radioItem.createEl('input', {
        type: 'radio',
        attr: {
          id: `trigger-${value}`,
          name: 'trigger-method',
          value: value
        }
      });
      radio.checked = checked;
      radioItem.createEl('label', {
        text: label,
        attr: { for: `trigger-${value}` }
      });
      
      return radio;
    };
    
    // Create the radio buttons
    const constantRadio = createRadio(
      triggerOptions, 
      'Constant (always included)', 
      'constant',
      this.plugin.settings.defaultEntry.constant
    );
    
    const vectorizedRadio = createRadio(
      triggerOptions, 
      'Vectorized (AI determines relevance)', 
      'vectorized',
      this.plugin.settings.defaultEntry.vectorized
    );
    
    const selectiveRadio = createRadio(
      triggerOptions, 
      'Selective (triggered by keywords)', 
      'selective',
      this.plugin.settings.defaultEntry.selective
    );
    
    // Add change listeners
    constantRadio.addEventListener('change', async () => {
      if (constantRadio.checked) {
        this.plugin.settings.defaultEntry.constant = true;
        this.plugin.settings.defaultEntry.vectorized = false;
        this.plugin.settings.defaultEntry.selective = false;
        await this.plugin.saveSettings(this.plugin.settings);
      }
    });
    
    vectorizedRadio.addEventListener('change', async () => {
      if (vectorizedRadio.checked) {
        this.plugin.settings.defaultEntry.constant = false;
        this.plugin.settings.defaultEntry.vectorized = true;
        this.plugin.settings.defaultEntry.selective = false;
        await this.plugin.saveSettings(this.plugin.settings);
      }
    });
    
    selectiveRadio.addEventListener('change', async () => {
      if (selectiveRadio.checked) {
        this.plugin.settings.defaultEntry.constant = false;
        this.plugin.settings.defaultEntry.vectorized = false;
        this.plugin.settings.defaultEntry.selective = true;
        await this.plugin.saveSettings(this.plugin.settings);
      }
    });
    
    // Add radio buttons to the setting
    triggerSetting.settingEl.appendChild(triggerOptions);
    
    // Add selective logic dropdown (only relevant if selective is chosen)
    new Setting(containerEl)
      .setName('Selective Logic')
      .setDesc('How optional filter keys interact with primary keys (AND ANY, AND ALL, NOT ANY, NOT ALL)')
      .addDropdown(dropdown => dropdown
        .addOptions({
          '0': 'AND ANY',
          '1': 'AND ALL',
          '2': 'NOT ANY',
          '3': 'NOT ALL'
        })
        .setValue(this.plugin.settings.defaultEntry.selectiveLogic.toString())
        .onChange(async (value) => {
          this.plugin.settings.defaultEntry.selectiveLogic = parseInt(value);
          await this.plugin.saveSettings(this.plugin.settings);
        }));
    
    // Probability setting
    new Setting(containerEl)
      .setName('Default Probability')
      .setDesc('Chance of entry being included (0-100%)')
      .addSlider(slider => slider
        .setLimits(0, 100, 1)
        .setValue(this.plugin.settings.defaultEntry.probability)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.defaultEntry.probability = value;
          await this.plugin.saveSettings(this.plugin.settings);
        }));
    
    // Depth setting
    new Setting(containerEl)
      .setName('Default Depth')
      .setDesc('Scanning depth for including entries (1-10)')
      .addSlider(slider => slider
        .setLimits(1, 10, 1)
        .setValue(this.plugin.settings.defaultEntry.depth)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.defaultEntry.depth = value;
          await this.plugin.saveSettings(this.plugin.settings);
        }));
    
    // Group weight setting
    new Setting(containerEl)
      .setName('Default Group Weight')
      .setDesc('Weight of entries in their group (0-100)')
      .addSlider(slider => slider
        .setLimits(0, 100, 1)
        .setValue(this.plugin.settings.defaultEntry.groupWeight)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.defaultEntry.groupWeight = value;
          await this.plugin.saveSettings(this.plugin.settings);
        }));

    // Priority Weights section
    containerEl.createEl('h3', { text: 'Priority Weights' });
    containerEl.createEl('p', { 
      text: 'These weights determine how entries are ordered in the lorebook. Higher weights give more importance to that factor.'
    });

    // The updated createWeightSetting function
    const createWeightSetting = (key: keyof typeof this.plugin.settings.weights, name: string, desc: string) => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText(text => text
          .setValue(this.plugin.settings.weights[key].toString())
          .onChange(async (value) => {
            // Parse the input to a number
            const numValue = parseInt(value);
            
            // Validate the input is a valid number
            if (!isNaN(numValue)) {
              this.plugin.settings.weights[key] = numValue;
              await this.plugin.saveSettings(this.plugin.settings);
            }
          }));
    };

    createWeightSetting('hierarchy', 'Hierarchy', 
      'Distance from root document (lower depth = higher priority)');
    createWeightSetting('in_degree', 'In-Degree', 
      'Number of links pointing to this document');
    createWeightSetting('pagerank', 'PageRank', 
      'Overall importance based on network centrality');
    createWeightSetting('betweenness', 'Betweenness', 
      'How important this node is as a connector');
    createWeightSetting('out_degree', 'Out-Degree', 
      'Number of outgoing links');
    createWeightSetting('total_degree', 'Total Degree', 
      'Total number of links, in + out');
    createWeightSetting('file_depth', 'File Depth', 
      'Position in folder hierarchy');

    containerEl.createEl('h3', { text: 'SQLite Pack Export' });
    containerEl.createEl('p', {
      text: 'LoreVault SQLite pack is the canonical export format. ST world_info and RAG outputs are derived from this pipeline.'
    });

    new Setting(containerEl)
      .setName('Enable SQLite Pack Export')
      .setDesc('Write a SQLite pack per built lorebook.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.sqlite.enabled)
        .onChange(async (value) => {
          this.plugin.settings.sqlite.enabled = value;
          await this.persistSettings();
        }));

    let sqliteOutputInput: TextComponent | null = null;
    const sqliteOutputSetting = new Setting(containerEl)
      .setName('SQLite Output Directory')
      .setDesc('Vault-relative directory for canonical SQLite packs. Type a path or browse existing folders. LoreVault writes one <lorebook>.db per lorebook.')
      .addText(text => {
        sqliteOutputInput = text;
        text
          .setPlaceholder('lorebooks/')
          .setValue(this.plugin.settings.sqlite.outputPath)
          .onChange(async (value) => {
            this.plugin.settings.sqlite.outputPath = this.normalizePathInput(value);
            await this.persistSettings();
          });
      });
    sqliteOutputSetting.addButton(button => button
      .setButtonText('Browse')
      .setTooltip('Pick existing folder from vault')
      .onClick(() => {
        this.openFolderPicker((folderPath: string) => {
          const normalized = this.normalizePathInput(folderPath);
          this.plugin.settings.sqlite.outputPath = normalized || 'lorebooks';
          sqliteOutputInput?.setValue(this.plugin.settings.sqlite.outputPath);
          void this.persistSettings();
        });
      }));

    new Setting(containerEl)
      .setName('Export Freshness Policy')
      .setDesc('Controls canonical export freshness. manual: only explicit Build/Export. on_build: refresh only when build commands run. background_debounced: auto-rebuild impacted lorebooks after vault edits.')
      .addDropdown(dropdown => dropdown
        .addOptions({
          manual: 'manual',
          on_build: 'on_build',
          background_debounced: 'background_debounced'
        })
        .setValue(this.plugin.settings.sqlite.exportFreshnessPolicy ?? 'on_build')
        .onChange(async value => {
          if (value === 'manual' || value === 'background_debounced') {
            this.plugin.settings.sqlite.exportFreshnessPolicy = value;
          } else {
            this.plugin.settings.sqlite.exportFreshnessPolicy = 'on_build';
          }
          await this.persistSettings();
        }));

    new Setting(containerEl)
      .setName('Background Export Debounce (ms)')
      .setDesc('Used only for background_debounced policy. LoreVault waits this long after edits before rebuilding impacted lorebooks.')
      .addText(text => text
        .setValue(String(this.plugin.settings.sqlite.backgroundDebounceMs ?? 1800))
        .onChange(async value => {
          const parsed = Math.floor(Number(value));
          if (Number.isFinite(parsed)) {
            this.plugin.settings.sqlite.backgroundDebounceMs = Math.max(400, Math.min(30000, parsed));
            await this.persistSettings();
          }
        }));

    containerEl.createEl('h3', { text: 'Story Chat' });

    let chatFolderInput: TextComponent | null = null;
    const chatFolderSetting = new Setting(containerEl)
      .setName('Story Chat Conversation Folder')
      .setDesc('Vault folder where Story Chat conversation notes are stored. Type a path or browse existing folders.')
      .addText(text => {
        chatFolderInput = text;
        text
          .setPlaceholder('LoreVault/chat')
          .setValue(this.plugin.settings.storyChat.chatFolder)
          .onChange(async (value) => {
            this.plugin.settings.storyChat.chatFolder = this.normalizePathInput(value);
            await this.persistSettings();
          });
      });
    chatFolderSetting.addButton(button => button
      .setButtonText('Browse')
      .setTooltip('Pick existing folder from vault')
      .onClick(() => {
        this.openFolderPicker((folderPath: string) => {
          const normalized = this.normalizePathInput(folderPath);
          this.plugin.settings.storyChat.chatFolder = normalized || 'LoreVault/chat';
          chatFolderInput?.setValue(this.plugin.settings.storyChat.chatFolder);
          void this.persistSettings();
        });
      }));

    new Setting(containerEl)
      .setName('Enable Story Chat Tool Calls')
      .setDesc('Allow Story Chat to run bounded LLM tool calls for lorebook lookup and linked-story/steering access before final response generation.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.storyChat.toolCalls.enabled)
        .onChange(async (value) => {
          this.plugin.settings.storyChat.toolCalls.enabled = value;
          await this.persistSettings();
        }));

    new Setting(containerEl)
      .setName('Story Chat Tool Calls Per Turn')
      .setDesc('Hard cap on Story Chat tool calls per turn (1-16).')
      .addText(text => text
        .setValue(this.plugin.settings.storyChat.toolCalls.maxCallsPerTurn.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value, 10);
          if (!isNaN(numValue) && numValue >= 1 && numValue <= 16) {
            this.plugin.settings.storyChat.toolCalls.maxCallsPerTurn = numValue;
            await this.persistSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Story Chat Tool Result Token Cap')
      .setDesc('Hard cap for accumulated Story Chat tool result payload tokens per turn.')
      .addText(text => text
        .setValue(this.plugin.settings.storyChat.toolCalls.maxResultTokensPerTurn.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value, 10);
          if (!isNaN(numValue) && numValue >= 128) {
            this.plugin.settings.storyChat.toolCalls.maxResultTokensPerTurn = numValue;
            await this.persistSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Story Chat Tool Planning Time Cap (ms)')
      .setDesc('Maximum planner-loop time budget for Story Chat tool execution per turn.')
      .addText(text => text
        .setValue(this.plugin.settings.storyChat.toolCalls.maxPlanningTimeMs.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value, 10);
          if (!isNaN(numValue) && numValue >= 500) {
            this.plugin.settings.storyChat.toolCalls.maxPlanningTimeMs = numValue;
            await this.persistSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Allow Story Chat Tool Write Actions')
      .setDesc('Allow tool actions that write to linked Author Notes or create lorebook notes. Writes are still blocked unless the current user turn explicitly asks for an edit/create action.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.storyChat.toolCalls.allowWriteActions)
        .onChange(async (value) => {
          this.plugin.settings.storyChat.toolCalls.allowWriteActions = value;
          await this.persistSettings();
        }));

    containerEl.createEl('h3', { text: 'Story Steering' });

    let steeringFolderInput: TextComponent | null = null;
    const steeringFolderSetting = new Setting(containerEl)
      .setName('Author Note Folder')
      .setDesc('Vault folder where note-level Author Note markdown files are stored.')
      .addText(text => {
        steeringFolderInput = text;
        text
          .setPlaceholder('LoreVault/author-notes')
          .setValue(this.plugin.settings.storySteering.folder)
          .onChange(async (value) => {
            this.plugin.settings.storySteering.folder = this.normalizePathInput(value);
            await this.persistSettings();
          });
      });
    steeringFolderSetting.addButton(button => button
      .setButtonText('Browse')
      .setTooltip('Pick existing folder from vault')
      .onClick(() => {
        this.openFolderPicker((folderPath: string) => {
          const normalized = this.normalizePathInput(folderPath);
          this.plugin.settings.storySteering.folder = normalized || 'LoreVault/author-notes';
          steeringFolderInput?.setValue(this.plugin.settings.storySteering.folder);
          void this.persistSettings();
        });
      }));

    new Setting(containerEl)
      .setName('Story Steering Extraction Sanitization')
      .setDesc('Strict filters lorebook-like profile facts from LLM steering update proposals. Off keeps raw extracted content.')
      .addDropdown(dropdown => dropdown
        .addOptions({
          strict: 'Strict (Recommended)',
          off: 'Off (Raw Extraction)'
        })
        .setValue(this.plugin.settings.storySteering.extractionSanitization)
        .onChange(async value => {
          this.plugin.settings.storySteering.extractionSanitization = value === 'off' ? 'off' : 'strict';
          await this.persistSettings();
        }));

    containerEl.createEl('h3', { text: 'Writing Completion' });
    containerEl.createEl('p', {
      text: 'Configure LLM generation for "Continue Story with Context".'
    });

    const selectedPreset = completionPresetsSorted
      .find(item => item.id === this.selectedCompletionPresetEditorId) ?? null;
    if (selectedPreset) {
      this.applyCompletionPreset(selectedPreset);
    }

    new Setting(containerEl)
      .setName('Preset To Edit')
      .setDesc('Choose which preset to edit. This is separate from the per-device active preset above.')
      .addDropdown(dropdown => {
        dropdown.addOption('', '(none)');
        for (const preset of completionPresetsSorted) {
          dropdown.addOption(preset.id, preset.name);
        }
        dropdown.setValue(this.selectedCompletionPresetEditorId || '');
        dropdown.onChange(async value => {
          this.selectedCompletionPresetEditorId = value.trim();
          const selectedId = this.selectedCompletionPresetEditorId;
          if (selectedId) {
            const preset = this.plugin.settings.completion.presets.find(item => item.id === selectedId);
            if (preset) {
              this.applyCompletionPreset(preset);
            }
          }
          await this.persistSettings();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName('Completion API Secret Name')
      .setDesc('Secret id for the selected preset. Use the same id across presets to share one API key.')
      .addText(text => {
        text
          .setPlaceholder('lorevault-completion-main')
          .setValue(selectedPreset?.apiKeySecretName ?? '')
          .setDisabled(!selectedPreset)
          .onChange(async value => {
            if (!selectedPreset) {
              return;
            }
            selectedPreset.apiKeySecretName = value.trim();
            await this.persistCompletionSettings();
          });
      })
      .addButton(button => button
        .setButtonText('Pick Existing')
        .setDisabled(!selectedPreset)
        .onClick(async () => {
          if (!selectedPreset) {
            return;
          }
          const selected = await this.pickExistingSecretId(selectedPreset.apiKeySecretName);
          if (!selected) {
            return;
          }
          selectedPreset.apiKeySecretName = selected;
          await this.persistCompletionSettings();
          this.display();
        }));

    const presetActions = new Setting(containerEl)
      .setName('Preset Actions')
      .setDesc('Create a new empty preset, clone current settings, or remove the selected preset.');

    presetActions.addButton(button => button
      .setButtonText('New Preset')
      .onClick(async () => {
        const name = await this.requestPresetName('Create Completion Preset', 'New preset', 'Create');
        if (!name) {
          return;
        }

        const preset: CompletionPreset = {
          id: this.createPresetId(name),
          name,
          provider: DEFAULT_SETTINGS.completion.provider,
          endpoint: DEFAULT_SETTINGS.completion.endpoint,
          apiKey: '',
          apiKeySecretName: '',
          model: DEFAULT_SETTINGS.completion.model,
          systemPrompt: DEFAULT_SETTINGS.completion.systemPrompt,
          temperature: DEFAULT_SETTINGS.completion.temperature,
          maxOutputTokens: DEFAULT_SETTINGS.completion.maxOutputTokens,
          contextWindowTokens: DEFAULT_SETTINGS.completion.contextWindowTokens,
          promptReserveTokens: DEFAULT_SETTINGS.completion.promptReserveTokens,
          timeoutMs: DEFAULT_SETTINGS.completion.timeoutMs,
          promptCachingEnabled: DEFAULT_SETTINGS.completion.promptCachingEnabled,
          providerRouting: DEFAULT_SETTINGS.completion.providerRouting
        };
        this.plugin.settings.completion.presets = [
          ...this.plugin.settings.completion.presets,
          preset
        ];
        this.selectedCompletionPresetEditorId = preset.id;
        this.applyCompletionPreset(preset);
        await this.persistCompletionSettings();
        new Notice(`Created preset: ${name}`);
        this.display();
      }));

    presetActions.addButton(button => button
      .setButtonText('Clone Current')
      .onClick(async () => {
        const defaultName = `${this.plugin.settings.completion.provider} · ${this.plugin.settings.completion.model}`;
        const name = await this.requestPresetName('Clone Completion Preset', defaultName, 'Clone');
        if (!name) {
          return;
        }

        const preset = this.snapshotCurrentCompletion(name);
        this.plugin.settings.completion.presets = [
          ...this.plugin.settings.completion.presets,
          preset
        ];
        this.selectedCompletionPresetEditorId = preset.id;
        await this.persistCompletionSettings();
        new Notice(`Cloned preset: ${name}`);
        this.display();
      }));

    presetActions.addButton(button => button
      .setButtonText('Delete Selected')
      .onClick(async () => {
        const selectedPresetId = this.selectedCompletionPresetEditorId.trim();
        if (!selectedPresetId) {
          new Notice('No preset selected to delete.');
          return;
        }

        const existing = this.plugin.settings.completion.presets.find(item => item.id === selectedPresetId);
        if (!existing) {
          new Notice('Selected preset no longer exists.');
          return;
        }

        const confirmed = await this.requestConfirmation(
          'Delete Completion Preset',
          `Delete completion preset "${existing.name}"?`,
          'Delete'
        );
        if (!confirmed) {
          return;
        }

        this.plugin.settings.completion.presets = this.plugin.settings.completion.presets
          .filter(item => item.id !== selectedPresetId);
        this.selectedCompletionPresetEditorId = '';
        if (this.plugin.getDeviceActiveCompletionPresetId() === selectedPresetId) {
          await this.plugin.setDeviceActiveCompletionPresetId('');
        }
        await this.persistSettings();
        new Notice(`Deleted preset: ${existing.name}`);
        this.display();
      }));

    new Setting(containerEl)
      .setName('Enable Writing Completion')
      .setDesc('Generate continuation text instead of inserting a placeholder.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.completion.enabled)
        .onChange(async (value) => {
          this.plugin.settings.completion.enabled = value;
          await this.plugin.saveSettings(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Completion Provider')
      .setDesc('Inference backend for story continuation.')
      .addDropdown(dropdown => dropdown
        .addOptions({
          'openrouter': 'OpenRouter',
          'ollama': 'Ollama',
          'openai_compatible': 'OpenAI-Compatible'
        })
        .setValue(this.plugin.settings.completion.provider)
        .onChange(async (value) => {
          if (value === 'ollama' || value === 'openai_compatible') {
            this.plugin.settings.completion.provider = value;
          } else {
            this.plugin.settings.completion.provider = 'openrouter';
          }
          await this.persistCompletionSettings();
        }));

    new Setting(containerEl)
      .setName('Completion Endpoint')
      .setDesc('Base endpoint URL (for example https://openrouter.ai/api/v1 or http://localhost:11434).')
      .addText(text => text
        .setPlaceholder('https://openrouter.ai/api/v1')
        .setValue(this.plugin.settings.completion.endpoint)
        .onChange(async (value) => {
          this.plugin.settings.completion.endpoint = value.trim();
          await this.persistCompletionSettings();
        }));

    new Setting(containerEl)
      .setName('Completion API Key')
      .setDesc('Bootstrap key for the selected preset (not required for local Ollama). LoreVault only creates missing secrets and never overwrites existing secret values; update existing keys in Obsidian Secret Storage.')
      .addText(text => {
        text
          .setPlaceholder('sk-...')
          .setValue(this.plugin.settings.completion.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.completion.apiKey = value.trim();
            await this.persistCompletionSettings();
          });
        text.inputEl.type = 'password';
      });

    new Setting(containerEl)
      .setName('Completion Model')
      .setDesc('Model identifier used for continuation generation.')
      .addText(text => text
        .setPlaceholder('openai/gpt-4o-mini')
        .setValue(this.plugin.settings.completion.model)
        .onChange(async (value) => {
          this.plugin.settings.completion.model = value.trim();
          await this.persistCompletionSettings();
        }));

    new Setting(containerEl)
      .setName('System Prompt')
      .setDesc('Instruction that controls writing style and behavior.')
      .addTextArea(text => text
        .setValue(this.plugin.settings.completion.systemPrompt)
        .onChange(async (value) => {
          this.plugin.settings.completion.systemPrompt = value.trim();
          await this.persistCompletionSettings();
        }));

    new Setting(containerEl)
      .setName('Completion Temperature')
      .setDesc('Creativity level (0.0-2.0).')
      .addText(text => text
        .setValue(this.plugin.settings.completion.temperature.toString())
        .onChange(async (value) => {
          const numValue = Number(value);
          if (!isNaN(numValue) && numValue >= 0 && numValue <= 2) {
            this.plugin.settings.completion.temperature = numValue;
            await this.persistCompletionSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Max Output Tokens')
      .setDesc('Upper bound for generated continuation length.')
      .addText(text => text
        .setValue(this.plugin.settings.completion.maxOutputTokens.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 64) {
            this.plugin.settings.completion.maxOutputTokens = numValue;
            await this.persistCompletionSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Context Window Tokens')
      .setDesc('Total prompt + completion token window used for budgeting.')
      .addText(text => text
        .setValue(this.plugin.settings.completion.contextWindowTokens.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= this.plugin.settings.completion.maxOutputTokens + 512) {
            this.plugin.settings.completion.contextWindowTokens = numValue;
            await this.persistCompletionSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Prompt Reserve Tokens')
      .setDesc('Reserved headroom for prompt overhead and safety margin.')
      .addText(text => text
        .setValue(this.plugin.settings.completion.promptReserveTokens.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 0) {
            this.plugin.settings.completion.promptReserveTokens = numValue;
            await this.persistCompletionSettings();
          }
        }));

    containerEl.createEl('h4', { text: 'Provider & Request Options' });
    containerEl.createEl('p', { text: 'These settings are saved with the selected completion preset, including reasoning/thinking options.' });

    new Setting(containerEl)
      .setName('Completion Timeout (ms)')
      .setDesc('Request timeout for completion API calls.')
      .addText(text => text
        .setValue(this.plugin.settings.completion.timeoutMs.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 1000) {
            this.plugin.settings.completion.timeoutMs = numValue;
            await this.persistCompletionSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Prompt Caching (OpenRouter)')
      .setDesc('Add a cache_control breakpoint to each request, enabling Anthropic prompt-cache hits. Other providers cache automatically regardless of this setting.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.completion.promptCachingEnabled)
        .onChange(async value => {
          this.plugin.settings.completion.promptCachingEnabled = value;
          await this.persistCompletionSettings();
        }));

    new Setting(containerEl)
      .setName('Provider Routing (OpenRouter)')
      .setDesc('Comma-separated OpenRouter provider slugs to lock requests to, e.g. "anthropic" or "anthropic,google". Leave blank to let OpenRouter route automatically.')
      .addText(text => text
        .setPlaceholder('anthropic')
        .setValue(this.plugin.settings.completion.providerRouting)
        .onChange(async value => {
          this.plugin.settings.completion.providerRouting = value.trim();
          await this.persistCompletionSettings();
        }));

    const reasoningEnabled = this.plugin.settings.completion.reasoning?.enabled ?? false;
    let reasoningEffortSetting: Setting;
    let reasoningMaxTokensSetting: Setting;
    let reasoningExcludeSetting: Setting;
    new Setting(containerEl)
      .setName('Reasoning (OpenRouter)')
      .setDesc('Request reasoning/thinking tokens from models that support them (Anthropic Claude, Gemini, OpenAI o-series, etc.). Token usage and cost increase when enabled.')
      .addToggle(toggle => toggle
        .setValue(reasoningEnabled)
        .onChange(async value => {
          this.plugin.settings.completion.reasoning = value
            ? { enabled: true, effort: 'medium' }
            : undefined;
          await this.persistCompletionSettings();
          reasoningEffortSetting.setDisabled(!value);
          reasoningMaxTokensSetting.setDisabled(!value);
          reasoningExcludeSetting.setDisabled(!value);
        }));

    reasoningEffortSetting = new Setting(containerEl)
      .setName('Reasoning Effort')
      .setDesc('Controls how many tokens the model uses for reasoning. Ignored when Max Tokens is set. "none" disables thinking while keeping the reasoning parameter.')
      .setDisabled(!reasoningEnabled)
      .addDropdown(dropdown => {
        const effort = this.plugin.settings.completion.reasoning?.effort ?? 'medium';
        dropdown
          .addOptions({
            xhigh: 'xhigh — ~95% of max tokens',
            high: 'high — ~80% of max tokens',
            medium: 'medium — ~50% of max tokens (default)',
            low: 'low — ~20% of max tokens',
            minimal: 'minimal — ~10% of max tokens',
            none: 'none — disable reasoning'
          })
          .setValue(effort)
          .onChange(async value => {
            const r = this.plugin.settings.completion.reasoning;
            if (r) {
              r.effort = value as ReasoningEffort;
              await this.persistCompletionSettings();
            }
          });
      });

    reasoningMaxTokensSetting = new Setting(containerEl)
      .setName('Max Reasoning Tokens')
      .setDesc('Exact token budget for Anthropic/Gemini models. Overrides Effort when > 0. Minimum 1024. Set to 0 to use Effort instead.')
      .setDisabled(!reasoningEnabled)
      .addText(text => text
        .setPlaceholder('0')
        .setValue(String(this.plugin.settings.completion.reasoning?.maxTokens ?? 0))
        .onChange(async value => {
          const r = this.plugin.settings.completion.reasoning;
          if (r) {
            const parsed = parseInt(value);
            r.maxTokens = isNaN(parsed) || parsed < 0 ? 0 : parsed;
            await this.persistCompletionSettings();
          }
        }));

    reasoningExcludeSetting = new Setting(containerEl)
      .setName('Exclude Reasoning from Response')
      .setDesc('The model reasons internally but does not return the reasoning text. When off, Story Chat shows a Thinking block and Continue Story stores returned reasoning in a collapsed lv-thinking callout.')
      .setDisabled(!reasoningEnabled)
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.completion.reasoning?.exclude ?? false)
        .onChange(async value => {
          const r = this.plugin.settings.completion.reasoning;
          if (r) {
            r.exclude = value;
            await this.persistCompletionSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Story Continuity Aggressiveness')
      .setDesc('Controls how aggressively chapter memory includes prior chapters and style excerpts in Continue Story and Story Chat.')
      .addDropdown(dropdown => dropdown
        .addOption('balanced', 'Balanced')
        .addOption('aggressive', 'Aggressive')
        .setValue(this.plugin.settings.completion.continuityAggressiveness)
        .onChange(async value => {
          this.plugin.settings.completion.continuityAggressiveness = value === 'balanced'
            ? 'balanced'
            : 'aggressive';
          await this.persistSettings();
        }));

    const semanticRecall = this.plugin.settings.completion.semanticChapterRecall;
    containerEl.createEl('h4', { text: 'Semantic Chapter Recall' });
    containerEl.createEl('p', {
      text: 'Optionally retrieve related prior scene chunks by embedding similarity to the current writing/query context.'
    });

    new Setting(containerEl)
      .setName('Enable Semantic Chapter Recall')
      .setDesc('Enabled by default. If enabled, chapter memory can add a "Related Past Scenes" block from semantically similar prior chunks.')
      .addToggle(toggle => toggle
        .setValue(semanticRecall.enabled)
        .onChange(async value => {
          this.plugin.settings.completion.semanticChapterRecall.enabled = value;
          await this.persistSettings();
        }));

    new Setting(containerEl)
      .setName('Semantic Recall Max Source Chapters')
      .setDesc('How many previous chapters are scanned for candidate chunks.')
      .addText(text => text
        .setValue(semanticRecall.maxSourceChapters.toString())
        .onChange(async value => {
          const numValue = parseInt(value, 10);
          if (!isNaN(numValue) && numValue >= 2 && numValue <= 120) {
            this.plugin.settings.completion.semanticChapterRecall.maxSourceChapters = numValue;
            await this.persistSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Semantic Recall Max Chunks')
      .setDesc('Maximum retrieved related-scene chunks to inject per generation turn.')
      .addText(text => text
        .setValue(semanticRecall.maxChunks.toString())
        .onChange(async value => {
          const numValue = parseInt(value, 10);
          if (!isNaN(numValue) && numValue >= 1 && numValue <= 24) {
            this.plugin.settings.completion.semanticChapterRecall.maxChunks = numValue;
            await this.persistSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Semantic Recall Max Chunks Per Chapter')
      .setDesc('Limit recalled chunks per chapter to avoid overfocusing one chapter.')
      .addText(text => text
        .setValue(semanticRecall.maxChunksPerChapter.toString())
        .onChange(async value => {
          const numValue = parseInt(value, 10);
          if (!isNaN(numValue) && numValue >= 1 && numValue <= 6) {
            this.plugin.settings.completion.semanticChapterRecall.maxChunksPerChapter = numValue;
            await this.persistSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Semantic Recall Chunk Max Chars')
      .setDesc('Chunk size used when splitting prior chapter text for embeddings.')
      .addText(text => text
        .setValue(semanticRecall.chunkMaxChars.toString())
        .onChange(async value => {
          const numValue = parseInt(value, 10);
          if (!isNaN(numValue) && numValue >= 300 && numValue <= 6000) {
            this.plugin.settings.completion.semanticChapterRecall.chunkMaxChars = numValue;
            if (this.plugin.settings.completion.semanticChapterRecall.chunkOverlapChars >= numValue) {
              this.plugin.settings.completion.semanticChapterRecall.chunkOverlapChars = Math.max(
                0,
                Math.floor(numValue * 0.25)
              );
            }
            await this.persistSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Semantic Recall Chunk Overlap Chars')
      .setDesc('Overlap between adjacent chunks for smoother semantic matching continuity.')
      .addText(text => text
        .setValue(semanticRecall.chunkOverlapChars.toString())
        .onChange(async value => {
          const numValue = parseInt(value, 10);
          const maxValue = Math.max(0, this.plugin.settings.completion.semanticChapterRecall.chunkMaxChars - 1);
          if (!isNaN(numValue) && numValue >= 0 && numValue <= 1500 && numValue <= maxValue) {
            this.plugin.settings.completion.semanticChapterRecall.chunkOverlapChars = numValue;
            await this.persistSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Semantic Recall Min Similarity')
      .setDesc('Minimum cosine similarity threshold (0.0-1.0) for related-scene chunk inclusion.')
      .addText(text => text
        .setValue(semanticRecall.minSimilarity.toString())
        .onChange(async value => {
          const numValue = Number(value);
          if (!isNaN(numValue) && numValue >= 0 && numValue <= 1) {
            this.plugin.settings.completion.semanticChapterRecall.minSimilarity = numValue;
            await this.persistSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Semantic Recall Recency Blend')
      .setDesc('Blend factor (0.0-1.0): higher values prefer newer chapters when ranking similar chunks.')
      .addText(text => text
        .setValue(semanticRecall.recencyBlend.toString())
        .onChange(async value => {
          const numValue = Number(value);
          if (!isNaN(numValue) && numValue >= 0 && numValue <= 1) {
            this.plugin.settings.completion.semanticChapterRecall.recencyBlend = numValue;
            await this.persistSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Semantic Recall Budget Share')
      .setDesc('Fraction of chapter-memory budget reserved for related-scene semantic recall (0.05-0.80).')
      .addText(text => text
        .setValue(semanticRecall.budgetShare.toString())
        .onChange(async value => {
          const numValue = Number(value);
          if (!isNaN(numValue) && numValue >= 0.05 && numValue <= 0.8) {
            this.plugin.settings.completion.semanticChapterRecall.budgetShare = numValue;
            await this.persistSettings();
          }
        }));

    containerEl.createEl('p', {
      text: 'Steering placement controls where Author Note markdown is staged in prompts.'
    });
    containerEl.createEl('p', {
      text: 'Inline directives (`[LV: ...]` / `<!-- LV: ... -->`) are kept in-place and rendered as `<inline_story_directive>` tags; configured ignored callout types and non-`LV:` HTML comments are stripped from staged prompt blocks.'
    });

    new Setting(containerEl)
      .setName('Ignored LLM Callout Types')
      .setDesc('Callout types removed from markdown before LoreVault sends note text to LLMs. One per line or comma-separated. Defaults: lv-thinking, lv-ignore, note.')
      .addTextArea(text => text
        .setValue(this.plugin.settings.completion.ignoredCalloutTypes.join('\n'))
        .onChange(async value => {
          this.plugin.settings.completion.ignoredCalloutTypes = normalizeIgnoredCalloutTypes(value);
          await this.persistSettings();
        }));

    const placementOptions = {
      system: 'System Prompt',
      pre_history: 'Pre-History Block',
      pre_response: 'Pre-Response Block'
    };
    this.plugin.settings.completion.layerPlacement = {
      ...DEFAULT_SETTINGS.completion.layerPlacement,
      ...(this.plugin.settings.completion.layerPlacement ?? {})
    };

    new Setting(containerEl)
      .setName('Author Note Placement')
      .setDesc('Where note-level Author Note markdown is injected.')
      .addDropdown(dropdown => dropdown
        .addOptions(placementOptions)
        .setValue(this.plugin.settings.completion.layerPlacement.storyNotes)
        .onChange(async value => {
          if (value === 'system' || value === 'pre_history' || value === 'pre_response') {
            this.plugin.settings.completion.layerPlacement.storyNotes = value;
            await this.persistSettings();
          }
        }));

    containerEl.createEl('h3', { text: 'Text Commands' });
    containerEl.createEl('p', {
      text: 'Prompt-driven rewrite/reformat commands for selected editor text. If a review is dismissed or focus moves elsewhere before it opens, LoreVault keeps the result in a pending review queue.'
    });

    new Setting(containerEl)
      .setName('Auto-Accept Text Command Edits')
      .setDesc('If enabled, generated edits are applied without review modal confirmation. Unsafe auto-apply cases are saved to pending review instead of being dropped.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.textCommands.autoAcceptEdits)
        .onChange(async value => {
          this.plugin.settings.textCommands.autoAcceptEdits = value;
          await this.persistSettings();
        }));

    new Setting(containerEl)
      .setName('Include Lorebook Context by Default')
      .setDesc('Default context toggle for new text-command runs. Can still be changed per run.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.textCommands.defaultIncludeLorebookContext)
        .onChange(async value => {
          this.plugin.settings.textCommands.defaultIncludeLorebookContext = value;
          await this.persistSettings();
        }));

    new Setting(containerEl)
      .setName('Text Command Context Token Budget')
      .setDesc('Maximum lorebook token budget when a text command enables context injection.')
      .addText(text => text
        .setValue(this.plugin.settings.textCommands.maxContextTokens.toString())
        .onChange(async value => {
          const numValue = parseInt(value, 10);
          if (!isNaN(numValue) && numValue >= 128) {
            this.plugin.settings.textCommands.maxContextTokens = numValue;
            await this.persistSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Text Command System Prompt')
      .setDesc('Global model instruction for selection rewrite/reformat commands.')
      .addTextArea(text => text
        .setValue(this.plugin.settings.textCommands.systemPrompt)
        .onChange(async value => {
          this.plugin.settings.textCommands.systemPrompt = value.trim();
          await this.persistSettings();
        }));

    new Setting(containerEl)
      .setName('Text Command Prompt Notes Folder')
      .setDesc('Prompt templates are markdown notes in this folder. Use frontmatter `promptKind: text_command` and `includeLorebookContext: true|false`.')
      .addText(text => text
        .setPlaceholder('LoreVault/prompts/text-commands')
        .setValue(this.plugin.settings.textCommands.promptsFolder)
        .onChange(async value => {
          const normalized = this.normalizePathInput(value);
          this.plugin.settings.textCommands.promptsFolder = normalized || DEFAULT_SETTINGS.textCommands.promptsFolder;
          await this.persistSettings();
        }))
      .addButton(button => button
        .setButtonText('Browse')
        .onClick(() => {
          this.openFolderPicker(path => {
            this.plugin.settings.textCommands.promptsFolder = this.normalizePathInput(path) || DEFAULT_SETTINGS.textCommands.promptsFolder;
            void this.persistSettings().then(() => this.display());
          });
        }));

    new Setting(containerEl)
      .setName('Prompt Notes')
      .setDesc('Create default prompt notes in the configured folder (existing files are not overwritten), including Canon/Scene Consistency and Remove LLMisms passes.')
      .addButton(button => button
        .setButtonText('Create Default Prompt Notes')
        .onClick(async () => {
          try {
            const result = await this.plugin.populateDefaultTextCommandPromptNotes();
            new Notice(`Prompt notes updated: ${result.created} created, ${result.skipped} skipped (${result.folder}).`);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`Failed to create prompt notes: ${message}`);
          }
        }));

    containerEl.createEl('h3', { text: 'Retrieval (Graph + Fallback Entries)' });

    new Setting(containerEl)
      .setName('Fallback Retrieval Policy')
      .setDesc('Control when embedding/lexical fallback entries are included alongside graph-selected world_info.')
      .addDropdown(dropdown => dropdown
        .addOptions({
          'off': 'Off (graph/keyword only)',
          'auto': 'Auto (fallback on weak/no seed)',
          'always': 'Always (include when matched)'
        })
        .setValue(this.plugin.settings.retrieval.ragFallbackPolicy)
        .onChange(async (value) => {
          if (value === 'off' || value === 'always') {
            this.plugin.settings.retrieval.ragFallbackPolicy = value;
          } else {
            this.plugin.settings.retrieval.ragFallbackPolicy = 'auto';
          }
          await this.plugin.saveSettings(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Auto Fallback Seed Threshold')
      .setDesc('In auto mode, fallback retrieval activates when top seed score is below this threshold.')
      .addText(text => text
        .setValue(this.plugin.settings.retrieval.ragFallbackSeedScoreThreshold.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 1) {
            this.plugin.settings.retrieval.ragFallbackSeedScoreThreshold = numValue;
            await this.plugin.saveSettings(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Max Graph Hops')
      .setDesc('Maximum expansion depth from direct seed matches (0-3).')
      .addText(text => text
        .setValue(this.plugin.settings.retrieval.maxGraphHops.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 0 && numValue <= 3) {
            this.plugin.settings.retrieval.maxGraphHops = numValue;
            await this.plugin.saveSettings(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Graph Hop Decay')
      .setDesc('Score decay applied per graph hop (0.2-0.9).')
      .addText(text => text
        .setValue(this.plugin.settings.retrieval.graphHopDecay.toString())
        .onChange(async (value) => {
          const numValue = Number(value);
          if (!isNaN(numValue) && numValue >= 0.2 && numValue <= 0.9) {
            this.plugin.settings.retrieval.graphHopDecay = numValue;
            await this.plugin.saveSettings(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Include Backlinks in Graph Expansion')
      .setDesc('Allow reverse-edge expansion so notes that link to matched entities can also be selected.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.retrieval.includeBacklinksInGraphExpansion)
        .onChange(async (value) => {
          this.plugin.settings.retrieval.includeBacklinksInGraphExpansion = value;
          await this.plugin.saveSettings(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Enable Tool Retrieval Hooks')
      .setDesc('Allow model-driven retrieval calls (`search_entries`, `expand_neighbors`, `get_entry`) during generation.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.retrieval.toolCalls.enabled)
        .onChange(async (value) => {
          this.plugin.settings.retrieval.toolCalls.enabled = value;
          await this.plugin.saveSettings(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Tool Calls Per Turn')
      .setDesc('Hard cap on retrieval tool calls per generation/chat turn (1-16).')
      .addText(text => text
        .setValue(this.plugin.settings.retrieval.toolCalls.maxCallsPerTurn.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 1 && numValue <= 16) {
            this.plugin.settings.retrieval.toolCalls.maxCallsPerTurn = numValue;
            await this.plugin.saveSettings(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Tool Result Token Cap')
      .setDesc('Hard cap for accumulated tool result payload tokens per turn.')
      .addText(text => text
        .setValue(this.plugin.settings.retrieval.toolCalls.maxResultTokensPerTurn.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 128) {
            this.plugin.settings.retrieval.toolCalls.maxResultTokensPerTurn = numValue;
            await this.plugin.saveSettings(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Tool Planning Time Cap (ms)')
      .setDesc('Maximum planner loop time budget per turn.')
      .addText(text => text
        .setValue(this.plugin.settings.retrieval.toolCalls.maxPlanningTimeMs.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 500) {
            this.plugin.settings.retrieval.toolCalls.maxPlanningTimeMs = numValue;
            await this.plugin.saveSettings(this.plugin.settings);
          }
        }));

    containerEl.createEl('h3', { text: 'Auto Summaries' });

    new Setting(containerEl)
      .setName('Summary Max Input Chars')
      .setDesc('Maximum note body characters included when generating summaries.')
      .addText(text => text
        .setValue(this.plugin.settings.summaries.maxInputChars.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 500) {
            this.plugin.settings.summaries.maxInputChars = numValue;
            await this.plugin.saveSettings(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Summary Max Output Chars')
      .setDesc('Hard cap for normalized world_info summaries (set to 0 to disable). Chapter summaries are not length-capped.')
      .addText(text => text
        .setValue(this.plugin.settings.summaries.maxSummaryChars.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 0) {
            this.plugin.settings.summaries.maxSummaryChars = numValue;
            await this.plugin.saveSettings(this.plugin.settings);
          }
        }));

    containerEl.createEl('h3', { text: 'Cost Tracking (Experimental)' });

    new Setting(containerEl)
      .setName('Enable Cost Tracking')
      .setDesc('Capture completion usage (tokens/cost metadata) into shared immutable vault ledger records.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.costTracking.enabled)
        .onChange(async (value) => {
          this.plugin.settings.costTracking.enabled = value;
          await this.plugin.saveSettings(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Usage Ledger Path')
      .setDesc('Vault path for shared usage-ledger records. Legacy `.json` files are imported into the sibling ledger folder.')
      .addText(text => text
        .setPlaceholder('.obsidian/plugins/lore-vault/cache/usage-ledger.json')
        .setValue(this.plugin.settings.costTracking.ledgerPath)
        .onChange(async (value) => {
          this.plugin.settings.costTracking.ledgerPath = value.trim();
          await this.plugin.saveSettings(this.plugin.settings);
        }));

    const localDbStatusEl = containerEl.createEl('p', { cls: 'setting-item-description' });
    const renderLocalDbStatus = async (): Promise<void> => {
      localDbStatusEl.setText('Loading local storage status...');
      try {
        const health = await this.plugin.getLocalStorageHealth();
        const backendLabel = health.operationLog.internalDb.available
          ? health.operationLog.internalDb.backendLabel || 'local'
          : 'unavailable';
        const persistedLabel = health.operationLog.internalDb.storagePersisted === null
          ? 'unknown'
          : health.operationLog.internalDb.storagePersisted
            ? 'yes'
            : 'no';
        const usageSummary = health.quotaBytes !== null
          ? `${formatStorageBytes(health.usageBytes)} / ${formatStorageBytes(health.quotaBytes)}`
          : formatStorageBytes(health.usageBytes);
        const errorSuffix = health.operationLog.internalDb.errorMessage
          ? ` | error: ${health.operationLog.internalDb.errorMessage}`
          : '';
        localDbStatusEl.setText(
          `Local DB backend: ${backendLabel} | persisted: ${persistedLabel} | origin usage: ${usageSummary} | ledger sync: ${formatStatusTimestamp(health.usageLedger.lastSuccessfulSyncAt)} | pending record updates: ${health.usageLedger.pendingChangedRecordCount} | stale roots queued: ${health.usageLedger.staleSourceRootCount}${errorSuffix}`
        );
      } catch (error) {
        localDbStatusEl.setText(`Failed to load local storage status: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    new Setting(containerEl)
      .setName('Local DB Maintenance')
      .setDesc('Inspect the worker-backed local DB, rebuild shared usage-ledger indexes, or fully reset local SQLite state used for logs/query acceleration.')
      .addButton(button => button
        .setButtonText('Refresh Status')
        .onClick(() => {
          void renderLocalDbStatus();
        }))
      .addButton(button => button
        .setButtonText('Rebuild Local Indexes')
        .onClick(async () => {
          try {
            await this.plugin.rebuildLocalIndexes();
            new Notice('Rebuilt local usage-ledger indexes.');
            await renderLocalDbStatus();
          } catch (error) {
            new Notice(`Failed to rebuild local indexes: ${error instanceof Error ? error.message : String(error)}`);
          }
        }))
      .addButton(button => button
        .setWarning()
        .setButtonText('Reset Local DB')
        .onClick(async () => {
          if (!window.confirm('Reset the local DB? This clears local operation logs and rebuilds the current usage-ledger index from vault records.')) {
            return;
          }
          try {
            await this.plugin.resetLocalDb();
            new Notice('Reset the local DB and rebuilt the current usage-ledger index.');
            await renderLocalDbStatus();
          } catch (error) {
            new Notice(`Failed to reset local DB: ${error instanceof Error ? error.message : String(error)}`);
          }
        }));
    void renderLocalDbStatus();

    new Setting(containerEl)
      .setName('Default Input Cost / 1M Tokens (USD)')
      .setDesc('Fallback input-token pricing used when provider does not return cost.')
      .addText(text => text
        .setValue(this.plugin.settings.costTracking.defaultInputCostPerMillionUsd.toString())
        .onChange(async (value) => {
          const numValue = Number(value);
          if (!Number.isNaN(numValue) && numValue >= 0) {
            this.plugin.settings.costTracking.defaultInputCostPerMillionUsd = numValue;
            await this.plugin.saveSettings(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Default Output Cost / 1M Tokens (USD)')
      .setDesc('Fallback output-token pricing used when provider does not return cost.')
      .addText(text => text
        .setValue(this.plugin.settings.costTracking.defaultOutputCostPerMillionUsd.toString())
        .onChange(async (value) => {
          const numValue = Number(value);
          if (!Number.isNaN(numValue) && numValue >= 0) {
            this.plugin.settings.costTracking.defaultOutputCostPerMillionUsd = numValue;
            await this.plugin.saveSettings(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Usage Report Output Directory')
      .setDesc('Directory for exported usage reports (JSON/CSV).')
      .addText(text => text
        .setPlaceholder('.obsidian/plugins/lore-vault/reports')
        .setValue(this.plugin.settings.costTracking.reportOutputDir)
        .onChange(async (value) => {
          this.plugin.settings.costTracking.reportOutputDir = value.trim();
          await this.plugin.saveSettings(this.plugin.settings);
        }));

    const budgetProfileOptions = this.resolveCostBudgetProfileOptions();
    this.selectedCostBudgetProfileId = this.resolveSelectedCostBudgetProfileId(budgetProfileOptions);
    const selectedBudgetProfileId = this.selectedCostBudgetProfileId;
    const selectedBudgetProfileLabel = selectedBudgetProfileId === '__default__'
      ? '__default__ (fallback)'
      : selectedBudgetProfileId;
    let selectedBudgetSettings = this.getCostProfileBudgetSettings(selectedBudgetProfileId);
    const persistSelectedBudgetSettings = async (): Promise<void> => {
      this.setCostProfileBudgetSettings(selectedBudgetProfileId, selectedBudgetSettings);
      await this.plugin.saveSettings(this.plugin.settings);
    };

    new Setting(containerEl)
      .setName('Budget Cost Profile')
      .setDesc('Budget settings below are saved for this cost profile.')
      .addDropdown(dropdown => {
        for (const profileId of budgetProfileOptions) {
          const label = profileId === '__default__' ? '__default__ (fallback)' : profileId;
          dropdown.addOption(profileId, label);
        }
        dropdown.setValue(selectedBudgetProfileId);
        dropdown.onChange(value => {
          this.selectedCostBudgetProfileId = this.normalizeCostBudgetProfileId(value);
          this.display();
        });
      })
      .addButton(button => button
        .setButtonText('Use Device Effective')
        .onClick(() => {
          const effective = this.normalizeCostBudgetProfileId(this.plugin.getDeviceEffectiveCostProfileLabel());
          if (effective) {
            this.selectedCostBudgetProfileId = effective;
            this.display();
          }
        }))
      .addButton(button => button
        .setButtonText('Set Profile...')
        .onClick(async () => {
          const picked = await this.requestCostBudgetProfileName(selectedBudgetProfileId);
          if (picked === null) {
            return;
          }
          const normalized = this.normalizeCostBudgetProfileId(picked);
          if (!normalized) {
            new Notice('Cost profile cannot be empty.');
            return;
          }
          this.selectedCostBudgetProfileId = normalized;
          this.display();
        }))
      .addButton(button => button
        .setButtonText('Clear Profile Budgets')
        .onClick(async () => {
          const configured = this.getCostProfileBudgetMap();
          delete configured[selectedBudgetProfileId];
          await this.plugin.saveSettings(this.plugin.settings);
          this.display();
        }));

    new Setting(containerEl)
      .setName('Daily Budget Warning (USD)')
      .setDesc(`Warn when known daily (UTC) cost exceeds this amount for profile "${selectedBudgetProfileLabel}". Set 0 to disable.`)
      .addText(text => text
        .setValue(selectedBudgetSettings.dailyBudgetUsd.toString())
        .onChange(async (value) => {
          const numValue = Number(value);
          if (!Number.isNaN(numValue) && numValue >= 0) {
            selectedBudgetSettings.dailyBudgetUsd = numValue;
            await persistSelectedBudgetSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Session Budget Warning (USD)')
      .setDesc(`Warn when known session cost exceeds this amount for profile "${selectedBudgetProfileLabel}". Set 0 to disable.`)
      .addText(text => text
        .setValue(selectedBudgetSettings.sessionBudgetUsd.toString())
        .onChange(async (value) => {
          const numValue = Number(value);
          if (!Number.isNaN(numValue) && numValue >= 0) {
            selectedBudgetSettings.sessionBudgetUsd = numValue;
            await persistSelectedBudgetSettings();
          }
        }));

    let pricingOverridesDraft = this.formatModelPricingOverridesInput(
      this.plugin.settings.costTracking.modelPricingOverrides
    );
    new Setting(containerEl)
      .setName('Model Pricing Overrides')
      .setDesc('Optional manual pricing overrides. One per line: provider | model-pattern | inputUSDper1M | outputUSDper1M. Use * for provider wildcard.')
      .addTextArea(text => {
        text.inputEl.rows = 4;
        text
          .setPlaceholder('openrouter | z-ai/glm-5 | 0.6 | 2.2')
          .setValue(pricingOverridesDraft)
          .onChange(value => {
            pricingOverridesDraft = value;
          });
      })
      .addButton(button => button
        .setButtonText('Apply')
        .onClick(async () => {
          try {
            this.plugin.settings.costTracking.modelPricingOverrides = this.parseModelPricingOverridesInput(pricingOverridesDraft);
            await this.plugin.saveSettings(this.plugin.settings);
            new Notice('Applied model pricing overrides.');
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`Invalid pricing overrides: ${message}`);
          }
        }));

    let operationBudgetDraft = this.formatBudgetMapInput(selectedBudgetSettings.budgetByOperationUsd);
    new Setting(containerEl)
      .setName('Budget by Operation (USD)')
      .setDesc(`Optional operation-level budgets for "${selectedBudgetProfileLabel}". One per line: operation=value (for example story_chat_turn=2.5).`)
      .addTextArea(text => {
        text.inputEl.rows = 3;
        text
          .setPlaceholder('story_chat_turn = 2.5')
          .setValue(operationBudgetDraft)
          .onChange(value => {
            operationBudgetDraft = value;
          });
      })
      .addButton(button => button
        .setButtonText('Apply')
        .onClick(async () => {
          try {
            selectedBudgetSettings.budgetByOperationUsd = this.parseBudgetMapInput(operationBudgetDraft);
            await persistSelectedBudgetSettings();
            new Notice('Applied operation budgets.');
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`Invalid operation budgets: ${message}`);
          }
        }));

    let modelBudgetDraft = this.formatBudgetMapInput(selectedBudgetSettings.budgetByModelUsd);
    new Setting(containerEl)
      .setName('Budget by Model (USD)')
      .setDesc(`Optional model-level budgets for "${selectedBudgetProfileLabel}". One per line: provider:model=value (for example openrouter:z-ai/glm-5=4).`)
      .addTextArea(text => {
        text.inputEl.rows = 3;
        text
          .setPlaceholder('openrouter:z-ai/glm-5 = 4')
          .setValue(modelBudgetDraft)
          .onChange(value => {
            modelBudgetDraft = value;
          });
      })
      .addButton(button => button
        .setButtonText('Apply')
        .onClick(async () => {
          try {
            const parsed = this.parseBudgetMapInput(modelBudgetDraft);
            const normalized: {[key: string]: number} = {};
            for (const [key, value] of Object.entries(parsed)) {
              normalized[key.toLowerCase()] = value;
            }
            selectedBudgetSettings.budgetByModelUsd = normalized;
            await persistSelectedBudgetSettings();
            new Notice('Applied model budgets.');
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`Invalid model budgets: ${message}`);
          }
        }));

    let scopeBudgetDraft = this.formatBudgetMapInput(selectedBudgetSettings.budgetByScopeUsd);
    new Setting(containerEl)
      .setName('Budget by Lorebook (USD)')
      .setDesc(`Optional lorebook budgets for "${selectedBudgetProfileLabel}". One per line: lorebook=value (for example universe/main=3.5).`)
      .addTextArea(text => {
        text.inputEl.rows = 3;
        text
          .setPlaceholder('universe/main = 3.5')
          .setValue(scopeBudgetDraft)
          .onChange(value => {
            scopeBudgetDraft = value;
          });
      })
      .addButton(button => button
        .setButtonText('Apply')
        .onClick(async () => {
          try {
            selectedBudgetSettings.budgetByScopeUsd = this.parseBudgetMapInput(scopeBudgetDraft);
            await persistSelectedBudgetSettings();
            new Notice('Applied lorebook budgets.');
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`Invalid lorebook budgets: ${message}`);
          }
        }));

    containerEl.createEl('h3', { text: 'LLM Operation Log' });

    new Setting(containerEl)
      .setName('Enable LLM Operation Log')
      .setDesc('Persist full LLM request/response content for debugging. Includes full prompts, tool planner messages, and model outputs.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.operationLog.enabled)
        .onChange(async (value) => {
          this.plugin.settings.operationLog.enabled = value;
          await this.plugin.saveSettings(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('LLM Operation Log Path')
      .setDesc('Vault-relative legacy JSONL base path for operation logs. LoreVault uses this for fallback writes, legacy import, and raw-file inspection, with one file per cost profile suffix.')
      .addText(text => text
        .setPlaceholder('.obsidian/plugins/lore-vault/cache/llm-operation-log.jsonl')
        .setValue(this.plugin.settings.operationLog.path)
        .onChange(async (value) => {
          const normalized = this.normalizePathInput(value);
          this.plugin.settings.operationLog.path = normalized || DEFAULT_SETTINGS.operationLog.path;
          await this.plugin.saveSettings(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('LLM Operation Log Max Entries')
      .setDesc('Maximum number of recent log entries kept per cost profile in local SQLite storage and legacy JSONL fallback files (default 10000, range 20-20000). Oldest entries are trimmed.')
      .addText(text => text
        .setValue(this.plugin.settings.operationLog.maxEntries.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value, 10);
          if (!isNaN(numValue) && numValue >= 20) {
            this.plugin.settings.operationLog.maxEntries = numValue;
            await this.plugin.saveSettings(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Include Embedding Backend Calls')
      .setDesc('Also log embedding request/response payloads (`kind: embedding`). Useful for semantic-retrieval debugging; can generate large logs.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.operationLog.includeEmbeddings)
        .onChange(async (value) => {
          this.plugin.settings.operationLog.includeEmbeddings = value;
          await this.plugin.saveSettings(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Open LLM Operation Log Explorer')
      .setDesc('Open the built-in panel to browse captured LLM operations, inspect storage backend status, and open the legacy JSONL file when needed.')
      .addButton(button => button
        .setButtonText('Open Explorer')
        .onClick(() => {
          void this.plugin.openOperationLogView();
        }));

    containerEl.createEl('h3', { text: 'Embeddings & Semantic RAG' });

    new Setting(containerEl)
      .setName('Enable Embeddings')
      .setDesc('Generate and cache embeddings for RAG chunks.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.embeddings.enabled)
        .onChange(async (value) => {
          this.plugin.settings.embeddings.enabled = value;
          await this.plugin.saveSettings(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Embedding Provider')
      .setDesc('Inference backend for embeddings.')
      .addDropdown(dropdown => dropdown
        .addOptions({
          'openrouter': 'OpenRouter',
          'ollama': 'Ollama',
          'openai_compatible': 'OpenAI-Compatible'
        })
        .setValue(this.plugin.settings.embeddings.provider)
        .onChange(async (value) => {
          if (value === 'ollama' || value === 'openai_compatible') {
            this.plugin.settings.embeddings.provider = value;
          } else {
            this.plugin.settings.embeddings.provider = 'openrouter';
          }
          await this.plugin.saveSettings(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Embedding Endpoint')
      .setDesc('Base endpoint URL (for example https://openrouter.ai/api/v1 or http://localhost:11434).')
      .addText(text => text
        .setPlaceholder('https://openrouter.ai/api/v1')
        .setValue(this.plugin.settings.embeddings.endpoint)
        .onChange(async (value) => {
          this.plugin.settings.embeddings.endpoint = value.trim();
          await this.plugin.saveSettings(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Embedding API Key')
      .setDesc('Bootstrap key for embeddings auth. LoreVault only creates missing secrets and never overwrites existing secret values; update existing keys in Obsidian Secret Storage.')
      .addText(text => {
        text
          .setPlaceholder('sk-...')
          .setValue(this.plugin.settings.embeddings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.embeddings.apiKey = value.trim();
            await this.plugin.saveSettings(this.plugin.settings);
          });
        text.inputEl.type = 'password';
      });

    new Setting(containerEl)
      .setName('Embedding API Secret Name')
      .setDesc('Secret id used for embeddings API key.')
      .addText(text => text
        .setPlaceholder('lorevault-embeddings-default')
        .setValue(this.plugin.settings.embeddings.apiKeySecretName)
        .onChange(async (value) => {
          this.plugin.settings.embeddings.apiKeySecretName = value.trim();
          await this.plugin.saveSettings(this.plugin.settings);
        }))
      .addButton(button => button
        .setButtonText('Pick Existing')
        .onClick(async () => {
          const selected = await this.pickExistingSecretId(this.plugin.settings.embeddings.apiKeySecretName);
          if (!selected) {
            return;
          }
          this.plugin.settings.embeddings.apiKeySecretName = selected;
          await this.persistSettings();
          this.display();
        }));

    new Setting(containerEl)
      .setName('Embedding Model')
      .setDesc('Embedding model identifier.')
      .addText(text => text
        .setPlaceholder('qwen/qwen3-embedding-8b')
        .setValue(this.plugin.settings.embeddings.model)
        .onChange(async (value) => {
          this.plugin.settings.embeddings.model = value.trim();
          await this.plugin.saveSettings(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Embedding Instruction')
      .setDesc('Optional instruction/prefix included in cache key and provider request.')
      .addTextArea(text => text
        .setPlaceholder('Represent this chunk for retrieval...')
        .setValue(this.plugin.settings.embeddings.instruction)
        .onChange(async (value) => {
          this.plugin.settings.embeddings.instruction = value.trim();
          await this.plugin.saveSettings(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Embedding Batch Size')
      .setDesc('Number of chunks per embedding request.')
      .addText(text => text
        .setValue(this.plugin.settings.embeddings.batchSize.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue > 0) {
            this.plugin.settings.embeddings.batchSize = numValue;
            await this.plugin.saveSettings(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Embedding Timeout (ms)')
      .setDesc('Request timeout for embedding API calls.')
      .addText(text => text
        .setValue(this.plugin.settings.embeddings.timeoutMs.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 1000) {
            this.plugin.settings.embeddings.timeoutMs = numValue;
            await this.plugin.saveSettings(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Embedding Cache Directory')
      .setDesc('Vault-relative one-file-per-hash cache directory.')
      .addText(text => text
        .setPlaceholder('.obsidian/plugins/lore-vault/cache/embeddings')
        .setValue(this.plugin.settings.embeddings.cacheDir)
        .onChange(async (value) => {
          this.plugin.settings.embeddings.cacheDir = this.normalizePathInput(value);
          await this.plugin.saveSettings(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('RAG Chunking Mode')
      .setDesc('Auto uses note-size heuristics. Note and section force deterministic strategies.')
      .addDropdown(dropdown => dropdown
        .addOptions({
          'auto': 'Auto',
          'note': 'Note',
          'section': 'Section'
        })
        .setValue(this.plugin.settings.embeddings.chunkingMode)
        .onChange(async (value) => {
          if (value === 'note' || value === 'section') {
            this.plugin.settings.embeddings.chunkingMode = value;
          } else {
            this.plugin.settings.embeddings.chunkingMode = 'auto';
          }
          await this.plugin.saveSettings(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Min Chunk Chars')
      .setDesc('Minimum target chunk size in characters.')
      .addText(text => text
        .setValue(this.plugin.settings.embeddings.minChunkChars.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 100) {
            this.plugin.settings.embeddings.minChunkChars = numValue;
            await this.plugin.saveSettings(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Max Chunk Chars')
      .setDesc('Maximum chunk size before splitting.')
      .addText(text => text
        .setValue(this.plugin.settings.embeddings.maxChunkChars.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= this.plugin.settings.embeddings.minChunkChars) {
            this.plugin.settings.embeddings.maxChunkChars = numValue;
            await this.plugin.saveSettings(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Chunk Overlap Chars')
      .setDesc('Character overlap when splitting long chunks.')
      .addText(text => text
        .setValue(this.plugin.settings.embeddings.overlapChars.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 0) {
            this.plugin.settings.embeddings.overlapChars = numValue;
            await this.plugin.saveSettings(this.plugin.settings);
          }
        }));
  }
}
