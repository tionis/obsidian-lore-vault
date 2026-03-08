import { App, Modal } from 'obsidian';

export interface GreetingOption {
  label: string;
  text: string;
}

export type GreetingSelectorResult =
  | { action: 'use'; selectedText: string; selectedIndex: number }
  | { action: 'cancel' };

export class GreetingSelectorModal extends Modal {
  private readonly greetings: GreetingOption[];
  private selectedIndex: number;
  private resolveResult: ((value: GreetingSelectorResult) => void) | null = null;
  private settled = false;
  private previewEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;

  constructor(app: App, greetings: GreetingOption[]) {
    super(app);
    this.greetings = greetings;
    this.selectedIndex = 0;
  }

  waitForResult(): Promise<GreetingSelectorResult> {
    return new Promise(resolve => {
      this.resolveResult = resolve;
    });
  }

  onOpen(): void {
    this.modalEl.addClass('lorevault-greeting-selector-shell');
    this.setTitle('Select Opening Scene');
    this.contentEl.empty();
    this.contentEl.addClass('lorevault-greeting-selector');

    this.contentEl.createEl('p', {
      text: 'This card has multiple greetings. Choose which opening scene to transform into the story.'
    });

    const columns = this.contentEl.createDiv({ cls: 'lorevault-greeting-columns' });

    const listWrapper = columns.createDiv({ cls: 'lorevault-greeting-list-wrap' });
    this.listEl = listWrapper.createEl('ul', { cls: 'lorevault-greeting-list' });
    for (let i = 0; i < this.greetings.length; i++) {
      this.renderListItem(i);
    }

    const previewWrapper = columns.createDiv({ cls: 'lorevault-greeting-preview-wrap' });
    previewWrapper.createEl('div', { text: 'Preview', cls: 'lorevault-greeting-preview-label' });
    this.previewEl = previewWrapper.createEl('pre', { cls: 'lorevault-greeting-preview' });
    this.updatePreview();

    const actions = this.contentEl.createDiv({ cls: 'lorevault-modal-actions' });

    const cancelButton = actions.createEl('button', { text: 'Cancel' });
    cancelButton.addEventListener('click', () => {
      this.finish({ action: 'cancel' });
      this.close();
    });

    const useButton = actions.createEl('button', { text: 'Use Selected' });
    useButton.addClass('mod-cta');
    useButton.addEventListener('click', () => {
      const greeting = this.greetings[this.selectedIndex];
      if (!greeting) {
        return;
      }
      this.finish({ action: 'use', selectedText: greeting.text, selectedIndex: this.selectedIndex });
      this.close();
    });
  }

  private renderListItem(index: number): void {
    if (!this.listEl) {
      return;
    }
    const greeting = this.greetings[index];
    if (!greeting) {
      return;
    }
    const li = this.listEl.createEl('li', { cls: 'lorevault-greeting-item' });
    if (index === this.selectedIndex) {
      li.addClass('is-selected');
    }
    li.createEl('span', { cls: 'lorevault-greeting-item-label', text: greeting.label });
    const snippetText = greeting.text.slice(0, 120).replace(/\s+/g, ' ').trim();
    li.createEl('span', {
      cls: 'lorevault-greeting-item-snippet',
      text: greeting.text.length > 120 ? `${snippetText}…` : snippetText
    });

    li.addEventListener('click', () => {
      this.selectedIndex = index;
      this.refreshList();
      this.updatePreview();
    });
    li.addEventListener('dblclick', () => {
      this.selectedIndex = index;
      const g = this.greetings[this.selectedIndex];
      if (!g) {
        return;
      }
      this.finish({ action: 'use', selectedText: g.text, selectedIndex: this.selectedIndex });
      this.close();
    });
  }

  private refreshList(): void {
    if (!this.listEl) {
      return;
    }
    this.listEl.empty();
    for (let i = 0; i < this.greetings.length; i++) {
      this.renderListItem(i);
    }
  }

  private updatePreview(): void {
    if (!this.previewEl) {
      return;
    }
    const greeting = this.greetings[this.selectedIndex];
    this.previewEl.setText(greeting?.text ?? '');
  }

  onClose(): void {
    this.modalEl.removeClass('lorevault-greeting-selector-shell');
    this.contentEl.empty();
    this.finish({ action: 'cancel' });
  }

  private finish(result: GreetingSelectorResult): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.resolveResult?.(result);
  }
}
