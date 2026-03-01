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

    this.renderSection(contentEl, 'Start Here', {
      bullets: [
        'Tag notes with `#lorebook/...` to place them in one or more lorebooks.',
        'Add `keywords` or `key` in frontmatter for better trigger matching.',
        'Build exports from `LoreVault Manager -> Build/Export` on each scope card.',
        'Use `Continue Story with Context` from the editor context menu to generate text at the cursor.'
      ],
      note: 'LoreVault is task-oriented: build/audit lorebooks, then use them for story continuation and chat.',
      actions: [
        { label: 'Open Manager', onClick: () => void this.plugin.openLorebooksManagerView() },
        { label: 'Open Lorebook Auditor', onClick: () => void this.plugin.openLorebookAuditorView() },
        { label: 'Open Story Chat', onClick: () => void this.plugin.openStoryChatView() }
      ]
    });

    this.renderSection(contentEl, 'Recommended Note Structure', {
      bullets: [
        'Use one note per chapter/scene for long-form stories.',
        'Keep `storyId` stable across chapters; set numeric `chapter` where possible.',
        'Use `previousChapter` / `nextChapter` links for explicit ordering when needed.',
        'Add a `## Summary` section near the top of notes; LoreVault prefers this for memory/retrieval.'
      ],
      note: 'Summary precedence is deterministic: `## Summary` first paragraph -> frontmatter `summary` fallback -> excerpt fallback.',
      codeSample: [
        '---',
        'tags: [lorebook/universe/yggdrasil]',
        'keywords: [baalthasar, archmage, mind magic]',
        'chapter: 7',
        'storyId: chronicles-main',
        'chapterTitle: "Crossing the Spine"',
        'previousChapter: [[story/ch06-the-fallout]]',
        'nextChapter: [[story/ch08-the-reckoning]]',
        '---',
        '# Crossing the Spine',
        '',
        '## Summary',
        '',
        'Short chapter recap for memory injection.'
      ].join('\n')
    });

    this.renderSection(contentEl, 'Continue Story in Editor', {
      bullets: [
        'Use editor context menu: `LoreVault: Continue Story with Context`.',
        'Use command `Stop Active Generation` (or editor menu while running) to abort story text completion.',
        'Works on desktop and mobile editor menus.',
        'Context assembly order: local near-cursor story context -> chapter memory -> lorebook retrieval -> optional fallback/tool retrieval.',
        'Chapter-memory depth expands automatically when more context budget is available.',
        'With embeddings enabled, long query windows are chunked/averaged for semantic query embeddings; failures fall back to lexical retrieval so completion continues.',
        'Generation Monitor in Manager shows context usage, selected entries, and trim decisions.',
        'Inline directives are supported with strict syntax: `[LV: ...]` or `<!-- LV: ... -->`.'
      ],
      actions: [
        { label: 'Open Story Steering', onClick: () => void this.plugin.openStorySteeringView() },
        { label: 'Open Query Simulation', onClick: () => void this.plugin.openQuerySimulationView() }
      ]
    });

    this.renderSection(contentEl, 'Story Steering and Chat', {
      bullets: [
        'Story Steering now uses one note-level Author Note markdown document per active note.',
        'Story Steering edits autosave immediately; switching active notes autosaves current edits before loading the next note-level Author Note.',
        'Lorebook scope selection for continuation/chat is resolved from active-note frontmatter first, then Author Note frontmatter.',
        'Steering layers are simplified to `Author Note` plus parsed inline directives.',
        'Story Steering LLM assistance supports optional update prompts so you can direct what should change before review/apply.',
        'Steering update review shows Current vs Proposed Author Note markdown before apply.',
        '`Near-Cursor Context` in steering assistance means text before cursor in the active editor (fallback: note body).',
        'Chapter workflow commands: split monolithic story notes by `##` chapters and create linked next-chapter notes with managed story frontmatter.',
        'Story Chat supports per-conversation scopes, manual context, note steering refs (`note:*`), specific notes, and fork/regenerate.',
        'Story Chat continuity items are conversation-level toggles; they are no longer sourced from multi-scope steering fields.',
        'Optional Story Chat tool calls can search/read selected lorebooks, read linked story notes, and read/update the active note-level Author Note.',
        'Chat and continuation both show context-layer traces and token usage diagnostics.'
      ],
      actions: [
        { label: 'Open Story Chat', onClick: () => void this.plugin.openStoryChatView() },
        { label: 'Open Story Steering', onClick: () => void this.plugin.openStorySteeringView() }
      ]
    });

    this.renderSection(contentEl, 'Lorebook Auditor and Simulation', {
      bullets: [
        'Lorebook Auditor highlights missing keywords, thin entries, and duplicate-like similarity.',
        'Duplicate checks use deterministic heuristics plus embedding neighbors when embeddings are available.',
        'Auditor row actions include: `Open Entry`, `Open Similar`, `Open Pair`, and keyword generation.',
        'Query Simulation lets you test multi-scope retrieval decisions, lift tiers, fallback policy, and token budgets before generation.',
        'Use these panels to tune retrieval quality before writing sessions.'
      ],
      actions: [
        { label: 'Open Lorebook Auditor', onClick: () => void this.plugin.openLorebookAuditorView() },
        { label: 'Open Query Simulation', onClick: () => void this.plugin.openQuerySimulationView() }
      ]
    });

    this.renderSection(contentEl, 'Auto Summaries', {
      bullets: [
        'Generate world_info or chapter summaries from command palette or editor context menu.',
        'Review and edit in a modal before writing.',
        'Accepted summaries are written to `## Summary` in the note body.',
        'For safety, only the first paragraph under `## Summary` is treated as canonical summary text.'
      ],
      actions: [
        { label: 'Open Manager', onClick: () => void this.plugin.openLorebooksManagerView() }
      ]
    });

    this.renderSection(contentEl, 'Text Commands', {
      bullets: [
        'Select text, then run `LoreVault: Run Text Command on Selection` from context menu.',
        'Prompt templates are markdown notes (editable like normal notes).',
        'Per prompt, choose whether to include lorebook context or use selected text only.',
        'Edits open in a diff review modal before apply unless auto-accept is enabled.'
      ]
    });

    this.renderSection(contentEl, 'Import and Update Wiki Pages', {
      bullets: [
        '`Import SillyTavern Lorebook`: paste ST JSON, preview, then import.',
        '`Extract Wiki Pages from Story`: paste story markdown, run chunked extraction, preview, then apply.',
        '`Apply Story Delta to Existing Wiki`: compare new story text against existing pages and apply reviewed updates (source modes: `note`, `chapter`, `story`, with note picker).',
        'Created/updated pages follow readable wiki layout: `# Title`, `## Summary`, then section headings.'
      ],
      actions: [
        { label: 'Open Lorebook Import', onClick: () => void this.plugin.openImportLorebookView() },
        { label: 'Open Story Extraction', onClick: () => void this.plugin.openStoryExtractionView() },
        { label: 'Open Lorebook Update', onClick: () => void this.plugin.openStoryDeltaView() }
      ]
    });

    this.renderSection(contentEl, 'Settings You Will Likely Use', {
      bullets: [
        'Writing Completion: provider/model/context window/max output and model presets.',
        'LLM Operation Log: enable full request/response logging, path, retention cap, optional embedding-call logging, and open the built-in explorer panel with parsed message inspection.',
        'Story Chat folder plus Story Chat tool-call limits/write toggle.',
        'Author Note folder and extraction sanitization setting.',
        'Retrieval controls: graph hops/decay, backlink expansion, fallback policy (`off|auto|always`), body-lift settings.',
        'Text Commands: prompt folder, default context toggle, auto-accept.',
        'Cost Tracking: usage ledger path, pricing overrides, and optional budget alerts (daily/session/operation/model/scope).'
      ],
      actions: [
        { label: 'Open Operation Log Explorer', onClick: () => void this.plugin.openOperationLogView() }
      ]
    });

    this.renderSection(contentEl, 'Command Coverage', {
      bullets: [
        'Build/Manage: `Build Active Lorebook Scope`, `Open LoreVault Manager`, `Open LoreVault Lorebook Auditor`, `Open LoreVault Query Simulation`.',
        'Story Tools: `Continue Story with Context`, `Stop Active Generation`, `Open Story Chat`, `Open Story Steering`, `Create Next Story Chapter`, `Split Active Story Note into Chapter Notes`, `Split Active Story Note into Chapter Notes (Pick Folder)`.',
        'Summary/Keyword: `Generate World Info Summary (Active Note)`, `Generate Keywords (Active Note)`, `Generate Chapter Summary (Active Note)`.',
        'Batch Summary: `Generate World Info Summaries (Active Scope)`, `Generate Chapter Summaries (Current Story)`.',
        'Import/Update: `Import SillyTavern Lorebook`, `Extract Wiki Pages from Story`, `Apply Story Delta to Existing Wiki`.',
        'Text Editing: `Run Text Command on Selection`.',
        'Operation Log: `Open LLM Operation Log Explorer`.',
        'Usage/Reporting: `Export Usage Report (JSON)`, `Export Usage Report (CSV)`.',
        'Template: `Create LoreVault Entry Template`.',
        'Help: `Open LoreVault Help`.'
      ],
      note: 'Most writing actions are also available from editor context menus on desktop and mobile where relevant.'
    });

    this.renderSection(contentEl, 'Troubleshooting', {
      bullets: [
        'No lorebooks visible: verify notes are tagged under your configured prefix (default `#lorebook/...`).',
        'Context seems wrong: run Query Simulation and check selected scopes + fallback policy.',
        'Generation too short or trimmed: increase context window/output limits in Writing Completion settings.',
        'Keywords quality issues: use Lorebook Auditor -> Generate Keywords with review.',
        'If settings changes seem ignored, reopen the affected panel once (it forces a fresh render state).'
      ],
      actions: [
        { label: 'Open Story Chat', onClick: () => void this.plugin.openStoryChatView() },
        { label: 'Open Manager', onClick: () => void this.plugin.openLorebooksManagerView() }
      ]
    });

    this.renderSection(contentEl, 'Exports', {
      bullets: [
        'Canonical export is one SQLite pack per lorebook scope (`<scope>.db`).',
        'Downstream files are generated from canonical scope data.',
        'Build/export is done from Manager scope cards or the build command.'
      ]
    });

  }
}
