import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import LoreBookConverterPlugin from './main';
import { UsageLedgerBreakdownItem, UsageLedgerReportSnapshot, UsageLedgerTotals } from './usage-ledger-report';
import { formatRelativeTime } from './time-format';

export const LOREVAULT_COST_ANALYZER_VIEW_TYPE = 'lorevault-cost-analyzer-view';

function formatTokenValue(value: number): string {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)).toString() : '0';
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '$0.0000';
  }
  return `$${value.toFixed(4)}`;
}

function formatCostSummaryValue(totals: UsageLedgerTotals): string {
  return `${totals.requests} req | tokens ${formatTokenValue(totals.totalTokens)} | known ${formatUsd(totals.costUsdKnown)} | unknown ${totals.unknownCostCount}`;
}

export class LorevaultCostAnalyzerView extends ItemView {
  private plugin: LoreBookConverterPlugin;
  private selectedCostProfile = '';
  private availableCostProfiles: string[] = [];
  private snapshot: UsageLedgerReportSnapshot | null = null;
  private localIndexSummary = '';
  private loading = false;
  private loadError = '';
  private profileSelectEl: HTMLSelectElement | null = null;
  private statusEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: LoreBookConverterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LOREVAULT_COST_ANALYZER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Cost Analyzer';
  }

  getIcon(): string {
    return 'wallet-cards';
  }

  async onOpen(): Promise<void> {
    this.renderShell();
    await this.reload();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  refresh(): void {
    void this.reload();
  }

  private renderShell(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-cost-analyzer-view');

    const titleRow = contentEl.createDiv({ cls: 'lorevault-cost-analyzer-title-row' });
    const icon = titleRow.createSpan({ cls: 'lorevault-cost-analyzer-icon' });
    setIcon(icon, 'wallet-cards');
    titleRow.createEl('h2', { text: 'Cost Analyzer' });

    const controls = contentEl.createDiv({ cls: 'lorevault-cost-analyzer-controls' });
    const refreshButton = controls.createEl('button', { text: 'Refresh' });
    refreshButton.addEventListener('click', () => {
      void this.reload();
    });

    const profileLabel = controls.createEl('label', { cls: 'lorevault-cost-analyzer-profile-label' });
    profileLabel.createSpan({ text: 'Cost profile' });
    const profileSelect = profileLabel.createEl('select');
    profileSelect.addClass('dropdown');
    profileSelect.addEventListener('change', () => {
      this.selectedCostProfile = profileSelect.value.trim();
      void this.reload();
    });
    this.profileSelectEl = profileSelect;

    this.statusEl = contentEl.createDiv({ cls: 'lorevault-cost-analyzer-status' });
    this.bodyEl = contentEl.createDiv({ cls: 'lorevault-cost-analyzer-body' });
  }

  private renderCostProfileSelect(): void {
    if (!this.profileSelectEl) {
      return;
    }
    this.profileSelectEl.empty();

    const defaults = this.plugin.getDeviceEffectiveCostProfileLabel().trim();
    const uniqueProfiles = new Set<string>(this.availableCostProfiles);
    if (defaults) {
      uniqueProfiles.add(defaults);
    }
    if (this.selectedCostProfile) {
      uniqueProfiles.add(this.selectedCostProfile);
    }
    const options = [...uniqueProfiles].sort((left, right) => left.localeCompare(right));
    if (!this.selectedCostProfile) {
      this.selectedCostProfile = defaults || options[0] || '';
    }

    if (options.length === 0) {
      const option = this.profileSelectEl.createEl('option', {
        text: '(none)',
        value: ''
      });
      option.selected = true;
      return;
    }

    for (const profile of options) {
      this.profileSelectEl.createEl('option', {
        text: profile,
        value: profile
      });
    }
    this.profileSelectEl.value = this.selectedCostProfile;
  }

  private renderStatus(): void {
    if (!this.statusEl) {
      return;
    }
    this.statusEl.empty();
    if (this.loading) {
      this.statusEl.setText('Loading cost profile usage...');
      return;
    }
    if (this.loadError) {
      this.statusEl.createEl('span', {
        cls: 'lorevault-operation-log-error',
        text: `Failed to load cost data: ${this.loadError}`
      });
      return;
    }
    this.statusEl.setText(
      [
        this.selectedCostProfile
          ? `Showing usage for cost profile: ${this.selectedCostProfile}`
          : 'No cost profile selected.',
        this.localIndexSummary
      ].filter(Boolean).join(' | ')
    );
  }

  private renderTotals(container: HTMLElement, snapshot: UsageLedgerReportSnapshot): void {
    const rows: Array<{ label: string; totals: UsageLedgerTotals }> = [
      { label: 'Session', totals: snapshot.totals.session },
      { label: 'Today (UTC)', totals: snapshot.totals.day },
      { label: 'This Week (UTC)', totals: snapshot.totals.week },
      { label: 'This Month (UTC)', totals: snapshot.totals.month },
      { label: 'Project', totals: snapshot.totals.project }
    ];
    const list = container.createEl('ul', { cls: 'lorevault-cost-breakdown-list' });
    for (const row of rows) {
      const line = list.createEl('li', { cls: 'lorevault-cost-breakdown-row' });
      line.createEl('span', { cls: 'lorevault-cost-breakdown-label', text: row.label });
      line.createEl('span', { cls: 'lorevault-cost-breakdown-value', text: formatCostSummaryValue(row.totals) });
    }
  }

  private renderBreakdownSection(
    container: HTMLElement,
    label: string,
    items: UsageLedgerBreakdownItem[],
    renderRow: (item: UsageLedgerBreakdownItem) => string
  ): void {
    const section = container.createDiv({ cls: 'lorevault-cost-analyzer-breakdown' });
    section.createEl('h3', { text: label });
    if (items.length === 0) {
      section.createEl('p', { text: '(none)' });
      return;
    }
    const list = section.createEl('ul');
    for (const item of items.slice(0, 12)) {
      list.createEl('li', { text: renderRow(item) });
    }
  }

  private renderBody(): void {
    if (!this.bodyEl) {
      return;
    }
    this.bodyEl.empty();
    if (this.loading) {
      this.bodyEl.createEl('p', { text: 'Loading...' });
      return;
    }
    if (this.loadError) {
      return;
    }
    if (!this.snapshot) {
      this.bodyEl.createEl('p', { text: 'No usage data available for the selected profile.' });
      return;
    }

    const summaryCard = this.bodyEl.createDiv({ cls: 'lorevault-manager-card lorevault-manager-generation-card' });
    summaryCard.createEl('p', {
      cls: 'lorevault-manager-generation-stats lorevault-cost-breakdown-updated',
      text: `Updated ${formatRelativeTime(this.snapshot.generatedAt)}`
    });
    this.renderTotals(summaryCard, this.snapshot);
    if (this.snapshot.warnings.length > 0) {
      const warnings = summaryCard.createEl('ul', { cls: 'lorevault-manager-warnings' });
      for (const warning of this.snapshot.warnings) {
        const row = warnings.createEl('li', { text: warning });
        row.addClass('lorevault-manager-warning-item');
      }
    }

    this.renderBreakdownSection(this.bodyEl, 'By Operation', this.snapshot.byOperation, item =>
      `${item.key}: ${item.requests} req | ${formatTokenValue(item.totalTokens)} tokens | ${formatUsd(item.costUsdKnown)}`
    );
    this.renderBreakdownSection(this.bodyEl, 'By Model', this.snapshot.byModel, item =>
      `${item.key}: ${item.requests} req | ${formatTokenValue(item.totalTokens)} tokens | ${formatUsd(item.costUsdKnown)}`
    );
    this.renderBreakdownSection(this.bodyEl, 'By Scope', this.snapshot.byScope, item =>
      `${item.key}: ${item.requests} req | ${formatTokenValue(item.totalTokens)} tokens | ${formatUsd(item.costUsdKnown)}`
    );
    this.renderBreakdownSection(this.bodyEl, 'By Cost Source', this.snapshot.byCostSource, item =>
      `${item.key}: ${item.requests} req | known ${formatUsd(item.costUsdKnown)} | unknown ${item.unknownCostCount}`
    );
  }

  private async reload(): Promise<void> {
    this.loading = true;
    this.renderStatus();
    this.renderBody();
    try {
      const [profiles, usageLedgerStatus] = await Promise.all([
        this.plugin.listKnownCostProfiles(),
        this.plugin.getUsageLedgerStorageStatus()
      ]);
      this.availableCostProfiles = profiles;
      const localIndexParts = [
        `Local index: ${usageLedgerStatus.internalDb.available
          ? usageLedgerStatus.internalDb.backendLabel || 'local'
          : 'unavailable'}`
      ];
      localIndexParts.push(
        usageLedgerStatus.lastSuccessfulSyncAt > 0
          ? `synced ${formatRelativeTime(usageLedgerStatus.lastSuccessfulSyncAt)}`
          : 'not synced yet'
      );
      if (usageLedgerStatus.pendingChangedRecordCount > 0) {
        localIndexParts.push(`pending ${usageLedgerStatus.pendingChangedRecordCount}`);
      }
      if (usageLedgerStatus.staleSourceRootCount > 0) {
        localIndexParts.push(`stale roots ${usageLedgerStatus.staleSourceRootCount}`);
      }
      this.localIndexSummary = localIndexParts.join(' | ');
      this.renderCostProfileSelect();
      this.snapshot = this.selectedCostProfile
        ? await this.plugin.getUsageReportSnapshot({ costProfile: this.selectedCostProfile })
        : null;
      this.loadError = '';
    } catch (error) {
      this.snapshot = null;
      this.localIndexSummary = '';
      this.loadError = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
      this.renderStatus();
      this.renderBody();
    }
  }
}
