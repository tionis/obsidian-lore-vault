import {
  App,
  FuzzySuggestModal,
  ItemView,
  MarkdownRenderer,
  Notice,
  TFile,
  WorkspaceLeaf,
  setIcon
} from 'obsidian';
import LoreBookConverterPlugin from './main';
import {
  asNumber,
  asString,
  asStringArray,
  FrontmatterData,
  getFrontmatterValue,
  normalizeFrontmatter
} from './frontmatter-utils';
import {
  StoryChatContextMeta,
  StoryChatMessage
} from './models';
import {
  CHAT_SCHEMA_VERSION,
  ChatMessageVersion,
  ConversationDocument,
  ConversationMessage,
  cloneStoryChatContextMeta,
  parseConversationMarkdown,
  serializeConversationMarkdown
} from './story-chat-document';
import {
  buildStoryChatContextInspectorLines,
  buildStoryChatContextInspectorSummary
} from './story-chat-context-inspector';
import {
  extractNoteRefsFromStoryChatSteeringRefs,
  normalizeStoryChatSteeringRefs,
  parseStoryChatSteeringRef,
  stringifyStoryChatSteeringRef
} from './story-chat-steering-refs';

export const LOREVAULT_STORY_CHAT_VIEW_TYPE = 'lorevault-story-chat-view';

interface ConversationSummary {
  id: string;
  title: string;
  path: string;
  createdAt: number;
  updatedAt: number;
}

function formatScope(scope: string): string {
  return scope || '(all)';
}

function formatTime(timestamp: number): string {
  if (!timestamp) {
    return '';
  }
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(timestamp: number): string {
  if (!timestamp) {
    return '';
  }
  return new Date(timestamp).toLocaleString();
}

function formatTokenValue(value: number): string {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)).toString() : '0';
}

function slugifyTitle(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'chat';
}

class NotePickerModal extends FuzzySuggestModal<TFile> {
  private files: TFile[];
  private onChoose: (file: TFile) => void;

  constructor(app: App, files: TFile[], onChoose: (file: TFile) => void, placeholder = 'Pick a note...') {
    super(app);
    this.files = [...files].sort((a, b) => a.path.localeCompare(b.path));
    this.onChoose = onChoose;
    this.setPlaceholder(placeholder);
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}

class ScopePickerModal extends FuzzySuggestModal<string> {
  private scopes: string[];
  private onChoose: (scope: string) => void;

  constructor(app: App, scopes: string[], onChoose: (scope: string) => void) {
    super(app);
    this.scopes = [...scopes].sort((a, b) => a.localeCompare(b));
    this.onChoose = onChoose;
    this.setPlaceholder('Pick a lorebook scope to add...');
  }

  getItems(): string[] {
    return this.scopes;
  }

  getItemText(scope: string): string {
    return formatScope(scope);
  }

  onChooseItem(scope: string): void {
    this.onChoose(scope);
  }
}

class ConversationPickerModal extends FuzzySuggestModal<ConversationSummary> {
  private conversations: ConversationSummary[];
  private onChoose: (summary: ConversationSummary) => void;

  constructor(
    app: App,
    conversations: ConversationSummary[],
    onChoose: (summary: ConversationSummary) => void
  ) {
    super(app);
    this.conversations = [...conversations].sort((a, b) => (
      b.updatedAt - a.updatedAt ||
      a.title.localeCompare(b.title)
    ));
    this.onChoose = onChoose;
    this.setPlaceholder('Pick a conversation...');
  }

  getItems(): ConversationSummary[] {
    return this.conversations;
  }

  getItemText(summary: ConversationSummary): string {
    return `${summary.title} (${formatDateTime(summary.updatedAt)})`;
  }

  onChooseItem(summary: ConversationSummary): void {
    this.onChoose(summary);
  }
}

export class StoryChatView extends ItemView {
  private plugin: LoreBookConverterPlugin;
  private chatFolder = 'LoreVault/chat';
  private activeConversationPath = '';
  private conversationId = '';
  private conversationTitle = '';
  private conversationCreatedAt = 0;
  private selectedScopes = new Set<string>();
  private manualContext = '';
  private steeringScopeRefs: string[] = [];
  private continuitySelection = {
    includePlotThreads: true,
    includeOpenLoops: true,
    includeCanonDeltas: true
  };
  private noteContextRefs: string[] = [];
  private messages: ConversationMessage[] = [];
  private conversationSummaries: ConversationSummary[] = [];
  private isSending = false;
  private stopRequested = false;
  private saveTimer: number | null = null;
  private telemetryTimer: number | null = null;
  private ignoreRefreshUntil = 0;
  private inputDraft = '';
  private inputEl: HTMLTextAreaElement | null = null;
  private statusEl: HTMLElement | null = null;
  private generationStateEl: HTMLElement | null = null;
  private generationScopesEl: HTMLElement | null = null;
  private generationTokensEl: HTMLElement | null = null;
  private generationOutputEl: HTMLElement | null = null;
  private editingMessageId: string | null = null;
  private editingVersionId: string | null = null;
  private editingMessageDraft = '';

  constructor(leaf: WorkspaceLeaf, plugin: LoreBookConverterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LOREVAULT_STORY_CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Story Chat';
  }

  getIcon(): string {
    return 'message-circle';
  }

  async onOpen(): Promise<void> {
    this.loadSettingsState();
    await this.loadConversationSummaries();
    await this.ensureConversationLoaded();
    this.render();
    this.startTelemetryPolling();
  }

  async onClose(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.telemetryTimer !== null) {
      window.clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
    await this.saveCurrentConversation();
    this.contentEl.empty();
  }

  refresh(): void {
    // Avoid full rerenders from vault modify events while editing/sending.
    this.updateGenerationMonitor();
    if (Date.now() < this.ignoreRefreshUntil) {
      return;
    }

    if (this.isSending) {
      return;
    }

    void this.refreshFromSettingsIfNeeded();
  }

  private async refreshFromSettingsIfNeeded(): Promise<void> {
    const previousFolder = this.chatFolder;
    const previousPath = this.activeConversationPath;
    this.loadSettingsState();

    const folderChanged = this.chatFolder !== previousFolder;
    const pathChanged = this.activeConversationPath !== previousPath;
    if (!folderChanged && !pathChanged) {
      return;
    }

    await this.loadConversationSummaries();

    if (this.activeConversationPath) {
      const loaded = await this.loadConversationByPath(this.activeConversationPath);
      if (loaded) {
        this.render();
        return;
      }
    }

    await this.ensureConversationLoaded();
    this.render();
  }

