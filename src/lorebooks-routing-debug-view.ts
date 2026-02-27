import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import LoreBookConverterPlugin from './main';
import { AssembledContext, ScopeContextPack } from './context-query';
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

function formatTriggerMode(entry: {
  constant: boolean;
  vectorized: boolean;
  selective: boolean;
}): string {
  if (entry.constant) {
    return 'constant';
  }
  if (entry.vectorized) {
    return 'vectorized';
  }
  if (entry.selective) {
    return 'selective';
  }
  return 'none';
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export class LorebooksRoutingDebugView extends ItemView {
  private plugin: LoreBookConverterPlugin;
  private selectedScope: string | null = null;
  private queryText = '';
  private queryTokenBudget = 1024;
  private queryResult: AssembledContext | null = null;
  private queryError = '';
  private queryInFlight = false;
  private renderVersion = 0;

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
    await this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  refresh(): void {
    void this.render();
  }

  setScope(scope: string | null): void {
    const normalized = normalizeScope(scope ?? '');
    this.selectedScope = normalized || null;
    this.queryResult = null;
    this.queryError = '';
    void this.render();
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
      this.queryResult = null;
      this.queryError = '';
      void this.render();
    });

    const refreshButton = toolbar.createEl('button', { text: 'Refresh' });
    refreshButton.addEventListener('click', () => {
      this.queryResult = null;
      this.queryError = '';
      void this.render();
    });

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

  private renderLorebookContents(container: HTMLElement, pack: ScopeContextPack): void {
    const section = container.createDiv({ cls: 'lorevault-routing-section' });
    section.createEl('h3', { text: 'Lorebook Contents (world_info)' });

    const entries = [...pack.worldInfoEntries].sort((a, b) => b.order - a.order || a.uid - b.uid);
    section.createEl('p', {
      cls: 'lorevault-routing-subtle',
      text: `Entries: ${entries.length}`
    });

    if (entries.length === 0) {
      section.createEl('p', { text: 'No world_info entries in this scope.' });
      return;
    }

    const list = section.createDiv({ cls: 'lorevault-routing-entry-list' });
    for (const entry of entries) {
      const details = list.createEl('details', { cls: 'lorevault-routing-entry' });
      const keywords = [...entry.key, ...entry.keysecondary].filter(Boolean);
      details.createEl('summary', {
        text: `${entry.comment || `Entry ${entry.uid}`} | trigger ${formatTriggerMode(entry)} | keys ${keywords.length}`
      });

      details.createEl('p', {
        text: `UID ${entry.uid} | order ${entry.order} | depth ${entry.depth} | probability ${entry.probability}% | selectiveLogic ${entry.selectiveLogic}`
      });
      details.createEl('p', {
        text: `Primary keys: ${entry.key.join(', ') || '(none)'}`
      });
      details.createEl('p', {
        text: `Secondary keys: ${entry.keysecondary.join(', ') || '(none)'}`
      });

      const contentDetails = details.createEl('details', { cls: 'lorevault-routing-content-details' });
      contentDetails.createEl('summary', {
        text: `Content (~${estimateTokens(entry.content)} tokens)`
      });
      contentDetails.createEl('pre', {
        cls: 'lorevault-routing-content',
        text: entry.content || ''
      });
    }
  }

  private renderQuerySimulator(container: HTMLElement, scope: string): void {
    const section = container.createDiv({ cls: 'lorevault-routing-section' });
    section.createEl('h3', { text: 'Query Simulation' });

    const input = section.createEl('textarea', { cls: 'lorevault-routing-query-input' });
    input.placeholder = 'Type text to simulate which world_info entries would be selected and why.';
    input.value = this.queryText;
    input.addEventListener('input', () => {
      this.queryText = input.value;
    });

    const controls = section.createDiv({ cls: 'lorevault-routing-query-controls' });
    controls.createEl('label', { text: 'Token Budget' });
    const budgetInput = controls.createEl('input', { cls: 'lorevault-routing-budget-input', type: 'number' });
    budgetInput.min = '64';
    budgetInput.step = '1';
    budgetInput.value = String(this.queryTokenBudget);
    budgetInput.addEventListener('change', () => {
      const parsed = Number.parseInt(budgetInput.value, 10);
      if (Number.isFinite(parsed) && parsed >= 64) {
        this.queryTokenBudget = parsed;
      }
      budgetInput.value = String(this.queryTokenBudget);
    });

    const runButton = controls.createEl('button', { text: this.queryInFlight ? 'Running...' : 'Run Simulation' });
    runButton.disabled = this.queryInFlight;
    runButton.addEventListener('click', () => {
      void this.runSimulation(scope);
    });

    if (this.queryError) {
      section.createEl('p', {
        cls: 'lorevault-manager-warning-item',
        text: this.queryError
      });
    }

    if (!this.queryResult) {
      section.createEl('p', {
        cls: 'lorevault-routing-subtle',
        text: 'Run a simulation to inspect selected entries and match reasons.'
      });
      return;
    }

    const result = this.queryResult;
    section.createEl('p', {
      text: `Used tokens: ${result.usedTokens}/${result.tokenBudget} | world_info ${result.worldInfo.length} | rag ${result.rag.length}`
    });

    const worldInfoList = section.createDiv({ cls: 'lorevault-routing-entry-list' });
    for (const selected of result.worldInfo) {
      const details = worldInfoList.createEl('details', { cls: 'lorevault-routing-entry' });
      details.createEl('summary', {
        text: `${selected.entry.comment} | score ${selected.score.toFixed(2)} | matched ${selected.matchedKeywords.join(', ') || '(constant/order only)'}`
      });
      details.createEl('p', {
        text: `UID ${selected.entry.uid} | order ${selected.entry.order} | trigger ${formatTriggerMode(selected.entry)} | keys ${selected.entry.key.join(', ') || '(none)'}`
      });
      const contentDetails = details.createEl('details', { cls: 'lorevault-routing-content-details' });
      contentDetails.createEl('summary', { text: `Content (~${estimateTokens(selected.entry.content)} tokens)` });
      contentDetails.createEl('pre', {
        cls: 'lorevault-routing-content',
        text: selected.entry.content || ''
      });
    }

    const ragDetails = section.createEl('details', { cls: 'lorevault-routing-content-details' });
    ragDetails.createEl('summary', {
      text: `RAG candidates (${result.rag.length})`
    });
    if (result.rag.length === 0) {
      ragDetails.createEl('p', { text: 'No rag documents selected.' });
    } else {
      const ragList = ragDetails.createEl('ul');
      for (const item of result.rag) {
        ragList.createEl('li', {
          text: `${item.document.title} | score ${item.score.toFixed(2)} | matched ${item.matchedTerms.join(', ') || '-'}`
        });
      }
    }
  }

  private renderRoutingTable(container: HTMLElement, summary: ScopeSummary): void {
    const section = container.createDiv({ cls: 'lorevault-routing-section' });
    section.createEl('h3', { text: 'Scope Routing Decisions' });

    const tableWrap = section.createDiv({ cls: 'lorevault-manager-table-wrap' });
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

  private async runSimulation(scope: string): Promise<void> {
    const query = this.queryText.trim();
    if (!query) {
      new Notice('Enter query text first.');
      return;
    }

    this.queryInFlight = true;
    this.queryError = '';
    this.queryResult = null;
    await this.render();

    try {
      this.queryResult = await this.plugin.liveContextIndex.query({
        queryText: query,
        tokenBudget: this.queryTokenBudget
      }, scope);
      this.queryError = '';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.queryError = `Simulation failed: ${message}`;
      this.queryResult = null;
    } finally {
      this.queryInFlight = false;
      await this.render();
    }
  }

  private async render(): Promise<void> {
    const version = ++this.renderVersion;
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

    let pack: ScopeContextPack | null = null;
    try {
      pack = await this.plugin.getScopeContextPack(selectedSummary.scope);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      contentEl.createEl('p', {
        cls: 'lorevault-manager-warning-item',
        text: `Failed to load scope pack: ${message}`
      });
    }

    if (version !== this.renderVersion) {
      return;
    }

    if (pack) {
      this.renderLorebookContents(contentEl, pack);
      this.renderQuerySimulator(contentEl, selectedSummary.scope);
    }
    this.renderRoutingTable(contentEl, selectedSummary);
  }
}
