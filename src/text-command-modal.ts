import { App, Modal, Setting } from 'obsidian';
import { TextCommandPromptTemplate } from './models';

export interface TextCommandPromptSelectionResult {
  action: 'cancel' | 'run';
  promptId: string;
  promptName: string;
  promptText: string;
  includeLorebookContext: boolean;
}

interface TextCommandPromptModalOptions {
  templates: TextCommandPromptTemplate[];
  defaultIncludeLorebookContext: boolean;
  selectedTextPreview: string;
}

const CUSTOM_PROMPT_ID = '__custom__';

export class TextCommandPromptModal extends Modal {
  private readonly options: TextCommandPromptModalOptions;
  private readonly templatesById: Map<string, TextCommandPromptTemplate>;
  private resolveResult: ((value: TextCommandPromptSelectionResult) => void) | null = null;
  private settled = false;
  private selectedPromptId: string;
  private promptText: string;
  private promptName: string;
  private includeLorebookContext: boolean;

  constructor(app: App, options: TextCommandPromptModalOptions) {
    super(app);
    this.options = options;
    this.templatesById = new Map(options.templates.map(template => [template.id, template]));

    const firstTemplate = options.templates[0];
    this.selectedPromptId = firstTemplate?.id ?? CUSTOM_PROMPT_ID;
    this.promptText = firstTemplate?.prompt ?? '';
    this.promptName = firstTemplate?.name ?? 'Custom Prompt';
    this.includeLorebookContext = firstTemplate?.includeLorebookContext ?? options.defaultIncludeLorebookContext;
  }

  waitForResult(): Promise<TextCommandPromptSelectionResult> {
    return new Promise(resolve => {
      this.resolveResult = resolve;
    });
  }

  onOpen(): void {
    this.modalEl.addClass('lorevault-text-command-modal-shell');
    this.setTitle('LoreVault Text Command');
    this.contentEl.empty();
    this.contentEl.addClass('lorevault-text-command-modal');

    this.contentEl.createEl('p', {
      text: 'Select or edit a prompt, then run the command on the current text selection.'
    });
    if (this.options.selectedTextPreview) {
      const preview = this.contentEl.createEl('pre', { cls: 'lorevault-text-command-selection-preview' });
      preview.setText(this.options.selectedTextPreview);
    }

    new Setting(this.contentEl)
      .setName('Prompt Template')
      .setDesc('Choose a stored template or switch to custom prompt text.')
      .addDropdown(dropdown => {
        for (const template of this.options.templates) {
          dropdown.addOption(template.id, template.name);
        }
        dropdown.addOption(CUSTOM_PROMPT_ID, 'Custom');
        dropdown.setValue(this.selectedPromptId);
        dropdown.onChange(value => {
          if (value === CUSTOM_PROMPT_ID) {
            this.selectedPromptId = CUSTOM_PROMPT_ID;
            this.promptName = 'Custom Prompt';
            return;
          }
          const template = this.templatesById.get(value);
          if (!template) {
            return;
          }
          this.selectedPromptId = template.id;
          this.promptName = template.name;
          this.promptText = template.prompt;
          this.includeLorebookContext = template.includeLorebookContext;
          this.render();
        });
      });

    const promptSetting = new Setting(this.contentEl)
      .setName('Prompt')
      .setDesc('Instruction passed to the model along with selected text.');
    promptSetting.addTextArea(text => {
      text.inputEl.rows = Math.min(14, Math.max(7, Math.ceil(this.promptText.length / 120)));
      text
        .setPlaceholder('Rewrite this text for clarity while preserving meaning.')
        .setValue(this.promptText)
        .onChange(value => {
          this.promptText = value;
        });
    });

    new Setting(this.contentEl)
      .setName('Include Lorebook Context')
      .setDesc('When enabled, LoreVault retrieves context for the selected text before rewriting.')
      .addToggle(toggle => {
        toggle
          .setValue(this.includeLorebookContext)
          .onChange(value => {
            this.includeLorebookContext = value;
          });
      });

    const actions = this.contentEl.createDiv({ cls: 'lorevault-summary-actions' });
    const cancelButton = actions.createEl('button', { text: 'Cancel' });
    cancelButton.addEventListener('click', () => {
      this.finish({
        action: 'cancel',
        promptId: this.selectedPromptId,
        promptName: this.promptName,
        promptText: this.promptText.trim(),
        includeLorebookContext: this.includeLorebookContext
      });
      this.close();
    });

    const runButton = actions.createEl('button', { text: 'Run Text Command' });
    runButton.addClass('mod-cta');
    runButton.addEventListener('click', () => {
      const promptText = this.promptText.trim();
      if (!promptText) {
        return;
      }
      this.finish({
        action: 'run',
        promptId: this.selectedPromptId,
        promptName: this.promptName,
        promptText,
        includeLorebookContext: this.includeLorebookContext
      });
      this.close();
    });
  }

  onClose(): void {
    this.modalEl.removeClass('lorevault-text-command-modal-shell');
    this.contentEl.empty();
    this.finish({
      action: 'cancel',
      promptId: this.selectedPromptId,
      promptName: this.promptName,
      promptText: this.promptText.trim(),
      includeLorebookContext: this.includeLorebookContext
    });
  }

  private finish(result: TextCommandPromptSelectionResult): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.resolveResult?.(result);
  }

  private render(): void {
    this.onOpen();
  }
}