  private loadSettingsState(): void {
    const config = this.plugin.getStoryChatConfig();
    this.chatFolder = config.chatFolder?.trim() || 'LoreVault/chat';
    this.activeConversationPath = config.activeConversationPath?.trim() || '';
  }

  private async persistSettingsState(): Promise<void> {
    await this.plugin.updateStoryChatConfig({
      chatFolder: this.chatFolder,
      activeConversationPath: this.activeConversationPath
    });
  }

  private createId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private cloneContextMeta(meta: StoryChatContextMeta | undefined): StoryChatContextMeta | undefined {
    return cloneStoryChatContextMeta(meta);
  }

  private cloneVersion(version: ChatMessageVersion): ChatMessageVersion {
    return {
      ...version,
      contextMeta: this.cloneContextMeta(version.contextMeta)
    };
  }

  private cloneMessage(message: ConversationMessage): ConversationMessage {
    return {
      ...message,
      versions: message.versions.map(version => this.cloneVersion(version))
    };
  }

  private getSelectedVersion(message: ConversationMessage): ChatMessageVersion {
    return message.versions.find(version => version.id === message.activeVersionId) ?? message.versions[0];
  }

  private isPathAlreadyExistsError(error: unknown): boolean {
    const maybe = error as { code?: string; message?: string };
    const code = typeof maybe?.code === 'string' ? maybe.code.toUpperCase() : '';
    if (code === 'EEXIST') {
      return true;
    }
    const message = typeof maybe?.message === 'string' ? maybe.message.toLowerCase() : String(error ?? '').toLowerCase();
    return message.includes('already exists');
  }

  private async ensureFolderExists(folderPath: string): Promise<void> {
    const normalized = folderPath
      .split('/')
      .map(part => part.trim())
      .filter(Boolean);
    if (normalized.length === 0) {
      return;
    }

    let current = '';
    for (const part of normalized) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (!existing) {
        try {
          await this.app.vault.createFolder(current);
        } catch (error) {
          if (!this.isPathAlreadyExistsError(error)) {
            throw error;
          }
        }
      }
    }
  }

  private async getUniqueConversationPath(title: string): Promise<string> {
    const folder = this.chatFolder;
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const slug = slugifyTitle(title);
    let attempt = 0;

    while (attempt < 200) {
      const suffix = attempt === 0 ? '' : `-${attempt}`;
      const candidate = `${folder}/${stamp}-${slug}${suffix}.md`;
      if (!this.app.vault.getAbstractFileByPath(candidate)) {
        return candidate;
      }
      attempt += 1;
    }

    return `${folder}/${Date.now()}-${slug}-${Math.random().toString(36).slice(2, 8)}.md`;
  }

  private applyConversationDocument(document: ConversationDocument, path: string): void {
    this.activeConversationPath = path;
    this.conversationId = document.id;
    this.conversationTitle = document.title;
    this.conversationCreatedAt = document.createdAt;
    this.selectedScopes = new Set(document.selectedScopes);
    this.manualContext = document.manualContext;
    this.steeringScopeRefs = normalizeStoryChatSteeringRefs(document.steeringScopeRefs ?? []);
    this.continuitySelection = {
      includePlotThreads: true,
      includeOpenLoops: true,
      includeCanonDeltas: true
    };
    this.noteContextRefs = [...document.noteContextRefs];
    this.messages = document.messages.map(message => this.cloneMessage(message));
    this.editingMessageId = null;
    this.editingVersionId = null;
    this.editingMessageDraft = '';
  }

  private buildCurrentConversationDocument(updatedAt: number): ConversationDocument {
    return {
      schemaVersion: CHAT_SCHEMA_VERSION,
      id: this.conversationId || this.createId('conv'),
      title: this.conversationTitle || 'Story Chat',
      createdAt: this.conversationCreatedAt || updatedAt,
      updatedAt,
      selectedScopes: [...this.selectedScopes].sort((a, b) => a.localeCompare(b)),
      useLorebookContext: this.selectedScopes.size > 0,
      manualContext: this.manualContext,
      steeringScopeRefs: [...this.steeringScopeRefs],
      pinnedInstructions: '',
      storyNotes: '',
      sceneIntent: '',
      continuityPlotThreads: [],
      continuityOpenLoops: [],
      continuityCanonDeltas: [],
      continuitySelection: { ...this.continuitySelection },
      noteContextRefs: [...this.noteContextRefs],
      messages: this.messages.map(message => this.cloneMessage(message))
    };
  }

