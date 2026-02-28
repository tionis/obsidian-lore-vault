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
        'Add frontmatter keywords/key for stronger retrieval precision.',
        'Notes are included as unified lore entries by default; use `retrieval: none` to exclude.',
        'Run Build Active Lorebook Scope from command palette or ribbon.'
      ],
      actions: [
        { label: 'Open Manager', onClick: () => void this.plugin.openLorebooksManagerView() },
        { label: 'Open Lorebook Auditor', onClick: () => void this.plugin.openLorebookAuditorView() },
        { label: 'Open Query Simulation', onClick: () => void this.plugin.openQuerySimulationView() }
      ]
    });

    this.renderSection(contentEl, 'Long-Form Story Workflow', {
      bullets: [
        'Create one note per chapter/scene and keep a stable storyId for the same story thread.',
        'Set chapter numbers where possible so thread order is explicit and deterministic.',
        'Optionally set previousChapter/nextChapter links to enforce explicit sequence edges.',
        'Add a `## Summary` section near the top of chapter notes for higher-quality chapter memory injection.'
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
        '---',
        '# Crossing the Spine',
        '',
        '## Summary',
        '',
        'Short chapter recap for memory injection.'
      ].join('\n')
    });

    this.renderSection(contentEl, 'Auto Summaries', {
      bullets: [
        'Generate world_info or chapter summaries from command palette or the editor context menu.',
        'Context menu shows world_info summary only for lorebook-tagged notes, and chapter summary only for story/chapter frontmatter notes.',
        'Review modal allows editing before writing summary updates.',
        'Accepted summaries are written to a `## Summary` section in the note body.',
        'Precedence: first paragraph under `## Summary` -> `frontmatter summary` fallback -> body/excerpt fallback.'
      ]
    });

    this.renderSection(contentEl, 'Text Commands', {
      bullets: [
        'Select text in the editor, right-click, and run `LoreVault: Run Text Command on Selection`.',
        'Prompt templates are markdown notes in your prompt folder and can be edited like normal notes.',
        'Template frontmatter controls behavior (`promptKind: text_command`, `includeLorebookContext: true|false`).',
        'Pick a stored prompt template or edit a custom prompt before running.',
        'Each run can include lorebook context or operate on selected text only.',
        'Generated edits are reviewed in a diff/preview modal before apply unless auto-accept is enabled.',
        'Manage prompt folder path, context defaults, and auto-accept in Settings -> Text Commands.'
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
        'Import SillyTavern Lorebook: paste ST lorebook JSON, preview generated notes, then import into your target folder.',
        'Extract Wiki Pages from Story: paste story markdown and run chunked extraction to create/extend wiki notes with preview before apply.',
        'Apply Story Delta to Existing Wiki (lorebook update panel): compare new story text against existing notes and apply reviewed updates.',
        'All three panels support target folder + lorebook tagging so outputs stay scoped, with a Browse picker for selecting existing folders.',
        'Extraction/update output is normalized to readable wiki structure: top # Title, then ## Summary, then sectioned body headings.',
        'Imported/extracted/updated summaries are written to note `## Summary` sections (frontmatter `summary` is fallback input only).',
        'Story Delta includes low-confidence gating and per-change approval checkboxes before writing.'
      ],
      actions: [
        { label: 'Open Lorebook Import', onClick: () => void this.plugin.openImportLorebookView() },
        { label: 'Open Story Extraction', onClick: () => void this.plugin.openStoryExtractionView() },
        { label: 'Open Lorebook Update', onClick: () => void this.plugin.openStoryDeltaView() }
      ]
    });

    this.renderSection(contentEl, 'Retrieval and Budget Controls', {
      bullets: [
        'Primary retrieval is graph-first world_info (seed matches + bounded graph expansion).',
        'Fallback retrieval policy is configurable in settings: off | auto | always.',
        'Graph controls: max hops, hop decay, backlink expansion toggle, and seed threshold for auto fallback.',
        'Optional tool retrieval hooks can fetch targeted entries via search_entries / expand_neighbors / get_entry.',
        'Tool hooks enforce hard limits per turn (call count, tool result tokens, planning time).',
        'Token budgets are enforced; world_info content is tiered short -> medium -> full, with high-score body lift using full note body when budget permits.',
        'When full body does not fit, excerpt lift uses lexical scoring and (if embeddings are enabled) semantic paragraph reranking as a fallback.',
        'Use Query Simulation for multi-scope retrieval testing, fallback diagnostics, and body-lift decision traces.',
        'Lorebook Auditor includes a Quality Audit table that flags missing keywords, duplicate-like entries, and thin notes.',
        'Keyword generation now always opens a review step before applying and supports multi-note runs from the audit table.'
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

  }
}
