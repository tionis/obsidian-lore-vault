import { App, Modal } from 'obsidian';
import { buildTextCommandDiffPreview } from './text-command-diff';

export interface TextCommandReviewResult {
  action: 'cancel' | 'apply';
  revisedText: string;
}

export class TextCommandReviewModal extends Modal {
  private readonly originalText: string;
  private revisedText: string;
  private readonly promptName: string;
  private resolveResult: ((result: TextCommandReviewResult) => void) | null = null;
  private settled = false;

  constructor(app: App, originalText: string, revisedText: string, promptName: string) {
    super(app);
    this.originalText = originalText;
    this.revisedText = revisedText;
    this.promptName = promptName;
  }

  waitForResult(): Promise<TextCommandReviewResult> {
    return new Promise(resolve => {
      this.resolveResult = resolve;
    });
  }

  onOpen(): void {
    this.modalEl.addClass('lorevault-summary-modal-shell');
    this.setTitle('Review Text Command Edit');
    this.contentEl.empty();
    this.contentEl.addClass('lorevault-summary-modal');
    this.contentEl.createEl('p', {
      text: `Prompt: ${this.promptName}`
    });

    const diff = buildTextCommandDiffPreview(this.originalText, this.revisedText);
    this.contentEl.createEl('p', {
      text: `Diff: +${diff.addedLines} / -${diff.removedLines}${diff.truncated ? ' (truncated)' : ''}`
    });
    const diffDetails = this.contentEl.createEl('details');
    diffDetails.createEl('summary', {
      text: `Diff Preview${diff.truncated ? ' (truncated)' : ''}`
    });
    diffDetails.createEl('pre', {
      text: diff.preview
    });

    const existing = this.contentEl.createDiv({ cls: 'lorevault-summary-existing' });
    existing.createEl('h4', { text: 'Original Selection' });
    const existingTextarea = existing.createEl('textarea', {
      cls: 'lorevault-summary-textarea lorevault-summary-textarea-existing'
    });
    existingTextarea.value = this.originalText;
    existingTextarea.readOnly = true;

    this.contentEl.createEl('h4', { text: 'Edited Text (will replace selection)' });
    const revisedTextarea = this.contentEl.createEl('textarea', { cls: 'lorevault-summary-textarea' });
    revisedTextarea.value = this.revisedText;
    revisedTextarea.rows = Math.min(18, Math.max(8, Math.ceil(this.revisedText.length / 120)));
    revisedTextarea.addEventListener('input', () => {
      this.revisedText = revisedTextarea.value;
    });

    const actions = this.contentEl.createDiv({ cls: 'lorevault-summary-actions' });
    const cancelButton = actions.createEl('button', { text: 'Cancel' });
    cancelButton.addEventListener('click', () => {
      this.finish({ action: 'cancel', revisedText: this.revisedText });
      this.close();
    });

    const applyButton = actions.createEl('button', { text: 'Apply Edit' });
    applyButton.addClass('mod-cta');
    applyButton.addEventListener('click', () => {
      this.finish({ action: 'apply', revisedText: this.revisedText });
      this.close();
    });
  }

  onClose(): void {
    this.modalEl.removeClass('lorevault-summary-modal-shell');
    this.contentEl.empty();
    this.finish({ action: 'cancel', revisedText: this.revisedText });
  }

  private finish(result: TextCommandReviewResult): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.resolveResult?.(result);
  }
}