  private async loadConversationSummaries(): Promise<void> {
    const prefix = `${this.chatFolder}/`;
    const files = this.app.vault
      .getMarkdownFiles()
      .filter(file => file.path.startsWith(prefix));
    const summaries: ConversationSummary[] = [];

    for (const file of files) {
      try {
        const content = await this.app.vault.cachedRead(file);
        const parsed = parseConversationMarkdown(
          content,
          file.basename,
          prefix => this.createId(prefix)
        );
        if (!parsed) {
          continue;
        }
        summaries.push({
          id: parsed.id,
          title: parsed.title,
          path: file.path,
          createdAt: parsed.createdAt,
          updatedAt: parsed.updatedAt
        });
      } catch (error) {
        console.error(`Failed to inspect chat conversation ${file.path}:`, error);
      }
    }

    summaries.sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) {
        return b.updatedAt - a.updatedAt;
      }
      return a.title.localeCompare(b.title);
    });

    this.conversationSummaries = summaries;
  }

  private async loadConversationByPath(path: string): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return false;
    }

    const markdown = await this.app.vault.cachedRead(file);
    const parsed = parseConversationMarkdown(
      markdown,
      file.basename,
      prefix => this.createId(prefix)
    );
    if (!parsed) {
      return false;
    }

    this.applyConversationDocument(parsed, file.path);
    await this.persistSettingsState();
    return true;
  }

  private async ensureConversationLoaded(): Promise<void> {
    if (this.activeConversationPath) {
      const loaded = await this.loadConversationByPath(this.activeConversationPath);
      if (loaded) {
        return;
      }
    }

    if (this.conversationSummaries.length > 0) {
      const loaded = await this.loadConversationByPath(this.conversationSummaries[0].path);
      if (loaded) {
        return;
      }
    }

    await this.createConversation('Story Chat', null);
  }

  private async createConversation(title: string, sourceMessageIndex: number | null): Promise<void> {
    await this.ensureFolderExists(this.chatFolder);
    const now = Date.now();
    const sourceMessages = sourceMessageIndex === null
      ? []
      : this.messages.slice(0, sourceMessageIndex + 1).map(message => this.cloneMessage(message));
    const document: ConversationDocument = {
      schemaVersion: CHAT_SCHEMA_VERSION,
      id: this.createId('conv'),
      title: title.trim() || 'Story Chat',
      createdAt: now,
      updatedAt: now,
      selectedScopes: [...this.selectedScopes].sort((a, b) => a.localeCompare(b)),
      useLorebookContext: this.selectedScopes.size > 0,
      manualContext: this.manualContext,
      steeringScopeRefs: [...this.steeringScopeRefs],
      pinnedInstructions: '',
      storyNotes: '',
      sceneIntent: '',
      continuityPlotThreads: [],
      continuityOpenLoops: [],
      continuityCanonDeltas: [],
      continuitySelection: { ...this.continuitySelection },
      noteContextRefs: [...this.noteContextRefs],
      messages: sourceMessages
    };

    const path = await this.getUniqueConversationPath(document.title);
    await this.app.vault.create(path, serializeConversationMarkdown(document));
    this.applyConversationDocument(document, path);
    await this.persistSettingsState();
    await this.loadConversationSummaries();
  }

  private async saveCurrentConversation(): Promise<void> {
    if (!this.activeConversationPath) {
      return;
    }

    const updatedAt = Date.now();
    const document = this.buildCurrentConversationDocument(updatedAt);
    const markdown = serializeConversationMarkdown(document);
    const existing = this.app.vault.getAbstractFileByPath(this.activeConversationPath);
    this.ignoreRefreshUntil = Date.now() + 800;

    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, markdown);
    } else {
      await this.ensureFolderExists(this.chatFolder);
      await this.app.vault.create(this.activeConversationPath, markdown);
    }

    const existingSummary = this.conversationSummaries.find(summary => summary.path === this.activeConversationPath);
    if (existingSummary) {
      existingSummary.title = document.title;
      existingSummary.updatedAt = document.updatedAt;
    } else {
      this.conversationSummaries.push({
        id: document.id,
        title: document.title,
        path: this.activeConversationPath,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt
      });
    }
    this.conversationSummaries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private scheduleConversationSave(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }

    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveCurrentConversation();
    }, 400);
  }

  private setStatus(message: string): void {
    if (!this.statusEl) {
      return;
    }
    this.statusEl.setText(message);
  }

  private renderMarkdownContent(container: HTMLElement, markdown: string): void {
    container.empty();
    void MarkdownRenderer.render(
      this.app,
      markdown,
      container,
      this.activeConversationPath || '',
      this
    );
  }

  private startTelemetryPolling(): void {
    if (this.telemetryTimer !== null) {
      window.clearInterval(this.telemetryTimer);
    }

    this.telemetryTimer = window.setInterval(() => {
      this.updateGenerationMonitor();
    }, 450);
  }

  private updateGenerationMonitor(): void {
    if (!this.generationStateEl || !this.generationScopesEl || !this.generationTokensEl || !this.generationOutputEl) {
      return;
    }

    const telemetry = this.plugin.getGenerationTelemetry();
    const scopes = telemetry.scopes.length > 0 ? telemetry.scopes.join(', ') : '(none)';
    const outputPct = telemetry.maxOutputTokens > 0
      ? Math.min(100, Math.max(0, Math.floor((telemetry.generatedTokens / telemetry.maxOutputTokens) * 100)))
      : 0;
    const status = telemetry.state === 'idle'
      ? 'idle'
      : `${telemetry.state}: ${telemetry.statusText}`;

    this.generationStateEl.setText(`Generation: ${status}`);
    this.generationScopesEl.setText(`Scopes: ${scopes}`);
    this.generationTokensEl.setText(
      `Context window ${formatTokenValue(telemetry.contextWindowTokens)} | input ${formatTokenValue(telemetry.maxInputTokens)} | used ${formatTokenValue(telemetry.contextUsedTokens)} | remaining ${formatTokenValue(telemetry.contextRemainingTokens)}`
    );
    this.generationOutputEl.setText(
      `Output ~${formatTokenValue(telemetry.generatedTokens)} / ${formatTokenValue(telemetry.maxOutputTokens)} (${outputPct}%) | world_info ${formatTokenValue(telemetry.worldInfoCount)} | fallback ${formatTokenValue(telemetry.ragCount)}`
    );
  }

  private renderConversationBar(container: HTMLElement): void {
    const row = container.createDiv({ cls: 'lorevault-chat-conversation-row' });
    row.createEl('strong', { text: 'Conversation' });
    const activeSummary = this.conversationSummaries.find(summary => summary.path === this.activeConversationPath);
    row.createEl('span', {
      cls: 'lorevault-chat-conversation-title',
      text: this.conversationTitle || activeSummary?.title || 'Story Chat'
    });

    const actions = row.createDiv({ cls: 'lorevault-chat-conversation-actions' });
    const openConversationButton = actions.createEl('button', { text: 'Open Conversation' });
    openConversationButton.disabled = this.isSending || this.conversationSummaries.length === 0;
    openConversationButton.addEventListener('click', () => {
      if (this.conversationSummaries.length === 0) {
        return;
      }
      const modal = new ConversationPickerModal(this.app, this.conversationSummaries, summary => {
        void this.switchConversation(summary.path);
      });
      modal.open();
    });

    const newButton = actions.createEl('button', { text: 'New Chat' });
    newButton.disabled = this.isSending;
    newButton.addEventListener('click', () => {
      void this.createConversationAndRender('Story Chat', null);
    });
  }

  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: 'lorevault-chat-header' });
    const titleRow = header.createDiv({ cls: 'lorevault-chat-title-row' });
    const icon = titleRow.createSpan({ cls: 'lorevault-chat-icon' });
    setIcon(icon, 'message-circle');
    titleRow.createEl('h2', { text: 'Story Chat' });

    const actions = header.createDiv({ cls: 'lorevault-chat-actions' });
    const stopButton = actions.createEl('button', { text: 'Stop' });
    stopButton.disabled = !this.isSending;
    stopButton.addEventListener('click', () => {
      if (!this.isSending) {
        return;
      }
      this.stopRequested = true;
      this.plugin.stopActiveGeneration();
      this.setStatus('Stopping generation...');
    });
  }

  private renderGenerationMonitor(container: HTMLElement): void {
    const monitor = container.createDiv({ cls: 'lorevault-chat-generation-monitor' });
    monitor.createEl('h3', { text: 'Generation Monitor' });
    this.generationStateEl = monitor.createEl('p');
    this.generationScopesEl = monitor.createEl('p');
    this.generationTokensEl = monitor.createEl('p');
    this.generationOutputEl = monitor.createEl('p');
    this.updateGenerationMonitor();
  }

  private renderContextControls(container: HTMLElement): void {
    const controls = container.createDiv({ cls: 'lorevault-chat-controls' });
    controls.createEl('h3', { text: 'Context Controls' });
    this.renderLorebookContextControls(controls);
    this.renderAuthorNotesContextControls(controls);
    this.renderStoryNotesContextControls(controls);

    const manualSection = controls.createDiv({ cls: 'lorevault-chat-manual' });
    manualSection.createEl('strong', { text: 'Manual Context' });
    const manualInput = manualSection.createEl('textarea', {
      cls: 'lorevault-chat-manual-input'
    });
    manualInput.placeholder = 'Optional context to inject for every turn in this chat.';
    manualInput.value = this.manualContext;
    manualInput.addEventListener('input', () => {
      this.manualContext = manualInput.value;
      this.scheduleConversationSave();
    });
  }

  private readFrontmatter(file: TFile): FrontmatterData {
    const cache = this.app.metadataCache.getFileCache(file);
    return normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
  }

  private normalizeLinkLikeValue(raw: string): string {
    let normalized = raw.trim();
    if (!normalized) {
      return '';
    }

    const wikiMatch = normalized.match(/^\[\[([\s\S]+)\]\]$/);
    if (wikiMatch) {
      normalized = wikiMatch[1].trim();
    }

    const markdownLinkMatch = normalized.match(/^\[[^\]]*\]\(([^)]+)\)$/);
    if (markdownLinkMatch) {
      normalized = markdownLinkMatch[1].trim();
    }

    const angleBracketMatch = normalized.match(/^<([\s\S]+)>$/);
    if (angleBracketMatch) {
      normalized = angleBracketMatch[1].trim();
    }

    const pipeIndex = normalized.indexOf('|');
    if (pipeIndex >= 0) {
      normalized = normalized.slice(0, pipeIndex).trim();
    }

    return normalized.replace(/\\/g, '/').trim();
  }

  private resolveNoteRefToFile(ref: string, sourcePath = ''): TFile | null {
    const normalizedRef = this.normalizeLinkLikeValue(ref);
    if (!normalizedRef) {
      return null;
    }

    const resolvedFromLink = this.app.metadataCache.getFirstLinkpathDest(normalizedRef, sourcePath);
    if (resolvedFromLink instanceof TFile) {
      return resolvedFromLink;
    }

    const directCandidates = normalizedRef.toLowerCase().endsWith('.md')
      ? [normalizedRef]
      : [normalizedRef, `${normalizedRef}.md`];
    for (const candidate of directCandidates) {
      const found = this.app.vault.getAbstractFileByPath(candidate);
      if (found instanceof TFile) {
        return found;
      }
    }

    const basename = normalizedRef.split('/').pop()?.replace(/\.md$/i, '').trim() ?? '';
    if (!basename) {
      return null;
    }
    const byBasename = this.app.vault
      .getMarkdownFiles()
      .filter(file => file.basename.localeCompare(basename, undefined, { sensitivity: 'accent' }) === 0);
    return byBasename.length === 1 ? byBasename[0] : null;
  }

  private addLorebookScope(scope: string): void {
    const normalized = scope.trim();
    if (!normalized || this.selectedScopes.has(normalized)) {
      return;
    }
    this.selectedScopes.add(normalized);
    this.scheduleConversationSave();
    this.render();
  }

  private renderLorebookContextControls(container: HTMLElement): void {
    const lorebooksSection = container.createDiv({ cls: 'lorevault-chat-manual' });
    const header = lorebooksSection.createDiv({ cls: 'lorevault-chat-scopes-header' });
    header.createEl('strong', { text: 'Lorebooks' });

    const buttons = header.createDiv({ cls: 'lorevault-chat-scope-buttons' });
    const addButton = buttons.createEl('button', { text: 'Add Lorebook' });
    addButton.addEventListener('click', () => {
      const available = this.plugin.getAvailableScopes()
        .filter(scope => !this.selectedScopes.has(scope));
      if (available.length === 0) {
        new Notice('No additional lorebooks available.');
        return;
      }

      const modal = new ScopePickerModal(this.app, available, scope => {
        this.addLorebookScope(scope);
      });
      modal.open();
    });

    const clearButton = buttons.createEl('button', { text: 'Clear' });
    clearButton.disabled = this.selectedScopes.size === 0;
    clearButton.addEventListener('click', () => {
      this.selectedScopes.clear();
      this.scheduleConversationSave();
      this.render();
    });

    const selected = [...this.selectedScopes].sort((a, b) => a.localeCompare(b));
    const list = lorebooksSection.createDiv({ cls: 'lorevault-chat-note-list' });
    if (selected.length === 0) {
      list.createEl('p', { text: 'No lorebooks selected.' });
      return;
    }

    for (const scope of selected) {
      const row = list.createDiv({ cls: 'lorevault-chat-note-row' });
      row.createEl('span', { text: formatScope(scope) });
      const removeButton = row.createEl('button', { text: 'Remove' });
      removeButton.addEventListener('click', () => {
        this.selectedScopes.delete(scope);
        this.scheduleConversationSave();
        this.render();
      });
    }
  }

  private getAuthorNoteRefFromFrontmatter(frontmatter: FrontmatterData): string {
    const value = getFrontmatterValue(frontmatter, 'authorNote');
    const refs = asStringArray(value)
      .map(item => this.normalizeLinkLikeValue(item))
      .filter(Boolean);
    return refs[0] ?? '';
  }

  private hasAuthorNoteDocType(frontmatter: FrontmatterData): boolean {
    const docType = (asString(getFrontmatterValue(frontmatter, 'lvDocType')) ?? '')
      .trim()
      .toLowerCase();
    return docType === 'authornote';
  }

  private buildAuthorNoteBacklinkCounts(files: TFile[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const file of files) {
      const frontmatter = this.readFrontmatter(file);
      const authorNoteRef = this.getAuthorNoteRefFromFrontmatter(frontmatter);
      if (!authorNoteRef) {
        continue;
      }
      const resolved = this.resolveNoteRefToFile(authorNoteRef, file.path);
      if (!resolved) {
        continue;
      }
      counts.set(resolved.path, (counts.get(resolved.path) ?? 0) + 1);
    }
    return counts;
  }

  private getAuthorNoteCandidateFiles(): TFile[] {
    const files = [...this.app.vault.getMarkdownFiles()].sort((a, b) => a.path.localeCompare(b.path));
    const backlinkCounts = this.buildAuthorNoteBacklinkCounts(files);
    return files.filter(file => {
      const frontmatter = this.readFrontmatter(file);
      if (this.hasAuthorNoteDocType(frontmatter)) {
        return true;
      }
      if (backlinkCounts.has(file.path)) {
        return true;
      }
      const linkedStory = asString(getFrontmatterValue(frontmatter, 'authorNoteLinkedStory'));
      return Boolean(linkedStory);
    });
  }

  private addSteeringScopeRef(rawRef: string): void {
    const parsed = parseStoryChatSteeringRef(rawRef);
    if (!parsed) {
      return;
    }
    const canonical = stringifyStoryChatSteeringRef(parsed);
    if (this.steeringScopeRefs.includes(canonical)) {
      return;
    }
    this.steeringScopeRefs.push(canonical);
    this.scheduleConversationSave();
    this.render();
  }

  private renderAuthorNotesContextControls(container: HTMLElement): void {
    const steeringSection = container.createDiv({ cls: 'lorevault-chat-manual' });
    const steeringHeader = steeringSection.createDiv({ cls: 'lorevault-chat-scopes-header' });
    steeringHeader.createEl('strong', { text: 'Author Notes' });
    const steeringButtons = steeringHeader.createDiv({ cls: 'lorevault-chat-scope-buttons' });

    const addButton = steeringButtons.createEl('button', { text: 'Add Author Note' });
    addButton.addEventListener('click', () => {
      const selectedRefs = new Set(extractNoteRefsFromStoryChatSteeringRefs(this.steeringScopeRefs));
      const candidates = this.getAuthorNoteCandidateFiles()
        .filter(file => !selectedRefs.has(file.path));
      const fallback = [...this.app.vault.getMarkdownFiles()]
        .sort((a, b) => a.path.localeCompare(b.path))
        .filter(file => !selectedRefs.has(file.path));
      const files = candidates.length > 0 ? candidates : fallback;
      if (files.length === 0) {
        new Notice('No notes available to add as author note context.');
        return;
      }

      const placeholder = candidates.length > 0
        ? 'Pick an author note...'
        : 'No detected author notes. Pick a note to treat as author note context...';
      const modal = new NotePickerModal(this.app, files, file => {
        this.addSteeringScopeRef(`note:${file.path}`);
      }, placeholder);
      modal.open();
    });

    const clearButton = steeringButtons.createEl('button', { text: 'Clear' });
    clearButton.disabled = this.steeringScopeRefs.length === 0;
    clearButton.addEventListener('click', () => {
      this.steeringScopeRefs = [];
      this.scheduleConversationSave();
      this.render();
    });

    const noteRefs = extractNoteRefsFromStoryChatSteeringRefs(this.steeringScopeRefs);
    const notePreview = this.plugin.previewNoteContextRefs(noteRefs);
    const unresolvedNoteRefs = new Set(notePreview.unresolvedRefs);

    const list = steeringSection.createDiv({ cls: 'lorevault-chat-note-list' });
    if (this.steeringScopeRefs.length === 0) {
      list.createEl('p', { text: 'No author notes selected.' });
      return;
    }

    for (let index = 0; index < this.steeringScopeRefs.length; index += 1) {
      const ref = this.steeringScopeRefs[index];
      const parsed = parseStoryChatSteeringRef(ref);
      if (!parsed) {
        continue;
      }

      const row = list.createDiv({ cls: 'lorevault-chat-note-row' });
      const label = row.createEl('span', { text: parsed.key });
      if (parsed.type === 'note') {
        if (unresolvedNoteRefs.has(parsed.key)) {
          label.addClass('lorevault-chat-note-unresolved');
        } else {
          label.addClass('lorevault-chat-note-resolved');
        }
      }

      const removeButton = row.createEl('button', { text: 'Remove' });
      removeButton.addEventListener('click', () => {
        this.steeringScopeRefs.splice(index, 1);
        this.scheduleConversationSave();
        this.render();
      });
    }

    if (notePreview.unresolvedRefs.length > 0) {
      const unresolved = steeringSection.createEl('p', {
        text: `Unresolved author note references: ${notePreview.unresolvedRefs.join(', ')}`
      });
      unresolved.addClass('lorevault-manager-warning-item');
    }
  }

  private getChapterInfo(file: TFile): {chapter: number | null; chapterTitle: string} {
    const frontmatter = this.readFrontmatter(file);
    const chapterValue = asNumber(getFrontmatterValue(frontmatter, 'chapter', 'chapterIndex', 'scene'));
    const chapter = Number.isFinite(chapterValue)
      ? Math.max(0, Math.floor(chapterValue as number))
      : null;
    const chapterTitle = asString(getFrontmatterValue(frontmatter, 'chapterTitle', 'sceneTitle')) ?? '';
    return {
      chapter,
      chapterTitle
    };
  }

  private isChapterLikeFile(file: TFile): boolean {
    const chapterInfo = this.getChapterInfo(file);
    if (typeof chapterInfo.chapter === 'number') {
      return true;
    }
    const frontmatter = this.readFrontmatter(file);
    const previousRefs = asStringArray(getFrontmatterValue(frontmatter, 'previousChapter', 'prevChapter'));
    const nextRefs = asStringArray(getFrontmatterValue(frontmatter, 'nextChapter'));
    return previousRefs.length > 0 || nextRefs.length > 0;
  }

  private addNoteContextRef(ref: string): void {
    const normalizedRef = ref.trim();
    if (!normalizedRef || this.noteContextRefs.includes(normalizedRef)) {
      return;
    }
    this.noteContextRefs.push(normalizedRef);
    this.scheduleConversationSave();
    this.render();
  }

  private formatNoteContextRefLabel(ref: string): string {
    const resolved = this.resolveNoteRefToFile(ref);
    if (!resolved) {
      return ref;
    }
    const chapterInfo = this.getChapterInfo(resolved);
    if (typeof chapterInfo.chapter === 'number') {
      const titleSuffix = chapterInfo.chapterTitle ? ` - ${chapterInfo.chapterTitle}` : '';
      return `Chapter ${chapterInfo.chapter}${titleSuffix}: ${resolved.path}`;
    }
    return resolved.path;
  }

  private renderStoryNotesContextControls(container: HTMLElement): void {
    const notesSection = container.createDiv({ cls: 'lorevault-chat-manual' });
    const notesHeader = notesSection.createDiv({ cls: 'lorevault-chat-scopes-header' });
    notesHeader.createEl('strong', { text: 'Chapters and Raw Notes' });
    const notesButtons = notesHeader.createDiv({ cls: 'lorevault-chat-scope-buttons' });

    const addChapterButton = notesButtons.createEl('button', { text: 'Add Chapter' });
    addChapterButton.addEventListener('click', () => {
      const selectedRefs = new Set(this.noteContextRefs);
      const candidates = this.app.vault.getMarkdownFiles()
        .filter(file => this.isChapterLikeFile(file) && !selectedRefs.has(file.path));
      if (candidates.length === 0) {
        new Notice('No additional chapter notes available.');
        return;
      }
      const modal = new NotePickerModal(this.app, candidates, file => {
        this.addNoteContextRef(file.path);
      }, 'Pick a chapter note...');
      modal.open();
    });

    const addNoteButton = notesButtons.createEl('button', { text: 'Add Note' });
    addNoteButton.addEventListener('click', () => {
      const selectedRefs = new Set(this.noteContextRefs);
      const files = this.app.vault.getMarkdownFiles()
        .filter(file => !selectedRefs.has(file.path));
      if (files.length === 0) {
        new Notice('No additional notes available to add.');
        return;
      }
      const modal = new NotePickerModal(this.app, files, file => {
        this.addNoteContextRef(file.path);
      });
      modal.open();
    });

    const clearButton = notesButtons.createEl('button', { text: 'Clear' });
    clearButton.disabled = this.noteContextRefs.length === 0;
    clearButton.addEventListener('click', () => {
      this.noteContextRefs = [];
      this.scheduleConversationSave();
      this.render();
    });

    const preview = this.plugin.previewNoteContextRefs(this.noteContextRefs);
    const resolvedSet = new Set(preview.resolvedPaths);
    const unresolvedSet = new Set(preview.unresolvedRefs);
    const list = notesSection.createDiv({ cls: 'lorevault-chat-note-list' });

    if (this.noteContextRefs.length === 0) {
      list.createEl('p', { text: 'No chapter/raw notes selected.' });
      return;
    }

    for (let index = 0; index < this.noteContextRefs.length; index += 1) {
      const ref = this.noteContextRefs[index];
      const row = list.createDiv({ cls: 'lorevault-chat-note-row' });
      const resolved = this.resolveNoteRefToFile(ref);
      const label = row.createEl('span', { text: this.formatNoteContextRefLabel(ref) });
      if (resolved && resolvedSet.has(resolved.path)) {
        label.addClass('lorevault-chat-note-resolved');
      } else if (unresolvedSet.has(ref)) {
        label.addClass('lorevault-chat-note-unresolved');
      }

      const removeButton = row.createEl('button', { text: 'Remove' });
      removeButton.addEventListener('click', () => {
        this.noteContextRefs.splice(index, 1);
        this.scheduleConversationSave();
        this.render();
      });
    }

    if (preview.unresolvedRefs.length > 0) {
      const unresolved = notesSection.createEl('p', {
        text: `Unresolved references: ${preview.unresolvedRefs.join(', ')}`
      });
      unresolved.addClass('lorevault-manager-warning-item');
    }
  }

  private renderAssistantContextMeta(container: HTMLElement, version: ChatMessageVersion, message: ConversationMessage): void {
    if (message.role !== 'assistant' || !version.contextMeta) {
      return;
    }

    const details = container.createEl('details', { cls: 'lorevault-chat-context-meta' });
    details.createEl('summary', { text: buildStoryChatContextInspectorSummary(version.contextMeta) });
    const lines = buildStoryChatContextInspectorLines(version.contextMeta);
    for (const line of lines) {
      details.createEl('p', { text: line });
    }
  }

  private renderMessageEditor(container: HTMLElement): void {
    const editor = container.createEl('textarea', { cls: 'lorevault-chat-message-editor' });
    editor.value = this.editingMessageDraft;
    editor.addEventListener('input', () => {
      this.editingMessageDraft = editor.value;
    });

    const actions = container.createDiv({ cls: 'lorevault-chat-message-edit-actions' });
    const saveButton = actions.createEl('button', { text: 'Save' });
    saveButton.addClass('mod-cta');
    saveButton.addEventListener('click', () => {
      void this.saveMessageEdit();
    });

    const cancelButton = actions.createEl('button', { text: 'Cancel' });
    cancelButton.addEventListener('click', () => {
      this.editingMessageId = null;
      this.editingVersionId = null;
      this.editingMessageDraft = '';
      this.render();
    });
  }

  private renderMessageVersionSwitcher(container: HTMLElement, message: ConversationMessage): void {
    if (message.versions.length <= 1) {
      return;
    }

    const row = container.createDiv({ cls: 'lorevault-chat-version-row' });
    row.createEl('span', { text: 'Version:' });
    const selector = row.createEl('select', { cls: 'dropdown lorevault-chat-version-select' });

    for (let index = 0; index < message.versions.length; index += 1) {
      const version = message.versions[index];
      const option = selector.createEl('option');
      option.value = version.id;
      option.text = `v${index + 1} · ${formatTime(version.createdAt)}`;
    }

    selector.value = message.activeVersionId;
    selector.disabled = this.isSending;
    selector.addEventListener('change', () => {
      message.activeVersionId = selector.value;
      this.scheduleConversationSave();
      this.render();
    });
  }

  private renderMessages(container: HTMLElement): void {
    const list = container.createDiv({ cls: 'lorevault-chat-messages' });
    const latestAssistantMessage = [...this.messages]
      .reverse()
      .find(message => message.role === 'assistant') ?? null;
    const latestAssistantId = latestAssistantMessage?.id ?? null;

    if (this.messages.length === 0) {
      list.createEl('p', {
        text: 'No messages yet. Start a discussion about your story.'
      });
      return;
    }

    for (let index = 0; index < this.messages.length; index += 1) {
      const message = this.messages[index];
      const version = this.getSelectedVersion(message);
      const row = list.createDiv({
        cls: `lorevault-chat-message lorevault-chat-message-${message.role}`
      });
      row.setAttr('data-message-id', message.id);

      const meta = row.createDiv({ cls: 'lorevault-chat-message-meta' });
      meta.setText(`${message.role === 'assistant' ? 'Assistant' : 'You'} · ${formatTime(message.createdAt)}`);

      this.renderMessageVersionSwitcher(row, message);
      this.renderAssistantContextMeta(row, version, message);

      if (
        this.editingMessageId === message.id &&
        this.editingVersionId === version.id &&
        !this.isSending
      ) {
        this.renderMessageEditor(row);
      } else {
        const content = row.createDiv({ cls: 'lorevault-chat-message-content' });
        const contentText = version.content || (this.isSending && message.role === 'assistant' ? '...' : '');
        if (!contentText.trim()) {
          content.setText('');
        } else {
          this.renderMarkdownContent(content, contentText);
        }
      }

      const messageActions = row.createDiv({ cls: 'lorevault-chat-message-actions' });

      const editButton = messageActions.createEl('button', { text: 'Edit' });
      editButton.disabled = this.isSending;
      editButton.addEventListener('click', () => {
        this.editingMessageId = message.id;
        this.editingVersionId = version.id;
        this.editingMessageDraft = version.content;
        this.render();
      });

      const forkButton = messageActions.createEl('button', { text: 'Fork Here' });
      forkButton.disabled = this.isSending;
      forkButton.addEventListener('click', () => {
        void this.createConversationAndRender(
          `${this.conversationTitle || 'Story Chat'} Fork`,
          index
        );
      });

      if (message.role === 'assistant' && message.id === latestAssistantId) {
        const regenerateButton = messageActions.createEl('button', { text: 'Regenerate' });
        regenerateButton.disabled = this.isSending;
        regenerateButton.addEventListener('click', () => {
          void this.regenerateLatestAssistantVersion();
        });
      }
    }
  }

  private renderComposer(container: HTMLElement): void {
    const composer = container.createDiv({ cls: 'lorevault-chat-composer' });
    this.statusEl = composer.createDiv({ cls: 'lorevault-chat-status' });
    this.setStatus(this.isSending ? 'Generating response...' : 'Idle');

    this.inputEl = composer.createEl('textarea', {
      cls: 'lorevault-chat-input'
    });
    this.inputEl.placeholder = 'Ask about your story, scene, or character decisions...';
    this.inputEl.value = this.inputDraft;
    this.inputEl.addEventListener('input', () => {
      this.inputDraft = this.inputEl?.value ?? '';
    });

    const buttons = composer.createDiv({ cls: 'lorevault-chat-composer-actions' });
    const sendButton = buttons.createEl('button', { text: 'Send' });
    sendButton.disabled = this.isSending;
    sendButton.addEventListener('click', () => {
      void this.sendFromDraft();
    });
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-chat-view');

    this.renderHeader(contentEl);
    this.renderConversationBar(contentEl);
    this.renderGenerationMonitor(contentEl);
    this.renderContextControls(contentEl);
    this.renderMessages(contentEl);
    this.renderComposer(contentEl);
  }

  private async createConversationAndRender(title: string, sourceMessageIndex: number | null): Promise<void> {
    if (this.isSending) {
      return;
    }
    await this.createConversation(title, sourceMessageIndex);
    new Notice(`Conversation created: ${this.conversationTitle}`);
    this.render();
  }

  private async switchConversation(path: string): Promise<void> {
    if (this.isSending || !path || path === this.activeConversationPath) {
      return;
    }
    await this.saveCurrentConversation();
    const loaded = await this.loadConversationByPath(path);
    if (!loaded) {
      new Notice('Failed to load selected conversation.');
      await this.loadConversationSummaries();
      this.render();
      return;
    }
    this.render();
  }

  private async saveMessageEdit(): Promise<void> {
    if (this.isSending || !this.editingMessageId || !this.editingVersionId) {
      return;
    }

    const message = this.messages.find(item => item.id === this.editingMessageId);
    if (!message) {
      this.editingMessageId = null;
      this.editingVersionId = null;
      this.editingMessageDraft = '';
      this.render();
      return;
    }

    const version = message.versions.find(item => item.id === this.editingVersionId);
    if (!version) {
      this.editingMessageId = null;
      this.editingVersionId = null;
      this.editingMessageDraft = '';
      this.render();
      return;
    }

    version.content = this.editingMessageDraft;
    this.editingMessageId = null;
    this.editingVersionId = null;
    this.editingMessageDraft = '';
    await this.saveCurrentConversation();
    this.render();
  }

  private async sendFromDraft(): Promise<void> {
    const prompt = (this.inputEl?.value ?? this.inputDraft).trim();
    if (!prompt) {
      return;
    }

    this.inputDraft = '';
    if (this.inputEl) {
      this.inputEl.value = '';
    }
    await this.runTurn(prompt, true);
  }

  private buildHistoryForGeneration(excludeMessageId?: string): StoryChatMessage[] {
    return this.messages
      .filter(message => message.id !== excludeMessageId)
      .map(message => {
        const selected = this.getSelectedVersion(message);
        return {
          id: message.id,
          role: message.role,
          content: selected.content,
          createdAt: message.createdAt,
          contextMeta: this.cloneContextMeta(selected.contextMeta)
        } as StoryChatMessage;
      })
      .filter(message => message.content.trim().length > 0);
  }

  private updateAssistantMessageContent(messageId: string, content: string): void {
    const row = this.contentEl.querySelector(`[data-message-id="${messageId}"] .lorevault-chat-message-content`) as HTMLElement | null;
    if (!row) {
      return;
    }
    row.setText(content || '...');
  }

  private async regenerateLatestAssistantVersion(): Promise<void> {
    if (this.isSending || this.messages.length === 0) {
      return;
    }

    const lastAssistantIndex = [...this.messages]
      .map((message, index) => ({ message, index }))
      .reverse()
      .find(entry => entry.message.role === 'assistant')?.index;

    if (typeof lastAssistantIndex !== 'number') {
      new Notice('No assistant message available to regenerate.');
      return;
    }

    let targetUserPrompt = '';
    if (lastAssistantIndex > 0) {
      const prior = this.messages[lastAssistantIndex - 1];
      const selected = prior ? this.getSelectedVersion(prior) : null;
      if (prior?.role === 'user' && selected) {
        targetUserPrompt = selected.content;
      }
    } else {
      const lastUser = [...this.messages].reverse().find(message => message.role === 'user');
      if (lastUser) {
        targetUserPrompt = this.getSelectedVersion(lastUser).content;
      }
    }

    if (!targetUserPrompt.trim()) {
      new Notice('No prior user turn available to regenerate.');
      return;
    }

    const assistant = this.messages[lastAssistantIndex];
    await this.runTurn(targetUserPrompt, false, assistant.id);
  }

  private async runTurn(prompt: string, appendUser: boolean, regenerateMessageId?: string): Promise<void> {
    if (this.isSending) {
      return;
    }

    this.stopRequested = false;
    this.isSending = true;
    this.editingMessageId = null;
    this.editingVersionId = null;
    this.editingMessageDraft = '';

    const authorNoteRefs = extractNoteRefsFromStoryChatSteeringRefs(this.steeringScopeRefs);
    const authorNotePreview = this.plugin.previewNoteContextRefs(authorNoteRefs);
    if (authorNoteRefs.length > 0 && authorNotePreview.resolvedPaths.length === 0) {
      new Notice('No author note references could be resolved.');
    } else if (authorNotePreview.unresolvedRefs.length > 0) {
      new Notice(`Some author note references were unresolved (${authorNotePreview.unresolvedRefs.length}).`);
    }

    const notePreview = this.plugin.previewNoteContextRefs(this.noteContextRefs);
    if (this.noteContextRefs.length > 0 && notePreview.resolvedPaths.length === 0) {
      new Notice('No chapter/raw note references could be resolved.');
    } else if (notePreview.unresolvedRefs.length > 0) {
      new Notice(`Some chapter/raw note references were unresolved (${notePreview.unresolvedRefs.length}).`);
    }

    if (appendUser) {
      const now = Date.now();
      const userVersion: ChatMessageVersion = {
        id: this.createId('ver'),
        content: prompt,
        createdAt: now
      };
      this.messages.push({
        id: this.createId('user'),
        role: 'user',
        createdAt: now,
        versions: [userVersion],
        activeVersionId: userVersion.id
      });
    }

    let assistantMessage: ConversationMessage | null = null;
    let activeVersion: ChatMessageVersion | null = null;
    let createdNewMessage = false;
    let previousActiveVersionId = '';

    if (regenerateMessageId) {
      const target = this.messages.find(message => message.id === regenerateMessageId && message.role === 'assistant');
      if (target) {
        previousActiveVersionId = target.activeVersionId;
        const version: ChatMessageVersion = {
          id: this.createId('ver'),
          content: '',
          createdAt: Date.now()
        };
        target.versions.push(version);
        target.activeVersionId = version.id;
        assistantMessage = target;
        activeVersion = version;
      }
    }

    if (!assistantMessage || !activeVersion) {
      const now = Date.now();
      const version: ChatMessageVersion = {
        id: this.createId('ver'),
        content: '',
        createdAt: now
      };
      assistantMessage = {
        id: this.createId('assistant'),
        role: 'assistant',
        createdAt: now,
        versions: [version],
        activeVersionId: version.id
      };
      activeVersion = version;
      this.messages.push(assistantMessage);
      createdNewMessage = true;
    }

    if (!assistantMessage || !activeVersion) {
      this.isSending = false;
      throw new Error('Unable to prepare assistant message for generation.');
    }

    const targetAssistantMessage = assistantMessage;
    const targetVersion = activeVersion;

    const maxMessages = Math.max(10, this.plugin.getStoryChatConfig().maxMessages);
    if (this.messages.length > maxMessages) {
      this.messages = this.messages.slice(-maxMessages);
    }

    this.render();
    this.setStatus('Generating response...');

    try {
      const result = await this.plugin.runStoryChatTurn({
        userMessage: prompt,
        selectedScopes: [...this.selectedScopes],
        useLorebookContext: this.selectedScopes.size > 0,
        manualContext: this.manualContext,
        steeringScopeRefs: [...this.steeringScopeRefs],
        pinnedInstructions: '',
        storyNotes: '',
        sceneIntent: '',
        continuityPlotThreads: [],
        continuityOpenLoops: [],
        continuityCanonDeltas: [],
        continuitySelection: { ...this.continuitySelection },
        noteContextRefs: [...this.noteContextRefs],
        history: this.buildHistoryForGeneration(targetAssistantMessage.id),
        onDelta: delta => {
          targetVersion.content += delta;
          this.updateAssistantMessageContent(targetAssistantMessage.id, targetVersion.content);
          this.updateGenerationMonitor();
        }
      });

      targetVersion.content = result.assistantText;
      targetVersion.contextMeta = this.cloneContextMeta(result.contextMeta);
      this.setStatus('Idle');
      await this.saveCurrentConversation();
      this.render();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const contentNow = targetVersion.content.trim();

      if (this.stopRequested && !contentNow) {
        targetVersion.content = '[Generation stopped.]';
      } else if (!contentNow) {
        if (createdNewMessage) {
          this.messages = this.messages.filter(item => item.id !== targetAssistantMessage.id);
        } else {
          const target = this.messages.find(item => item.id === targetAssistantMessage.id);
          if (target) {
            target.versions = target.versions.filter(item => item.id !== targetVersion.id);
            target.activeVersionId = previousActiveVersionId || (target.versions[0]?.id ?? '');
          }
        }
      }

      if (!this.stopRequested) {
        new Notice(`Story chat generation failed: ${message}`);
        this.setStatus(`Failed: ${message}`);
      } else {
        this.setStatus('Stopped');
      }
      await this.saveCurrentConversation();
      this.render();
    } finally {
      this.isSending = false;
      this.stopRequested = false;
      this.updateGenerationMonitor();
      this.render();
    }
  }
}
