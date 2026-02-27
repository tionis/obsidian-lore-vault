import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import LoreBookConverterPlugin from './main';

export const LOREVAULT_HELP_VIEW_TYPE = 'lorevault-help-view';

interface ActionItem {
  label: string;
  onClick: () => void;
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
    bullets: string[],
    actions: ActionItem[] = []
  ): void {
    const section = container.createDiv({ cls: 'lorevault-help-section' });
    section.createEl('h3', { text: title });
    const list = section.createEl('ul');
    for (const bullet of bullets) {
      list.createEl('li', { text: bullet });
    }

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

    this.renderSection(contentEl, 'Start Here', [
      'Tag notes with #lorebook/... to define scopes.',
      'Use frontmatter keywords/key for world_info routing.',
      'Use frontmatter retrieval to override routing: auto | world_info | rag | both | none.',
      'Build one scope at a time with Build Active Lorebook Scope.'
    ], [
      { label: 'Open Manager', onClick: () => void this.plugin.openLorebooksManagerView() },
      { label: 'Open Routing Debug', onClick: () => void this.plugin.openRoutingDebugView() }
    ]);

    this.renderSection(contentEl, 'Generation and Chat', [
      'Continue Story with Context streams text directly into the editor.',
      'Story Chat provides persistent note-backed chats, forks, and message versions.',
      'Story notes can set lorebook scopes via frontmatter keys: lorebooks, lorebookScopes, lorevaultScopes, activeLorebooks.',
      'Long-form stories can set storyId/chapter/chapterTitle and previousChapter/nextChapter for deterministic chapter memory injection.'
    ], [
      { label: 'Open Story Chat', onClick: () => void this.plugin.openStoryChatView() }
    ]);

    this.renderSection(contentEl, 'Retrieval Controls', [
      'Primary retrieval is graph-first world_info selection.',
      'RAG fallback policy is configurable: off | auto | always.',
      'Graph controls: max hops, hop decay, and seed threshold for auto fallback.',
      'Generation telemetry shows scope usage and token budgets in Manager and Story Chat.'
    ]);

    this.renderSection(contentEl, 'Export Artifacts', [
      'Canonical output is one SQLite pack per scope (<scope>.db).',
      'Downstream outputs are derived from SQLite under the same root (world_info JSON + rag markdown).',
      'Each scope now includes a deterministic manifest (<scope>.manifest.json) for downstream tooling contracts.'
    ]);

    this.renderSection(contentEl, 'Repository Docs', [
      'README.md: quick behavior summary and command-level guide.',
      'docs/documentation.md: detailed behavior and contracts.',
      'docs/technical-reference.md: architecture-level technical detail.',
      'docs/planning.md and docs/todo.md: product roadmap and implementation status.'
    ]);
  }
}
