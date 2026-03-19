import { ItemView, MarkdownRenderer, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
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
        'Optional persona context is set in Character Card Import (`Persona Note`) and baked into generated outputs at import time.',
        'Use `chapter`, `previousChapter`, and `nextChapter` for ordering.',
        'Add a `## Summary` section near the top for better memory injection.',
        'Use ignored callouts such as `> [!lv-ignore]` or `> [!note]` for note-local drafting comments that should stay out of prompts by default.'
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
        'If generation fails, the `Active Writing Note` card keeps the error state but the action row returns to `Continue Story` and the profile selector unlocks.',
        'Inline directives (`[LV: ...]` / `<!-- LV: ... -->`) are rendered in-place as `<inline_story_directive>` tags during generation; configured ignored callout types and non-`LV:` HTML comments are stripped from staged prompt blocks.',
        'Author note actions: `Open/Create Author Note`, `Link Author Note`, `Rewrite Author Note`.',
        'Chapter actions: `Generate Chapter Summary`, `Create Next Chapter`, `Fork Story`.',
        'Completion profile: use the panel dropdown (applies immediately). If an Author Note override exists the selector is disabled and shows `Overridden by Author Note`.',
        'Writing Completion preset settings, including reasoning/thinking, are saved per selected preset.',
        'If reasoning is enabled and `Exclude Reasoning from Response` is off, `Continue Story` inserts returned thinking into a collapsed `lv-thinking` callout before the continuation.',
        'Story Chat profile selection is separate; `Continue Story` uses author-note override first, then the Story Writing device preset, then base settings.',
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

    this.renderSection(contentEl, 'Story Starter', {
      bullets: [
        'Open it with `Open Story Starter`.',
        'Use it to turn a premise into two notes: a first chapter/introduction and a linked Author Note.',
        'Optional lorebooks are used for retrieval during generation and written into `lorebooks` frontmatter on the generated notes.',
        'Paste extra brainstorm/chat notes into `Brainstorm Notes` when you want the opener to reflect prior ideation.',
        'Preview exposes editable planned writes before `Create Notes`.'
      ],
      actions: [
        { label: 'Open Story Starter', onClick: () => void this.plugin.openStoryStarterView() }
      ]
    });

    this.renderSection(contentEl, 'Story Chat Panel', {
      bullets: [
        'Open chat with `Open Story Chat`.',
        'Switch chats with `Open Conversation` and create new ones with `New Chat`.',
        'Story Chat uses a device-level `Chat Completion Profile` selector independent from Story Writing profile selection.',
        'Per-chat context lists: Lorebooks, Author Notes, Chapters/Raw Notes, and Manual Context.',
        'Chat messages render markdown and support edit/fork/regenerate; empty failed turns stay retryable even if no reply text arrived.',
        'Assistant message metadata shows which profile/model generated that response.',
        'Saved chat notes keep full context metadata in collapsed `Context Meta` callouts with fenced `yaml` payloads.',
        'Conversations are saved as readable markdown session notes.'
      ],
      actions: [
        { label: 'Open Story Chat', onClick: () => void this.plugin.openStoryChatView() }
      ]
    });

    this.renderSection(contentEl, 'Operation Log', {
      bullets: [
        'Open it with `Open LLM Operation Log Explorer`.',
        'Explorer shows full completion, streaming, tool-planner, and optional embedding payloads with search and status filters.',
        'The explorer preloads the current result page as summary rows; expanding a row fetches the full record once, heavy request/response payload sections only render when you open those subsections, text/json fields include `Copy` buttons, and SQLite-backed searches use FTS with first-page reporting instead of exact recounts on every refresh.',
        'LoreVault prefers a local SQLite-backed operation-log store and the explorer shows whether the current runtime is using `OPFS`, `IndexedDB`, or legacy JSONL fallback.',
        'Cost Analyzer uses shared immutable usage-ledger records stored in the vault and a local SQLite index when available; after the initial ledger sync, LoreVault keeps that index current from vault file events, computes totals/breakdowns with SQLite aggregate queries, and caches known cost-profile option lists until ledger/settings changes invalidate them.',
        'Lorebook Manager, Routing Debug, Query Simulation, and live-context file-scope bookkeeping reuse an incremental lorebook metadata cache so normal note edits do not force a full metadata rescan before those surfaces refresh.',
        'Story Chat reuses cached markdown-file indexes and conversation summaries between vault refreshes so author-note/chapter pickers do not rescan the whole vault every time you open them.',
        'Settings now include local DB diagnostics plus `Rebuild Local Indexes` / `Reset Local DB` actions, so you can repair the worker-backed SQLite state without manually deleting plugin storage.',
        'Setting `LLM Operation Log Path` controls the legacy per-cost-profile JSONL path used for fallback writes, legacy import, and raw-file inspection.'
      ],
      actions: [
        { label: 'Open Operation Log', onClick: () => void this.plugin.openOperationLogView() },
        { label: 'Open Cost Analyzer', onClick: () => void this.plugin.openCostAnalyzerView() }
      ]
    });

    this.renderSection(contentEl, 'Lorebook Quality Tools', {
      bullets: [
        'Use **Lorebook Auditor** to find weak entries and generate keywords.',
        'Use **Query Simulation** to inspect what context would be selected.',
        'Use chapter/world summary commands to maintain concise memory context.',
        'Use `Run Text Command on Selection` with built-in `Canon Consistency Pass`, `Scene Consistency Pass`, or `Remove LLMisms` templates for fast rewrite passes.',
        'If a text-command review loses focus or is dismissed, use `Review Pending Text Command Edit` or the status-bar indicator to reopen the saved result.'
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
        '`Inject Character Card Event`: on a linked story note, pick another greeting/event from the card and run a review-first rewrite for story (and linked author note when present).',
        '`Sync Character Card Library`: scan Character Card Source Folder and create/update one `lvDocType: characterCard` meta note per card.',
        'Synced character-card meta notes keep compact metadata in frontmatter and keep long prose fields in a readable, versioned `Character Card Details` markdown block (including numbered subheadings for alternate/group-only greetings).',
        'If you localize avatar embeds in that details block (for example with Local Images Plus), sync preserves those local embeds.',
        'Summary fields stay duplicated in frontmatter and details markdown so Bases can display/filter quick summaries.',
        '`Write Back Character Card Source`: when a `characterCard` meta note is active, push identity/tags from frontmatter and long fields from details markdown back into the source `.png`/`.json` card file.',
        'Optional `Auto-Generate Card Summaries on Sync` adds concise summary/themes/tone fields and marks stale summaries by card hash without overwriting manual summaries.',
        'Bases integration: use view type `LoreVault Characters` in a Base filtered to character-card notes for avatar-card rendering and markdown/HTML field display.',
        'Character-card rewrite now keeps the model output as freeform `authorNoteMarkdown` (no enforced section template in post-processing).',
        'Character-card rewrite prompts now preserve richer description/personality/scenario/system detail and allow longer author-note output when source detail is dense.',
        'Character-card rewrite/extract now includes broader SillyTavern placeholder handling (`{{char}}`, `{{user}}`, `{{persona}}`, `{{random_user_1}}`, etc.) and warns when unresolved placeholders remain.',
        'Known limitation: character-card rewrite/extract currently runs as one request per stage (no chunked fallback), so very large cards can exceed model context limits.',
        'Optional `Extract Character Wiki Page` runs a character-only pass and adds one lorebook-ready character page derived from the card scenario/context.',
        'Character-card preview includes editable planned writes so you can adjust file paths and markdown content before import.',
        'When a synced card meta note exists, generated story notes store `characterCardMeta: [[...]]` for backlink-based related-story tracking.',
        'When the source card is image-based, generated story notes keep a linked avatar reference in frontmatter and embed the image in the note body.',
        '`Import Ebook`: import `.epub` or `.txt` files from the vault in three modes — **Story Chapters** (one linked chapter note per chapter), **Lorebook Extraction** (AI extraction into wiki notes), or **Raw Text Notes**. Load the ebook to preview detected chapters with character counts before importing.',
        '`Extract Wiki Pages from Story`: extract structured wiki pages from story text with selectable completion profile; generated notes auto-link clear cross-page references with Obsidian wikilinks.',
        '`Fork Active Lorebook`: clone one lorebook into a new lorebook/folder and rewrite internal links to the forked pages.',
        '`Apply Story Delta to Existing Wiki` / `Open Lorebook Update`: update existing pages from new story content with selectable completion profile.',
        '`Apply Lore Delta to Existing Wiki` / `Open Lore Delta`: apply an idea/design brief across existing lore notes, with section-aware merge by default and optional focused-note rewrites.',
        'Import/Extraction/Fork default target folder is controlled by `Default Lorebook Import Location` in settings.',
        'All panels show staged progress while preview/apply is running.',
        'Story-delta and rewrite review steps show side-by-side source diffs at the point where you accept/reject changes.'
      ],
      actions: [
        { label: 'Open Ebook Import', onClick: () => void this.plugin.openEbookImportView() },
        { label: 'Open Lorebook Import', onClick: () => void this.plugin.openImportLorebookView() },
        { label: 'Open Character Card Import', onClick: () => void this.plugin.openImportLorebookView('character_card') },
        {
          label: 'Inject Card Event',
          onClick: () => void this.plugin.injectCharacterCardEventFromActiveNote().catch(error => {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`Failed to inject character-card event: ${message}`);
          })
        },
        { label: 'Sync Character Cards', onClick: () => void this.plugin.syncCharacterCardLibrary() },
        { label: 'Write Back Character Card', onClick: () => void this.plugin.writeBackCharacterCardSourceFromActiveNote() },
        { label: 'Open Story Extraction', onClick: () => void this.plugin.openStoryExtractionView() },
        { label: 'Open Lorebook Update', onClick: () => void this.plugin.openStoryDeltaView() },
        { label: 'Open Lore Delta', onClick: () => void this.plugin.openLoreDeltaView() }
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
