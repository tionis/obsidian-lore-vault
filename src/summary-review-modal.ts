import { App, Modal, Notice, Setting } from 'obsidian';
import { GeneratedSummaryMode } from './summary-utils';

export interface SummaryReviewResult {
  action: 'cancel' | 'cache' | 'frontmatter';
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
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-summary-modal');
    contentEl.createEl('h2', { text: `${modeLabel(this.mode)} Summary Review` });
    contentEl.createEl('p', { text: `Note: ${this.notePath}` });

    if (this.existingSummary.trim()) {
      const existing = contentEl.createDiv({ cls: 'lorevault-summary-existing' });
      existing.createEl('h3', { text: 'Existing Frontmatter Summary' });
      existing.createEl('p', { text: this.existingSummary });
    }

    new Setting(contentEl)
      .setName('Proposed Summary')
      .setDesc('Review and edit before accepting.');
    const textarea = contentEl.createEl('textarea', { cls: 'lorevault-summary-textarea' });
    textarea.value = this.summaryText;
    textarea.addEventListener('input', () => {
      this.summaryText = textarea.value;
    });

    const actions = contentEl.createDiv({ cls: 'lorevault-summary-actions' });

    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => {
      this.finish({ action: 'cancel', summaryText: this.summaryText.trim() });
    });

    actions.createEl('button', { text: 'Approve Cache' }).addEventListener('click', () => {
      const normalized = this.summaryText.trim();
      if (!normalized) {
        new Notice('Summary is empty.');
        return;
      }
      this.finish({ action: 'cache', summaryText: normalized });
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
