import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import LoreBookConverterPlugin from './main';
import { ScopeContextPack } from './context-query';
import { collectLorebookNoteMetadata } from './lorebooks-manager-collector';
import { buildScopeSummaries, ScopeSummary } from './lorebooks-manager-data';
import { normalizeScope } from './lorebook-scoping';
import { buildQualityAuditRows } from './quality-audit';

export const LOREVAULT_ROUTING_DEBUG_VIEW_TYPE = 'lorevault-routing-debug-view';

function formatScopeLabel(scope: string): string {
  return scope || '(all)';
}

function formatRouteBadge(includeWorldInfo: boolean, includeRag: boolean): string {
  if (includeWorldInfo) {
    return includeRag ? 'entry (+projection)' : 'entry';
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

function trimTierContent(text: string, maxChars: number): string {
  const cleaned = text.trim();
  if (cleaned.length <= maxChars) {
    return cleaned;
  }
  const boundary = cleaned.slice(0, maxChars + 1).lastIndexOf(' ');
  const cut = boundary >= Math.floor(maxChars * 0.6) ? boundary : maxChars;
  return `${cleaned.slice(0, cut).trimEnd()}\n...`;
}

function computeTierContent(content: string, tier: 'short' | 'medium' | 'full'): string {
  const cleaned = content.trim();
  if (!cleaned) {
    return '';
  }
  if (tier === 'full') {
    return cleaned;
  }
  return trimTierContent(cleaned, tier === 'short' ? 260 : 900);
}

function computeBodyLiftCandidateContent(bodyText: string): string {
  const cleaned = bodyText.trim();
  if (!cleaned) {
    return '';
  }
  return trimTierContent(cleaned, 1800);
}

export class LorebooksRoutingDebugView extends ItemView {
  private plugin: LoreBookConverterPlugin;
  private selectedScope: string | null = null;
  private keywordGenerationPaths = new Set<string>();
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
      void this.render();
    });

    const refreshButton = toolbar.createEl('button', { text: 'Refresh' });
    refreshButton.addEventListener('click', () => {
      void this.render();
    });

    const simulationButton = toolbar.createEl('button', { text: 'Open Query Simulation' });
    simulationButton.addEventListener('click', () => {
      const selectedScope = this.selectedScope ? [this.selectedScope] : [];
      void this.plugin.openQuerySimulationView(selectedScope);
    });

    return selectedSummary;
  }

  private renderSummaryHeader(container: HTMLElement, summary: ScopeSummary): void {
    const section = container.createDiv({ cls: 'lorevault-routing-summary' });
    section.createEl('p', {
      text: `Scope ${formatScopeLabel(summary.scope)} | included ${summary.includedNotes} | entries ${summary.worldInfoEntries} | missing keywords ${summary.keywordlessEntries}`
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
    section.createEl('h3', { text: 'Lorebook Contents' });

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
      const bodyText = (pack.worldInfoBodyByUid?.[entry.uid] ?? '').trim();
      const shortTier = computeTierContent(entry.content, 'short');
      const mediumTier = computeTierContent(entry.content, 'medium');
      const fullTier = computeTierContent(entry.content, 'full');
      const fullBodyTier = computeBodyLiftCandidateContent(bodyText);
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

      const liftMeta = [
        `short ~${estimateTokens(shortTier)} tokens`,
        `medium ~${estimateTokens(mediumTier)} tokens`,
        `full ~${estimateTokens(fullTier)} tokens`,
        bodyText
          ? `full_body candidate ~${estimateTokens(fullBodyTier)} tokens`
          : 'full_body candidate unavailable (no source body)'
      ];
      details.createEl('p', {
        cls: 'lorevault-routing-subtle',
        text: `Lift tiers: ${liftMeta.join(' | ')}`
      });

      const liftDetails = details.createEl('details', { cls: 'lorevault-routing-content-details' });
      liftDetails.createEl('summary', { text: 'Lift Tier Previews' });

      const shortDetails = liftDetails.createEl('details', { cls: 'lorevault-routing-content-details' });
      shortDetails.createEl('summary', { text: `short (~${estimateTokens(shortTier)} tokens)` });
      shortDetails.createEl('pre', { cls: 'lorevault-routing-content', text: shortTier });

      const mediumDetails = liftDetails.createEl('details', { cls: 'lorevault-routing-content-details' });
      mediumDetails.createEl('summary', { text: `medium (~${estimateTokens(mediumTier)} tokens)` });
      mediumDetails.createEl('pre', { cls: 'lorevault-routing-content', text: mediumTier });

      const fullDetails = liftDetails.createEl('details', { cls: 'lorevault-routing-content-details' });
      fullDetails.createEl('summary', { text: `full (~${estimateTokens(fullTier)} tokens)` });
      fullDetails.createEl('pre', { cls: 'lorevault-routing-content', text: fullTier });

      const bodyDetails = liftDetails.createEl('details', { cls: 'lorevault-routing-content-details' });
      if (!bodyText) {
        bodyDetails.createEl('summary', { text: 'full_body candidate (unavailable)' });
        bodyDetails.createEl('p', {
          cls: 'lorevault-routing-subtle',
          text: 'No source note body found for this entry in the current scope pack.'
        });
      } else if (bodyText.trim() === entry.content.trim()) {
        bodyDetails.createEl('summary', { text: `full_body candidate (~${estimateTokens(fullBodyTier)} tokens)` });
        bodyDetails.createEl('p', {
          cls: 'lorevault-routing-subtle',
          text: 'Source note body matches world_info content; full_body lift would not add additional detail.'
        });
        bodyDetails.createEl('pre', { cls: 'lorevault-routing-content', text: fullBodyTier });
      } else {
        bodyDetails.createEl('summary', { text: `full_body candidate (~${estimateTokens(fullBodyTier)} tokens)` });
        bodyDetails.createEl('pre', { cls: 'lorevault-routing-content', text: fullBodyTier });
      }

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
    headRow.createEl('th', { text: 'Keyword Count' });
    headRow.createEl('th', { text: 'Scopes' });

    const tbody = table.createEl('tbody');
    for (const note of summary.notes) {
      const row = tbody.createEl('tr');
      row.createEl('td', { text: note.path });
      row.createEl('td', { text: formatReason(note.reason) });
      row.createEl('td', { text: formatRouteBadge(note.includeWorldInfo, note.includeRag) });
      row.createEl('td', { text: note.retrievalMode });
      row.createEl('td', { text: note.hasKeywords ? `${note.keywordCount}` : '0' });
      row.createEl('td', { text: note.scopes.join(', ') || '-' });
    }
  }

  private async handleGenerateKeywords(path: string): Promise<void> {
    if (!path || this.keywordGenerationPaths.has(path)) {
      return;
    }

    this.keywordGenerationPaths.add(path);
    try {
      await this.plugin.generateKeywordsForNotePath(path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Keyword generation from routing debug failed:', error);
      new Notice(`Keyword generation failed: ${message}`);
    } finally {
      this.keywordGenerationPaths.delete(path);
      void this.render();
    }
  }

  private renderQualityAudit(container: HTMLElement, summary: ScopeSummary, pack: ScopeContextPack): void {
    const section = container.createDiv({ cls: 'lorevault-routing-section' });
    section.createEl('h3', { text: 'Quality Audit' });

    const rows = buildQualityAuditRows({
      entries: pack.worldInfoEntries,
      ragDocuments: pack.ragDocuments,
      ragChunks: pack.ragChunks,
      ragChunkEmbeddings: pack.ragChunkEmbeddings,
      worldInfoBodyByUid: pack.worldInfoBodyByUid
    });
    const missing = rows.filter(row => row.canGenerateKeywords);
    const high = rows.filter(row => row.riskLevel === 'high').length;
    const medium = rows.filter(row => row.riskLevel === 'medium').length;
    const low = rows.filter(row => row.riskLevel === 'low').length;

    section.createEl('p', {
      cls: 'lorevault-routing-subtle',
      text: `Entries: ${summary.includedNotes} | high risk ${high} | medium ${medium} | low ${low} | missing keywords ${missing.length}`
    });

    if (rows.length === 0) {
      section.createEl('p', { text: 'No entries available for quality audit.' });
      return;
    }

    section.createEl('p', {
      cls: 'lorevault-routing-subtle',
      text: 'Use this to spot missing keywords, duplicate-like notes, and thin content. Generate keyword suggestions directly for missing-keyword entries.'
    });

    const tableWrap = section.createDiv({ cls: 'lorevault-manager-table-wrap' });
    const table = tableWrap.createEl('table', { cls: 'lorevault-manager-table' });
    const headRow = table.createEl('thead').createEl('tr');
    headRow.createEl('th', { text: 'Entry' });
    headRow.createEl('th', { text: 'Risk' });
    headRow.createEl('th', { text: 'Keywords' });
    headRow.createEl('th', { text: 'Similarity' });
    headRow.createEl('th', { text: 'Reasons' });
    headRow.createEl('th', { text: 'Actions' });

    const tbody = table.createEl('tbody');
    const visibleRows = rows.slice(0, 150);
    for (const row of visibleRows) {
      const tr = tbody.createEl('tr');
      tr.createEl('td', { text: row.path ? `${row.title} (${row.path})` : row.title });
      tr.createEl('td', { text: `${row.riskLevel} (${row.riskScore})` });
      tr.createEl('td', { text: `${row.keywordCount}` });
      tr.createEl('td', {
        text: row.bestSimilarUid !== null
          ? `UID ${row.bestSimilarUid} (${row.bestSimilarScore.toFixed(3)})`
          : '-'
      });
      tr.createEl('td', { text: row.reasons.join(' | ') || '(none)' });

      const actionsCell = tr.createEl('td');
      if (row.path) {
        const openButton = actionsCell.createEl('button', { text: 'Open' });
        openButton.addEventListener('click', () => {
          void this.app.workspace.openLinkText(row.path, '', true);
        });
      }

      if (row.canGenerateKeywords) {
        const running = this.keywordGenerationPaths.has(row.path);
        const generateButton = actionsCell.createEl('button', {
          text: running ? 'Generating…' : 'Generate Keywords'
        });
        generateButton.disabled = running;
        generateButton.addEventListener('click', () => {
          void this.handleGenerateKeywords(row.path);
        });
      }
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
      this.renderQualityAudit(contentEl, selectedSummary, pack);
      this.renderLorebookContents(contentEl, pack);
    }
    this.renderRoutingTable(contentEl, selectedSummary);
  }
}
