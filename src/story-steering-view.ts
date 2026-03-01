import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import LoreBookConverterPlugin from './main';

export const LOREVAULT_STORY_STEERING_VIEW_TYPE = 'lorevault-story-steering-view';

export class StorySteeringView extends ItemView {
  private plugin: LoreBookConverterPlugin;
  private activeNotePath = '';
  private isRendering = false;

  constructor(leaf: WorkspaceLeaf, plugin: LoreBookConverterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LOREVAULT_STORY_STEERING_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Story Author Note';
  }

  getIcon(): string {
    return 'book-text';
  }

  async onOpen(): Promise<void> {
    this.activeNotePath = this.app.workspace.getActiveFile()?.path ?? '';
    this.registerEvent(this.app.workspace.on('file-open', file => {
      const nextPath = file?.path ?? '';
      if (nextPath === this.activeNotePath) {
        return;
      }
      this.activeNotePath = nextPath;
      void this.render();
    }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
      const nextPath = this.app.workspace.getActiveFile()?.path ?? '';
      if (nextPath === this.activeNotePath) {
        return;
      }
      this.activeNotePath = nextPath;
      void this.render();
    }));
    await this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  refresh(): void {
    void this.render();
  }

  private async openOrCreateAuthorNote(): Promise<void> {
    try {
      await this.plugin.openOrCreateLinkedAuthorNoteForActiveNote();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to open/create author note: ${message}`);
    } finally {
      await this.render();
    }
  }

  private async rewriteAuthorNote(): Promise<void> {
    try {
      await this.plugin.rewriteAuthorNoteFromActiveNote();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Author-note rewrite failed: ${message}`);
    } finally {
      await this.render();
    }
  }

  private async render(): Promise<void> {
    if (this.isRendering) {
      return;
    }
    this.isRendering = true;

    try {
      const context = await this.plugin.resolveAuthorNoteWorkspaceContext();
      const { contentEl } = this;
      contentEl.empty();
      contentEl.addClass('lorevault-help-view');

      const titleRow = contentEl.createDiv({ cls: 'lorevault-help-title-row' });
      const icon = titleRow.createSpan({ cls: 'lorevault-help-icon' });
      setIcon(icon, 'book-text');
      titleRow.createEl('h2', { text: 'Story Author Note' });

      const summary = contentEl.createDiv({ cls: 'lorevault-help-section' });
      summary.createEl('h3', { text: 'Active Note' });
      summary.createEl('p', {
        text: context.activeFilePath || 'No active markdown note is selected.'
      });

      const actions = summary.createDiv({ cls: 'lorevault-help-actions' });
      const openButton = actions.createEl('button', {
        text: context.authorNotePath ? 'Open Linked Author Note' : 'Create Linked Author Note'
      });
      openButton.disabled = !context.activeFilePath;
      openButton.addEventListener('click', () => {
        void this.openOrCreateAuthorNote();
      });

      const rewriteButton = actions.createEl('button', { text: 'Rewrite Author Note' });
      rewriteButton.addClass('mod-cta');
      rewriteButton.disabled = !context.activeFilePath;
      rewriteButton.addEventListener('click', () => {
        void this.rewriteAuthorNote();
      });

      if (context.mode === 'story') {
        summary.createEl('p', {
          cls: 'lorevault-help-note',
          text: context.authorNotePath
            ? `Linked author note: ${context.authorNotePath}`
            : (context.missingAuthorNoteRef
              ? `Linked author note reference is unresolved: ${context.missingAuthorNoteRef}`
              : 'No linked author note yet. Create one to start steering via native Obsidian note editing.')
        });
      } else if (context.mode === 'author_note') {
        summary.createEl('p', {
          cls: 'lorevault-help-note',
          text: 'Active note is detected as an Author Note. Rewrite uses all linked story notes as source context.'
        });
      } else if (context.activeFilePath) {
        summary.createEl('p', {
          cls: 'lorevault-help-note',
          text: 'Active note is not linked to an Author Note yet. Use "Create Linked Author Note" to set `authorNote` frontmatter.'
        });
      }

      const linkedStoriesSection = contentEl.createDiv({ cls: 'lorevault-help-section' });
      linkedStoriesSection.createEl('h3', { text: 'Linked Story Notes' });
      if (context.linkedStoryPaths.length === 0) {
        linkedStoriesSection.createEl('p', {
          text: 'No linked story notes resolved.'
        });
      } else {
        const list = linkedStoriesSection.createEl('ul');
        for (const storyPath of context.linkedStoryPaths) {
          list.createEl('li', { text: storyPath });
        }
      }

      const note = contentEl.createDiv({ cls: 'lorevault-help-section' });
      note.createEl('h3', { text: 'Workflow' });
      note.createEl('p', {
        text: 'Author Note content is edited directly in native Obsidian notes. LoreVault only resolves links, injects content for generation, and provides rewrite-with-diff actions.'
      });
    } finally {
      this.isRendering = false;
    }
  }
}
