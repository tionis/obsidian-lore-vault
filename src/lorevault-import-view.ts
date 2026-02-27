import { ItemView, Notice, Setting, WorkspaceLeaf } from 'obsidian';
import LoreBookConverterPlugin from './main';
import {
  applyImportedWikiPages,
  buildImportedWikiPages,
  parseSillyTavernLorebookJson
} from './sillytavern-import';
import { openVaultFolderPicker } from './folder-suggest-modal';

export const LOREVAULT_IMPORT_VIEW_TYPE = 'lorevault-import-view';

export class LorevaultImportView extends ItemView {
  private plugin: LoreBookConverterPlugin;
  private targetFolder = 'LoreVault/import';
  private defaultTags = '';
  private lorebookName = '';
  private lorebookJson = '';
  private skipDisabled = true;

  constructor(leaf: WorkspaceLeaf, plugin: LoreBookConverterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LOREVAULT_IMPORT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'LoreVault Import';
  }

  getIcon(): string {
    return 'inbox';
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  refresh(): void {
    this.render();
  }

  private buildSharedInputs(container: HTMLElement): void {
    let targetFolderInput: { setValue: (value: string) => void } | null = null;
    new Setting(container)
      .setName('Target Folder')
      .setDesc('Folder where imported wiki pages will be created/updated.')
      .addText(text => {
        targetFolderInput = text;
        text
          .setPlaceholder('LoreVault/import')
          .setValue(this.targetFolder)
          .onChange(value => {
            this.targetFolder = value.trim();
          });
      })
      .addButton(button => button
        .setButtonText('Browse')
        .onClick(() => {
          openVaultFolderPicker(this.app, path => {
            this.targetFolder = path;
            targetFolderInput?.setValue(path);
          });
        }));

    new Setting(container)
      .setName('Default Tags')
      .setDesc('Comma or newline separated tags applied to every imported note.')
      .addTextArea(text => {
        text.inputEl.rows = 2;
        text
          .setPlaceholder('wiki, imported')
          .setValue(this.defaultTags)
          .onChange(value => {
            this.defaultTags = value;
          });
      });

    new Setting(container)
      .setName('Lorebook Name')
      .setDesc('Converted into one lorebook tag under your configured prefix.')
      .addText(text => text
        .setPlaceholder('characters-minor')
        .setValue(this.lorebookName)
        .onChange(value => {
          this.lorebookName = value;
        }));
  }

  private async runPreview(outputEl: HTMLElement): Promise<void> {
    outputEl.empty();
    if (!this.lorebookJson.trim()) {
      outputEl.createEl('p', { text: 'Paste lorebook JSON to preview import results.' });
      return;
    }

    try {
      const parsed = parseSillyTavernLorebookJson(this.lorebookJson);
      const entries = this.skipDisabled
        ? parsed.entries.filter(entry => !entry.disable)
        : parsed.entries;
      const pages = buildImportedWikiPages(entries, {
        targetFolder: this.targetFolder,
        defaultTagsRaw: this.defaultTags,
        lorebookName: this.lorebookName,
        tagPrefix: this.plugin.settings.tagScoping.tagPrefix,
        maxSummaryChars: this.plugin.settings.summaries.maxSummaryChars
      });

      outputEl.createEl('p', {
        text: `Preview: ${entries.length} entries -> ${pages.length} wiki note(s).`
      });

      if (parsed.warnings.length > 0) {
        const warningList = outputEl.createEl('ul');
        for (const warning of parsed.warnings) {
          warningList.createEl('li', { text: warning });
        }
      }

      const details = outputEl.createEl('details');
      details.createEl('summary', {
        text: 'Planned File Paths'
      });
      const list = details.createEl('ul');
      for (const page of pages.slice(0, 50)) {
        list.createEl('li', { text: page.path });
      }
      if (pages.length > 50) {
        details.createEl('p', {
          text: `... ${pages.length - 50} more`
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputEl.createEl('p', {
        text: `Preview failed: ${message}`
      });
    }
  }

  private async runImport(outputEl: HTMLElement): Promise<void> {
    outputEl.empty();
    if (!this.lorebookJson.trim()) {
      new Notice('Paste lorebook JSON before importing.');
      return;
    }

    try {
      const parsed = parseSillyTavernLorebookJson(this.lorebookJson);
      const entries = this.skipDisabled
        ? parsed.entries.filter(entry => !entry.disable)
        : parsed.entries;
      if (entries.length === 0) {
        new Notice('No importable entries found.');
        return;
      }
      const pages = buildImportedWikiPages(entries, {
        targetFolder: this.targetFolder,
        defaultTagsRaw: this.defaultTags,
        lorebookName: this.lorebookName,
        tagPrefix: this.plugin.settings.tagScoping.tagPrefix,
        maxSummaryChars: this.plugin.settings.summaries.maxSummaryChars
      });
      const applied = await applyImportedWikiPages(this.app, pages);
      new Notice(
        `Import finished: ${applied.created} created, ${applied.updated} updated (${pages.length} total).`
      );
      outputEl.createEl('p', {
        text: `Import finished: ${applied.created} created, ${applied.updated} updated.`
      });
      if (parsed.warnings.length > 0) {
        const warningList = outputEl.createEl('ul');
        for (const warning of parsed.warnings) {
          warningList.createEl('li', { text: warning });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Lorebook import failed:', error);
      new Notice(`Lorebook import failed: ${message}`);
      outputEl.createEl('p', { text: `Import failed: ${message}` });
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-import-view');
    contentEl.createEl('h2', { text: 'Import SillyTavern Lorebook' });

    this.buildSharedInputs(contentEl);

    new Setting(contentEl)
      .setName('Skip Disabled Entries')
      .setDesc('Ignore entries with disable=true in imported lorebook JSON.')
      .addToggle(toggle => toggle
        .setValue(this.skipDisabled)
        .onChange(value => {
          this.skipDisabled = value;
        }));

    new Setting(contentEl)
      .setName('Lorebook JSON')
      .setDesc('Paste the full SillyTavern lorebook JSON payload.')
      .addTextArea(text => {
        text.inputEl.rows = 12;
        text
          .setPlaceholder('{"entries": {...}}')
          .setValue(this.lorebookJson)
          .onChange(value => {
            this.lorebookJson = value;
          });
      });

    const actions = contentEl.createDiv({ cls: 'lorevault-import-actions' });
    const output = contentEl.createDiv({ cls: 'lorevault-import-output' });

    const previewButton = actions.createEl('button', { text: 'Preview' });
    previewButton.addEventListener('click', () => {
      void this.runPreview(output);
    });

    const importButton = actions.createEl('button', { text: 'Import' });
    importButton.addClass('mod-cta');
    importButton.addEventListener('click', () => {
      void this.runImport(output);
    });

    const clearButton = actions.createEl('button', { text: 'Clear JSON' });
    clearButton.addEventListener('click', () => {
      this.lorebookJson = '';
      this.render();
    });
  }
}
