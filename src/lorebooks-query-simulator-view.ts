import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import LoreBookConverterPlugin from './main';
import { AssembledContext } from './context-query';
import { collectLorebookNoteMetadata } from './lorebooks-manager-collector';
import { buildScopeSummaries } from './lorebooks-manager-data';
import { normalizeScope } from './lorebook-scoping';

export const LOREVAULT_QUERY_SIMULATION_VIEW_TYPE = 'lorevault-query-simulation-view';

interface ScopeQueryResult {
  scope: string;
  result: AssembledContext | null;
  error: string;
}

function formatScopeLabel(scope: string): string {
  return scope || '(all)';
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

export class LorebooksQuerySimulationView extends ItemView {
  private readonly plugin: LoreBookConverterPlugin;
  private readonly selectedScopes = new Set<string>();
  private queryText = '';
  private tokenBudget = 1024;
  private maxGraphHops: number | null = null;
  private graphHopDecay: number | null = null;
  private ragFallbackPolicy: 'off' | 'auto' | 'always' | null = null;
  private ragSeedThreshold: number | null = null;
  private maxWorldInfoEntries: number | null = null;
  private maxRagDocuments: number | null = null;
  private worldInfoBudgetRatio: number | null = null;
  private running = false;
  private results: ScopeQueryResult[] = [];
  private renderVersion = 0;

  constructor(leaf: WorkspaceLeaf, plugin: LoreBookConverterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LOREVAULT_QUERY_SIMULATION_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'LoreVault Query Simulation';
  }

  getIcon(): string {
    return 'flask-conical';
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

  setScopes(scopes: string[]): void {
    this.selectedScopes.clear();
    for (const scope of scopes) {
      const normalized = normalizeScope(scope);
      if (normalized) {
        this.selectedScopes.add(normalized);
      }
    }
    this.results = [];
    void this.render();
  }

  private discoverScopes(): string[] {
    const notes = collectLorebookNoteMetadata(this.app, this.plugin.settings);
    const summaries = buildScopeSummaries(notes, this.plugin.settings);
    return summaries.map(summary => summary.scope).sort((a, b) => a.localeCompare(b));
  }

  private ensureScopeSelection(scopes: string[]): void {
    if (this.selectedScopes.size > 0) {
      return;
    }
    if (scopes.length > 0) {
      this.selectedScopes.add(scopes[0]);
    }
  }

  private parseOptionalInteger(value: string, min: number, max?: number): number | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed < min || (max !== undefined && parsed > max)) {
      return null;
    }
    return parsed;
  }

  private parseOptionalFloat(value: string, min: number, max: number): number | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      return null;
    }
    return parsed;
  }

  private buildQueryOptions(perScopeBudget: number): {
    queryText: string;
    tokenBudget: number;
    maxGraphHops?: number;
    graphHopDecay?: number;
    ragFallbackPolicy?: 'off' | 'auto' | 'always';
    ragFallbackSeedScoreThreshold?: number;
    maxWorldInfoEntries?: number;
    maxRagDocuments?: number;
    worldInfoBudgetRatio?: number;
  } {
    const options: {
      queryText: string;
      tokenBudget: number;
      maxGraphHops?: number;
      graphHopDecay?: number;
      ragFallbackPolicy?: 'off' | 'auto' | 'always';
      ragFallbackSeedScoreThreshold?: number;
      maxWorldInfoEntries?: number;
      maxRagDocuments?: number;
      worldInfoBudgetRatio?: number;
    } = {
      queryText: this.queryText,
      tokenBudget: perScopeBudget
    };

    if (this.maxGraphHops !== null) {
      options.maxGraphHops = this.maxGraphHops;
    }
    if (this.graphHopDecay !== null) {
      options.graphHopDecay = this.graphHopDecay;
    }
    if (this.ragFallbackPolicy !== null) {
      options.ragFallbackPolicy = this.ragFallbackPolicy;
    }
    if (this.ragSeedThreshold !== null) {
      options.ragFallbackSeedScoreThreshold = this.ragSeedThreshold;
    }
    if (this.maxWorldInfoEntries !== null) {
      options.maxWorldInfoEntries = this.maxWorldInfoEntries;
    }
    if (this.maxRagDocuments !== null) {
      options.maxRagDocuments = this.maxRagDocuments;
    }
    if (this.worldInfoBudgetRatio !== null) {
      options.worldInfoBudgetRatio = this.worldInfoBudgetRatio;
    }

    return options;
  }

  private renderToolbar(container: HTMLElement): void {
    const toolbar = container.createDiv({ cls: 'lorevault-routing-toolbar' });

    const refreshButton = toolbar.createEl('button', { text: 'Refresh' });
    refreshButton.addEventListener('click', () => {
      this.results = [];
      void this.render();
    });

    const openRoutingButton = toolbar.createEl('button', { text: 'Open Routing Debug' });
    openRoutingButton.addEventListener('click', () => {
      const scopes = [...this.selectedScopes];
      void this.plugin.openRoutingDebugView(scopes.length === 1 ? scopes[0] : undefined);
    });
  }

  private renderScopeSelector(container: HTMLElement, availableScopes: string[]): void {
    const section = container.createDiv({ cls: 'lorevault-routing-section' });
    section.createEl('h3', { text: 'Scopes to Simulate' });
    section.createEl('p', {
      cls: 'lorevault-routing-subtle',
      text: 'Query runs once per selected lorebook scope with token budget split evenly across selected scopes.'
    });

    const actions = section.createDiv({ cls: 'lorevault-routing-query-controls' });
    const selectAll = actions.createEl('button', { text: 'Select All' });
    selectAll.addEventListener('click', () => {
      this.selectedScopes.clear();
      for (const scope of availableScopes) {
        this.selectedScopes.add(scope);
      }
      this.results = [];
      void this.render();
    });

    const clearAll = actions.createEl('button', { text: 'Clear' });
    clearAll.addEventListener('click', () => {
      this.selectedScopes.clear();
      this.results = [];
      void this.render();
    });

    const list = section.createDiv({ cls: 'lorevault-query-scope-list' });
    for (const scope of availableScopes) {
      const row = list.createDiv({ cls: 'lorevault-query-scope-row' });
      const checkbox = row.createEl('input', {
        type: 'checkbox'
      });
      checkbox.checked = this.selectedScopes.has(scope);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selectedScopes.add(scope);
        } else {
          this.selectedScopes.delete(scope);
        }
        this.results = [];
      });
      row.createSpan({ text: formatScopeLabel(scope) });
    }
  }

  private renderControls(container: HTMLElement): void {
    const section = container.createDiv({ cls: 'lorevault-routing-section' });
    section.createEl('h3', { text: 'Query Controls' });

    const input = section.createEl('textarea', { cls: 'lorevault-routing-query-input' });
    input.placeholder = 'Type text to simulate which world_info/rag items would be selected.';
    input.value = this.queryText;
    input.addEventListener('input', () => {
      this.queryText = input.value;
    });

    const controls = section.createDiv({ cls: 'lorevault-routing-query-controls' });
    controls.createEl('label', { text: 'Total Token Budget' });
    const budgetInput = controls.createEl('input', { cls: 'lorevault-routing-budget-input', type: 'number' });
    budgetInput.min = '64';
    budgetInput.step = '1';
    budgetInput.value = String(this.tokenBudget);
    budgetInput.addEventListener('change', () => {
      const parsed = this.parseOptionalInteger(budgetInput.value, 64);
      if (parsed !== null) {
        this.tokenBudget = parsed;
      }
      budgetInput.value = String(this.tokenBudget);
    });

    const runButton = controls.createEl('button', { text: this.running ? 'Running...' : 'Run Simulation' });
    runButton.disabled = this.running;
    runButton.addEventListener('click', () => {
      void this.runSimulation();
    });

    const advanced = section.createEl('details');
    advanced.createEl('summary', { text: 'Advanced Overrides (optional)' });

    const overrides = advanced.createDiv({ cls: 'lorevault-routing-query-controls' });

    const hopInput = overrides.createEl('input', { cls: 'lorevault-routing-budget-input', type: 'number' });
    hopInput.placeholder = 'maxGraphHops';
    hopInput.value = this.maxGraphHops === null ? '' : String(this.maxGraphHops);
    hopInput.addEventListener('change', () => {
      this.maxGraphHops = this.parseOptionalInteger(hopInput.value, 0, 3);
      hopInput.value = this.maxGraphHops === null ? '' : String(this.maxGraphHops);
      this.results = [];
    });

    const decayInput = overrides.createEl('input', { cls: 'lorevault-routing-budget-input', type: 'number' });
    decayInput.placeholder = 'graphHopDecay (0.2-0.9)';
    decayInput.step = '0.01';
    decayInput.value = this.graphHopDecay === null ? '' : String(this.graphHopDecay);
    decayInput.addEventListener('change', () => {
      this.graphHopDecay = this.parseOptionalFloat(decayInput.value, 0.2, 0.9);
      decayInput.value = this.graphHopDecay === null ? '' : String(this.graphHopDecay);
      this.results = [];
    });

    const ragPolicySelect = overrides.createEl('select', { cls: 'dropdown' });
    ragPolicySelect.createEl('option', { value: '', text: '(default policy)' });
    ragPolicySelect.createEl('option', { value: 'off', text: 'off' });
    ragPolicySelect.createEl('option', { value: 'auto', text: 'auto' });
    ragPolicySelect.createEl('option', { value: 'always', text: 'always' });
    ragPolicySelect.value = this.ragFallbackPolicy ?? '';
    ragPolicySelect.addEventListener('change', () => {
      const value = ragPolicySelect.value;
      this.ragFallbackPolicy = value === 'off' || value === 'always' ? value : (value === 'auto' ? 'auto' : null);
      this.results = [];
    });

    const ragThresholdInput = overrides.createEl('input', { cls: 'lorevault-routing-budget-input', type: 'number' });
    ragThresholdInput.placeholder = 'rag threshold';
    ragThresholdInput.value = this.ragSeedThreshold === null ? '' : String(this.ragSeedThreshold);
    ragThresholdInput.addEventListener('change', () => {
      this.ragSeedThreshold = this.parseOptionalInteger(ragThresholdInput.value, 1);
      ragThresholdInput.value = this.ragSeedThreshold === null ? '' : String(this.ragSeedThreshold);
      this.results = [];
    });

    const worldInfoLimitInput = overrides.createEl('input', { cls: 'lorevault-routing-budget-input', type: 'number' });
    worldInfoLimitInput.placeholder = 'maxWorldInfoEntries';
    worldInfoLimitInput.value = this.maxWorldInfoEntries === null ? '' : String(this.maxWorldInfoEntries);
    worldInfoLimitInput.addEventListener('change', () => {
      this.maxWorldInfoEntries = this.parseOptionalInteger(worldInfoLimitInput.value, 1);
      worldInfoLimitInput.value = this.maxWorldInfoEntries === null ? '' : String(this.maxWorldInfoEntries);
      this.results = [];
    });

    const ragLimitInput = overrides.createEl('input', { cls: 'lorevault-routing-budget-input', type: 'number' });
    ragLimitInput.placeholder = 'maxRagDocuments';
    ragLimitInput.value = this.maxRagDocuments === null ? '' : String(this.maxRagDocuments);
    ragLimitInput.addEventListener('change', () => {
      this.maxRagDocuments = this.parseOptionalInteger(ragLimitInput.value, 1);
      ragLimitInput.value = this.maxRagDocuments === null ? '' : String(this.maxRagDocuments);
      this.results = [];
    });

    const ratioInput = overrides.createEl('input', { cls: 'lorevault-routing-budget-input', type: 'number' });
    ratioInput.placeholder = 'worldInfoBudgetRatio';
    ratioInput.step = '0.05';
    ratioInput.value = this.worldInfoBudgetRatio === null ? '' : String(this.worldInfoBudgetRatio);
    ratioInput.addEventListener('change', () => {
      this.worldInfoBudgetRatio = this.parseOptionalFloat(ratioInput.value, 0.1, 0.95);
      ratioInput.value = this.worldInfoBudgetRatio === null ? '' : String(this.worldInfoBudgetRatio);
      this.results = [];
    });
  }

  private renderResults(container: HTMLElement): void {
    const section = container.createDiv({ cls: 'lorevault-routing-section' });
    section.createEl('h3', { text: 'Simulation Results' });

    if (this.results.length === 0) {
      section.createEl('p', {
        cls: 'lorevault-routing-subtle',
        text: 'Run a simulation to inspect selected entries, scores, and fallback reasons.'
      });
      return;
    }

    const successful = this.results.filter(item => item.result);
    const totalUsed = successful.reduce((sum, item) => sum + (item.result?.usedTokens ?? 0), 0);
    const totalWorldInfo = successful.reduce((sum, item) => sum + (item.result?.worldInfo.length ?? 0), 0);
    const totalRag = successful.reduce((sum, item) => sum + (item.result?.rag.length ?? 0), 0);
    section.createEl('p', {
      text: `Scopes: ${this.results.length} | used tokens: ${totalUsed} | world_info ${totalWorldInfo} | rag ${totalRag}`
    });

    for (const scopeResult of this.results) {
      const details = section.createEl('details', { cls: 'lorevault-routing-entry' });
      details.createEl('summary', { text: `Scope ${formatScopeLabel(scopeResult.scope)}` });

      if (scopeResult.error) {
        details.createEl('p', {
          cls: 'lorevault-manager-warning-item',
          text: scopeResult.error
        });
        continue;
      }

      const result = scopeResult.result;
      if (!result) {
        details.createEl('p', { text: 'No result.' });
        continue;
      }

      details.createEl('p', {
        text: `Used ${result.usedTokens}/${result.tokenBudget} tokens | world_info ${result.worldInfo.length} | rag ${result.rag.length}`
      });
      details.createEl('p', {
        cls: 'lorevault-routing-subtle',
        text: `RAG policy ${result.explainability.rag.policy} | enabled ${result.explainability.rag.enabled ? 'yes' : 'no'} | seed confidence ${result.explainability.rag.seedConfidence.toFixed(2)} (threshold ${result.explainability.rag.threshold})`
      });
      if (result.explainability.worldInfoBudget.droppedUids.length > 0) {
        details.createEl('p', {
          cls: 'lorevault-routing-subtle',
          text: `world_info cutoff: dropped ${result.explainability.worldInfoBudget.droppedUids.length} entries (${result.explainability.worldInfoBudget.droppedByBudget} budget, ${result.explainability.worldInfoBudget.droppedByLimit} max-entry limit)`
        });
      }
      if (result.explainability.worldInfoBudget.bodyLiftedUids.length > 0) {
        details.createEl('p', {
          cls: 'lorevault-routing-subtle',
          text: `world_info body lift: ${result.explainability.worldInfoBudget.bodyLiftedUids.length}/${result.explainability.worldInfoBudget.bodyLiftMaxEntries} entries (cap ${result.explainability.worldInfoBudget.bodyLiftTokenCapPerEntry} tokens each)`
        });
      }

      const worldInfoDetails = details.createEl('details', { cls: 'lorevault-routing-content-details' });
      worldInfoDetails.createEl('summary', {
        text: `world_info (${result.worldInfo.length})`
      });
      if (result.worldInfo.length === 0) {
        worldInfoDetails.createEl('p', { text: 'No world_info entries selected.' });
      } else {
        const list = worldInfoDetails.createDiv({ cls: 'lorevault-routing-entry-list' });
        for (const selected of result.worldInfo) {
          const item = list.createEl('details', { cls: 'lorevault-routing-entry' });
          item.createEl('summary', {
            text: `${selected.entry.comment} | score ${selected.score.toFixed(2)} | tier ${selected.contentTier} | matched ${selected.matchedKeywords.join(', ') || '(graph/constant/order)'}`
          });
          item.createEl('p', {
            text: `UID ${selected.entry.uid} | order ${selected.entry.order} | hop ${selected.hopDistance} | seed ${selected.seedUid ?? '-'} | trigger ${formatTriggerMode(selected.entry)}`
          });
          item.createEl('p', {
            text: `Score breakdown: seed ${selected.scoreBreakdown.seed.toFixed(2)} | graph ${selected.scoreBreakdown.graph.toFixed(2)} | constant ${selected.scoreBreakdown.constant.toFixed(2)} | order ${selected.scoreBreakdown.order.toFixed(2)}`
          });
          item.createEl('p', {
            text: `Path: ${selected.pathUids.length > 0 ? selected.pathUids.join(' -> ') : '(none)'}`
          });
          item.createEl('p', {
            text: `Reasons: ${selected.reasons.join(' | ') || '(none)'}`
          });
          const contentDetails = item.createEl('details', { cls: 'lorevault-routing-content-details' });
          contentDetails.createEl('summary', { text: `Content (~${estimateTokens(selected.includedContent)} tokens)` });
          contentDetails.createEl('pre', {
            cls: 'lorevault-routing-content',
            text: selected.includedContent || ''
          });
        }
      }

      const ragDetails = details.createEl('details', { cls: 'lorevault-routing-content-details' });
      ragDetails.createEl('summary', {
        text: `RAG documents (${result.rag.length})`
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
  }

  private async runSimulation(): Promise<void> {
    const query = this.queryText.trim();
    if (!query) {
      new Notice('Enter query text first.');
      return;
    }

    const scopes = [...this.selectedScopes].sort((a, b) => a.localeCompare(b));
    if (scopes.length === 0) {
      new Notice('Select at least one scope.');
      return;
    }

    this.running = true;
    this.results = [];
    await this.render();

    try {
      const perScopeBudget = Math.max(64, Math.floor(this.tokenBudget / scopes.length));
      const options = this.buildQueryOptions(perScopeBudget);
      const nextResults: ScopeQueryResult[] = [];
      for (const scope of scopes) {
        try {
          const result = await this.plugin.liveContextIndex.query(options, scope);
          nextResults.push({
            scope,
            result,
            error: ''
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          nextResults.push({
            scope,
            result: null,
            error: `Simulation failed: ${message}`
          });
        }
      }
      this.results = nextResults;
    } finally {
      this.running = false;
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
    setIcon(icon, 'flask-conical');
    titleRow.createEl('h2', { text: 'LoreVault Query Simulation' });

    this.renderToolbar(contentEl);

    const scopes = this.discoverScopes();
    if (scopes.length === 0) {
      contentEl.createEl('p', { text: 'No lorebook scopes found.' });
      return;
    }

    this.ensureScopeSelection(scopes);
    if (version !== this.renderVersion) {
      return;
    }

    this.renderScopeSelector(contentEl, scopes);
    this.renderControls(contentEl);
    this.renderResults(contentEl);
  }
}
