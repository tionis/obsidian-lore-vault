import { App, Modal, Notice, Setting } from 'obsidian';
import { parseGeneratedKeywords } from './keyword-utils';

export interface KeywordReviewResult {
  action: 'cancel' | 'apply';
  keywords: string[];
}

export class KeywordReviewModal extends Modal {
  private readonly notePath: string;
  private readonly existingKeywords: string[];
  private draftText: string;
  private readonly resolver: (result: KeywordReviewResult) => void;
  private resolved = false;

  constructor(
    app: App,
    notePath: string,
    existingKeywords: string[],
    proposedKeywords: string[],
    resolver: (result: KeywordReviewResult) => void
  ) {
    super(app);
    this.notePath = notePath;
    this.existingKeywords = [...existingKeywords];
    this.draftText = [...proposedKeywords].join('\n');
    this.resolver = resolver;
  }

  onOpen(): void {
    this.modalEl.addClass('lorevault-summary-modal-shell');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-summary-modal');
    contentEl.createEl('h2', { text: 'Keyword Review' });
    contentEl.createEl('p', { text: `Note: ${this.notePath}` });

    if (this.existingKeywords.length > 0) {
      const existing = contentEl.createDiv({ cls: 'lorevault-summary-existing' });
      existing.createEl('h3', { text: 'Existing Keywords' });
      existing.createEl('p', {
        text: this.existingKeywords.join(', ')
      });
    }

    new Setting(contentEl)
      .setName('Proposed Keywords')
      .setDesc('Edit before applying. One keyword per line or comma-separated list.');
    const textarea = contentEl.createEl('textarea', { cls: 'lorevault-summary-textarea' });
    textarea.value = this.draftText;
    textarea.rows = Math.max(8, Math.min(14, this.draftText.split('\n').length + 2));
    textarea.addEventListener('input', () => {
      this.draftText = textarea.value;
    });

    const actions = contentEl.createDiv({ cls: 'lorevault-summary-actions' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => {
      this.finish({ action: 'cancel', keywords: [] });
    });

    actions.createEl('button', { text: 'Apply Keywords' }).addEventListener('click', () => {
      const keywords = parseGeneratedKeywords(this.draftText);
      if (keywords.length === 0) {
        new Notice('No valid keywords found.');
        return;
      }
      this.finish({ action: 'apply', keywords });
    });
  }

  onClose(): void {
    this.modalEl.removeClass('lorevault-summary-modal-shell');
    this.contentEl.empty();
    if (!this.resolved) {
      this.finish({ action: 'cancel', keywords: [] });
    }
  }

  private finish(result: KeywordReviewResult): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolver(result);
    this.close();
  }
}
