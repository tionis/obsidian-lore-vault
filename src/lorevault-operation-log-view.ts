import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type LoreBookConverterPlugin from './main';
import {
  OperationLogParseIssue,
  ParsedOperationLogEntry,
  parseOperationLogJsonl
} from './operation-log';
import type { CompletionOperationKind, CompletionOperationLogAttempt } from './completion-provider';

export const LOREVAULT_OPERATION_LOG_VIEW_TYPE = 'lorevault-operation-log-view';

type KindFilter = 'all' | CompletionOperationKind;
type StatusFilter = 'all' | 'ok' | 'error';

function formatDateTime(timestamp: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return '(unknown time)';
  }
  return new Date(timestamp).toLocaleString();
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return '0 ms';
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }
  return `${(durationMs / 1000).toFixed(2)} s`;
}

function clampPreview(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}...`;
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `[unserializable JSON: ${message}]`;
  }
}

function formatAttemptHeader(attempt: CompletionOperationLogAttempt, index: number): string {
  const parts = [
    `Attempt ${index + 1}`,
    attempt.url ? `url ${attempt.url}` : '',
    attempt.error ? 'error' : 'ok'
  ].filter(Boolean);
  return parts.join(' | ');
}

export class LorevaultOperationLogView extends ItemView {
  private plugin: LoreBookConverterPlugin;
  private entries: ParsedOperationLogEntry[] = [];
  private issues: OperationLogParseIssue[] = [];
  private totalLines = 0;
  private fatalError = '';
  private isLoading = false;
  private loadVersion = 0;
  private kindFilter: KindFilter = 'all';
  private statusFilter: StatusFilter = 'all';
  private searchQuery = '';
  private rowLimit = 120;
  private autoRefresh = false;
  private autoRefreshTimer: number | null = null;
  private statusEl: HTMLElement | null = null;
  private pathEl: HTMLElement | null = null;
  private issueEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: LoreBookConverterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LOREVAULT_OPERATION_LOG_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'LLM Operation Log Explorer';
  }

  getIcon(): string {
    return 'list-tree';
  }

  async onOpen(): Promise<void> {
    this.renderShell();
    await this.reloadEntries();
  }

  async onClose(): Promise<void> {
    this.stopAutoRefresh();
    this.contentEl.empty();
  }

  refresh(): void {
    void this.reloadEntries();
  }

  private renderShell(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-operation-log-view');

    const titleRow = contentEl.createDiv({ cls: 'lorevault-operation-log-title-row' });
    const icon = titleRow.createSpan({ cls: 'lorevault-operation-log-icon' });
    setIcon(icon, 'list-tree');
    titleRow.createEl('h2', { text: 'LLM Operation Log Explorer' });

    const controls = contentEl.createDiv({ cls: 'lorevault-operation-log-controls' });
    const refreshButton = controls.createEl('button', { text: 'Refresh' });
    refreshButton.addEventListener('click', () => {
      void this.reloadEntries();
    });

    const openFileButton = controls.createEl('button', { text: 'Open Log File' });
    openFileButton.addEventListener('click', () => {
      void this.openRawLogFile();
    });

    const autoRefreshLabel = controls.createEl('label', { cls: 'lorevault-operation-log-auto-refresh' });
    const autoRefreshToggle = autoRefreshLabel.createEl('input');
    autoRefreshToggle.type = 'checkbox';
    autoRefreshToggle.checked = this.autoRefresh;
    autoRefreshToggle.addEventListener('change', () => {
      this.autoRefresh = autoRefreshToggle.checked;
      if (this.autoRefresh) {
        this.startAutoRefresh();
      } else {
        this.stopAutoRefresh();
      }
    });
    autoRefreshLabel.createSpan({ text: 'Auto refresh (3s)' });

    const filters = contentEl.createDiv({ cls: 'lorevault-operation-log-filters' });
    const searchInput = filters.createEl('input', { cls: 'lorevault-operation-log-search' });
    searchInput.type = 'search';
    searchInput.placeholder = 'Search operation/model/error/request text...';
    searchInput.value = this.searchQuery;
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      this.renderEntries();
    });

    const kindSelect = filters.createEl('select');
    const kindOptions: Array<{ value: KindFilter; label: string }> = [
      { value: 'all', label: 'All Kinds' },
      { value: 'completion', label: 'completion' },
      { value: 'completion_stream', label: 'completion_stream' },
      { value: 'tool_planner', label: 'tool_planner' }
    ];
    for (const optionSpec of kindOptions) {
      const option = kindSelect.createEl('option');
      option.value = optionSpec.value;
      option.text = optionSpec.label;
    }
    kindSelect.value = this.kindFilter;
    kindSelect.addEventListener('change', () => {
      const value = kindSelect.value;
      if (value === 'completion' || value === 'completion_stream' || value === 'tool_planner') {
        this.kindFilter = value;
      } else {
        this.kindFilter = 'all';
      }
      this.renderEntries();
    });

    const statusSelect = filters.createEl('select');
    const statusOptions: Array<{ value: StatusFilter; label: string }> = [
      { value: 'all', label: 'All Statuses' },
      { value: 'ok', label: 'ok' },
      { value: 'error', label: 'error' }
    ];
    for (const optionSpec of statusOptions) {
      const option = statusSelect.createEl('option');
      option.value = optionSpec.value;
      option.text = optionSpec.label;
    }
    statusSelect.value = this.statusFilter;
    statusSelect.addEventListener('change', () => {
      this.statusFilter = statusSelect.value === 'error'
        ? 'error'
        : statusSelect.value === 'ok'
          ? 'ok'
          : 'all';
      this.renderEntries();
    });

    const limitInput = filters.createEl('input');
    limitInput.type = 'number';
    limitInput.min = '10';
    limitInput.max = '5000';
    limitInput.step = '10';
    limitInput.value = this.rowLimit.toString();
    limitInput.title = 'Max rows to render';
    limitInput.addEventListener('change', () => {
      const numeric = Math.floor(Number(limitInput.value));
      const nextLimit = Number.isFinite(numeric) ? numeric : this.rowLimit;
      this.rowLimit = Math.max(10, Math.min(5000, nextLimit));
      limitInput.value = this.rowLimit.toString();
      this.renderEntries();
    });

    this.pathEl = contentEl.createDiv({ cls: 'lorevault-operation-log-path' });
    this.statusEl = contentEl.createDiv({ cls: 'lorevault-operation-log-status' });
    this.issueEl = contentEl.createDiv({ cls: 'lorevault-operation-log-issues' });
    this.listEl = contentEl.createDiv({ cls: 'lorevault-operation-log-list' });
    this.updatePathSummary();
    this.renderStatus();
  }

  private updatePathSummary(): void {
    if (!this.pathEl) {
      return;
    }
    this.pathEl.empty();
    this.pathEl.createSpan({ text: 'Path: ' });
    this.pathEl.createEl('code', { text: this.plugin.getOperationLogPath() });
  }

  private startAutoRefresh(): void {
    this.stopAutoRefresh();
    this.autoRefreshTimer = window.setInterval(() => {
      void this.reloadEntries();
    }, 3000);
  }

  private stopAutoRefresh(): void {
    if (this.autoRefreshTimer !== null) {
      window.clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  }

  private async reloadEntries(): Promise<void> {
    const loadVersion = this.loadVersion + 1;
    this.loadVersion = loadVersion;
    this.isLoading = true;
    this.renderStatus();
    this.updatePathSummary();
    try {
      const path = this.plugin.getOperationLogPath();
      const exists = await this.app.vault.adapter.exists(path);
      if (!exists) {
        if (loadVersion !== this.loadVersion) {
          return;
        }
        this.entries = [];
        this.issues = [];
        this.totalLines = 0;
        this.fatalError = '';
        this.isLoading = false;
        this.renderStatus();
        this.renderEntries();
        return;
      }

      const raw = await this.app.vault.adapter.read(path);
      if (loadVersion !== this.loadVersion) {
        return;
      }
      const parsed = parseOperationLogJsonl(raw);
      this.entries = parsed.entries;
      this.issues = parsed.issues;
      this.totalLines = parsed.totalLines;
      this.fatalError = '';
    } catch (error) {
      if (loadVersion !== this.loadVersion) {
        return;
      }
      this.entries = [];
      this.issues = [];
      this.totalLines = 0;
      this.fatalError = error instanceof Error ? error.message : String(error);
    } finally {
      if (loadVersion === this.loadVersion) {
        this.isLoading = false;
        this.renderStatus();
        this.renderEntries();
      }
    }
  }

  private renderStatus(): void {
    if (!this.statusEl) {
      return;
    }
    this.statusEl.empty();

    if (!this.plugin.settings.operationLog.enabled) {
      this.statusEl.createSpan({
        cls: 'lorevault-operation-log-warning',
        text: 'Operation log is currently disabled in settings.'
      });
      return;
    }

    if (this.isLoading) {
      this.statusEl.setText('Loading operation log...');
      return;
    }

    if (this.fatalError) {
      this.statusEl.createSpan({
        cls: 'lorevault-operation-log-error',
        text: `Failed to load log: ${this.fatalError}`
      });
      return;
    }

    this.statusEl.setText(
      `Loaded ${this.entries.length} entries from ${Math.max(0, this.totalLines)} line(s). Parse issues: ${this.issues.length}.`
    );
  }

  private renderIssues(): void {
    if (!this.issueEl) {
      return;
    }
    this.issueEl.empty();
    if (this.issues.length === 0) {
      return;
    }

    const details = this.issueEl.createEl('details', { cls: 'lorevault-operation-log-issue-details' });
    details.createEl('summary', { text: `Malformed or unsupported lines (${this.issues.length})` });

    const list = details.createEl('ul');
    const shown = this.issues.slice(0, 20);
    for (const issue of shown) {
      list.createEl('li', {
        text: `line ${issue.lineNumber}: ${issue.reason} | ${issue.linePreview}`
      });
    }
    if (this.issues.length > shown.length) {
      details.createEl('p', {
        text: `...and ${this.issues.length - shown.length} more issue(s).`
      });
    }
  }

  private matchesSearch(entry: ParsedOperationLogEntry): boolean {
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) {
      return true;
    }
    const tokens = query.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return true;
    }
    return tokens.every(token => entry.searchText.includes(token));
  }

  private filteredEntries(): ParsedOperationLogEntry[] {
    const filtered = this.entries.filter(entry => {
      if (this.kindFilter !== 'all' && entry.record.kind !== this.kindFilter) {
        return false;
      }
      if (this.statusFilter !== 'all' && entry.record.status !== this.statusFilter) {
        return false;
      }
      return this.matchesSearch(entry);
    });
    return filtered.slice(0, this.rowLimit);
  }

  private renderEntries(): void {
    this.renderIssues();
    if (!this.listEl) {
      return;
    }
    this.listEl.empty();

    if (this.isLoading) {
      this.listEl.createEl('p', { text: 'Loading...' });
      return;
    }

    if (this.fatalError) {
      this.listEl.createEl('p', {
        cls: 'lorevault-operation-log-error',
        text: `Cannot render entries: ${this.fatalError}`
      });
      return;
    }

    const filtered = this.filteredEntries();
    if (filtered.length === 0) {
      this.listEl.createEl('p', {
        text: this.entries.length === 0
          ? 'No operation log entries found. Trigger a completion/chat request to populate this file.'
          : 'No entries match current filters.'
      });
      return;
    }

    this.listEl.createEl('p', {
      cls: 'lorevault-operation-log-subtle',
      text: `Showing ${filtered.length} of ${this.entries.length} loaded entries.`
    });

    for (const entry of filtered) {
      this.renderEntry(entry);
    }
  }

  private renderEntry(entry: ParsedOperationLogEntry): void {
    if (!this.listEl) {
      return;
    }
    const details = this.listEl.createEl('details', { cls: 'lorevault-operation-log-entry' });
    const summary = details.createEl('summary', { cls: 'lorevault-operation-log-entry-summary' });

    const statusClass = entry.record.status === 'error'
      ? 'lorevault-operation-log-status-error'
      : 'lorevault-operation-log-status-ok';
    const abortedLabel = entry.record.aborted ? ' | aborted' : '';
    summary.createEl('span', {
      text: `${formatDateTime(entry.record.startedAt)} | ${entry.record.operationName} | ${entry.record.kind}${abortedLabel}`
    });
    summary.createEl('span', {
      cls: statusClass,
      text: entry.record.status
    });

    details.createEl('p', {
      text: [
        `ID: ${entry.record.id}`,
        `Provider: ${entry.record.provider}`,
        `Model: ${entry.record.model || '(none)'}`,
        `Duration: ${formatDuration(entry.record.durationMs)}`,
        `Attempts: ${entry.record.attempts.length}`
      ].join(' | ')
    });
    details.createEl('p', {
      text: `Endpoint: ${entry.record.endpoint || '(none)'}`
    });
    details.createEl('p', {
      cls: 'lorevault-operation-log-subtle',
      text: `Started: ${formatDateTime(entry.record.startedAt)} | Finished: ${formatDateTime(entry.record.finishedAt)} | Source line: ${entry.lineNumber}`
    });

    if (entry.record.error) {
      details.createEl('p', {
        cls: 'lorevault-operation-log-error',
        text: `Error: ${entry.record.error}`
      });
    }

    if (entry.record.usage) {
      details.createEl('p', {
        text: [
          `Usage source: ${entry.record.usage.source}`,
          `prompt ${entry.record.usage.promptTokens}`,
          `completion ${entry.record.usage.completionTokens}`,
          `total ${entry.record.usage.totalTokens}`,
          `cost ${entry.record.usage.reportedCostUsd === null ? 'n/a' : entry.record.usage.reportedCostUsd.toString()}`
        ].join(' | ')
      });
    }

    const requestDetails = details.createEl('details');
    requestDetails.createEl('summary', { text: 'Request Payload' });
    requestDetails.createEl('pre', {
      cls: 'lorevault-operation-log-json',
      text: prettyJson(entry.record.request)
    });

    const attemptsDetails = details.createEl('details');
    attemptsDetails.createEl('summary', { text: `Attempts (${entry.record.attempts.length})` });
    if (entry.record.attempts.length === 0) {
      attemptsDetails.createEl('p', { text: 'No attempts captured.' });
    } else {
      for (let index = 0; index < entry.record.attempts.length; index += 1) {
        const attempt = entry.record.attempts[index];
        const attemptDetails = attemptsDetails.createEl('details');
        attemptDetails.createEl('summary', { text: formatAttemptHeader(attempt, index) });
        attemptDetails.createEl('pre', {
          cls: 'lorevault-operation-log-json',
          text: prettyJson(attempt.requestBody)
        });
        if (typeof attempt.responseBody !== 'undefined') {
          const responseDetails = attemptDetails.createEl('details');
          responseDetails.createEl('summary', { text: 'Response Body' });
          responseDetails.createEl('pre', {
            cls: 'lorevault-operation-log-json',
            text: prettyJson(attempt.responseBody)
          });
        }
        if (attempt.responseText) {
          const textDetails = attemptDetails.createEl('details');
          textDetails.createEl('summary', { text: 'Raw Response Text' });
          textDetails.createEl('pre', {
            cls: 'lorevault-operation-log-json',
            text: attempt.responseText
          });
        }
        if (attempt.error) {
          attemptDetails.createEl('p', {
            cls: 'lorevault-operation-log-error',
            text: `Attempt error: ${attempt.error}`
          });
        }
      }
    }

    if (entry.record.finalText) {
      const outputDetails = details.createEl('details');
      outputDetails.createEl('summary', {
        text: `Final Output Text (${entry.record.finalText.length} chars)`
      });
      outputDetails.createEl('pre', {
        cls: 'lorevault-operation-log-json',
        text: entry.record.finalText
      });
    }

    const normalizedDetails = details.createEl('details');
    normalizedDetails.createEl('summary', { text: 'Normalized Record JSON' });
    normalizedDetails.createEl('pre', {
      cls: 'lorevault-operation-log-json',
      text: prettyJson(entry.record)
    });
  }

  private async openRawLogFile(): Promise<void> {
    const path = this.plugin.getOperationLogPath();
    const abstract = this.app.vault.getAbstractFileByPath(path);
    if (!(abstract instanceof TFile)) {
      new Notice(`Operation log file does not exist yet: ${clampPreview(path, 180)}`);
      return;
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(abstract);
  }
}
