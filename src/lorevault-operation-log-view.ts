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

interface ParsedPayloadToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

interface ParsedPayloadMessage {
  role: string;
  name: string;
  toolCallId: string;
  toolName: string;
  content: string;
  toolCalls: ParsedPayloadToolCall[];
}

interface ParsedPayloadToolDefinition {
  name: string;
  description: string;
  parameters: unknown;
}

interface ParsedPayloadShape {
  raw: Record<string, unknown> | null;
  summaryParts: string[];
  messages: ParsedPayloadMessage[];
  tools: ParsedPayloadToolDefinition[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

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

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}...`;
}

function normalizeContentText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null || typeof value === 'undefined') {
    return '';
  }
  if (Array.isArray(value)) {
    const pieces = value
      .map(item => normalizeContentText(item))
      .map(item => item.trim())
      .filter(Boolean);
    return truncateText(pieces.join('\n').trim(), 80000);
  }
  const record = asRecord(value);
  if (!record) {
    return truncateText(asString(value), 80000);
  }

  const candidateKeys = [
    'text',
    'value',
    'output_text',
    'content',
    'delta',
    'arguments',
    'input_text',
    'parts',
    'segments',
    'items'
  ];
  const segments: string[] = [];
  for (const key of candidateKeys) {
    const candidate = normalizeContentText(record[key]);
    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      segments.push(trimmed);
    }
  }
  if (segments.length > 0) {
    const seen = new Set<string>();
    const deduped = segments.filter(segment => {
      const marker = segment.toLowerCase();
      if (seen.has(marker)) {
        return false;
      }
      seen.add(marker);
      return true;
    });
    return truncateText(deduped.join('\n').trim(), 80000);
  }

  return truncateText(prettyJson(value), 80000);
}

function parsePayloadToolCalls(value: unknown): ParsedPayloadToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const calls: ParsedPayloadToolCall[] = [];
  for (const rawCall of value) {
    const call = asRecord(rawCall);
    if (!call) {
      continue;
    }
    const functionRecord = asRecord(call.function);
    const name = asString(functionRecord?.name ?? call.name).trim();
    const argumentsJson = normalizeContentText(functionRecord?.arguments ?? call.arguments).trim();
    if (!name && !argumentsJson) {
      continue;
    }
    calls.push({
      id: asString(call.id).trim(),
      name,
      argumentsJson
    });
  }
  return calls;
}

function parsePayloadMessages(payload: Record<string, unknown>): ParsedPayloadMessage[] {
  const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
  const messages: ParsedPayloadMessage[] = [];
  for (let index = 0; index < rawMessages.length; index += 1) {
    const rawMessage = asRecord(rawMessages[index]);
    if (!rawMessage) {
      continue;
    }
    const role = asString(rawMessage.role).trim() || `message_${index + 1}`;
    const name = asString(rawMessage.name).trim();
    const toolCallId = asString(rawMessage.tool_call_id).trim();
    const toolName = asString(rawMessage.tool_name).trim();
    const content = normalizeContentText(rawMessage.content).trim();
    const toolCalls = parsePayloadToolCalls(rawMessage.tool_calls);
    if (!content && toolCalls.length === 0 && !name && !toolCallId && !toolName) {
      continue;
    }
    messages.push({
      role,
      name,
      toolCallId,
      toolName,
      content,
      toolCalls
    });
  }
  return messages;
}

function parsePayloadTools(payload: Record<string, unknown>): ParsedPayloadToolDefinition[] {
  const rawTools = Array.isArray(payload.tools) ? payload.tools : [];
  const tools: ParsedPayloadToolDefinition[] = [];
  for (const rawTool of rawTools) {
    const tool = asRecord(rawTool);
    if (!tool) {
      continue;
    }
    const functionRecord = asRecord(tool.function);
    const name = asString(functionRecord?.name ?? tool.name).trim();
    const description = asString(functionRecord?.description ?? tool.description).trim();
    const parameters = functionRecord?.parameters ?? tool.parameters;
    if (!name && !description && typeof parameters === 'undefined') {
      continue;
    }
    tools.push({
      name,
      description,
      parameters
    });
  }
  return tools;
}

function parsePayloadShape(payload: unknown): ParsedPayloadShape {
  const raw = asRecord(payload);
  if (!raw) {
    return {
      raw: null,
      summaryParts: [],
      messages: [],
      tools: []
    };
  }

  const messages = parsePayloadMessages(raw);
  const tools = parsePayloadTools(raw);
  const summaryParts: string[] = [];
  const pushPart = (label: string, value: unknown): void => {
    const text = asString(value).trim();
    if (text.length > 0) {
      summaryParts.push(`${label} ${text}`);
    }
  };

  pushPart('model', raw.model);
  if (typeof raw.temperature === 'number') {
    summaryParts.push(`temperature ${raw.temperature}`);
  }
  if (typeof raw.max_tokens === 'number') {
    summaryParts.push(`max_tokens ${Math.floor(raw.max_tokens)}`);
  }
  if (typeof raw.stream !== 'undefined') {
    summaryParts.push(`stream ${String(raw.stream)}`);
  }
  pushPart('tool_choice', raw.tool_choice);
  const options = asRecord(raw.options);
  if (options) {
    if (typeof options.temperature === 'number') {
      summaryParts.push(`options.temperature ${options.temperature}`);
    }
    if (typeof options.num_predict === 'number') {
      summaryParts.push(`options.num_predict ${Math.floor(options.num_predict)}`);
    }
  }
  summaryParts.push(`messages ${messages.length}`);
  if (tools.length > 0) {
    summaryParts.push(`tools ${tools.length}`);
  }
  return {
    raw,
    summaryParts,
    messages,
    tools
  };
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
      { value: 'tool_planner', label: 'tool_planner' },
      { value: 'embedding', label: 'embedding' }
    ];
    for (const optionSpec of kindOptions) {
      const option = kindSelect.createEl('option');
      option.value = optionSpec.value;
      option.text = optionSpec.label;
    }
    kindSelect.value = this.kindFilter;
    kindSelect.addEventListener('change', () => {
      const value = kindSelect.value;
      if (value === 'completion' || value === 'completion_stream' || value === 'tool_planner' || value === 'embedding') {
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

  private createReadonlyTextBox(container: HTMLElement, value: string, placeholder?: string): void {
    const textValue = value.trim().length > 0
      ? value
      : (placeholder ?? '[No text content]');
    const textArea = container.createEl('textarea', { cls: 'lorevault-operation-log-textbox' });
    textArea.value = textValue;
    textArea.readOnly = true;
    textArea.rows = Math.max(4, Math.min(20, textValue.split('\n').length + 1));
  }

  private renderPayloadMessages(container: HTMLElement, messages: ParsedPayloadMessage[], label = 'Messages'): void {
    if (messages.length === 0) {
      return;
    }
    const messagesDetails = container.createEl('details');
    messagesDetails.createEl('summary', { text: `${label} (${messages.length})` });
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      const messageDetails = messagesDetails.createEl('details');
      const summaryParts = [
        `#${index + 1}`,
        message.role
      ];
      if (message.name) {
        summaryParts.push(`name=${message.name}`);
      }
      if (message.toolCallId) {
        summaryParts.push(`tool_call_id=${message.toolCallId}`);
      }
      if (message.toolName) {
        summaryParts.push(`tool_name=${message.toolName}`);
      }
      if (message.toolCalls.length > 0) {
        summaryParts.push(`tool_calls=${message.toolCalls.length}`);
      }
      messageDetails.createEl('summary', {
        text: `${summaryParts.join(' | ')} | chars ${message.content.length}`
      });
      this.createReadonlyTextBox(messageDetails, message.content, '[No message content]');
      if (message.toolCalls.length > 0) {
        const toolCallsDetails = messageDetails.createEl('details');
        toolCallsDetails.createEl('summary', {
          text: `Tool Calls (${message.toolCalls.length})`
        });
        for (let callIndex = 0; callIndex < message.toolCalls.length; callIndex += 1) {
          const call = message.toolCalls[callIndex];
          const callDetails = toolCallsDetails.createEl('details');
          const callSummary = [
            `#${callIndex + 1}`,
            call.name || '(unnamed)'
          ];
          if (call.id) {
            callSummary.push(`id=${call.id}`);
          }
          callDetails.createEl('summary', { text: callSummary.join(' | ') });
          this.createReadonlyTextBox(callDetails, call.argumentsJson, '[No tool arguments]');
        }
      }
    }
  }

  private renderPayloadTools(container: HTMLElement, tools: ParsedPayloadToolDefinition[]): void {
    if (tools.length === 0) {
      return;
    }
    const toolsDetails = container.createEl('details');
    toolsDetails.createEl('summary', { text: `Tool Definitions (${tools.length})` });
    for (let index = 0; index < tools.length; index += 1) {
      const tool = tools[index];
      const detail = toolsDetails.createEl('details');
      detail.createEl('summary', {
        text: `${index + 1}. ${tool.name || '(unnamed tool)'}`
      });
      if (tool.description) {
        detail.createEl('p', { text: tool.description });
      }
      if (typeof tool.parameters !== 'undefined') {
        const pre = detail.createEl('pre', { cls: 'lorevault-operation-log-json' });
        pre.setText(prettyJson(tool.parameters));
      }
    }
  }

  private renderPayloadBreakdown(
    container: HTMLElement,
    payload: unknown,
    options?: { includeRawJson?: boolean; rawLabel?: string }
  ): void {
    const parsed = parsePayloadShape(payload);
    if (!parsed.raw) {
      container.createEl('p', {
        cls: 'lorevault-operation-log-subtle',
        text: 'Payload is not an object record.'
      });
      if (options?.includeRawJson) {
        const rawDetails = container.createEl('details');
        rawDetails.createEl('summary', { text: options.rawLabel ?? 'Raw JSON' });
        rawDetails.createEl('pre', {
          cls: 'lorevault-operation-log-json',
          text: prettyJson(payload)
        });
      }
      return;
    }

    if (parsed.summaryParts.length > 0) {
      container.createEl('p', {
        text: parsed.summaryParts.join(' | ')
      });
    }
    this.renderPayloadMessages(container, parsed.messages);
    this.renderPayloadTools(container, parsed.tools);
    if (options?.includeRawJson) {
      const rawDetails = container.createEl('details');
      rawDetails.createEl('summary', { text: options.rawLabel ?? 'Raw JSON' });
      rawDetails.createEl('pre', {
        cls: 'lorevault-operation-log-json',
        text: prettyJson(payload)
      });
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
    this.renderPayloadBreakdown(requestDetails, entry.record.request, {
      includeRawJson: true,
      rawLabel: 'Request JSON'
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
        const attemptRequestDetails = attemptDetails.createEl('details');
        attemptRequestDetails.createEl('summary', { text: 'Attempt Request' });
        this.renderPayloadBreakdown(attemptRequestDetails, attempt.requestBody, {
          includeRawJson: true,
          rawLabel: 'Attempt Request JSON'
        });
        if (typeof attempt.responseBody !== 'undefined') {
          const responseDetails = attemptDetails.createEl('details');
          responseDetails.createEl('summary', { text: 'Response Body' });
          this.renderPayloadBreakdown(responseDetails, attempt.responseBody, {
            includeRawJson: true,
            rawLabel: 'Response JSON'
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
