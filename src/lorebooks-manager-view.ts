import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import LoreBookConverterPlugin from './main';
import { collectLorebookNoteMetadata } from './lorebooks-manager-collector';
import { ScopeSummary, buildScopeSummaries } from './lorebooks-manager-data';

export const LOREVAULT_MANAGER_VIEW_TYPE = 'lorevault-manager-view';

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

    const header = card.createDiv({ cls: 'lorevault-manager-card-header' });
    header.createEl('h3', { text: `Scope: ${formatScopeLabel(summary.scope)}` });

    const buildButton = header.createEl('button', { text: 'Build/Export Scope' });
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

    const details = card.createEl('details', { cls: 'lorevault-manager-debug' });
    details.createEl('summary', { text: 'Debug: Inclusion and Routing Decisions' });

    const tableWrap = details.createDiv({ cls: 'lorevault-manager-table-wrap' });
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

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-manager-view');

    const titleRow = contentEl.createDiv({ cls: 'lorevault-manager-title-row' });
    const icon = titleRow.createSpan({ cls: 'lorevault-manager-icon' });
    setIcon(icon, 'book-open-text');
    titleRow.createEl('h2', { text: 'LoreVault Manager' });

    this.renderToolbar(contentEl);
    this.renderGenerationCard(contentEl);

    const notes = collectLorebookNoteMetadata(this.app, this.plugin.settings);
    const summaries = buildScopeSummaries(notes, this.plugin.settings);

    if (summaries.length === 0) {
      contentEl.createEl('p', {
        text: 'No lorebook scopes found. Add tags under your configured prefix (for example #lorebook/universe).'
      });
      return;
    }

    for (const summary of summaries) {
      this.renderScopeCard(contentEl, summary);
    }
  }
}
