import { Modal } from 'obsidian';

export interface InlineDirectiveInsertRequest {
  action: 'cancel' | 'insert';
  instruction: string;
}

export class InlineDirectiveInsertModal extends Modal {
  private resolver: ((value: InlineDirectiveInsertRequest) => void) | null = null;
  private instructionInput!: HTMLTextAreaElement;
  private resolved = false;
  private initialInstruction: string;

  constructor(app: Modal['app'], initialInstruction = '') {
    super(app);
    this.initialInstruction = initialInstruction.trim();
  }

  waitForResult(): Promise<InlineDirectiveInsertRequest> {
    return new Promise(resolve => {
      this.resolver = resolve;
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Insert Inline Directive' });
    contentEl.createEl('p', {
      text: 'Insert a strict LoreVault directive in HTML comment syntax: <!-- LV: ... -->'
    });

    this.instructionInput = contentEl.createEl('textarea');
    this.instructionInput.rows = 4;
    this.instructionInput.style.width = '100%';
    this.instructionInput.placeholder = 'Example: Keep dialogue tense and end on a cliffhanger.';
    this.instructionInput.value = this.initialInstruction;

    const buttonRow = contentEl.createDiv({ cls: 'modal-button-container' });
    buttonRow.createEl('button', { text: 'Cancel' }).addEventListener('click', () => {
      this.resolveAndClose({
        action: 'cancel',
        instruction: ''
      });
    });
    buttonRow.createEl('button', { text: 'Insert', cls: 'mod-cta' }).addEventListener('click', () => {
      this.resolveAndClose({
        action: 'insert',
        instruction: this.instructionInput.value.trim()
      });
    });

    queueMicrotask(() => this.instructionInput.focus());
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolveAndClose({
        action: 'cancel',
        instruction: ''
      });
    }
  }

  private resolveAndClose(result: InlineDirectiveInsertRequest): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolver?.(result);
    this.resolver = null;
    this.close();
  }
}
