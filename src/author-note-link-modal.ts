import { App, FuzzySuggestModal, TFile } from 'obsidian';

export class AuthorNoteLinkModal extends FuzzySuggestModal<TFile> {
  private files: TFile[];
  private resolver: ((value: TFile | null) => void) | null = null;
  private resolved = false;

  constructor(app: App, files: TFile[]) {
    super(app);
    this.files = [...files].sort((a, b) => a.path.localeCompare(b.path));
    this.setPlaceholder('Pick an Author Note to link...');
  }

  waitForSelection(): Promise<TFile | null> {
    return new Promise(resolve => {
      this.resolver = resolve;
    });
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.resolveAndClose(file);
  }

  onClose(): void {
    super.onClose();
    if (!this.resolved) {
      this.resolveAndClose(null);
    }
  }

  private resolveAndClose(file: TFile | null): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolver?.(file);
    this.resolver = null;
    this.close();
  }
}
