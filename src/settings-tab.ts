import { App, PluginSettingTab, Setting } from 'obsidian';
import LoreBookConverterPlugin from './main';

export class LoreBookConverterSettingTab extends PluginSettingTab {
  plugin: LoreBookConverterPlugin;

  constructor(app: App, plugin: LoreBookConverterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('lorebook-converter-settings');

    containerEl.createEl('h2', { text: 'LoreVault Settings' });

    new Setting(containerEl)
      .setName('Output Path')
      .setDesc('Path where the Lorebook JSON file will be saved')
      .addText(text => text
        .setPlaceholder(`${this.app.vault.getName()}.json`)
        .setValue(this.plugin.settings.outputPath)
        .onChange(async (value) => {
          this.plugin.settings.outputPath = value;
          await this.plugin.saveData(this.plugin.settings);
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
      .setDesc('Exact: include only exact scope tags. Cascade: include entries from child scopes too.')
      .addDropdown(dropdown => dropdown
        .addOptions({
          'exact': 'Exact',
          'cascade': 'Cascade'
        })
        .setValue(this.plugin.settings.tagScoping.membershipMode)
        .onChange(async (value) => {
          this.plugin.settings.tagScoping.membershipMode = value === 'cascade' ? 'cascade' : 'exact';
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Include Untagged Notes')
      .setDesc('If enabled, notes without lorebook tags are included in the active build.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.tagScoping.includeUntagged)
        .onChange(async (value) => {
          this.plugin.settings.tagScoping.includeUntagged = value;
          await this.plugin.saveData(this.plugin.settings);
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
  }
}
