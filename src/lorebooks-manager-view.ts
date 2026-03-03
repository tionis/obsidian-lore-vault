import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import LoreBookConverterPlugin from './main';
import { ScopeSummary, buildScopeSummaries } from './lorebooks-manager-data';
import { formatRelativeTime } from './time-format';

export const LOREVAULT_MANAGER_VIEW_TYPE = 'lorevault-manager-view';

function formatScopeLabel(scope: string): string {
  return scope || '(all)';
}

function formatDateTime(timestamp: number): string {
  if (!timestamp) {
    return '-';
  }
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return '-';
  }
}

export class LorebooksManagerView extends ItemView {
  private plugin: LoreBookConverterPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: LoreBookConverterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LOREVAULT_MANAGER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'LoreVault Manager';
  }

  getIcon(): string {
    return 'book-open-text';
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  refresh(): void {
    void this.render();
  }

  private renderToolbar(container: HTMLElement): void {
    const toolbar = container.createDiv({ cls: 'lorevault-manager-toolbar' });

    const routingButton = toolbar.createEl('button', { text: 'Lorebook Auditor' });
    routingButton.addEventListener('click', () => {
      void this.plugin.openLorebookAuditorView();
    });

    const querySimulationButton = toolbar.createEl('button', { text: 'Query Simulation' });
    querySimulationButton.addEventListener('click', () => {
      void this.plugin.openQuerySimulationView();
    });

    const steeringButton = toolbar.createEl('button', { text: 'Story Writing Panel' });
    steeringButton.addEventListener('click', () => {
      void this.plugin.openStorySteeringView();
    });

    const costAnalyzerButton = toolbar.createEl('button', { text: 'Cost Analyzer' });
    costAnalyzerButton.addEventListener('click', () => {
      void this.plugin.openCostAnalyzerView();
    });
  }

  private renderScopeCard(container: HTMLElement, summary: ScopeSummary): void {
    const card = container.createDiv({ cls: 'lorevault-manager-card' });
    card.createDiv({ cls: 'lorevault-manager-card-kicker', text: 'Lorebook' });

    const header = card.createDiv({ cls: 'lorevault-manager-card-header' });
    header.createEl('h3', { text: `Lorebook: ${formatScopeLabel(summary.scope)}` });

    const stats = card.createEl('p', {
      text: `Included Notes: ${summary.includedNotes} | entries: ${summary.worldInfoEntries} | missing keywords: ${summary.keywordlessEntries}`
    });
    stats.addClass('lorevault-manager-stats');

    const lastExport = this.plugin.getScopeLastCanonicalExportTimestamp(summary.scope);
    card.createEl('p', {
      cls: 'lorevault-manager-generation-stats',
      text: `Last canonical export: ${formatDateTime(lastExport)} (${formatRelativeTime(lastExport)})`
    });

    if (summary.warnings.length > 0) {
      const warningList = card.createEl('ul', { cls: 'lorevault-manager-warnings' });
      for (const warning of summary.warnings) {
        const li = warningList.createEl('li', { text: warning });
        li.addClass('lorevault-manager-warning-item');
      }
    }

    const actions = card.createDiv({ cls: 'lorevault-manager-card-actions' });
    const buildButton = actions.createEl('button', {
      text: 'Build/Export'
    });
    buildButton.addClass('mod-cta');
    buildButton.addEventListener('click', async () => {
      try {
        const success = await this.plugin.convertToLorebook(summary.scope, {
          silentSuccessNotice: true
        });
        if (success) {
          new Notice(`Lorebook export finished: ${formatScopeLabel(summary.scope)}`);
          this.render();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Lorebook build failed: ${message}`);
      }
    });

    const inspectButton = actions.createEl('button', { text: 'Auditor' });
    inspectButton.addEventListener('click', () => {
      void this.plugin.openLorebookAuditorView(summary.scope);
    });
  }

  private renderScopesSection(container: HTMLElement, summaries: ScopeSummary[]): void {
    const section = container.createDiv({ cls: 'lorevault-manager-section' });
    section.createEl('h3', { text: 'Lorebooks' });
    const grid = section.createDiv({ cls: 'lorevault-manager-scope-grid' });

    for (const summary of summaries) {
      this.renderScopeCard(grid, summary);
    }
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-manager-view');

    const titleRow = contentEl.createDiv({ cls: 'lorevault-manager-title-row' });
    const icon = titleRow.createSpan({ cls: 'lorevault-manager-icon' });
    setIcon(icon, 'book-open-text');
    titleRow.createEl('h2', { text: 'LoreVault Manager' });

    const refreshButton = titleRow.createEl('button', {
      cls: 'clickable-icon lorevault-manager-refresh-icon',
      attr: {
        'aria-label': 'Refresh LoreVault Manager',
        title: 'Refresh'
      }
    });
    setIcon(refreshButton, 'refresh-cw');
    refreshButton.addEventListener('click', () => {
      void this.render();
    });

    this.renderToolbar(contentEl);

    const notes = this.plugin.getCachedLorebookMetadata();
    const summaries = buildScopeSummaries(notes, this.plugin.settings);

    if (summaries.length === 0) {
      contentEl.createEl('p', {
        text: 'No lorebooks found. Add tags under your configured prefix (for example #lorebook/universe).'
      });
      return;
    }

    this.renderScopesSection(contentEl, summaries);
  }
}
