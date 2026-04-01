import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type LoreBookConverterPlugin from './main';
import {
  OperationLogListEntry,
  OperationLogParseIssue,
  ParsedOperationLogEntry
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
  private entries: OperationLogListEntry[] = [];
  private issues: OperationLogParseIssue[] = [];
  private totalEntries: number | null = 0;
  private hasMoreEntries = false;
  private fatalError = '';
  private isLoading = false;
  private loadVersion = 0;
  private kindFilter: KindFilter = 'all';
  private statusFilter: StatusFilter = 'all';
  private searchQuery = '';
  private rowLimit = 120;
  private autoRefresh = false;
  private selectedCostProfile = '';
  private availableCostProfiles: string[] = [];
  private autoRefreshTimer: number | null = null;
  private reloadDebounceTimer: number | null = null;
  private backendLabel = 'Unavailable';
  private legacyPath = '';
  private backendWarning = '';
  private statusEl: HTMLElement | null = null;
  private pathEl: HTMLElement | null = null;
  private issueEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private costProfileSelectEl: HTMLSelectElement | null = null;

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
    if (this.reloadDebounceTimer !== null) {
      window.clearTimeout(this.reloadDebounceTimer);
      this.reloadDebounceTimer = null;
    }
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
    const costProfileSelect = filters.createEl('select');
    costProfileSelect.title = 'Cost profile';
    costProfileSelect.addEventListener('change', () => {
      this.selectedCostProfile = costProfileSelect.value.trim();
      void this.reloadEntries();
    });
    this.costProfileSelectEl = costProfileSelect;
    this.renderCostProfileSelect();

    const searchInput = filters.createEl('input', { cls: 'lorevault-operation-log-search' });
    searchInput.type = 'search';
    searchInput.placeholder = 'Search operation/model/error/request text...';
    searchInput.value = this.searchQuery;
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      this.scheduleReload(140);
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
      void this.reloadEntries();
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
      void this.reloadEntries();
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
      void this.reloadEntries();
    });

    this.pathEl = contentEl.createDiv({ cls: 'lorevault-operation-log-path' });
    this.statusEl = contentEl.createDiv({ cls: 'lorevault-operation-log-status' });
    this.issueEl = contentEl.createDiv({ cls: 'lorevault-operation-log-issues' });
    this.listEl = contentEl.createDiv({ cls: 'lorevault-operation-log-list' });
    this.updatePathSummary();
    this.renderStatus();
  }

  private async refreshCostProfileOptions(): Promise<void> {
    const known = await this.plugin.listKnownCostProfiles();
    const deviceDefault = this.plugin.getDeviceEffectiveCostProfileLabel().trim();
    const values = new Set<string>();
    for (const profile of known) {
      const normalized = profile.trim();
      if (normalized) {
        values.add(normalized);
      }
    }
    if (deviceDefault) {
      values.add(deviceDefault);
    }
    if (this.selectedCostProfile) {
      values.add(this.selectedCostProfile);
    }
    this.availableCostProfiles = [...values].sort((left, right) => left.localeCompare(right));
    if (!this.selectedCostProfile) {
      this.selectedCostProfile = deviceDefault || this.availableCostProfiles[0] || '';
    }
  }

  private renderCostProfileSelect(): void {
    if (!this.costProfileSelectEl) {
      return;
    }
    this.costProfileSelectEl.empty();
    if (this.availableCostProfiles.length === 0) {
      this.costProfileSelectEl.createEl('option', {
        value: '',
        text: '(none)'
      });
      this.costProfileSelectEl.value = '';
      return;
    }
    for (const profile of this.availableCostProfiles) {
      this.costProfileSelectEl.createEl('option', {
        value: profile,
        text: profile
      });
    }
    this.costProfileSelectEl.value = this.selectedCostProfile;
  }

  private getEntryCostProfile(entry: OperationLogListEntry): string {
    return entry.summary.costProfile?.trim()
      || this.selectedCostProfile
      || this.plugin.getDeviceEffectiveCostProfileLabel().trim()
      || 'default';
  }

  private updatePathSummary(): void {
    if (!this.pathEl) {
      return;
    }
    this.pathEl.empty();
    if (!this.backendWarning) {
      return;
    }
    this.pathEl.createDiv({
      cls: 'lorevault-operation-log-warning',
      text: this.backendWarning
    });
  }

  private scheduleReload(delayMs = 120): void {
    if (this.reloadDebounceTimer !== null) {
      window.clearTimeout(this.reloadDebounceTimer);
    }
    this.reloadDebounceTimer = window.setTimeout(() => {
      this.reloadDebounceTimer = null;
      void this.reloadEntries();
    }, delayMs);
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
    try {
      await this.refreshCostProfileOptions();
      this.renderCostProfileSelect();
    } catch (error) {
      console.warn('LoreVault: Failed to load cost profile options for operation log view:', error);
    }
    this.updatePathSummary();
    try {
      const result = await this.plugin.loadOperationLogEntries({
        costProfile: this.selectedCostProfile,
        kindFilter: this.kindFilter,
        statusFilter: this.statusFilter,
        searchQuery: this.searchQuery,
        limit: this.rowLimit
      });
      if (loadVersion !== this.loadVersion) {
        return;
      }
      this.entries = result.entries;
      this.issues = result.issues;
      this.totalEntries = result.totalEntries;
      this.hasMoreEntries = result.hasMoreEntries;
      this.backendLabel = result.backendLabel;
      this.legacyPath = result.legacyPath;
      this.backendWarning = result.warningMessage;
      this.fatalError = '';
    } catch (error) {
      if (loadVersion !== this.loadVersion) {
        return;
      }
      this.entries = [];
      this.issues = [];
      this.totalEntries = 0;
      this.hasMoreEntries = false;
      this.backendLabel = 'Unavailable';
      this.legacyPath = this.plugin.getOperationLogPath(this.selectedCostProfile);
      this.backendWarning = '';
      this.fatalError = error instanceof Error ? error.message : String(error);
    } finally {
      if (loadVersion === this.loadVersion) {
        this.isLoading = false;
        this.updatePathSummary();
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

    const parts = [this.describeEntryCount('Loaded'), this.backendLabel];
    if (this.issues.length > 0) {
      parts.push(`Parse issues: ${this.issues.length}`);
    }
    this.statusEl.setText(parts.join(' | '));
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

  private hasActiveFilters(): boolean {
    return this.kindFilter !== 'all'
      || this.statusFilter !== 'all'
      || this.searchQuery.trim().length > 0;
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

    if (this.entries.length === 0) {
      this.listEl.createEl('p', {
        text: this.hasActiveFilters()
          ? 'No entries match current filters.'
          : this.totalEntries === 0
          ? 'No operation log entries found. Trigger a completion/chat request to populate this file.'
          : 'No entries match current filters.'
      });
      return;
    }

    this.listEl.createEl('p', {
      cls: 'lorevault-operation-log-subtle',
      text: this.describeEntryCount('Showing')
    });

    for (const entry of this.entries) {
      this.renderEntry(entry);
    }
  }

  private createReadonlyTextBox(container: HTMLElement, value: string, placeholder?: string): void {
    const rawValue = value;
    const textValue = rawValue.trim().length > 0
      ? rawValue
      : (placeholder ?? '[No text content]');
    const wrapper = container.createDiv({ cls: 'lorevault-operation-log-copyable' });
    const textArea = wrapper.createEl('textarea', { cls: 'lorevault-operation-log-textbox' });
    textArea.value = textValue;
    textArea.readOnly = true;
    textArea.rows = Math.max(4, Math.min(20, textValue.split('\n').length + 1));
    this.addCopyIcon(wrapper, rawValue);
  }

  private describeEntryCount(verb: 'Loaded' | 'Showing'): string {
    const count = this.entries.length;
    if (typeof this.totalEntries === 'number') {
      return `${verb} ${count} of ${Math.max(0, this.totalEntries)} matching entr${this.totalEntries === 1 ? 'y' : 'ies'}.`;
    }
    if (this.hasMoreEntries) {
      return `${verb} first ${count} matching entr${count === 1 ? 'y' : 'ies'} (more available).`;
    }
    return `${verb} ${count} matching entr${count === 1 ? 'y' : 'ies'}.`;
  }

  private createReadonlyInlineField(container: HTMLElement, value: string, placeholder?: string): void {
    const rawValue = value;
    const textValue = rawValue.trim().length > 0
      ? rawValue
      : (placeholder ?? '[No text content]');
    const wrapper = container.createDiv({ cls: 'lorevault-operation-log-copyable lorevault-operation-log-copyable-inline' });
    const input = wrapper.createEl('input', { cls: 'lorevault-operation-log-inline-field' });
    input.type = 'text';
    input.value = textValue;
    input.readOnly = true;
    this.addCopyIcon(wrapper, rawValue);
  }

  private addCopyIcon(wrapper: HTMLElement, rawValue: string): void {
    if (!rawValue.trim()) {
      return;
    }
    const btn = wrapper.createEl('button', {
      cls: 'lorevault-operation-log-copy-icon',
      attr: { 'aria-label': 'Copy to clipboard' }
    });
    setIcon(btn, 'copy');
    btn.addEventListener('click', () => {
      void this.copyTextToClipboard(rawValue);
    });
  }

  private async copyTextToClipboard(value: string): Promise<void> {
    if (value.length === 0) {
      new Notice('Nothing to copy.');
      return;
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        new Notice('Copied to clipboard.');
        return;
      }
    } catch (_error) {
      // Fall through to document.execCommand fallback.
    }

    if (typeof document === 'undefined') {
      new Notice('Failed to copy to clipboard.');
      return;
    }

    const textArea = document.createElement('textarea');
    textArea.value = value;
    textArea.setAttribute('readonly', 'true');
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    textArea.style.pointerEvents = 'none';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, value.length);
    const copied = document.execCommand('copy');
    document.body.removeChild(textArea);
    new Notice(copied ? 'Copied to clipboard.' : 'Failed to copy to clipboard.');
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
        this.createReadonlyTextBox(detail, tool.description, '[No description]');
      }
      if (typeof tool.parameters !== 'undefined') {
        this.createReadonlyTextBox(detail, prettyJson(tool.parameters), '[No parameters]');
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
      this.createReadonlyInlineField(container, 'Payload is not an object record.');
      if (options?.includeRawJson) {
        const rawDetails = container.createEl('details');
        rawDetails.createEl('summary', { text: options.rawLabel ?? 'Raw JSON' });
        this.createReadonlyTextBox(rawDetails, prettyJson(payload), '[No JSON]');
      }
      return;
    }

    if (parsed.summaryParts.length > 0) {
      this.createReadonlyInlineField(container, parsed.summaryParts.join(' | '));
    }
    this.renderPayloadMessages(container, parsed.messages);
    this.renderPayloadTools(container, parsed.tools);
    if (options?.includeRawJson) {
      const rawDetails = container.createEl('details');
      rawDetails.createEl('summary', { text: options.rawLabel ?? 'Raw JSON' });
      this.createReadonlyTextBox(rawDetails, prettyJson(payload), '[No JSON]');
    }
  }

  private createLazyDetailsSection(
    container: HTMLElement,
    summaryText: string,
    renderContent: (body: HTMLElement) => void
  ): HTMLDetailsElement {
    const details = container.createEl('details');
    details.createEl('summary', { text: summaryText });
    const body = details.createDiv();
    let rendered = false;
    const renderIfNeeded = (): void => {
      if (rendered) {
        return;
      }
      rendered = true;
      renderContent(body);
    };
    details.addEventListener('toggle', () => {
      if (details.open) {
        renderIfNeeded();
      }
    });
    return details;
  }

  private renderEntry(entry: OperationLogListEntry): void {
    if (!this.listEl) {
      return;
    }
    const details = this.listEl.createEl('details', { cls: 'lorevault-operation-log-entry' });
    const summaryEl = details.createEl('summary', { cls: 'lorevault-operation-log-entry-summary' });
    const summary = entry.summary;
    const statusClass = summary.status === 'error'
      ? 'lorevault-operation-log-status-error'
      : 'lorevault-operation-log-status-ok';
    const abortedLabel = summary.aborted ? ' | aborted' : '';
    const secondaryParts = [
      summary.model || summary.provider,
      formatDuration(summary.durationMs)
    ].filter(Boolean);
    summaryEl.createEl('span', {
      text: `${formatDateTime(summary.startedAt)} | ${summary.operationName} | ${summary.kind}${abortedLabel}`
    });
    if (secondaryParts.length > 0) {
      summaryEl.createEl('span', {
        cls: 'lorevault-operation-log-subtle',
        text: secondaryParts.join(' | ')
      });
    }
    summaryEl.createEl('span', {
      cls: statusClass,
      text: summary.status
    });

    const bodyEl = details.createDiv({ cls: 'lorevault-operation-log-entry-body' });
    let rendered = false;
    details.addEventListener('toggle', () => {
      if (!details.open) {
        return;
      }
      if (rendered) {
        return;
      }
      rendered = true;
      void this.renderEntryDetailBody(bodyEl, entry);
    });
  }

  private async renderEntryDetailBody(container: HTMLElement, entry: OperationLogListEntry): Promise<void> {
    const detail = entry.detailRecord ?? await this.loadEntryDetail(entry, container);
    if (detail) {
      entry.detailRecord = detail;
    }
    container.empty();
    this.renderResolvedEntryDetailBody(container, entry, detail);
  }

  private async loadEntryDetail(
    entry: OperationLogListEntry,
    container: HTMLElement
  ): Promise<ParsedOperationLogEntry | null> {
    const loadVersion = this.loadVersion;
    container.empty();
    container.createEl('p', {
      cls: 'lorevault-operation-log-subtle',
      text: 'Loading details...'
    });
    try {
      const detail = await this.plugin.loadOperationLogEntryDetail({
        costProfile: this.getEntryCostProfile(entry),
        id: entry.summary.id
      });
      if (loadVersion !== this.loadVersion || !container.isConnected) {
        return null;
      }
      return detail;
    } catch (error) {
      if (loadVersion === this.loadVersion && container.isConnected) {
        container.empty();
        container.createEl('p', {
          cls: 'lorevault-operation-log-error',
          text: `Failed to load details: ${error instanceof Error ? error.message : String(error)}`
        });
      }
      return null;
    }
  }

  private renderResolvedEntryDetailBody(
    container: HTMLElement,
    entry: OperationLogListEntry,
    detail: ParsedOperationLogEntry | null | undefined
  ): void {
    const summary = entry.summary;
    this.createReadonlyInlineField(container, [
      `ID: ${summary.id}`,
      `Cost profile: ${summary.costProfile || '(none)'}`,
      `Provider: ${summary.provider}`,
      `Model: ${summary.model || '(none)'}`,
      `Duration: ${formatDuration(summary.durationMs)}`
    ].join(' | '));
    this.createReadonlyInlineField(container, `Endpoint: ${summary.endpoint || '(none)'}`);
    this.createReadonlyInlineField(container, [
      `Started: ${formatDateTime(summary.startedAt)}`,
      `Finished: ${formatDateTime(summary.finishedAt)}`
    ].filter(Boolean).join(' | '));

    if (summary.error) {
      this.createReadonlyTextBox(container, `Error: ${summary.error}`);
    }

    if (!detail) {
      container.createEl('p', {
        cls: 'lorevault-operation-log-error',
      text: 'Detailed record data is unavailable for this entry.'
      });
      return;
    }

    if (detail.record.usage) {
      this.createReadonlyInlineField(container, [
        `Usage source: ${detail.record.usage.source}`,
        `prompt ${detail.record.usage.promptTokens}`,
        `completion ${detail.record.usage.completionTokens}`,
        `total ${detail.record.usage.totalTokens}`,
        `cost ${detail.record.usage.reportedCostUsd === null ? 'n/a' : detail.record.usage.reportedCostUsd.toString()}`
      ].join(' | '));
    }

    this.createLazyDetailsSection(container, 'Request Payload', body => {
      this.renderPayloadBreakdown(body, detail.record.request, {
        includeRawJson: true,
        rawLabel: 'Request JSON'
      });
    });

    this.createLazyDetailsSection(container, `Attempts (${detail.record.attempts.length})`, body => {
      if (!Array.isArray(detail.record.attempts) || detail.record.attempts.length === 0) {
        body.createEl('p', { text: 'No attempts captured.' });
        return;
      }
      for (let index = 0; index < detail.record.attempts.length; index += 1) {
        const attempt = detail.record.attempts[index];
        this.createLazyDetailsSection(body, formatAttemptHeader(attempt, index), attemptBody => {
          this.createLazyDetailsSection(attemptBody, 'Attempt Request', requestBody => {
            this.renderPayloadBreakdown(requestBody, attempt.requestBody, {
              includeRawJson: true,
              rawLabel: 'Attempt Request JSON'
            });
          });
          if (typeof attempt.responseBody !== 'undefined') {
            this.createLazyDetailsSection(attemptBody, 'Response Body', responseBody => {
              this.renderPayloadBreakdown(responseBody, attempt.responseBody, {
                includeRawJson: true,
                rawLabel: 'Response JSON'
              });
            });
          }
          const responseText = attempt.responseText;
          if (typeof responseText === 'string' && responseText.length > 0) {
            this.createLazyDetailsSection(attemptBody, 'Raw Response Text', textBody => {
              this.createReadonlyTextBox(textBody, responseText);
            });
          }
          if (attempt.error) {
            this.createReadonlyTextBox(attemptBody, `Attempt error: ${attempt.error}`);
          }
        });
      }
    });

    this.createLazyDetailsSection(container, detail.record.finalText
      ? `Final Output Text (${detail.record.finalText.length} chars)`
      : 'Final Output Text', body => {
      if (typeof detail.record.finalText !== 'string' || detail.record.finalText.length === 0) {
        body.createEl('p', {
          cls: 'lorevault-operation-log-subtle',
          text: 'No final output text captured.'
        });
        return;
      }
      this.createReadonlyTextBox(body, detail.record.finalText);
    });

    this.createLazyDetailsSection(container, 'Normalized Record JSON', body => {
      this.createReadonlyTextBox(body, prettyJson(detail.record), '[No JSON]');
    });
  }

}
