import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import LoreBookConverterPlugin from './main';
import { collectLorebookNoteMetadata } from './lorebooks-manager-collector';
import { buildScopeSummaries, ScopeSummary } from './lorebooks-manager-data';
import { normalizeScope } from './lorebook-scoping';

export const LOREVAULT_ROUTING_DEBUG_VIEW_TYPE = 'lorevault-routing-debug-view';

function formatScopeLabel(scope: string): string {
  return scope || '(all)';
}

function formatRouteBadge(includeWorldInfo: boolean, includeRag: boolean): string {
  if (includeWorldInfo && includeRag) {
    return 'world_info + rag';
  }
  if (includeWorldInfo) {
    return 'world_info';
  }
  if (includeRag) {
    return 'rag';
  }
  return '-';
}

function formatReason(reason: string): string {
  switch (reason) {
    case 'included':
      return 'included';
    case 'excluded_by_frontmatter':
      return 'excluded: frontmatter exclude';
    case 'scope_mismatch':
      return 'excluded: scope mismatch';
    case 'untagged_excluded':
      return 'excluded: untagged note';
    case 'retrieval_disabled':
      return 'excluded: retrieval disabled';
    default:
      return reason;
  }
}

export class LorebooksRoutingDebugView extends ItemView {
  private plugin: LoreBookConverterPlugin;
  private selectedScope: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: LoreBookConverterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LOREVAULT_ROUTING_DEBUG_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'LoreVault Routing Debug';
  }

  getIcon(): string {
    return 'binary';
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

  setScope(scope: string | null): void {
    const normalized = normalizeScope(scope ?? '');
    this.selectedScope = normalized || null;
    this.render();
  }

  private pickActiveSummary(summaries: ScopeSummary[]): ScopeSummary | null {
    if (summaries.length === 0) {
      return null;
    }

    if (this.selectedScope) {
      const matched = summaries.find(summary => summary.scope === this.selectedScope);
      if (matched) {
        return matched;
      }
    }

    const fallback = summaries[0];
    this.selectedScope = fallback.scope || null;
    return fallback;
  }

  private renderToolbar(container: HTMLElement, summaries: ScopeSummary[]): ScopeSummary | null {
    const toolbar = container.createDiv({ cls: 'lorevault-routing-toolbar' });

    toolbar.createEl('span', { text: 'Scope:' });
    const scopeSelect = toolbar.createEl('select', { cls: 'dropdown' });
    for (const summary of summaries) {
      const option = scopeSelect.createEl('option');
      option.value = summary.scope;
      option.text = formatScopeLabel(summary.scope);
    }

    const selectedSummary = this.pickActiveSummary(summaries);
    if (selectedSummary) {
      scopeSelect.value = selectedSummary.scope;
    }

    scopeSelect.addEventListener('change', () => {
      this.selectedScope = normalizeScope(scopeSelect.value) || null;
      this.render();
    });

    const refreshButton = toolbar.createEl('button', { text: 'Refresh' });
    refreshButton.addEventListener('click', () => this.render());

    return selectedSummary;
  }

  private renderSummaryHeader(container: HTMLElement, summary: ScopeSummary): void {
    const section = container.createDiv({ cls: 'lorevault-routing-summary' });
    section.createEl('p', {
      text: `Scope ${formatScopeLabel(summary.scope)} | included ${summary.includedNotes} | world_info ${summary.worldInfoEntries} | rag ${summary.ragDocuments}`
    });

    const included = summary.notes.filter(note => note.included).length;
    const excluded = summary.notes.length - included;
    section.createEl('p', {
      text: `Notes processed: ${summary.notes.length} | included: ${included} | excluded: ${excluded}`
    });

    if (summary.warnings.length > 0) {
      const warningList = section.createEl('ul', { cls: 'lorevault-manager-warnings' });
      for (const warning of summary.warnings) {
        const li = warningList.createEl('li', { text: warning });
        li.addClass('lorevault-manager-warning-item');
      }
    }
  }

  private renderTable(container: HTMLElement, summary: ScopeSummary): void {
    const tableWrap = container.createDiv({ cls: 'lorevault-manager-table-wrap' });
    const table = tableWrap.createEl('table', { cls: 'lorevault-manager-table' });
    const headRow = table.createEl('thead').createEl('tr');
    headRow.createEl('th', { text: 'Note' });
    headRow.createEl('th', { text: 'Decision' });
    headRow.createEl('th', { text: 'Route' });
    headRow.createEl('th', { text: 'Retrieval' });
    headRow.createEl('th', { text: 'Keywords' });
    headRow.createEl('th', { text: 'Scopes' });

    const tbody = table.createEl('tbody');
    for (const note of summary.notes) {
      const row = tbody.createEl('tr');
      row.createEl('td', { text: note.path });
      row.createEl('td', { text: formatReason(note.reason) });
      row.createEl('td', { text: formatRouteBadge(note.includeWorldInfo, note.includeRag) });
      row.createEl('td', { text: note.retrievalMode });
      row.createEl('td', { text: note.hasKeywords ? 'yes' : 'no' });
      row.createEl('td', { text: note.scopes.join(', ') || '-' });
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-routing-view');

    const titleRow = contentEl.createDiv({ cls: 'lorevault-routing-title-row' });
    const icon = titleRow.createSpan({ cls: 'lorevault-routing-icon' });
    setIcon(icon, 'binary');
    titleRow.createEl('h2', { text: 'LoreVault Routing Debug' });

    const notes = collectLorebookNoteMetadata(this.app, this.plugin.settings);
    const summaries = buildScopeSummaries(notes, this.plugin.settings);
    if (summaries.length === 0) {
      contentEl.createEl('p', { text: 'No lorebook scopes found.' });
      return;
    }

    const selectedSummary = this.renderToolbar(contentEl, summaries);
    if (!selectedSummary) {
      contentEl.createEl('p', { text: 'No scope available.' });
      return;
    }

    this.renderSummaryHeader(contentEl, selectedSummary);
    this.renderTable(contentEl, selectedSummary);
  }
}
