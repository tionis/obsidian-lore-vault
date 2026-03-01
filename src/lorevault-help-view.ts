import { ItemView, MarkdownRenderer, WorkspaceLeaf, setIcon } from 'obsidian';
import LoreBookConverterPlugin from './main';

export const LOREVAULT_HELP_VIEW_TYPE = 'lorevault-help-view';

interface ActionItem {
  label: string;
  onClick: () => void;
}

interface HelpSectionOptions {
  bullets: string[];
  actions?: ActionItem[];
  note?: string;
  codeSample?: string;
}

export class LorevaultHelpView extends ItemView {
  private plugin: LoreBookConverterPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: LoreBookConverterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LOREVAULT_HELP_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'LoreVault Help';
  }

  getIcon(): string {
    return 'help-circle';
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

  private renderSection(
    container: HTMLElement,
    title: string,
    options: HelpSectionOptions
  ): void {
    const section = container.createDiv({ cls: 'lorevault-help-section' });
    section.createEl('h3', { text: title });
    const list = section.createEl('ul');
    for (const bullet of options.bullets) {
      const item = list.createEl('li');
      void MarkdownRenderer.render(this.app, bullet, item, '', this);
    }

    if (options.note) {
      const note = section.createEl('p', {
        cls: 'lorevault-help-note'
      });
      void MarkdownRenderer.render(this.app, options.note, note, '', this);
    }

    if (options.codeSample) {
      section.createEl('pre', {
        cls: 'lorevault-help-code',
        text: options.codeSample
      });
    }

    const actions = options.actions ?? [];
    if (actions.length > 0) {
      const row = section.createDiv({ cls: 'lorevault-help-actions' });
      for (const action of actions) {
        const button = row.createEl('button', { text: action.label });
        button.addEventListener('click', action.onClick);
      }
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-help-view');

    const titleRow = contentEl.createDiv({ cls: 'lorevault-help-title-row' });
    const icon = titleRow.createSpan({ cls: 'lorevault-help-icon' });
    setIcon(icon, 'help-circle');
    titleRow.createEl('h2', { text: 'LoreVault Help' });

    this.renderSection(contentEl, 'Quick Start', {
      bullets: [
        'Tag notes with `#lorebook/...`.',
        'Add `keywords` (or `key`) in frontmatter.',
        'Open **LoreVault Manager** and run `Build/Export` for your scope.',
        'Use `Continue Story with Context` in the editor to generate at the cursor.'
      ],
      actions: [
        { label: 'Open Manager', onClick: () => void this.plugin.openLorebooksManagerView() },
        { label: 'Open Story Writing Panel', onClick: () => void this.plugin.openStorySteeringView() }
      ]
    });

    this.renderSection(contentEl, 'Story Notes Format', {
      bullets: [
        'Use one note per chapter/scene for long-form stories.',
        'Link a shared author note with `authorNote: [[...]]`.',
        'Use `chapter`, `previousChapter`, and `nextChapter` for ordering.',
        'Add a `## Summary` section near the top for better memory injection.'
      ],
      codeSample: [
        '---',
        'tags: [lorebook/universe/yggdrasil]',
        'keywords: [baalthasar, archmage]',
        'authorNote: [[LoreVault/author-notes/main-author-note]]',
        'chapter: 7',
        'previousChapter: [[story/ch06-the-fallout]]',
        'nextChapter: [[story/ch08-the-reckoning]]',
        '---',
        '# Chapter Title',
        '',
        '## Summary',
        '',
        'Short chapter recap.'
      ].join('\n')
    });

    this.renderSection(contentEl, 'Story Writing Panel', {
      bullets: [
        'Generation actions: `Continue Story` (switches to `Stop` while running) and `Insert Directive`.',
        'Author note actions: `Open/Create Author Note`, `Link Author Note`, `Rewrite Author Note`.',
        'Chapter actions: `Generate Chapter Summary`, `Create Next Chapter`.',
        'Panel also shows model, context usage, selected context items, and cost breakdown.'
      ],
      actions: [
        { label: 'Open Story Writing Panel', onClick: () => void this.plugin.openStorySteeringView() }
      ]
    });

    this.renderSection(contentEl, 'Story Chat Panel', {
      bullets: [
        'Open chat with `Open Story Chat`.',
        'Switch chats with `Open Conversation` and create new ones with `New Chat`.',
        'Per-chat context lists: Lorebooks, Author Notes, Chapters/Raw Notes, and Manual Context.',
        'Chat messages render markdown and support edit/fork/regenerate.',
        'Conversations are saved as readable markdown session notes.'
      ],
      actions: [
        { label: 'Open Story Chat', onClick: () => void this.plugin.openStoryChatView() }
      ]
    });

    this.renderSection(contentEl, 'Lorebook Quality Tools', {
      bullets: [
        'Use **Lorebook Auditor** to find weak entries and generate keywords.',
        'Use **Query Simulation** to inspect what context would be selected.',
        'Use chapter/world summary commands to maintain concise memory context.'
      ],
      actions: [
        { label: 'Open Lorebook Auditor', onClick: () => void this.plugin.openLorebookAuditorView() },
        { label: 'Open Query Simulation', onClick: () => void this.plugin.openQuerySimulationView() }
      ]
    });

    this.renderSection(contentEl, 'Import and Update', {
      bullets: [
        '`Import SillyTavern Lorebook`: import JSON lorebooks into notes.',
        '`Extract Wiki Pages from Story`: extract structured wiki pages from story text.',
        '`Apply Story Delta to Existing Wiki`: update existing pages from new story content.'
      ],
      actions: [
        { label: 'Open Lorebook Import', onClick: () => void this.plugin.openImportLorebookView() },
        { label: 'Open Story Extraction', onClick: () => void this.plugin.openStoryExtractionView() },
        { label: 'Open Lorebook Update', onClick: () => void this.plugin.openStoryDeltaView() }
      ]
    });

    this.renderSection(contentEl, 'If Something Looks Wrong', {
      bullets: [
        'No scopes found: verify your tags use the configured `#lorebook/...` prefix.',
        'Weak retrieval: run Query Simulation and check selected scopes and fallback policy.',
        'Short outputs: increase context window/output limits in settings.',
        'Unexpected behavior after changing settings: close and reopen the panel once.'
      ],
      actions: [
        { label: 'Open Manager', onClick: () => void this.plugin.openLorebooksManagerView() }
      ]
    });

  }
}
