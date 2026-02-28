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
import {
  CompletionPreset,
  DEFAULT_SETTINGS
} from './models';

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

  private async persistSettings(): Promise<void> {
    await this.plugin.saveData(this.plugin.settings);
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
      model: completion.model,
      systemPrompt: completion.systemPrompt,
      temperature: completion.temperature,
      maxOutputTokens: completion.maxOutputTokens,
      contextWindowTokens: completion.contextWindowTokens,
      promptReserveTokens: completion.promptReserveTokens,
      timeoutMs: completion.timeoutMs
    };
  }

  private applyCompletionPreset(preset: CompletionPreset): void {
    const completion = this.plugin.settings.completion;
    completion.provider = preset.provider;
    completion.endpoint = preset.endpoint;
    completion.apiKey = preset.apiKey;
    completion.model = preset.model;
    completion.systemPrompt = preset.systemPrompt;
    completion.temperature = preset.temperature;
    completion.maxOutputTokens = preset.maxOutputTokens;
    completion.contextWindowTokens = preset.contextWindowTokens;
    completion.promptReserveTokens = preset.promptReserveTokens;
    completion.timeoutMs = preset.timeoutMs;
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

    new Setting(containerEl)
      .setName('Downstream Export Path Pattern')
      .setDesc('Relative path under each lorebook output folder (SQLite Output Directory). Example: sillytavern/lorevault.json -> sillytavern/lorevault-<scope>.json and .rag.md. Use {scope} to place scope explicitly.')
      .addText(text => text
        .setPlaceholder('sillytavern/lorevault.json')
        .setValue(this.plugin.settings.outputPath)
        .onChange(async (value) => {
          this.plugin.settings.outputPath = this.normalizePathInput(value);
          await this.persistSettings();
        }));

    // Lorebook Scope section
    containerEl.createEl('h3', { text: 'Lorebook Scope' });

    new Setting(containerEl)
      .setName('Lorebook Tag Prefix')
      .setDesc('Tag namespace used to detect lorebooks (without #), e.g. lorebook')
      .addText(text => text
        .setPlaceholder('lorebook')
        .setValue(this.plugin.settings.tagScoping.tagPrefix)
        .onChange(async (value) => {
          this.plugin.settings.tagScoping.tagPrefix = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Active Scope')
      .setDesc('Optional scope path under the tag prefix, e.g. universe/yggdrasil (empty = all lorebook tags)')
      .addText(text => text
        .setPlaceholder('universe/yggdrasil')
        .setValue(this.plugin.settings.tagScoping.activeScope)
        .onChange(async (value) => {
          this.plugin.settings.tagScoping.activeScope = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Membership Mode')
      .setDesc('Exact: include only exact scope tags. Cascade: include exact scope, parent scopes, and child scopes.')
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
          await this.plugin.saveData(this.plugin.settings);
        }));
    
    new Setting(containerEl)
      .setName('Use Droste Effect')
      .setDesc('Allow lorebook entries to trigger other lorebook entries')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.defaultLoreBook.useDroste)
        .onChange(async (value) => {
          this.plugin.settings.defaultLoreBook.useDroste = value;
          await this.plugin.saveData(this.plugin.settings);
        }));
    
    new Setting(containerEl)
      .setName('Use Recursion')
      .setDesc('Allow entries to call themselves recursively')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.defaultLoreBook.useRecursion)
        .onChange(async (value) => {
          this.plugin.settings.defaultLoreBook.useRecursion = value;
          await this.plugin.saveData(this.plugin.settings);
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
            await this.plugin.saveData(this.plugin.settings);
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
            await this.plugin.saveData(this.plugin.settings);
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
        await this.plugin.saveData(this.plugin.settings);
      }
    });
    
    vectorizedRadio.addEventListener('change', async () => {
      if (vectorizedRadio.checked) {
        this.plugin.settings.defaultEntry.constant = false;
        this.plugin.settings.defaultEntry.vectorized = true;
        this.plugin.settings.defaultEntry.selective = false;
        await this.plugin.saveData(this.plugin.settings);
      }
    });
    
    selectiveRadio.addEventListener('change', async () => {
      if (selectiveRadio.checked) {
        this.plugin.settings.defaultEntry.constant = false;
        this.plugin.settings.defaultEntry.vectorized = false;
        this.plugin.settings.defaultEntry.selective = true;
        await this.plugin.saveData(this.plugin.settings);
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
          await this.plugin.saveData(this.plugin.settings);
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
          await this.plugin.saveData(this.plugin.settings);
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
          await this.plugin.saveData(this.plugin.settings);
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
          await this.plugin.saveData(this.plugin.settings);
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
              await this.plugin.saveData(this.plugin.settings);
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
      .setDesc('Write a SQLite pack per built scope.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.sqlite.enabled)
        .onChange(async (value) => {
          this.plugin.settings.sqlite.enabled = value;
          await this.persistSettings();
        }));

    let sqliteOutputInput: TextComponent | null = null;
    const sqliteOutputSetting = new Setting(containerEl)
      .setName('SQLite Output Directory')
      .setDesc('Vault-relative directory for canonical SQLite packs. Type a path or browse existing folders. LoreVault writes one <scope>.db per lorebook.')
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

    containerEl.createEl('h3', { text: 'Writing Completion' });
    containerEl.createEl('p', {
      text: 'Configure LLM generation for "Continue Story with Context".'
    });

    new Setting(containerEl)
      .setName('Active Completion Preset')
      .setDesc('Selecting a preset immediately applies provider/model/token settings.')
      .addDropdown(dropdown => {
        dropdown.addOption('', '(none)');
        const sortedPresets = [...this.plugin.settings.completion.presets]
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        for (const preset of sortedPresets) {
          dropdown.addOption(preset.id, preset.name);
        }
        dropdown.setValue(this.plugin.settings.completion.activePresetId || '');
        dropdown.onChange(async (value) => {
          const activeId = value.trim();
          if (!activeId) {
            this.plugin.settings.completion.activePresetId = '';
            await this.persistSettings();
            return;
          }

          const preset = this.plugin.settings.completion.presets.find(item => item.id === activeId);
          if (!preset) {
            new Notice('Preset not found.');
            return;
          }

          this.applyCompletionPreset(preset);
          this.plugin.settings.completion.activePresetId = preset.id;
          await this.persistSettings();
          this.display();
        });
      });

    const presetActions = new Setting(containerEl)
      .setName('Preset Actions')
      .setDesc('Save current completion settings as a new preset, update the active preset, or remove it.');

    presetActions.addButton(button => button
      .setButtonText('Save As New')
      .onClick(async () => {
        const defaultName = `${this.plugin.settings.completion.provider} · ${this.plugin.settings.completion.model}`;
        const name = await this.requestPresetName('Save Completion Preset', defaultName, 'Save');
        if (!name) {
          return;
        }

        const preset = this.snapshotCurrentCompletion(name);
        this.plugin.settings.completion.presets = [
          ...this.plugin.settings.completion.presets,
          preset
        ];
        this.plugin.settings.completion.activePresetId = preset.id;
        await this.persistSettings();
        new Notice(`Saved preset: ${name}`);
        this.display();
      }));

    presetActions.addButton(button => button
      .setButtonText('Update Active')
      .onClick(async () => {
        const activePresetId = this.plugin.settings.completion.activePresetId;
        if (!activePresetId) {
          new Notice('No active preset selected.');
          return;
        }

        const index = this.plugin.settings.completion.presets.findIndex(item => item.id === activePresetId);
        if (index < 0) {
          new Notice('Active preset no longer exists.');
          return;
        }

        const existing = this.plugin.settings.completion.presets[index];
        const name = await this.requestPresetName('Update Completion Preset', existing.name, 'Update');
        if (!name) {
          return;
        }

        this.plugin.settings.completion.presets[index] = this.snapshotCurrentCompletion(name, existing.id);
        this.plugin.settings.completion.activePresetId = existing.id;
        await this.persistSettings();
        new Notice(`Updated preset: ${name}`);
        this.display();
      }));

    presetActions.addButton(button => button
      .setButtonText('Delete Active')
      .onClick(async () => {
        const activePresetId = this.plugin.settings.completion.activePresetId;
        if (!activePresetId) {
          new Notice('No active preset selected.');
          return;
        }

        const existing = this.plugin.settings.completion.presets.find(item => item.id === activePresetId);
        if (!existing) {
          new Notice('Active preset no longer exists.');
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
          .filter(item => item.id !== activePresetId);
        this.plugin.settings.completion.activePresetId = '';
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
          await this.plugin.saveData(this.plugin.settings);
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
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Completion Endpoint')
      .setDesc('Base endpoint URL (for example https://openrouter.ai/api/v1 or http://localhost:11434).')
      .addText(text => text
        .setPlaceholder('https://openrouter.ai/api/v1')
        .setValue(this.plugin.settings.completion.endpoint)
        .onChange(async (value) => {
          this.plugin.settings.completion.endpoint = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Completion API Key')
      .setDesc('API key for provider auth (not required for local Ollama).')
      .addText(text => text
        .setPlaceholder('sk-...')
        .setValue(this.plugin.settings.completion.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.completion.apiKey = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Completion Model')
      .setDesc('Model identifier used for continuation generation.')
      .addText(text => text
        .setPlaceholder('openai/gpt-4o-mini')
        .setValue(this.plugin.settings.completion.model)
        .onChange(async (value) => {
          this.plugin.settings.completion.model = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('System Prompt')
      .setDesc('Instruction that controls writing style and behavior.')
      .addTextArea(text => text
        .setValue(this.plugin.settings.completion.systemPrompt)
        .onChange(async (value) => {
          this.plugin.settings.completion.systemPrompt = value.trim();
          await this.plugin.saveData(this.plugin.settings);
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
            await this.plugin.saveData(this.plugin.settings);
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
            await this.plugin.saveData(this.plugin.settings);
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
            await this.plugin.saveData(this.plugin.settings);
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
            await this.plugin.saveData(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Completion Timeout (ms)')
      .setDesc('Request timeout for completion API calls.')
      .addText(text => text
        .setValue(this.plugin.settings.completion.timeoutMs.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 1000) {
            this.plugin.settings.completion.timeoutMs = numValue;
            await this.plugin.saveData(this.plugin.settings);
          }
        }));

    containerEl.createEl('h3', { text: 'Text Commands' });
    containerEl.createEl('p', {
      text: 'Prompt-driven rewrite/reformat commands for selected editor text.'
    });

    new Setting(containerEl)
      .setName('Auto-Accept Text Command Edits')
      .setDesc('If enabled, generated edits are applied without review modal confirmation.')
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
      .setDesc('Create default prompt notes in the configured folder (existing files are not overwritten).')
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
          await this.plugin.saveData(this.plugin.settings);
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
            await this.plugin.saveData(this.plugin.settings);
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
            await this.plugin.saveData(this.plugin.settings);
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
            await this.plugin.saveData(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Include Backlinks in Graph Expansion')
      .setDesc('Allow reverse-edge expansion so notes that link to matched entities can also be selected.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.retrieval.includeBacklinksInGraphExpansion)
        .onChange(async (value) => {
          this.plugin.settings.retrieval.includeBacklinksInGraphExpansion = value;
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Enable Tool Retrieval Hooks')
      .setDesc('Allow model-driven retrieval calls (`search_entries`, `expand_neighbors`, `get_entry`) during generation.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.retrieval.toolCalls.enabled)
        .onChange(async (value) => {
          this.plugin.settings.retrieval.toolCalls.enabled = value;
          await this.plugin.saveData(this.plugin.settings);
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
            await this.plugin.saveData(this.plugin.settings);
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
            await this.plugin.saveData(this.plugin.settings);
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
            await this.plugin.saveData(this.plugin.settings);
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
            await this.plugin.saveData(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Summary Max Output Chars')
      .setDesc('Hard cap for normalized generated summary text.')
      .addText(text => text
        .setValue(this.plugin.settings.summaries.maxSummaryChars.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 80) {
            this.plugin.settings.summaries.maxSummaryChars = numValue;
            await this.plugin.saveData(this.plugin.settings);
          }
        }));

    containerEl.createEl('h3', { text: 'Cost Tracking (Experimental)' });

    new Setting(containerEl)
      .setName('Enable Cost Tracking')
      .setDesc('Capture completion usage (tokens/cost metadata) into a local ledger file.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.costTracking.enabled)
        .onChange(async (value) => {
          this.plugin.settings.costTracking.enabled = value;
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Usage Ledger Path')
      .setDesc('Path to usage ledger JSON file inside your vault.')
      .addText(text => text
        .setPlaceholder('.obsidian/plugins/lore-vault/cache/usage-ledger.json')
        .setValue(this.plugin.settings.costTracking.ledgerPath)
        .onChange(async (value) => {
          this.plugin.settings.costTracking.ledgerPath = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Default Input Cost / 1M Tokens (USD)')
      .setDesc('Fallback input-token pricing used when provider does not return cost.')
      .addText(text => text
        .setValue(this.plugin.settings.costTracking.defaultInputCostPerMillionUsd.toString())
        .onChange(async (value) => {
          const numValue = Number(value);
          if (!Number.isNaN(numValue) && numValue >= 0) {
            this.plugin.settings.costTracking.defaultInputCostPerMillionUsd = numValue;
            await this.plugin.saveData(this.plugin.settings);
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
            await this.plugin.saveData(this.plugin.settings);
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
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Daily Budget Warning (USD)')
      .setDesc('Warn in manager panel when known daily (UTC) cost exceeds this amount. Set 0 to disable.')
      .addText(text => text
        .setValue(this.plugin.settings.costTracking.dailyBudgetUsd.toString())
        .onChange(async (value) => {
          const numValue = Number(value);
          if (!Number.isNaN(numValue) && numValue >= 0) {
            this.plugin.settings.costTracking.dailyBudgetUsd = numValue;
            await this.plugin.saveData(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Session Budget Warning (USD)')
      .setDesc('Warn in manager panel when known session cost exceeds this amount. Set 0 to disable.')
      .addText(text => text
        .setValue(this.plugin.settings.costTracking.sessionBudgetUsd.toString())
        .onChange(async (value) => {
          const numValue = Number(value);
          if (!Number.isNaN(numValue) && numValue >= 0) {
            this.plugin.settings.costTracking.sessionBudgetUsd = numValue;
            await this.plugin.saveData(this.plugin.settings);
          }
        }));

    containerEl.createEl('h3', { text: 'Embeddings & Semantic RAG' });

    new Setting(containerEl)
      .setName('Enable Embeddings')
      .setDesc('Generate and cache embeddings for RAG chunks.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.embeddings.enabled)
        .onChange(async (value) => {
          this.plugin.settings.embeddings.enabled = value;
          await this.plugin.saveData(this.plugin.settings);
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
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Embedding Endpoint')
      .setDesc('Base endpoint URL (for example https://openrouter.ai/api/v1 or http://localhost:11434).')
      .addText(text => text
        .setPlaceholder('https://openrouter.ai/api/v1')
        .setValue(this.plugin.settings.embeddings.endpoint)
        .onChange(async (value) => {
          this.plugin.settings.embeddings.endpoint = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Embedding API Key')
      .setDesc('API key for provider auth (if required).')
      .addText(text => text
        .setPlaceholder('sk-...')
        .setValue(this.plugin.settings.embeddings.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.embeddings.apiKey = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Embedding Model')
      .setDesc('Embedding model identifier.')
      .addText(text => text
        .setPlaceholder('qwen/qwen3-embedding-8b')
        .setValue(this.plugin.settings.embeddings.model)
        .onChange(async (value) => {
          this.plugin.settings.embeddings.model = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Embedding Instruction')
      .setDesc('Optional instruction/prefix included in cache key and provider request.')
      .addTextArea(text => text
        .setPlaceholder('Represent this chunk for retrieval...')
        .setValue(this.plugin.settings.embeddings.instruction)
        .onChange(async (value) => {
          this.plugin.settings.embeddings.instruction = value.trim();
          await this.plugin.saveData(this.plugin.settings);
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
            await this.plugin.saveData(this.plugin.settings);
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
            await this.plugin.saveData(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Embedding Cache Directory')
      .setDesc('One-file-per-hash cache directory (relative to vault root or absolute path).')
      .addText(text => text
        .setPlaceholder('.obsidian/plugins/lore-vault/cache/embeddings')
        .setValue(this.plugin.settings.embeddings.cacheDir)
        .onChange(async (value) => {
          this.plugin.settings.embeddings.cacheDir = value.trim();
          await this.plugin.saveData(this.plugin.settings);
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
          await this.plugin.saveData(this.plugin.settings);
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
            await this.plugin.saveData(this.plugin.settings);
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
            await this.plugin.saveData(this.plugin.settings);
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
            await this.plugin.saveData(this.plugin.settings);
          }
        }));
  }
}
