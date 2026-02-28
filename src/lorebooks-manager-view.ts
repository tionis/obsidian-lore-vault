import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import LoreBookConverterPlugin from './main';
import { ScopeSummary, buildScopeSummaries } from './lorebooks-manager-data';
import { UsageLedgerTotals } from './usage-ledger-report';
import { PromptLayerUsage } from './models';

export const LOREVAULT_MANAGER_VIEW_TYPE = 'lorevault-manager-view';

function formatScopeLabel(scope: string): string {
  return scope || '(all)';
}

function formatTokenValue(value: number): string {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)).toString() : '0';
}

function formatSecondsAgo(timestamp: number): string {
  if (!timestamp) {
    return '-';
  }
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  return `${seconds} second${seconds === 1 ? '' : 's'} ago`;
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

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '$0.0000';
  }
  return `$${value.toFixed(4)}`;
}

function formatCostSummary(label: string, totals: UsageLedgerTotals): string {
  return `${label}: ${totals.requests} req | tokens ${formatTokenValue(totals.totalTokens)} | known ${formatUsd(totals.costUsdKnown)} (provider ${formatUsd(totals.providerReportedCostUsd)}, estimated ${formatUsd(totals.estimatedOnlyCostUsd)}) | unknown ${totals.unknownCostCount}`;
}

function formatLayerUsageRow(layer: PromptLayerUsage): string {
  return `${layer.layer}@${layer.placement}: ${formatTokenValue(layer.usedTokens)}/${formatTokenValue(layer.reservedTokens)} (headroom ${formatTokenValue(layer.headroomTokens)})${layer.trimmed ? ` [trimmed: ${layer.trimReason ?? 'budget'}]` : ''}`;
}

export class LorebooksManagerView extends ItemView {
  private plugin: LoreBookConverterPlugin;
  private renderVersion = 0;
  private generationDetailsOpen = false;
  private usageDetailsOpen = false;

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

    const refreshButton = toolbar.createEl('button', { text: 'Refresh' });
    refreshButton.addEventListener('click', () => this.render());

    const routingButton = toolbar.createEl('button', { text: 'Open Lorebook Auditor' });
    routingButton.addEventListener('click', () => {
      void this.plugin.openLorebookAuditorView();
    });

    const querySimulationButton = toolbar.createEl('button', { text: 'Open Query Simulation' });
    querySimulationButton.addEventListener('click', () => {
      void this.plugin.openQuerySimulationView();
    });

