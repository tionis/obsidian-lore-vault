import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import LoreBookConverterPlugin from './main';
import { ScopeContextPack, trimContentWithEllipsis } from './context-query';
import { collectLorebookNoteMetadata } from './lorebooks-manager-collector';
import { buildScopeSummaries, ScopeSummary } from './lorebooks-manager-data';
import { normalizeScope } from './lorebook-scoping';
import { buildQualityAuditRows } from './quality-audit';

export const LOREVAULT_ROUTING_DEBUG_VIEW_TYPE = 'lorevault-routing-debug-view';

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

function trimTierContent(text: string, maxChars: number): string {
  return trimContentWithEllipsis(text, maxChars);
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
  private selectedKeywordPaths = new Set<string>();
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
    return 'LoreVault Lorebook Auditor';
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

  private async handleGenerateKeywords(path: string): Promise<void> {
    if (!path || this.keywordGenerationPaths.has(path)) {
      return;
    }

    this.keywordGenerationPaths.add(path);
    try {
      await this.plugin.generateKeywordsForNotePath(path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Keyword generation from lorebook auditor failed:', error);
      new Notice(`Keyword generation failed: ${message}`);
    } finally {
      this.keywordGenerationPaths.delete(path);
      void this.render();
    }
  }

  private async handleGenerateKeywordsBulk(paths: string[]): Promise<void> {
    const uniquePaths = [...new Set(paths.map(path => path.trim()).filter(Boolean))];
    if (uniquePaths.length === 0) {
      return;
    }

    for (const path of uniquePaths) {
      this.keywordGenerationPaths.add(path);
    }

    try {
      await this.plugin.generateKeywordsForNotePaths(uniquePaths);
      for (const path of uniquePaths) {
        this.selectedKeywordPaths.delete(path);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Bulk keyword generation failed:', error);
      new Notice(`Bulk keyword generation failed: ${message}`);
    } finally {
      for (const path of uniquePaths) {
        this.keywordGenerationPaths.delete(path);
      }
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
      text: 'Use this to spot missing keywords, duplicate-like notes, and thin content. Duplicate/similarity signals combine heuristics with embedding neighbors when embeddings are available.'
    });

    const actionablePaths = missing.map(row => row.path).filter(Boolean);
    const validSelectedPaths = [...this.selectedKeywordPaths]
      .filter(path => actionablePaths.includes(path));
    this.selectedKeywordPaths = new Set(validSelectedPaths);

    const controls = section.createDiv({ cls: 'lorevault-routing-query-controls' });
    const bulkRunning = this.keywordGenerationPaths.size > 0;
    const selectAll = controls.createEl('button', {
      text: `Select Missing (${actionablePaths.length})`
    });
    selectAll.disabled = actionablePaths.length === 0 || bulkRunning;
    selectAll.addEventListener('click', () => {
      this.selectedKeywordPaths = new Set(actionablePaths);
      void this.render();
    });

    const clearSelection = controls.createEl('button', { text: 'Clear Selection' });
    clearSelection.disabled = this.selectedKeywordPaths.size === 0 || bulkRunning;
    clearSelection.addEventListener('click', () => {
      this.selectedKeywordPaths.clear();
      void this.render();
    });

    const generateSelected = controls.createEl('button', {
      text: bulkRunning
        ? `Generating Keywords (${this.keywordGenerationPaths.size} Running)`
        : `Generate Keywords (${this.selectedKeywordPaths.size} Selected)`
    });
    generateSelected.disabled = this.selectedKeywordPaths.size === 0 || bulkRunning;
    generateSelected.addEventListener('click', () => {
      void this.handleGenerateKeywordsBulk([...this.selectedKeywordPaths]);
    });

    const tableWrap = section.createDiv({ cls: 'lorevault-manager-table-wrap' });
    const table = tableWrap.createEl('table', { cls: 'lorevault-manager-table' });
    const headRow = table.createEl('thead').createEl('tr');
    headRow.createEl('th', { text: 'Select' });
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
      const selectCell = tr.createEl('td');
      if (row.canGenerateKeywords && row.path) {
        const checkbox = selectCell.createEl('input', {
          type: 'checkbox'
        });
        checkbox.checked = this.selectedKeywordPaths.has(row.path);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            this.selectedKeywordPaths.add(row.path);
          } else {
            this.selectedKeywordPaths.delete(row.path);
          }
          void this.render();
        });
      } else {
        selectCell.setText('-');
      }
      tr.createEl('td', { text: row.path ? `${row.title} (${row.path})` : row.title });
      tr.createEl('td', { text: `${row.riskLevel} (${row.riskScore})` });
      tr.createEl('td', { text: `${row.keywordCount}` });
      tr.createEl('td', {
        text: row.bestSimilarUid !== null
          ? `${row.bestSimilarTitle ?? `UID ${row.bestSimilarUid}`} (${row.bestSimilarScore.toFixed(3)})`
          : '-'
      });
      const reasonsCell = tr.createEl('td');
      reasonsCell.setText(row.reasons.join(' | ') || '(none)');

      const actionsCell = tr.createEl('td');
      if (row.path) {
        const openButton = actionsCell.createEl('button', { text: 'Open Entry' });
        openButton.addEventListener('click', () => {
          void this.app.workspace.openLinkText(row.path, '', true);
        });
      }

      if (row.bestSimilarPath) {
        const openSimilarButton = actionsCell.createEl('button', { text: 'Open Similar' });
        openSimilarButton.addEventListener('click', () => {
          void this.app.workspace.openLinkText(row.bestSimilarPath, '', true);
        });
      }

      if (row.path && row.bestSimilarPath) {
        const openPairButton = actionsCell.createEl('button', { text: 'Open Pair' });
        openPairButton.addEventListener('click', () => {
          void this.app.workspace.openLinkText(row.path, '', true);
          void this.app.workspace.openLinkText(row.bestSimilarPath, '', true);
        });
      }

      if (row.canGenerateKeywords) {
        const running = this.keywordGenerationPaths.has(row.path);
        const generateButton = actionsCell.createEl('button', {
          text: running ? 'Generating…' : 'Generate Keywords'
        });
        generateButton.disabled = running || bulkRunning;
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
    titleRow.createEl('h2', { text: 'LoreVault Lorebook Auditor' });

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
  }
}
