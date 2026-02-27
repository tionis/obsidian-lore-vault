import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import LoreBookConverterPlugin from './main';
import { collectLorebookNoteMetadata } from './lorebooks-manager-collector';
import { ScopeSummary, buildScopeSummaries } from './lorebooks-manager-data';

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
  return `${seconds}s ago`;
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
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  refresh(): void {
    this.render();
  }

  private renderToolbar(container: HTMLElement): void {
    const toolbar = container.createDiv({ cls: 'lorevault-manager-toolbar' });

    const refreshButton = toolbar.createEl('button', { text: 'Refresh' });
    refreshButton.addEventListener('click', () => this.render());

    const routingButton = toolbar.createEl('button', { text: 'Open Routing Debug' });
    routingButton.addEventListener('click', () => {
      void this.plugin.openRoutingDebugView();
    });

    const openFolderButton = toolbar.createEl('button', { text: 'Open Output Folder' });
    openFolderButton.addEventListener('click', async () => {
      try {
        await this.plugin.openOutputFolder();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Open folder failed: ${message}`);
      }
    });
  }

  private renderScopeCard(container: HTMLElement, summary: ScopeSummary): void {
    const card = container.createDiv({ cls: 'lorevault-manager-card' });
    card.createDiv({ cls: 'lorevault-manager-card-kicker', text: 'Lorebook Scope' });

    const header = card.createDiv({ cls: 'lorevault-manager-card-header' });
    header.createEl('h3', { text: `Scope: ${formatScopeLabel(summary.scope)}` });

    const stats = card.createEl('p', {
      text: `Included Notes: ${summary.includedNotes} | world_info: ${summary.worldInfoEntries} | rag: ${summary.ragDocuments}`
    });
    stats.addClass('lorevault-manager-stats');

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
        await this.plugin.convertToLorebook(summary.scope);
        new Notice(`Scope export finished: ${formatScopeLabel(summary.scope)}`);
        this.render();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Scope build failed: ${message}`);
      }
    });

    const inspectButton = actions.createEl('button', { text: 'Inspect Routing' });
    inspectButton.addEventListener('click', () => {
      void this.plugin.openRoutingDebugView(summary.scope);
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
      text: `Output: ~${formatTokenValue(telemetry.generatedTokens)} / ${formatTokenValue(telemetry.maxOutputTokens)} | world_info ${formatTokenValue(telemetry.worldInfoCount)} | rag ${formatTokenValue(telemetry.ragCount)}`
    });

    if (telemetry.lastError) {
      card.createEl('p', {
        cls: 'lorevault-manager-warning-item',
        text: `Last error: ${telemetry.lastError}`
      });
    }

    const details = card.createEl('details', { cls: 'lorevault-manager-debug' });
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

    const ragHeading = details.createEl('h4', { text: 'rag' });
    ragHeading.addClass('lorevault-manager-subheading');
    if (telemetry.ragItems.length === 0) {
      details.createEl('p', { text: '(none)' });
    } else {
      const ragList = details.createEl('ul');
      for (const item of telemetry.ragItems) {
        ragList.createEl('li', { text: item });
      }
    }
  }

  private renderGenerationSection(container: HTMLElement): void {
    const section = container.createDiv({ cls: 'lorevault-manager-section' });
    section.createEl('h3', { text: 'Generation Monitor' });
    this.renderGenerationCard(section);
  }

  private renderScopesSection(container: HTMLElement, summaries: ScopeSummary[]): void {
    const section = container.createDiv({ cls: 'lorevault-manager-section' });
    section.createEl('h3', { text: 'Lorebook Scopes' });
    const grid = section.createDiv({ cls: 'lorevault-manager-scope-grid' });

    for (const summary of summaries) {
      this.renderScopeCard(grid, summary);
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-manager-view');

    const titleRow = contentEl.createDiv({ cls: 'lorevault-manager-title-row' });
    const icon = titleRow.createSpan({ cls: 'lorevault-manager-icon' });
    setIcon(icon, 'book-open-text');
    titleRow.createEl('h2', { text: 'LoreVault Manager' });

    this.renderToolbar(contentEl);
    this.renderGenerationSection(contentEl);

    const notes = collectLorebookNoteMetadata(this.app, this.plugin.settings);
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
