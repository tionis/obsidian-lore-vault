import { App, Modal, Notice, Setting } from 'obsidian';

export class TemplateModal extends Modal {
  result: string;
  title: string = '';
  keywords: string = '';
  triggerMethod: string = 'selective';
  probability: number = 100;
  depth: number = 4;

  constructor(app: App) {
    super(app);
    this.result = '';
  }

  onOpen() {
    const { contentEl } = this;
    
    contentEl.createEl('h2', { text: 'Create Lorebook Entry Template' });
    
    new Setting(contentEl)
      .setName('Title')
      .setDesc('The title of your lorebook entry')
      .addText(text => text
        .setPlaceholder('Entry Title')
        .setValue(this.title)
        .onChange(value => this.title = value));
    
    new Setting(contentEl)
      .setName('Keywords')
      .setDesc('Comma-separated keywords that trigger this entry')
      .addText(text => text
        .setPlaceholder('keyword1, keyword2, keyword3')
        .setValue(this.keywords)
        .onChange(value => this.keywords = value));
    
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
    
    new Setting(contentEl)
      .setName('Probability')
      .setDesc('Chance of entry being included (0-100)')
      .addSlider(slider => slider
        .setLimits(0, 100, 1)
        .setValue(this.probability)
        .setDynamicTooltip()
        .onChange(value => this.probability = value));
    
    new Setting(contentEl)
      .setName('Depth')
      .setDesc('Scanning depth for including this entry (1-10)')
      .addSlider(slider => slider
        .setLimits(1, 10, 1)
        .setValue(this.depth)
        .setDynamicTooltip()
        .onChange(value => this.depth = value));
    
    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Generate Template')
        .setCta()
        .onClick(() => {
          this.generateTemplate();
          this.close();
        }));
  }

  generateTemplate() {
    if (!this.title) {
      new Notice('Title is required!');
      return;
    }
    
    this.result = `# Title: ${this.title}
# Keywords: ${this.keywords}
# Overview: 

# Trigger Method: ${this.triggerMethod}
# Probability: ${this.probability}
# Depth: ${this.depth}

# Content:
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

export async function createTemplate(app: App): Promise<string> {
  return new Promise((resolve, reject) => {
    const modal = new TemplateModal(app);
    
    modal.onClose = () => {
      if (modal.result) {
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
