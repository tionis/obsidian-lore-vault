import { App, Modal, Setting, Notice } from 'obsidian';
import { ConverterSettings, DEFAULT_SETTINGS } from './models';

export class TemplateModal extends Modal {
  result: string = '';
  title: string = '';
  keywords: string = '';
  overview: string = '';
  triggerMethod: string = 'selective';
  probability: number = 75;
  depth: number = 4;
  isSubmitted: boolean = false;
  settings: ConverterSettings;

  constructor(app: App, settings: ConverterSettings) {
    super(app);
    this.settings = settings;
    
    // Initialize with default values from settings
    if (settings.defaultEntry.constant) {
      this.triggerMethod = 'constant';
    } else if (settings.defaultEntry.vectorized) {
      this.triggerMethod = 'vectorized';
    } else {
      this.triggerMethod = 'selective';
    }
    
    this.probability = settings.defaultEntry.probability;
    this.depth = settings.defaultEntry.depth;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('lorebook-template-modal');
    
    contentEl.createEl('h2', { text: 'Create Lorebook Entry Template' });
    
    // Title field
    new Setting(contentEl)
      .setName('Title')
      .setDesc('The title of your lorebook entry')
      .addText(text => text
        .setPlaceholder('Entry Title')
        .setValue(this.title)
        .onChange(value => this.title = value));
    
    // Keywords field
    new Setting(contentEl)
      .setName('Keywords')
      .setDesc('Comma-separated keywords that trigger this entry')
      .addText(text => text
        .setPlaceholder('keyword1, keyword2, keyword3')
        .setValue(this.keywords)
        .onChange(value => this.keywords = value));
    
    // Overview field
    new Setting(contentEl)
      .setName('Overview')
      .setDesc('A brief description of this entry (optional)')
      .addTextArea(text => text
        .setPlaceholder('Brief description of this entry...')
        .setValue(this.overview)
        .onChange(value => this.overview = value));
    
    // Trigger method dropdown
    new Setting(contentEl)
      .setName('Trigger Method')
      .setDesc('How this entry is triggered in the AI')
      .addDropdown(dropdown => dropdown
        .addOptions({
          'selective': 'Selective',
          'constant': 'Constant',
          'vectorized': 'Vectorized'
        })
        .setValue(this.triggerMethod)
        .onChange(value => this.triggerMethod = value));
    
    // Probability slider
    new Setting(contentEl)
      .setName('Probability')
      .setDesc('Chance of entry being included (0-100)')
      .addSlider(slider => slider
        .setLimits(0, 100, 1)
        .setValue(this.probability)
        .setDynamicTooltip()
        .onChange(value => this.probability = value));
    
    // Depth slider
    new Setting(contentEl)
      .setName('Depth')
      .setDesc('Scanning depth for including this entry (1-10)')
      .addSlider(slider => slider
        .setLimits(1, 10, 1)
        .setValue(this.depth)
        .setDynamicTooltip()
        .onChange(value => this.depth = value));
    
    // Buttons
    const buttonContainer = contentEl.createDiv({ cls: 'lorebook-template-buttons' });
    
    // Cancel button
    buttonContainer.createEl('button', {
      text: 'Cancel',
      cls: 'lorebook-template-button-cancel'
    }).addEventListener('click', () => {
      this.close();
    });
    
    // Create button
    buttonContainer.createEl('button', {
      text: 'Create Template',
      cls: 'lorebook-template-button-create'
    }).addEventListener('click', () => {
      if (!this.title) {
        new Notice('Title is required!');
        return;
      }
      
      this.isSubmitted = true;
      this.generateTemplate();
      this.close();
    });
  }

  generateTemplate() {
    const keywords = this.keywords
      .split(',')
      .map(keyword => keyword.trim())
      .filter(keyword => keyword.length > 0);

    const keywordBlock = keywords.length > 0
      ? keywords.map(keyword => `  - "${keyword.replace(/"/g, '\\"')}"`).join('\n')
      : '  - ""';

    const selectiveLogicLine = this.triggerMethod === 'selective'
      ? `selectiveLogic: ${this.settings.defaultEntry.selectiveLogic}\n`
      : '';

    const summaryLine = this.overview.trim()
      ? `summary: "${this.overview.trim().replace(/"/g, '\\"')}"\n`
      : '';

    this.result = `---
lorebook: true
title: "${this.title.replace(/"/g, '\\"')}"
keywords:
${keywordBlock}
${summaryLine}trigger_method: ${this.triggerMethod}
probability: ${this.probability}
depth: ${this.depth}
${selectiveLogicLine}---
Enter your content here...

## Additional Notes
- Add relevant information
- Include any related concepts
- Link to related entries using [[Wiki Links]]
`;
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export async function createTemplate(app: App, settings?: ConverterSettings): Promise<string> {
  return new Promise((resolve, reject) => {
    // Get plugin settings if not provided
    let pluginSettings: ConverterSettings;
    
    if (!settings) {
      // Try to get the plugin instance
      const plugin = (app as any).plugins.plugins['lorebook-converter'];
      if (plugin && plugin.settings) {
        pluginSettings = plugin.settings;
      } else {
        // Fallback to default settings
        pluginSettings = DEFAULT_SETTINGS;
      }
    } else {
      pluginSettings = settings;
    }
    
    const modal = new TemplateModal(app, pluginSettings);
    
    modal.onClose = () => {
      if (modal.isSubmitted && modal.result) {
        resolve(modal.result);
      } else {
        reject('Template creation cancelled');
      }
      const { contentEl } = modal;
      contentEl.empty();
    };
    
    modal.open();
  });
}
