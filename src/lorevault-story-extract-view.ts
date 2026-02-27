import { ItemView, Notice, Setting, WorkspaceLeaf } from 'obsidian';
import LoreBookConverterPlugin from './main';

export const LOREVAULT_STORY_EXTRACT_VIEW_TYPE = 'lorevault-story-extract-view';

export class LorevaultStoryExtractView extends ItemView {
  private plugin: LoreBookConverterPlugin;
  private targetFolder = 'LoreVault/import';
  private defaultTags = '';
  private lorebookName = '';
  private storyMarkdown = '';

  constructor(leaf: WorkspaceLeaf, plugin: LoreBookConverterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LOREVAULT_STORY_EXTRACT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'LoreVault Story Extraction';
  }

  getIcon(): string {
    return 'file-search';
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

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-import-view');
    contentEl.createEl('h2', { text: 'Extract Wiki Pages from Story' });

    new Setting(contentEl)
      .setName('Target Folder')
      .setDesc('Folder where extracted wiki pages will be created/updated.')
      .addText(text => text
        .setPlaceholder('LoreVault/import')
        .setValue(this.targetFolder)
        .onChange(value => {
          this.targetFolder = value.trim();
        }));

    new Setting(contentEl)
      .setName('Default Tags')
      .setDesc('Comma or newline separated tags applied to generated notes.')
      .addTextArea(text => {
        text.inputEl.rows = 2;
        text
          .setPlaceholder('wiki, extracted')
          .setValue(this.defaultTags)
          .onChange(value => {
            this.defaultTags = value;
          });
      });

    new Setting(contentEl)
      .setName('Lorebook Name')
      .setDesc(`Converted into one lorebook tag under prefix "${this.plugin.settings.tagScoping.tagPrefix}".`)
      .addText(text => text
        .setPlaceholder('story-extract')
        .setValue(this.lorebookName)
        .onChange(value => {
          this.lorebookName = value;
        }));

    new Setting(contentEl)
      .setName('Story Markdown')
      .setDesc('Paste story markdown to extract/update wiki notes chunk-by-chunk.')
      .addTextArea(text => {
        text.inputEl.rows = 14;
        text
          .setPlaceholder('# Chapter 1\n...')
          .setValue(this.storyMarkdown)
          .onChange(value => {
            this.storyMarkdown = value;
          });
      });

    const actions = contentEl.createDiv({ cls: 'lorevault-import-actions' });
    const note = contentEl.createDiv({ cls: 'lorevault-import-output' });
    note.createEl('p', {
      text: 'Extraction pipeline is planned next (deterministic chunking + schema-constrained LLM extraction + preview/diff before writes).'
    });

    const runButton = actions.createEl('button', { text: 'Start Extraction' });
    runButton.addClass('mod-cta');
    runButton.addEventListener('click', () => {
      new Notice('Story extraction pipeline is not implemented yet.');
    });
  }
}
