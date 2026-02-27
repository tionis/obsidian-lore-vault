import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
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
      list.createEl('li', { text: bullet });
    }

    if (options.note) {
      section.createEl('p', {
        cls: 'lorevault-help-note',
        text: options.note
      });
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
        'Tag notes with #lorebook/... to assign scope membership.',
        'Add frontmatter keywords/key for world_info routing.',
        'Use frontmatter retrieval override when needed: auto | world_info | rag | both | none.',
        'Run Build Active Lorebook Scope from command palette or ribbon.'
      ],
      actions: [
        { label: 'Open Manager', onClick: () => void this.plugin.openLorebooksManagerView() },
        { label: 'Open Routing Debug', onClick: () => void this.plugin.openRoutingDebugView() },
        { label: 'Open Query Simulation', onClick: () => void this.plugin.openQuerySimulationView() }
      ]
    });

    this.renderSection(contentEl, 'Long-Form Story Workflow', {
      bullets: [
        'Create one note per chapter/scene and keep a stable storyId for the same story thread.',
        'Set chapter numbers where possible so thread order is explicit and deterministic.',
        'Optionally set previousChapter/nextChapter links to enforce explicit sequence edges.',
        'Add summary in chapter frontmatter for higher-quality chapter memory injection.'
      ],
      note: 'Current behavior: both Continue Story and Story Chat inject bounded chapter memory before lorebook retrieval.',
      codeSample: [
        '---',
        'storyId: chronicles-main',
        'chapter: 7',
        'chapterTitle: "Crossing the Spine"',
        'previousChapter: [[story/ch06-the-fallout]]',
        'nextChapter: [[story/ch08-the-reckoning]]',
        'lorebooks: [universe/core, universe/yggdrasil]',
        'summary: "Short chapter recap for memory injection."',
        '---'
      ].join('\n')
    });

    this.renderSection(contentEl, 'Auto Summaries', {
      bullets: [
        'Generate world_info or chapter summaries with command-palette actions.',
        'Review modal allows edit + approval before storing/writing summaries.',
        'Approve Cache stores generated summary only in cache.',
        'Write Frontmatter Summary stores cache and updates frontmatter summary field.',
        'Precedence: frontmatter summary -> generated summary -> body/excerpt fallback.'
      ]
    });

    this.renderSection(contentEl, 'Generation and Chat', {
      bullets: [
        'Continue Story with Context streams generated text into the active editor at the cursor.',
        'It assembles context in layers: local story window, chapter memory (if available), then lorebook retrieval.',
        'Writing Completion settings support reusable model presets for quick provider/model A/B testing.',
        'Optional Cost Tracking settings persist token/cost usage records for continuation, chat, and summary runs.',
        'Manager panel includes usage/cost rollups (session/day/project) with optional budget warnings.',
        'Use commands Export Usage Report (JSON/CSV) for deterministic report exports.',
        'Story Chat provides persistent note-backed conversations with fork and regenerate support.',
        'Story Chat supports per-chat scope selection, manual context, and specific-note context lists.',
        'Assistant turns expose a layer trace so you can see which context layer contributed injected data.'
      ],
      actions: [
        { label: 'Open Story Chat', onClick: () => void this.plugin.openStoryChatView() }
      ]
    });

    this.renderSection(contentEl, 'Inbound Wiki Panels', {
      bullets: [
        'Import SillyTavern Lorebook opens a panel with target folder, default tags, and lorebook-name tag mapping.',
        'Paste lorebook JSON, run Preview, then Import to create/update wiki pages deterministically.',
        'Extract Wiki Pages from Story runs deterministic chunked extraction with per-chunk validation and preview/apply workflow.'
      ]
    });

    this.renderSection(contentEl, 'Retrieval and Budget Controls', {
      bullets: [
        'Primary retrieval is graph-first world_info (seed matches + bounded graph expansion).',
        'RAG fallback policy is configurable in settings: off | auto | always.',
        'Graph controls: max hops, hop decay, and seed threshold for auto fallback.',
        'Optional tool retrieval hooks can fetch targeted entries via search_entries / expand_neighbors / get_entry.',
        'Tool hooks enforce hard limits per turn (call count, tool result tokens, planning time).',
        'Token budgets are enforced; world_info content is tiered short -> medium -> full when budget allows.',
        'Use Query Simulation for multi-scope retrieval testing with override knobs.'
      ]
    });

    this.renderSection(contentEl, 'Exports and Downstream Use', {
      bullets: [
        'Canonical artifact: one SQLite pack per scope (<scope>.db).',
        'Downstream exports are derived under the same root (world_info JSON + rag markdown).',
        'SQLite meta table includes schema/scope/timestamp/count metadata for each build.',
        'Companion tools should consume SQLite directly instead of re-parsing vault notes.'
      ]
    });

    this.renderSection(contentEl, 'Documentation', {
      bullets: [
        'README.md: concise behavior summary and commands.',
        'docs/documentation.md: detailed feature behavior and settings.',
        'docs/technical-reference.md: implementation-level architecture/contracts.',
        'docs/planning.md + docs/todo.md: roadmap and implementation status.'
      ]
    });
  }
}
