import { App, Modal } from 'obsidian';
import { buildTextCommandDiffPreview } from './text-command-diff';
import { renderSourceDiffPreview } from './source-diff-view';

export interface TextCommandReviewResult {
  action: 'cancel' | 'apply';
  revisedText: string;
}

export interface TextCommandReviewModalOptions {
  title?: string;
  promptLabel?: string | null;
  showOriginalText?: boolean;
  originalTextLabel?: string;
  showEditedText?: boolean;
  editedTextLabel?: string;
  applyButtonText?: string;
  compactDiffStats?: boolean;
}

export class TextCommandReviewModal extends Modal {
  private readonly originalText: string;
  private revisedText: string;
  private readonly promptName: string;
  private readonly options: TextCommandReviewModalOptions;
  private resolveResult: ((result: TextCommandReviewResult) => void) | null = null;
  private settled = false;

  constructor(
    app: App,
    originalText: string,
    revisedText: string,
    promptName: string,
    options: TextCommandReviewModalOptions = {}
  ) {
    super(app);
    this.originalText = originalText;
    this.revisedText = revisedText;
    this.promptName = promptName;
    this.options = options;
  }

  waitForResult(): Promise<TextCommandReviewResult> {
    return new Promise(resolve => {
      this.resolveResult = resolve;
    });
  }

  onOpen(): void {
    this.modalEl.addClass('lorevault-summary-modal-shell');
    this.setTitle(this.options.title?.trim() || 'Review Text Command Edit');
    this.contentEl.empty();
    this.contentEl.addClass('lorevault-summary-modal');

    const promptLabel = this.options.promptLabel;
    const showPromptLabel = promptLabel !== null && promptLabel !== undefined;
    if (showPromptLabel) {
      this.contentEl.createEl('p', {
        text: promptLabel?.trim() || `Prompt: ${this.promptName}`
      });
    }

    const diffStatsClasses = ['lorevault-text-command-review-diff-stats'];
    if (this.options.compactDiffStats) {
      diffStatsClasses.push('is-compact');
    }
    const diffStats = this.contentEl.createEl('p', { cls: diffStatsClasses.join(' ') });
    const diffRoot = this.contentEl.createDiv();
    const renderDiff = (): void => {
      const diff = buildTextCommandDiffPreview(this.originalText, this.revisedText);
      diffStats.setText(`Diff: +${diff.addedLines} / -${diff.removedLines}${diff.truncated ? ' (truncated)' : ''}`);
      renderSourceDiffPreview(diffRoot, diff);
    };
    renderDiff();

    const showOriginalText = this.options.showOriginalText ?? true;
    if (showOriginalText) {
      const existing = this.contentEl.createDiv({ cls: 'lorevault-summary-existing' });
      existing.createEl('h4', { text: this.options.originalTextLabel?.trim() || 'Original Selection' });
      const existingTextarea = existing.createEl('textarea', {
        cls: 'lorevault-summary-textarea lorevault-summary-textarea-existing'
      });
      existingTextarea.value = this.originalText;
      existingTextarea.readOnly = true;
    }

    const showEditedText = this.options.showEditedText ?? true;
    if (showEditedText) {
      this.contentEl.createEl('h4', {
        text: this.options.editedTextLabel?.trim() || 'Edited Text (will replace selection)'
      });
      const revisedTextarea = this.contentEl.createEl('textarea', { cls: 'lorevault-summary-textarea' });
      revisedTextarea.value = this.revisedText;
      revisedTextarea.rows = Math.min(18, Math.max(8, Math.ceil(this.revisedText.length / 120)));
      revisedTextarea.addEventListener('input', () => {
        this.revisedText = revisedTextarea.value;
        renderDiff();
      });
    }

    const actions = this.contentEl.createDiv({ cls: 'lorevault-summary-actions' });
    const cancelButton = actions.createEl('button', { text: 'Cancel' });
    cancelButton.addEventListener('click', () => {
      this.finish({ action: 'cancel', revisedText: this.revisedText });
      this.close();
    });

    const applyButton = actions.createEl('button', { text: this.options.applyButtonText?.trim() || 'Apply Edit' });
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
