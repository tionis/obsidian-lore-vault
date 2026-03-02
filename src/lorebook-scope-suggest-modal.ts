import { App, FuzzySuggestModal } from 'obsidian';

export class LorebookScopeSuggestModal extends FuzzySuggestModal<string> {
  private readonly scopes: string[];
  private resolveResult: ((value: string | null) => void) | null = null;
  private resolved = false;
  private selectedScope: string | null = null;

  constructor(
    app: App,
    scopes: string[],
    placeholder = 'Pick a lorebook scope...'
  ) {
    super(app);
    this.scopes = [...scopes].sort((a, b) => a.localeCompare(b));
    this.setPlaceholder(placeholder);
  }

  waitForSelection(): Promise<string | null> {
    return new Promise(resolve => {
      this.resolveResult = resolve;
    });
  }

  getItems(): string[] {
    return this.scopes;
  }

  getItemText(scope: string): string {
    return scope || '(all)';
  }

  onChooseItem(scope: string): void {
    this.selectedScope = scope;
    this.finish(scope);
  }

  onClose(): void {
    super.onClose();
    window.setTimeout(() => {
      this.finish(this.selectedScope);
    }, 0);
  }

  private finish(value: string | null): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    if (this.resolveResult) {
      this.resolveResult(value);
      this.resolveResult = null;
    }
  }
}
