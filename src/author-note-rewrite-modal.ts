import { App, Modal } from 'obsidian';

export interface AuthorNoteRewriteRequest {
  action: 'cancel' | 'rewrite';
  updateInstruction: string;
}

export class AuthorNoteRewriteModal extends Modal {
  private updateInstruction = '';
  private resolver: ((result: AuthorNoteRewriteRequest) => void) | null = null;
  private resolved = false;

  constructor(app: App) {
    super(app);
  }

  waitForResult(): Promise<AuthorNoteRewriteRequest> {
    return new Promise(resolve => {
      this.resolver = resolve;
    });
  }

  onOpen(): void {
    this.modalEl.addClass('lorevault-summary-modal-shell');
    this.contentEl.empty();
    this.contentEl.addClass('lorevault-summary-modal');
    this.contentEl.createEl('h2', { text: 'Rewrite Author Note' });
    this.contentEl.createEl('p', {
      text: 'Optional: describe what should change. Leave empty for a full refresh based on story + lore context.'
    });

    const input = this.contentEl.createEl('textarea', { cls: 'lorevault-summary-textarea' });
    input.placeholder = 'Example: tighten voice guidance and update next-scene plan for chapter 12.';
    input.rows = 8;
    input.value = this.updateInstruction;
    input.addEventListener('input', () => {
      this.updateInstruction = input.value.trim();
    });

    const actions = this.contentEl.createDiv({ cls: 'lorevault-summary-actions' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => {
      this.finish({
        action: 'cancel',
        updateInstruction: this.updateInstruction
      });
      this.close();
    });

    const applyButton = actions.createEl('button', { text: 'Rewrite' });
    applyButton.addClass('mod-cta');
    applyButton.addEventListener('click', () => {
      this.finish({
        action: 'rewrite',
        updateInstruction: this.updateInstruction
      });
      this.close();
    });
  }

  onClose(): void {
    this.modalEl.removeClass('lorevault-summary-modal-shell');
    this.contentEl.empty();
    if (!this.resolved) {
      this.finish({
        action: 'cancel',
        updateInstruction: this.updateInstruction
      });
    }
  }

  private finish(result: AuthorNoteRewriteRequest): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolver?.(result);
  }
}
