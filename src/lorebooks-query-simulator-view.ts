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
  private tokenBudget: number | null = null;
  private maxGraphHops: number | null = null;
  private graphHopDecay: number | null = null;
  private ragFallbackPolicy: 'off' | 'auto' | 'always' | null = null;
  private ragSeedThreshold: number | null = null;
  private includeBacklinksInGraphExpansion: boolean | null = null;
  private maxWorldInfoEntries: number | null = null;
  private maxRagDocuments: number | null = null;
  private worldInfoBudgetRatio: number | null = null;
  private worldInfoBodyLiftEnabled: boolean | null = null;
  private worldInfoBodyLiftMaxEntries: number | null = null;
  private worldInfoBodyLiftTokenCapPerEntry: number | null = null;
  private worldInfoBodyLiftMinScore: number | null = null;
  private worldInfoBodyLiftMaxHopDistance: number | null = null;
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

  private createOverrideField(
    container: HTMLElement,
    labelText: string,
    defaultText: string
  ): HTMLDivElement {
    const field = container.createDiv({ cls: 'lorevault-routing-override-field' });
    field.createEl('label', {
      cls: 'lorevault-routing-override-label',
      text: `${labelText} (${defaultText})`
    });
    return field;
  }

  private getDefaultTokenBudget(): number {
    return Math.max(64, Math.floor(Number(this.plugin.settings.defaultLoreBook.tokenBudget) || 1024));
  }

  private getEffectiveTokenBudget(): number {
    return this.tokenBudget ?? this.getDefaultTokenBudget();
  }

  private getDefaultMaxGraphHops(): number {
    return Math.max(0, Math.min(3, Math.floor(Number(this.plugin.settings.retrieval.maxGraphHops) || 2)));
  }

  private getEffectiveMaxGraphHops(): number {
    return this.maxGraphHops ?? this.getDefaultMaxGraphHops();
  }

  private getDefaultGraphHopDecay(): number {
    const value = Number(this.plugin.settings.retrieval.graphHopDecay);
    if (!Number.isFinite(value)) {
      return 0.55;
    }
    return Math.max(0.2, Math.min(0.9, value));
  }

  private getEffectiveGraphHopDecay(): number {
    return this.graphHopDecay ?? this.getDefaultGraphHopDecay();
  }

  private getDefaultRagFallbackPolicy(): 'off' | 'auto' | 'always' {
    const value = this.plugin.settings.retrieval.ragFallbackPolicy;
    return value === 'off' || value === 'always' ? value : 'auto';
  }

  private getEffectiveRagFallbackPolicy(): 'off' | 'auto' | 'always' {
    return this.ragFallbackPolicy ?? this.getDefaultRagFallbackPolicy();
  }

  private getDefaultRagSeedThreshold(): number {
    return Math.max(1, Math.floor(Number(this.plugin.settings.retrieval.ragFallbackSeedScoreThreshold) || 120));
  }

  private getEffectiveRagSeedThreshold(): number {
    return this.ragSeedThreshold ?? this.getDefaultRagSeedThreshold();
  }

  private getDefaultIncludeBacklinksInGraphExpansion(): boolean {
    return Boolean(this.plugin.settings.retrieval.includeBacklinksInGraphExpansion);
  }

  private getEffectiveIncludeBacklinksInGraphExpansion(): boolean {
    return this.includeBacklinksInGraphExpansion ?? this.getDefaultIncludeBacklinksInGraphExpansion();
  }

  private getDefaultWorldInfoBudgetRatio(): number {
    return 0.7;
  }

  private getEffectiveWorldInfoBudgetRatio(): number {
    return this.worldInfoBudgetRatio ?? this.getDefaultWorldInfoBudgetRatio();
  }

  private getDefaultMaxWorldInfoEntries(): number {
    return 8;
  }

  private getEffectiveMaxWorldInfoEntries(): number {
    return this.maxWorldInfoEntries ?? this.getDefaultMaxWorldInfoEntries();
  }

  private getDefaultMaxRagDocuments(): number {
    return 6;
  }

  private getEffectiveMaxRagDocuments(): number {
    return this.maxRagDocuments ?? this.getDefaultMaxRagDocuments();
  }

  private getDefaultBodyLiftEnabled(): boolean {
    return true;
  }

  private getEffectiveBodyLiftEnabled(): boolean {
    return this.worldInfoBodyLiftEnabled ?? this.getDefaultBodyLiftEnabled();
  }

  private getDefaultBodyLiftMaxEntries(): number {
    const budget = this.getEffectiveTokenBudget();
    return Math.max(1, Math.min(4, Math.floor(budget / 2500) + 1));
  }

  private getEffectiveBodyLiftMaxEntries(): number {
    return this.worldInfoBodyLiftMaxEntries ?? this.getDefaultBodyLiftMaxEntries();
  }

  private getDefaultBodyLiftTokenCapPerEntry(): number {
    const budget = this.getEffectiveTokenBudget();
    return Math.max(180, Math.min(1200, Math.floor(budget * 0.12)));
  }

  private getEffectiveBodyLiftTokenCapPerEntry(): number {
    return this.worldInfoBodyLiftTokenCapPerEntry ?? this.getDefaultBodyLiftTokenCapPerEntry();
  }

  private getDefaultBodyLiftMinScore(): number {
    return 90;
  }

  private getEffectiveBodyLiftMinScore(): number {
    return this.worldInfoBodyLiftMinScore ?? this.getDefaultBodyLiftMinScore();
  }

  private getDefaultBodyLiftMaxHopDistance(): number {
    return 1;
  }

  private getEffectiveBodyLiftMaxHopDistance(): number {
    return this.worldInfoBodyLiftMaxHopDistance ?? this.getDefaultBodyLiftMaxHopDistance();
  }

  private buildQueryOptions(perScopeBudget: number): {
    queryText: string;
    tokenBudget: number;
    maxGraphHops?: number;
    graphHopDecay?: number;
    ragFallbackPolicy?: 'off' | 'auto' | 'always';
    ragFallbackSeedScoreThreshold?: number;
    includeBacklinksInGraphExpansion?: boolean;
    maxWorldInfoEntries?: number;
    maxRagDocuments?: number;
    worldInfoBudgetRatio?: number;
    worldInfoBodyLiftEnabled?: boolean;
    worldInfoBodyLiftMaxEntries?: number;
    worldInfoBodyLiftTokenCapPerEntry?: number;
    worldInfoBodyLiftMinScore?: number;
    worldInfoBodyLiftMaxHopDistance?: number;
  } {
    const options: {
      queryText: string;
      tokenBudget: number;
      maxGraphHops?: number;
      graphHopDecay?: number;
      ragFallbackPolicy?: 'off' | 'auto' | 'always';
      ragFallbackSeedScoreThreshold?: number;
      includeBacklinksInGraphExpansion?: boolean;
      maxWorldInfoEntries?: number;
      maxRagDocuments?: number;
      worldInfoBudgetRatio?: number;
      worldInfoBodyLiftEnabled?: boolean;
      worldInfoBodyLiftMaxEntries?: number;
      worldInfoBodyLiftTokenCapPerEntry?: number;
      worldInfoBodyLiftMinScore?: number;
      worldInfoBodyLiftMaxHopDistance?: number;
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
    if (this.includeBacklinksInGraphExpansion !== null) {
      options.includeBacklinksInGraphExpansion = this.includeBacklinksInGraphExpansion;
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
    if (this.worldInfoBodyLiftEnabled !== null) {
      options.worldInfoBodyLiftEnabled = this.worldInfoBodyLiftEnabled;
    }
    if (this.worldInfoBodyLiftMaxEntries !== null) {
      options.worldInfoBodyLiftMaxEntries = this.worldInfoBodyLiftMaxEntries;
    }
    if (this.worldInfoBodyLiftTokenCapPerEntry !== null) {
      options.worldInfoBodyLiftTokenCapPerEntry = this.worldInfoBodyLiftTokenCapPerEntry;
    }
    if (this.worldInfoBodyLiftMinScore !== null) {
      options.worldInfoBodyLiftMinScore = this.worldInfoBodyLiftMinScore;
    }
    if (this.worldInfoBodyLiftMaxHopDistance !== null) {
      options.worldInfoBodyLiftMaxHopDistance = this.worldInfoBodyLiftMaxHopDistance;
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

    const openRoutingButton = toolbar.createEl('button', { text: 'Open Lorebook Auditor' });
    openRoutingButton.addEventListener('click', () => {
      const scopes = [...this.selectedScopes];
      void this.plugin.openLorebookAuditorView(scopes.length === 1 ? scopes[0] : undefined);
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
    input.placeholder = 'Type text to simulate which lore entries would be selected (graph + fallback retrieval).';
    input.value = this.queryText;
    input.addEventListener('input', () => {
      this.queryText = input.value;
    });

    const controls = section.createDiv({ cls: 'lorevault-routing-query-controls' });
    controls.createEl('label', { text: `Total Token Budget (default ${this.getDefaultTokenBudget()})` });
    const budgetInput = controls.createEl('input', { cls: 'lorevault-routing-budget-input', type: 'number' });
    budgetInput.min = '64';
    budgetInput.step = '1';
    budgetInput.value = String(this.getEffectiveTokenBudget());
    budgetInput.addEventListener('change', () => {
      const parsed = this.parseOptionalInteger(budgetInput.value, 64);
      const defaultBudget = this.getDefaultTokenBudget();
      this.tokenBudget = parsed === null || parsed === defaultBudget ? null : parsed;
      budgetInput.value = String(this.getEffectiveTokenBudget());
      this.results = [];
      void this.render();
    });

    const runButton = controls.createEl('button', { text: this.running ? 'Running...' : 'Run Simulation' });
    runButton.disabled = this.running;
    runButton.addEventListener('click', () => {
      void this.runSimulation();
    });

    const advanced = section.createEl('details');
    advanced.createEl('summary', { text: 'Advanced Overrides (optional)' });

    const overrides = advanced.createDiv({ cls: 'lorevault-routing-override-grid' });

    const hopField = this.createOverrideField(overrides, 'Max Graph Hops', String(this.getDefaultMaxGraphHops()));
    const hopInput = hopField.createEl('input', { cls: 'lorevault-routing-budget-input', type: 'number' });
    hopInput.placeholder = '0-3';
    hopInput.value = String(this.getEffectiveMaxGraphHops());
    hopInput.addEventListener('change', () => {
      const parsed = this.parseOptionalInteger(hopInput.value, 0, 3);
      const defaultValue = this.getDefaultMaxGraphHops();
      this.maxGraphHops = parsed === null || parsed === defaultValue ? null : parsed;
      hopInput.value = String(this.getEffectiveMaxGraphHops());
      this.results = [];
    });

    const decayField = this.createOverrideField(overrides, 'Graph Hop Decay', String(this.getDefaultGraphHopDecay()));
    const decayInput = decayField.createEl('input', { cls: 'lorevault-routing-budget-input', type: 'number' });
    decayInput.placeholder = '0.2-0.9';
    decayInput.step = '0.01';
    decayInput.value = String(this.getEffectiveGraphHopDecay());
    decayInput.addEventListener('change', () => {
      const parsed = this.parseOptionalFloat(decayInput.value, 0.2, 0.9);
      const defaultValue = this.getDefaultGraphHopDecay();
      this.graphHopDecay = parsed === null || Math.abs(parsed - defaultValue) < 1e-9 ? null : parsed;
      decayInput.value = String(this.getEffectiveGraphHopDecay());
      this.results = [];
    });

    const ragPolicyField = this.createOverrideField(overrides, 'Fallback Retrieval Policy', this.getDefaultRagFallbackPolicy());
    const ragPolicySelect = ragPolicyField.createEl('select', { cls: 'dropdown' });
    ragPolicySelect.createEl('option', { value: '', text: `Reset (default ${this.getDefaultRagFallbackPolicy()})` });
    ragPolicySelect.createEl('option', { value: 'off', text: 'off' });
    ragPolicySelect.createEl('option', { value: 'auto', text: 'auto' });
    ragPolicySelect.createEl('option', { value: 'always', text: 'always' });
    ragPolicySelect.value = this.getEffectiveRagFallbackPolicy();
    ragPolicySelect.addEventListener('change', () => {
      const value = ragPolicySelect.value;
      const parsed = value === 'off' || value === 'always' ? value : (value === 'auto' ? 'auto' : null);
      const defaultValue = this.getDefaultRagFallbackPolicy();
      this.ragFallbackPolicy = parsed === null || parsed === defaultValue ? null : parsed;
      ragPolicySelect.value = this.getEffectiveRagFallbackPolicy();
      this.results = [];
    });

    const ragThresholdField = this.createOverrideField(overrides, 'Fallback Seed Threshold', String(this.getDefaultRagSeedThreshold()));
    const ragThresholdInput = ragThresholdField.createEl('input', { cls: 'lorevault-routing-budget-input', type: 'number' });
    ragThresholdInput.placeholder = '>= 1';
    ragThresholdInput.value = String(this.getEffectiveRagSeedThreshold());
    ragThresholdInput.addEventListener('change', () => {
      const parsed = this.parseOptionalInteger(ragThresholdInput.value, 1);
      const defaultValue = this.getDefaultRagSeedThreshold();
      this.ragSeedThreshold = parsed === null || parsed === defaultValue ? null : parsed;
      ragThresholdInput.value = String(this.getEffectiveRagSeedThreshold());
      this.results = [];
    });

    const backlinksField = this.createOverrideField(
      overrides,
      'Include Backlinks in Graph Expansion',
      this.getDefaultIncludeBacklinksInGraphExpansion() ? 'on' : 'off'
    );
    const backlinksSelect = backlinksField.createEl('select', { cls: 'dropdown' });
    backlinksSelect.createEl('option', { value: '', text: `Reset (default ${this.getDefaultIncludeBacklinksInGraphExpansion() ? 'on' : 'off'})` });
    backlinksSelect.createEl('option', { value: 'true', text: 'Backlinks on' });
    backlinksSelect.createEl('option', { value: 'false', text: 'Backlinks off' });
    backlinksSelect.value = this.getEffectiveIncludeBacklinksInGraphExpansion() ? 'true' : 'false';
    backlinksSelect.addEventListener('change', () => {
      if (backlinksSelect.value === 'true') {
        this.includeBacklinksInGraphExpansion = true;
      } else if (backlinksSelect.value === 'false') {
        this.includeBacklinksInGraphExpansion = false;
      } else {
        this.includeBacklinksInGraphExpansion = null;
      }
      const defaultValue = this.getDefaultIncludeBacklinksInGraphExpansion();
      if (this.includeBacklinksInGraphExpansion === defaultValue) {
        this.includeBacklinksInGraphExpansion = null;
      }
      backlinksSelect.value = this.getEffectiveIncludeBacklinksInGraphExpansion() ? 'true' : 'false';
      this.results = [];
    });

    const worldInfoLimitField = this.createOverrideField(overrides, 'Max world_info Entries', String(this.getDefaultMaxWorldInfoEntries()));
    const worldInfoLimitInput = worldInfoLimitField.createEl('input', { cls: 'lorevault-routing-budget-input', type: 'number' });
    worldInfoLimitInput.placeholder = '>= 1';
    worldInfoLimitInput.value = String(this.getEffectiveMaxWorldInfoEntries());
    worldInfoLimitInput.addEventListener('change', () => {
      const parsed = this.parseOptionalInteger(worldInfoLimitInput.value, 1);
      const defaultValue = this.getDefaultMaxWorldInfoEntries();
      this.maxWorldInfoEntries = parsed === null || parsed === defaultValue ? null : parsed;
      worldInfoLimitInput.value = String(this.getEffectiveMaxWorldInfoEntries());
      this.results = [];
    });

    const ragLimitField = this.createOverrideField(overrides, 'Max Fallback Entries', String(this.getDefaultMaxRagDocuments()));
    const ragLimitInput = ragLimitField.createEl('input', { cls: 'lorevault-routing-budget-input', type: 'number' });
    ragLimitInput.placeholder = '>= 1';
    ragLimitInput.value = String(this.getEffectiveMaxRagDocuments());
    ragLimitInput.addEventListener('change', () => {
      const parsed = this.parseOptionalInteger(ragLimitInput.value, 1);
      const defaultValue = this.getDefaultMaxRagDocuments();
      this.maxRagDocuments = parsed === null || parsed === defaultValue ? null : parsed;
      ragLimitInput.value = String(this.getEffectiveMaxRagDocuments());
      this.results = [];
    });

    const ratioField = this.createOverrideField(overrides, 'world_info Budget Ratio', String(this.getDefaultWorldInfoBudgetRatio()));
    const ratioInput = ratioField.createEl('input', { cls: 'lorevault-routing-budget-input', type: 'number' });
    ratioInput.placeholder = '0.1-0.95';
    ratioInput.step = '0.05';
    ratioInput.value = String(this.getEffectiveWorldInfoBudgetRatio());
    ratioInput.addEventListener('change', () => {
      const parsed = this.parseOptionalFloat(ratioInput.value, 0.1, 0.95);
      const defaultValue = this.getDefaultWorldInfoBudgetRatio();
      this.worldInfoBudgetRatio = parsed === null || Math.abs(parsed - defaultValue) < 1e-9 ? null : parsed;
      ratioInput.value = String(this.getEffectiveWorldInfoBudgetRatio());
      this.results = [];
    });

    const bodyLiftEnabledField = this.createOverrideField(
      overrides,
      'Body Lift Enabled',
      this.getDefaultBodyLiftEnabled() ? 'on' : 'off'
    );
    const bodyLiftEnabledSelect = bodyLiftEnabledField.createEl('select', { cls: 'dropdown' });
    bodyLiftEnabledSelect.createEl('option', { value: '', text: `Reset (default ${this.getDefaultBodyLiftEnabled() ? 'on' : 'off'})` });
    bodyLiftEnabledSelect.createEl('option', { value: 'true', text: 'bodyLift on' });
    bodyLiftEnabledSelect.createEl('option', { value: 'false', text: 'bodyLift off' });
    bodyLiftEnabledSelect.value = this.getEffectiveBodyLiftEnabled() ? 'true' : 'false';
    bodyLiftEnabledSelect.addEventListener('change', () => {
      if (bodyLiftEnabledSelect.value === 'true') {
        this.worldInfoBodyLiftEnabled = true;
      } else if (bodyLiftEnabledSelect.value === 'false') {
        this.worldInfoBodyLiftEnabled = false;
      } else {
        this.worldInfoBodyLiftEnabled = null;
      }
      const defaultValue = this.getDefaultBodyLiftEnabled();
      if (this.worldInfoBodyLiftEnabled === defaultValue) {
        this.worldInfoBodyLiftEnabled = null;
      }
      bodyLiftEnabledSelect.value = this.getEffectiveBodyLiftEnabled() ? 'true' : 'false';
      this.results = [];
    });

    const bodyLiftEntriesField = this.createOverrideField(
      overrides,
      'Body Lift Max Entries',
      String(this.getDefaultBodyLiftMaxEntries())
    );
    const bodyLiftEntriesInput = bodyLiftEntriesField.createEl('input', { cls: 'lorevault-routing-budget-input', type: 'number' });
    bodyLiftEntriesInput.placeholder = '1-8';
    bodyLiftEntriesInput.value = String(this.getEffectiveBodyLiftMaxEntries());
    bodyLiftEntriesInput.addEventListener('change', () => {
      const parsed = this.parseOptionalInteger(bodyLiftEntriesInput.value, 1, 8);
      const defaultValue = this.getDefaultBodyLiftMaxEntries();
      this.worldInfoBodyLiftMaxEntries = parsed === null || parsed === defaultValue ? null : parsed;
      bodyLiftEntriesInput.value = String(this.getEffectiveBodyLiftMaxEntries());
      this.results = [];
    });

    const bodyLiftCapField = this.createOverrideField(
      overrides,
      'Body Lift Token Cap / Entry',
      String(this.getDefaultBodyLiftTokenCapPerEntry())
    );
    const bodyLiftCapInput = bodyLiftCapField.createEl('input', { cls: 'lorevault-routing-budget-input', type: 'number' });
    bodyLiftCapInput.placeholder = '80-2400';
    bodyLiftCapInput.value = String(this.getEffectiveBodyLiftTokenCapPerEntry());
    bodyLiftCapInput.addEventListener('change', () => {
      const parsed = this.parseOptionalInteger(bodyLiftCapInput.value, 80, 2400);
      const defaultValue = this.getDefaultBodyLiftTokenCapPerEntry();
      this.worldInfoBodyLiftTokenCapPerEntry = parsed === null || parsed === defaultValue ? null : parsed;
      bodyLiftCapInput.value = String(this.getEffectiveBodyLiftTokenCapPerEntry());
      this.results = [];
    });

    const bodyLiftMinScoreField = this.createOverrideField(
      overrides,
      'Body Lift Min Score',
      String(this.getDefaultBodyLiftMinScore())
    );
    const bodyLiftMinScoreInput = bodyLiftMinScoreField.createEl('input', { cls: 'lorevault-routing-budget-input', type: 'number' });
    bodyLiftMinScoreInput.placeholder = '>= 1';
    bodyLiftMinScoreInput.step = '0.1';
    bodyLiftMinScoreInput.value = String(this.getEffectiveBodyLiftMinScore());
    bodyLiftMinScoreInput.addEventListener('change', () => {
      const parsed = this.parseOptionalFloat(bodyLiftMinScoreInput.value, 1, 10000);
      const defaultValue = this.getDefaultBodyLiftMinScore();
      this.worldInfoBodyLiftMinScore = parsed === null || Math.abs(parsed - defaultValue) < 1e-9 ? null : parsed;
      bodyLiftMinScoreInput.value = String(this.getEffectiveBodyLiftMinScore());
      this.results = [];
    });

    const bodyLiftHopField = this.createOverrideField(
      overrides,
      'Body Lift Max Hop Distance',
      String(this.getDefaultBodyLiftMaxHopDistance())
    );
    const bodyLiftHopInput = bodyLiftHopField.createEl('input', { cls: 'lorevault-routing-budget-input', type: 'number' });
    bodyLiftHopInput.placeholder = '0-3';
    bodyLiftHopInput.value = String(this.getEffectiveBodyLiftMaxHopDistance());
    bodyLiftHopInput.addEventListener('change', () => {
      const parsed = this.parseOptionalInteger(bodyLiftHopInput.value, 0, 3);
      const defaultValue = this.getDefaultBodyLiftMaxHopDistance();
      this.worldInfoBodyLiftMaxHopDistance = parsed === null || parsed === defaultValue ? null : parsed;
      bodyLiftHopInput.value = String(this.getEffectiveBodyLiftMaxHopDistance());
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
      text: `Scopes: ${this.results.length} | used tokens: ${totalUsed} | world_info ${totalWorldInfo} | fallback ${totalRag}`
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
        text: `Used ${result.usedTokens}/${result.tokenBudget} tokens | world_info ${result.worldInfo.length} | fallback ${result.rag.length}`
      });
      const tierCounts = result.worldInfo.reduce((counts, item) => {
        counts[item.contentTier] = (counts[item.contentTier] ?? 0) + 1;
        return counts;
      }, {} as Record<string, number>);
      details.createEl('p', {
        cls: 'lorevault-routing-subtle',
        text: `world_info tiers: short ${tierCounts.short ?? 0}, medium ${tierCounts.medium ?? 0}, full ${tierCounts.full ?? 0}, full_body ${tierCounts.full_body ?? 0}`
      });
      details.createEl('p', {
        cls: 'lorevault-routing-subtle',
        text: `Graph backlinks: ${result.explainability.graph.includeBacklinksInGraphExpansion ? 'enabled' : 'disabled'}`
      });
      details.createEl('p', {
        cls: 'lorevault-routing-subtle',
        text: `fallback policy ${result.explainability.rag.policy} | enabled ${result.explainability.rag.enabled ? 'yes' : 'no'} | seed confidence ${result.explainability.rag.seedConfidence.toFixed(2)} (threshold ${result.explainability.rag.threshold})`
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
      const bodyLift = result.explainability.worldInfoBudget.bodyLift;
      details.createEl('p', {
        cls: 'lorevault-routing-subtle',
        text: `body lift config: ${bodyLift.enabled ? 'enabled' : 'disabled'} | min score ${bodyLift.minScore.toFixed(2)} | max hop ${bodyLift.maxHopDistance} | budget ${bodyLift.usedBudget}/${bodyLift.allocatedBudget} (borrowed ${bodyLift.borrowedRagBudget})`
      });
      const bodyLiftDetails = details.createEl('details', { cls: 'lorevault-routing-content-details' });
      bodyLiftDetails.createEl('summary', {
        text: `Body Lift Decisions (${bodyLift.decisions.length})`
      });
      if (bodyLift.decisions.length === 0) {
        bodyLiftDetails.createEl('p', { text: 'No body-lift decisions recorded.' });
      } else {
        const bodyLiftList = bodyLiftDetails.createEl('ul');
        for (const decision of bodyLift.decisions) {
          bodyLiftList.createEl('li', {
            text: `${decision.comment} [uid ${decision.uid}] | ${decision.status} | score ${decision.score.toFixed(2)} | hop ${decision.hopDistance} | tier ${decision.fromTier} -> ${decision.toTier} | ${decision.reason}`
          });
        }
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
        text: `Fallback Entries (${result.rag.length})`
      });
      if (result.rag.length === 0) {
        ragDetails.createEl('p', { text: 'No fallback entries selected.' });
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
      const perScopeBudget = Math.max(64, Math.floor(this.getEffectiveTokenBudget() / scopes.length));
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
