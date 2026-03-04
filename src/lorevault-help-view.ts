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
        'Open **LoreVault Manager** and run `Build/Export` for your lorebook.',
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
        'Inline directives (`[LV: ...]` / `<!-- LV: ... -->`) are rendered in-place as `<inline_story_directive>` tags during generation; non-`LV:` HTML comments are stripped from staged prompt blocks.',
        'Author note actions: `Open/Create Author Note`, `Link Author Note`, `Rewrite Author Note`.',
        'Chapter actions: `Generate Chapter Summary`, `Create Next Chapter`, `Fork Story`.',
        'Completion profile: use the panel dropdown (applies immediately). If an Author Note override exists the selector is disabled and shows `Overridden by Author Note`.',
        'Set author-note `completionProfile` via command `Set Author Note Completion Profile`.',
        'API keys are in Obsidian Secret Storage; each completion preset has a `Completion API Secret Name` used as its secret key id. LoreVault only creates missing secrets and never overwrites existing ones.',
        'Cost profile label is configured in settings (device-local) and only affects usage metadata; when empty, LoreVault auto-derives one from API key hash.',
        'Cost budgets are configured per cost profile in settings. Pick a budget profile first, then edit daily/session/operation/model/lorebook limits for that profile.',
        'Story continuity aggressiveness (`Balanced` / `Aggressive`) is configured in settings and controls how much prior chapter memory + style carryover is injected.',
        'Semantic chapter recall is enabled by default and configurable in Writing Completion settings; disable/tune it as needed. It can add `Related Past Scenes` from similar prior chapter chunks.',
        'Panel shows effective model, context usage, selected context items, and cost breakdown under the profile selector.'
      ],
      actions: [
        { label: 'Open Story Writing Panel', onClick: () => void this.plugin.openStorySteeringView() },
        { label: 'Open Cost Analyzer', onClick: () => void this.plugin.openCostAnalyzerView() }
      ]
    });

    this.renderSection(contentEl, 'Story Chat Panel', {
      bullets: [
        'Open chat with `Open Story Chat`.',
        'Switch chats with `Open Conversation` and create new ones with `New Chat`.',
        'Story Chat uses a device-level `Chat Completion Profile` selector independent from Story Writing profile selection.',
        'Per-chat context lists: Lorebooks, Author Notes, Chapters/Raw Notes, and Manual Context.',
        'Chat messages render markdown and support edit/fork/regenerate.',
        'Assistant message metadata shows which profile/model generated that response.',
        'Saved chat notes keep full context metadata in collapsed `Context Meta` callouts with fenced `yaml` payloads.',
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
        'Use chapter/world summary commands to maintain concise memory context.',
        'Use `Run Text Command on Selection` with built-in `Canon Consistency Pass` or `Scene Consistency Pass` templates for fast rewrite passes.'
      ],
      actions: [
        { label: 'Open Lorebook Auditor', onClick: () => void this.plugin.openLorebookAuditorView() },
        { label: 'Open Query Simulation', onClick: () => void this.plugin.openQuerySimulationView() }
      ]
    });

    this.renderSection(contentEl, 'Import and Update', {
      bullets: [
        '`Import SillyTavern Lorebook`: import JSON lorebooks into notes with list-based lorebook selection.',
        '`Import SillyTavern Character Card`: parse `.png`/`.json` cards, rewrite them into freeform story + author note with an LLM, and optionally import embedded lorebooks.',
        'Character-card rewrite now keeps the model output as freeform `authorNoteMarkdown` (no enforced section template in post-processing).',
        'Character-card preview includes editable planned writes so you can adjust file paths and markdown content before import.',
        '`Extract Wiki Pages from Story`: extract structured wiki pages from story text with selectable completion profile.',
        '`Fork Active Lorebook`: clone one lorebook into a new lorebook/folder and rewrite internal links to the forked pages.',
        '`Apply Story Delta to Existing Wiki` / `Open Lorebook Update`: update existing pages from new story content with selectable completion profile.',
        'Import/Extraction/Fork default target folder is controlled by `Default Lorebook Import Location` in settings.',
        'All panels show staged progress while preview/apply is running.',
        'Story-delta and rewrite review steps show side-by-side source diffs at the point where you accept/reject changes.'
      ],
      actions: [
        { label: 'Open Lorebook Import', onClick: () => void this.plugin.openImportLorebookView() },
        { label: 'Open Character Card Import', onClick: () => void this.plugin.openImportLorebookView('character_card') },
        { label: 'Open Story Extraction', onClick: () => void this.plugin.openStoryExtractionView() },
        { label: 'Open Lorebook Update', onClick: () => void this.plugin.openStoryDeltaView() }
      ]
    });

    this.renderSection(contentEl, 'If Something Looks Wrong', {
      bullets: [
        'No lorebooks found: verify your tags use the configured `#lorebook/...` prefix.',
        'Weak retrieval: run Query Simulation and check selected lorebooks and fallback policy.',
        'Short outputs: increase context window/output limits in settings.',
        'Unexpected behavior after changing settings: close and reopen the panel once.'
      ],
      actions: [
        { label: 'Open Manager', onClick: () => void this.plugin.openLorebooksManagerView() }
      ]
    });

  }
}
