import { App, Modal, Notice, Setting } from 'obsidian';
import { GeneratedSummaryMode } from './summary-utils';

export interface SummaryReviewResult {
  action: 'cancel' | 'frontmatter';
  summaryText: string;
}

function modeLabel(mode: GeneratedSummaryMode): string {
  return mode === 'chapter' ? 'Chapter' : 'World Info';
}

export class SummaryReviewModal extends Modal {
  private readonly mode: GeneratedSummaryMode;
  private readonly notePath: string;
  private readonly existingSummary: string;
  private summaryText: string;
  private resolver: (result: SummaryReviewResult) => void;
  private resolved = false;

  constructor(
    app: App,
    mode: GeneratedSummaryMode,
    notePath: string,
    proposedSummary: string,
    existingSummary: string,
    resolver: (result: SummaryReviewResult) => void
  ) {
    super(app);
    this.mode = mode;
    this.notePath = notePath;
    this.summaryText = proposedSummary;
    this.existingSummary = existingSummary;
    this.resolver = resolver;
  }

  onOpen(): void {
    this.modalEl.addClass('lorevault-summary-modal-shell');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-summary-modal');
    contentEl.createEl('h2', { text: `${modeLabel(this.mode)} Summary Review` });
    contentEl.createEl('p', { text: `Note: ${this.notePath}` });

    if (this.existingSummary.trim()) {
      const existing = contentEl.createDiv({ cls: 'lorevault-summary-existing' });
      existing.createEl('h3', { text: 'Existing Frontmatter Summary' });
      const existingTextarea = existing.createEl('textarea', { cls: 'lorevault-summary-textarea lorevault-summary-textarea-existing' });
      existingTextarea.readOnly = true;
      existingTextarea.value = this.existingSummary;
      existingTextarea.rows = Math.min(10, Math.max(4, Math.ceil(this.existingSummary.length / 120)));
    }

    new Setting(contentEl)
      .setName('Proposed Summary')
      .setDesc('Review and edit before accepting.');
    const textarea = contentEl.createEl('textarea', { cls: 'lorevault-summary-textarea' });
    textarea.value = this.summaryText;
    textarea.rows = Math.min(14, Math.max(8, Math.ceil(this.summaryText.length / 120)));
    textarea.addEventListener('input', () => {
      this.summaryText = textarea.value;
    });

    const actions = contentEl.createDiv({ cls: 'lorevault-summary-actions' });

    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => {
      this.finish({ action: 'cancel', summaryText: this.summaryText.trim() });
    });

    actions.createEl('button', { text: 'Write Frontmatter Summary' }).addEventListener('click', () => {
      const normalized = this.summaryText.trim();
      if (!normalized) {
        new Notice('Summary is empty.');
        return;
      }
      this.finish({ action: 'frontmatter', summaryText: normalized });
    });
  }

  private finish(result: SummaryReviewResult): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolver(result);
    this.close();
  }

  onClose(): void {
    this.modalEl.removeClass('lorevault-summary-modal-shell');
    if (!this.resolved) {
      this.resolved = true;
      this.resolver({
        action: 'cancel',
        summaryText: this.summaryText.trim()
      });
    }
    this.contentEl.empty();
  }
}