    const steeringButton = toolbar.createEl('button', { text: 'Open Story Steering' });
    steeringButton.addEventListener('click', () => {
      void this.plugin.openStorySteeringView();
    });
  }

  private renderScopeCard(container: HTMLElement, summary: ScopeSummary): void {
    const card = container.createDiv({ cls: 'lorevault-manager-card' });
    card.createDiv({ cls: 'lorevault-manager-card-kicker', text: 'Lorebook Scope' });

    const header = card.createDiv({ cls: 'lorevault-manager-card-header' });
    header.createEl('h3', { text: `Scope: ${formatScopeLabel(summary.scope)}` });

    const stats = card.createEl('p', {
      text: `Included Notes: ${summary.includedNotes} | entries: ${summary.worldInfoEntries} | missing keywords: ${summary.keywordlessEntries}`
    });
    stats.addClass('lorevault-manager-stats');

    const lastExport = this.plugin.getScopeLastCanonicalExportTimestamp(summary.scope);
    card.createEl('p', {
      cls: 'lorevault-manager-generation-stats',
      text: `Last canonical export: ${formatDateTime(lastExport)} (${formatSecondsAgo(lastExport)})`
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
          new Notice(`Scope export finished: ${formatScopeLabel(summary.scope)}`);
          this.render();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Scope build failed: ${message}`);
      }
    });

    const inspectButton = actions.createEl('button', { text: 'Open Auditor' });
    inspectButton.addEventListener('click', () => {
      void this.plugin.openLorebookAuditorView(summary.scope);
    });
  }

  private renderGenerationCard(container: HTMLElement): void {
    const telemetry = this.plugin.getGenerationTelemetry();
    const card = container.createDiv({ cls: 'lorevault-manager-card lorevault-manager-generation-card' });
    const header = card.createDiv({ cls: 'lorevault-manager-card-header' });
    header.createEl('h3', { text: 'Generation Monitor' });
    const stateBadge = header.createSpan({ cls: `lorevault-manager-state lorevault-manager-state-${telemetry.state}` });
    stateBadge.setText(telemetry.state);

    card.createEl('p', {
      cls: 'lorevault-manager-generation-stats',
      text: `Status: ${telemetry.statusText} | Updated: ${formatSecondsAgo(telemetry.updatedAt)}`
    });

    const provider = telemetry.provider || '-';
    const model = telemetry.model || '-';
    card.createEl('p', {
      cls: 'lorevault-manager-generation-stats',
      text: `Provider: ${provider} | Model: ${model}`
    });

    const scopeLabel = telemetry.scopes.length > 0 ? telemetry.scopes.join(', ') : '(none)';
    card.createEl('p', {
      cls: 'lorevault-manager-generation-stats',
      text: `Active scopes: ${scopeLabel}`
    });

    card.createEl('p', {
      cls: 'lorevault-manager-generation-stats',
      text: `Context: window ${formatTokenValue(telemetry.contextWindowTokens)} | input ${formatTokenValue(telemetry.maxInputTokens)} | reserve ${formatTokenValue(telemetry.promptReserveTokens)} | story ${formatTokenValue(telemetry.storyTokens)} | used ${formatTokenValue(telemetry.contextUsedTokens)} | left ${formatTokenValue(telemetry.contextRemainingTokens)}`
    });

    card.createEl('p', {
      cls: 'lorevault-manager-generation-stats',
      text: `Output: ~${formatTokenValue(telemetry.generatedTokens)} / ${formatTokenValue(telemetry.maxOutputTokens)} | world_info ${formatTokenValue(telemetry.worldInfoCount)} | fallback ${formatTokenValue(telemetry.ragCount)}`
    });

    if (telemetry.lastError) {
      card.createEl('p', {
        cls: 'lorevault-manager-warning-item',
        text: `Last error: ${telemetry.lastError}`
      });
    }

    const details = card.createEl('details', { cls: 'lorevault-manager-debug' });
    details.open = this.generationDetailsOpen;
    details.addEventListener('toggle', () => {
      this.generationDetailsOpen = details.open;
    });
    details.createEl('summary', { text: 'Selected Context Items' });

    const wiHeading = details.createEl('h4', { text: 'world_info' });
    wiHeading.addClass('lorevault-manager-subheading');
    if (telemetry.worldInfoItems.length === 0) {
      details.createEl('p', { text: '(none)' });
    } else {
      const wiList = details.createEl('ul');
      for (const item of telemetry.worldInfoItems) {
        wiList.createEl('li', { text: item });
      }
    }

    const ragHeading = details.createEl('h4', { text: 'fallback entries' });
    ragHeading.addClass('lorevault-manager-subheading');
    if (telemetry.ragItems.length === 0) {
      details.createEl('p', { text: '(none)' });
    } else {
      const ragList = details.createEl('ul');
      for (const item of telemetry.ragItems) {
        ragList.createEl('li', { text: item });
      }
    }

    const steeringHeading = details.createEl('h4', { text: 'inline directives' });
    steeringHeading.addClass('lorevault-manager-subheading');
    if (telemetry.inlineDirectiveItems.length === 0) {
      details.createEl('p', { text: '(none)' });
    } else {
      const directiveList = details.createEl('ul');
      for (const item of telemetry.inlineDirectiveItems) {
        directiveList.createEl('li', { text: item });
      }
    }

    const continuityHeading = details.createEl('h4', { text: 'continuity state' });
    continuityHeading.addClass('lorevault-manager-subheading');
    details.createEl('p', {
      text: `plot threads: ${telemetry.continuityPlotThreads.join(' | ') || '(none)'}`
    });
    details.createEl('p', {
      text: `open loops: ${telemetry.continuityOpenLoops.join(' | ') || '(none)'}`
    });
    details.createEl('p', {
      text: `canon deltas: ${telemetry.continuityCanonDeltas.join(' | ') || '(none)'}`
    });

    const layerUsageHeading = details.createEl('h4', { text: 'prompt layer usage' });
    layerUsageHeading.addClass('lorevault-manager-subheading');
    if (telemetry.layerUsage.length === 0) {
      details.createEl('p', { text: '(none)' });
    } else {
      const layerUsageList = details.createEl('ul');
      for (const layer of telemetry.layerUsage) {
        layerUsageList.createEl('li', { text: formatLayerUsageRow(layer) });
      }
    }

    const overflowHeading = details.createEl('h4', { text: 'overflow policy decisions' });
    overflowHeading.addClass('lorevault-manager-subheading');
    if (telemetry.overflowTrace.length === 0) {
      details.createEl('p', { text: '(none)' });
    } else {
      const overflowList = details.createEl('ul');
      for (const item of telemetry.overflowTrace) {
        overflowList.createEl('li', { text: item });
      }
    }

    const layersHeading = details.createEl('h4', { text: 'context layers' });
    layersHeading.addClass('lorevault-manager-subheading');
    if (telemetry.contextLayerTrace.length === 0) {
      details.createEl('p', { text: '(none)' });
    } else {
      const layerList = details.createEl('ul');
      for (const item of telemetry.contextLayerTrace) {
        layerList.createEl('li', { text: item });
      }
    }
  }

  private renderGenerationSection(container: HTMLElement): void {
    const section = container.createDiv({ cls: 'lorevault-manager-section' });
    section.createEl('h3', { text: 'Generation Monitor' });
    this.renderGenerationCard(section);
  }

  private async renderCostSection(container: HTMLElement, renderVersion: number): Promise<void> {
    const section = container.createDiv({ cls: 'lorevault-manager-section' });
    section.createEl('h3', { text: 'Usage and Cost' });
    const card = section.createDiv({ cls: 'lorevault-manager-card lorevault-manager-generation-card' });
    card.createEl('p', {
      cls: 'lorevault-manager-generation-stats',
      text: 'Loading usage summary...'
    });

    try {
      const snapshot = await this.plugin.getUsageReportSnapshot();
      if (renderVersion !== this.renderVersion) {
        return;
      }

      card.empty();
      card.createEl('p', {
        cls: 'lorevault-manager-generation-stats',
        text: `Updated: ${formatSecondsAgo(snapshot.generatedAt)}`
      });

      card.createEl('p', {
        cls: 'lorevault-manager-generation-stats',
        text: formatCostSummary('Session', snapshot.totals.session)
      });

      card.createEl('p', {
        cls: 'lorevault-manager-generation-stats',
        text: formatCostSummary('Today (UTC)', snapshot.totals.day)
      });

      card.createEl('p', {
        cls: 'lorevault-manager-generation-stats',
        text: formatCostSummary('Project', snapshot.totals.project)
      });

      if (snapshot.warnings.length > 0) {
        const warnings = card.createEl('ul', { cls: 'lorevault-manager-warnings' });
        for (const warning of snapshot.warnings) {
          const item = warnings.createEl('li', { text: warning });
          item.addClass('lorevault-manager-warning-item');
        }
      }

      const details = card.createEl('details', { cls: 'lorevault-manager-debug' });
      details.open = this.usageDetailsOpen;
      details.addEventListener('toggle', () => {
        this.usageDetailsOpen = details.open;
      });
      details.createEl('summary', { text: 'Top Usage Breakdown' });

      const opHeading = details.createEl('h4', { text: 'By Operation' });
      opHeading.addClass('lorevault-manager-subheading');
      const opList = details.createEl('ul');
      for (const item of snapshot.byOperation.slice(0, 8)) {
        opList.createEl('li', {
          text: `${item.key}: ${item.requests} req | ${formatTokenValue(item.totalTokens)} tokens | ${formatUsd(item.costUsdKnown)}`
        });
      }
      if (snapshot.byOperation.length === 0) {
        details.createEl('p', { text: '(none)' });
      }

      const modelHeading = details.createEl('h4', { text: 'By Model' });
      modelHeading.addClass('lorevault-manager-subheading');
      const modelList = details.createEl('ul');
      for (const item of snapshot.byModel.slice(0, 8)) {
        modelList.createEl('li', {
          text: `${item.key}: ${item.requests} req | ${formatTokenValue(item.totalTokens)} tokens | ${formatUsd(item.costUsdKnown)} | provider ${formatUsd(item.providerReportedCostUsd)} | estimated ${formatUsd(item.estimatedOnlyCostUsd)}`
        });
      }
      if (snapshot.byModel.length === 0) {
        details.createEl('p', { text: '(none)' });
      }

      const scopeHeading = details.createEl('h4', { text: 'By Scope' });
      scopeHeading.addClass('lorevault-manager-subheading');
      const scopeList = details.createEl('ul');
      for (const item of snapshot.byScope.slice(0, 8)) {
        scopeList.createEl('li', {
          text: `${item.key}: ${item.requests} req | ${formatTokenValue(item.totalTokens)} tokens | ${formatUsd(item.costUsdKnown)}`
        });
      }
      if (snapshot.byScope.length === 0) {
        details.createEl('p', { text: '(none)' });
      }

      const sourceHeading = details.createEl('h4', { text: 'By Cost Source' });
      sourceHeading.addClass('lorevault-manager-subheading');
      const sourceList = details.createEl('ul');
      for (const item of snapshot.byCostSource) {
        sourceList.createEl('li', {
          text: `${item.key}: ${item.requests} req | known ${formatUsd(item.costUsdKnown)} | unknown ${item.unknownCostCount}`
        });
      }
      if (snapshot.byCostSource.length === 0) {
        details.createEl('p', { text: '(none)' });
      }
    } catch (error) {
      if (renderVersion !== this.renderVersion) {
        return;
      }
      card.empty();
      const message = error instanceof Error ? error.message : String(error);
      card.createEl('p', {
        cls: 'lorevault-manager-warning-item',
        text: `Failed to load usage summary: ${message}`
      });
    }
  }

  private renderScopesSection(container: HTMLElement, summaries: ScopeSummary[]): void {
    const section = container.createDiv({ cls: 'lorevault-manager-section' });
    section.createEl('h3', { text: 'Lorebook Scopes' });
    const grid = section.createDiv({ cls: 'lorevault-manager-scope-grid' });

    for (const summary of summaries) {
      this.renderScopeCard(grid, summary);
    }
  }

  private async render(): Promise<void> {
    this.renderVersion += 1;
    const renderVersion = this.renderVersion;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-manager-view');

    const titleRow = contentEl.createDiv({ cls: 'lorevault-manager-title-row' });
    const icon = titleRow.createSpan({ cls: 'lorevault-manager-icon' });
    setIcon(icon, 'book-open-text');
    titleRow.createEl('h2', { text: 'LoreVault Manager' });

    this.renderToolbar(contentEl);
    this.renderGenerationSection(contentEl);
    await this.renderCostSection(contentEl, renderVersion);

    const notes = this.plugin.getCachedLorebookMetadata();
    const summaries = buildScopeSummaries(notes, this.plugin.settings);

    if (summaries.length === 0) {
      contentEl.createEl('p', {
        text: 'No lorebook scopes found. Add tags under your configured prefix (for example #lorebook/universe).'
      });
      return;
    }

    this.renderScopesSection(contentEl, summaries);
  }
}
