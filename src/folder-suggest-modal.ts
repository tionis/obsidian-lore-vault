import { App, FuzzySuggestModal, Notice, TFolder } from 'obsidian';

class VaultFolderSuggestModal extends FuzzySuggestModal<string> {
  private readonly folders: string[];
  private readonly onChoosePath: (path: string) => void;

  constructor(app: App, onChoosePath: (path: string) => void) {
    super(app);
    this.onChoosePath = onChoosePath;
    this.folders = app.vault
      .getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder)
      .map(folder => folder.path)
      .filter(path => path.trim().length > 0)
      .sort((a, b) => a.localeCompare(b));
    this.setPlaceholder('Select existing folder');
  }

  hasFolders(): boolean {
    return this.folders.length > 0;
  }

  getItems(): string[] {
    return this.folders;
  }

  getItemText(item: string): string {
    return item;
  }

  onChooseItem(item: string): void {
    this.onChoosePath(item);
  }
}

export function openVaultFolderPicker(app: App, onChoosePath: (path: string) => void): void {
  const modal = new VaultFolderSuggestModal(app, onChoosePath);
  if (!modal.hasFolders()) {
    new Notice('No existing folders found in this vault.');
    return;
  }
  modal.open();
}
