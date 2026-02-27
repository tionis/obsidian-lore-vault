import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import LoreBookConverterPlugin from './main';
import { StoryChatMessage } from './models';

export const LOREVAULT_STORY_CHAT_VIEW_TYPE = 'lorevault-story-chat-view';

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

function parseNoteContextRefs(value: string): string[] {
  return value
    .split(/\r?\n|,/g)
    .map(item => item.trim())
    .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index);
}

export class StoryChatView extends ItemView {
  private plugin: LoreBookConverterPlugin;
  private selectedScopes = new Set<string>();
  private useLorebookContext = true;
  private manualContext = '';
  private noteContextRefs: string[] = [];
  private messages: StoryChatMessage[] = [];
  private isSending = false;
  private stopRequested = false;
  private saveTimer: number | null = null;
  private inputDraft = '';
  private inputEl: HTMLTextAreaElement | null = null;
  private statusEl: HTMLElement | null = null;

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
    this.loadFromSettings();
    this.render();
  }

  async onClose(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.persistConfig(true);
    this.contentEl.empty();
  }

  refresh(): void {
    if (!this.isSending) {
      this.loadFromSettings();
      this.render();
    }
  }

  private createMessageId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private loadFromSettings(): void {
    const config = this.plugin.getStoryChatConfig();
    this.selectedScopes = new Set(config.selectedScopes);
    this.useLorebookContext = config.useLorebookContext;
    this.manualContext = config.manualContext;
    this.noteContextRefs = [...config.noteContextRefs];
    this.messages = config.messages;
  }

  private schedulePersist(includeMessages = false): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }

    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.persistConfig(includeMessages);
    }, 350);
  }

  private async persistConfig(includeMessages = false): Promise<void> {
    const update: {
      selectedScopes: string[];
      useLorebookContext: boolean;
      manualContext: string;
      noteContextRefs: string[];
      messages?: StoryChatMessage[];
    } = {
      selectedScopes: [...this.selectedScopes].sort((a, b) => a.localeCompare(b)),
      useLorebookContext: this.useLorebookContext,
      manualContext: this.manualContext,
      noteContextRefs: [...this.noteContextRefs]
    };

    if (includeMessages) {
      update.messages = this.messages;
    }

    await this.plugin.updateStoryChatConfig(update);
  }

  private setStatus(message: string): void {
    if (!this.statusEl) {
      return;
    }
    this.statusEl.setText(message);
  }

  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: 'lorevault-chat-header' });
    const titleRow = header.createDiv({ cls: 'lorevault-chat-title-row' });
    const icon = titleRow.createSpan({ cls: 'lorevault-chat-icon' });
    setIcon(icon, 'message-circle');
    titleRow.createEl('h2', { text: 'Story Chat' });

    const actions = header.createDiv({ cls: 'lorevault-chat-actions' });

    const clearButton = actions.createEl('button', { text: 'Clear Chat' });
    clearButton.disabled = this.isSending || this.messages.length === 0;
    clearButton.addEventListener('click', async () => {
      if (this.isSending) {
        return;
      }
      this.messages = [];
      await this.plugin.clearStoryChatMessages();
      this.render();
    });

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

  private renderContextControls(container: HTMLElement): void {
    const controls = container.createDiv({ cls: 'lorevault-chat-controls' });
    controls.createEl('h3', { text: 'Context Controls' });

    const toggleRow = controls.createDiv({ cls: 'lorevault-chat-toggle-row' });
    const toggleInput = toggleRow.createEl('input', { type: 'checkbox' });
    toggleInput.checked = this.useLorebookContext;
    toggleInput.addEventListener('change', () => {
      this.useLorebookContext = toggleInput.checked;
      this.schedulePersist(false);
      this.render();
    });
    toggleRow.createEl('label', { text: 'Use Lorebook Context' });

    const scopeSection = controls.createDiv({ cls: 'lorevault-chat-scopes' });
    const scopeHeader = scopeSection.createDiv({ cls: 'lorevault-chat-scopes-header' });
    scopeHeader.createEl('strong', { text: 'Active Scopes' });

    const scopeButtons = scopeHeader.createDiv({ cls: 'lorevault-chat-scope-buttons' });
    const allButton = scopeButtons.createEl('button', { text: 'All' });
    allButton.disabled = !this.useLorebookContext;
    allButton.addEventListener('click', () => {
      if (!this.useLorebookContext) {
        return;
      }
      const scopes = this.plugin.getAvailableScopes();
      this.selectedScopes = new Set(scopes);
      this.schedulePersist(false);
      this.render();
    });

    const noneButton = scopeButtons.createEl('button', { text: 'None' });
    noneButton.disabled = !this.useLorebookContext;
    noneButton.addEventListener('click', () => {
      this.selectedScopes.clear();
      this.schedulePersist(false);
      this.render();
    });

    const scopeList = scopeSection.createDiv({ cls: 'lorevault-chat-scope-list' });
    const scopes = this.plugin.getAvailableScopes();

    if (scopes.length === 0) {
      scopeList.createEl('p', { text: 'No scopes discovered yet.' });
    } else {
      for (const scope of scopes) {
        const row = scopeList.createDiv({ cls: 'lorevault-chat-scope-row' });
        const checkbox = row.createEl('input', { type: 'checkbox' });
        checkbox.checked = this.selectedScopes.has(scope);
        checkbox.disabled = !this.useLorebookContext;
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            this.selectedScopes.add(scope);
          } else {
            this.selectedScopes.delete(scope);
          }
          this.schedulePersist(false);
        });
        row.createEl('label', { text: formatScope(scope) });
      }
    }

    const manualSection = controls.createDiv({ cls: 'lorevault-chat-manual' });
    manualSection.createEl('strong', { text: 'Manual Context' });
    const manualInput = manualSection.createEl('textarea', {
      cls: 'lorevault-chat-manual-input'
    });
    manualInput.placeholder = 'Optional context to inject for every turn in this chat.';
    manualInput.value = this.manualContext;
    manualInput.addEventListener('input', () => {
      this.manualContext = manualInput.value;
      this.schedulePersist(false);
    });

    const notesSection = controls.createDiv({ cls: 'lorevault-chat-manual' });
    const notesHeader = notesSection.createDiv({ cls: 'lorevault-chat-scopes-header' });
    notesHeader.createEl('strong', { text: 'Specific Notes Context' });
    const notesButtons = notesHeader.createDiv({ cls: 'lorevault-chat-scope-buttons' });

    const addActiveButton = notesButtons.createEl('button', { text: 'Add Active' });
    addActiveButton.addEventListener('click', () => {
      const active = this.app.workspace.getActiveFile();
      if (!active) {
        new Notice('No active note to add.');
        return;
      }
      if (!this.noteContextRefs.includes(active.path)) {
        this.noteContextRefs.push(active.path);
        this.schedulePersist(false);
        this.render();
      }
    });

    const clearNotesButton = notesButtons.createEl('button', { text: 'Clear' });
    clearNotesButton.disabled = this.noteContextRefs.length === 0;
    clearNotesButton.addEventListener('click', () => {
      this.noteContextRefs = [];
      this.schedulePersist(false);
      this.render();
    });

    const notesInput = notesSection.createEl('textarea', {
      cls: 'lorevault-chat-manual-input'
    });
    notesInput.placeholder = 'One note reference per line (path, basename, or [[wikilink]]).';
    notesInput.value = this.noteContextRefs.join('\n');
    notesInput.addEventListener('input', () => {
      this.noteContextRefs = parseNoteContextRefs(notesInput.value);
      this.schedulePersist(false);
      this.render();
    });

    const preview = this.plugin.previewNoteContextRefs(this.noteContextRefs);
    const previewSection = notesSection.createDiv({ cls: 'lorevault-chat-note-preview' });
    previewSection.createEl('p', {
      text: `Resolved notes: ${preview.resolvedPaths.length}`
    });

    if (preview.resolvedPaths.length > 0) {
      const resolvedList = previewSection.createEl('ul');
      for (const item of preview.resolvedPaths.slice(0, 8)) {
        resolvedList.createEl('li', { text: item });
      }
      if (preview.resolvedPaths.length > 8) {
        previewSection.createEl('p', {
          text: `+${preview.resolvedPaths.length - 8} more`
        });
      }
    }

    if (preview.unresolvedRefs.length > 0) {
      const unresolvedTitle = previewSection.createEl('p', {
        text: `Unresolved references: ${preview.unresolvedRefs.length}`
      });
      unresolvedTitle.addClass('lorevault-manager-warning-item');

      const unresolvedList = previewSection.createEl('ul');
      for (const ref of preview.unresolvedRefs.slice(0, 8)) {
        const li = unresolvedList.createEl('li', { text: ref });
        li.addClass('lorevault-manager-warning-item');
      }
      if (preview.unresolvedRefs.length > 8) {
        previewSection.createEl('p', {
          text: `+${preview.unresolvedRefs.length - 8} more unresolved`
        });
      }
    }
  }

  private renderMessages(container: HTMLElement): void {
    const list = container.createDiv({ cls: 'lorevault-chat-messages' });

    if (this.messages.length === 0) {
      list.createEl('p', {
        text: 'No messages yet. Start a discussion about your story.'
      });
      return;
    }

    for (const message of this.messages) {
      const row = list.createDiv({
        cls: `lorevault-chat-message lorevault-chat-message-${message.role}`
      });
      row.setAttr('data-message-id', message.id);

      const meta = row.createDiv({ cls: 'lorevault-chat-message-meta' });
      meta.setText(`${message.role === 'assistant' ? 'Assistant' : 'You'} · ${formatTime(message.createdAt)}`);

      const content = row.createDiv({ cls: 'lorevault-chat-message-content' });
      content.setText(message.content || (this.isSending && message.role === 'assistant' ? '...' : ''));

      if (message.role === 'assistant' && message.contextMeta) {
        const details = row.createEl('details', { cls: 'lorevault-chat-context-meta' });
        details.createEl('summary', {
          text: `Context: scopes ${message.contextMeta.scopes.join(', ') || '(none)'} | notes ${message.contextMeta.specificNotePaths.length} | world_info ${message.contextMeta.worldInfoCount} | rag ${message.contextMeta.ragCount}`
        });
        details.createEl('p', {
          text: `Tokens: ${message.contextMeta.contextTokens} | lorebook: ${message.contextMeta.usedLorebookContext ? 'on' : 'off'} | manual: ${message.contextMeta.usedManualContext ? 'on' : 'off'} | specific-notes: ${message.contextMeta.usedSpecificNotesContext ? 'on' : 'off'}`
        });

        const specificNotesList = details.createEl('p');
        specificNotesList.setText(`specific notes: ${message.contextMeta.specificNotePaths.join(', ') || '(none)'}`);

        const unresolved = details.createEl('p');
        unresolved.setText(`unresolved note refs: ${message.contextMeta.unresolvedNoteRefs.join(', ') || '(none)'}`);

        const worldInfoList = details.createEl('p');
        worldInfoList.setText(`world_info: ${message.contextMeta.worldInfoItems.join(', ') || '(none)'}`);

        const ragList = details.createEl('p');
        ragList.setText(`rag: ${message.contextMeta.ragItems.join(', ') || '(none)'}`);
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

    const regenerateButton = buttons.createEl('button', { text: 'Regenerate' });
    regenerateButton.disabled = this.isSending || this.messages.length === 0;
    regenerateButton.addEventListener('click', () => {
      void this.regenerateLastAssistantTurn();
    });
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-chat-view');

    this.renderHeader(contentEl);
    this.renderContextControls(contentEl);
    this.renderMessages(contentEl);
    this.renderComposer(contentEl);
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

  private async regenerateLastAssistantTurn(): Promise<void> {
    if (this.isSending || this.messages.length === 0) {
      return;
    }

    const lastAssistantIndex = [...this.messages]
      .map((message, index) => ({ message, index }))
      .reverse()
      .find(entry => entry.message.role === 'assistant')?.index;

    let targetUserPrompt = '';
    if (typeof lastAssistantIndex === 'number' && lastAssistantIndex > 0) {
      const prior = this.messages[lastAssistantIndex - 1];
      if (prior?.role === 'user') {
        targetUserPrompt = prior.content;
      }
      this.messages.splice(lastAssistantIndex, 1);
    } else {
      const lastUser = [...this.messages].reverse().find(message => message.role === 'user');
      targetUserPrompt = lastUser?.content ?? '';
    }

    if (!targetUserPrompt.trim()) {
      new Notice('No prior user turn available to regenerate.');
      return;
    }

    this.render();
    await this.runTurn(targetUserPrompt, false);
  }

  private updateAssistantMessageContent(messageId: string, content: string): void {
    const row = this.contentEl.querySelector(`[data-message-id=\"${messageId}\"] .lorevault-chat-message-content`) as HTMLElement | null;
    if (!row) {
      return;
    }
    row.setText(content || '...');
  }

  private async runTurn(prompt: string, appendUser: boolean): Promise<void> {
    if (this.isSending) {
      return;
    }

    this.stopRequested = false;
    this.isSending = true;

    const preview = this.plugin.previewNoteContextRefs(this.noteContextRefs);
    if (this.noteContextRefs.length > 0 && preview.resolvedPaths.length === 0) {
      new Notice('No specific notes could be resolved from current references.');
    } else if (preview.unresolvedRefs.length > 0) {
      new Notice(`Some specific note references were unresolved (${preview.unresolvedRefs.length}).`);
    }

    if (appendUser) {
      this.messages.push({
        id: this.createMessageId('user'),
        role: 'user',
        content: prompt,
        createdAt: Date.now()
      });
    }

    const assistantMessage: StoryChatMessage = {
      id: this.createMessageId('assistant'),
      role: 'assistant',
      content: '',
      createdAt: Date.now()
    };
    this.messages.push(assistantMessage);
    this.messages = this.messages.slice(-this.plugin.getStoryChatConfig().maxMessages);
    this.render();
    this.setStatus('Generating response...');

    try {
      const history = this.messages
        .filter(message => message.id !== assistantMessage.id)
        .filter(message => message.content.trim().length > 0);
      const result = await this.plugin.runStoryChatTurn({
        userMessage: prompt,
        selectedScopes: [...this.selectedScopes],
        useLorebookContext: this.useLorebookContext,
        manualContext: this.manualContext,
        noteContextRefs: this.noteContextRefs,
        history,
        onDelta: delta => {
          assistantMessage.content += delta;
          this.updateAssistantMessageContent(assistantMessage.id, assistantMessage.content);
        }
      });

      assistantMessage.content = result.assistantText;
      assistantMessage.contextMeta = result.contextMeta;
      this.setStatus('Idle');
      await this.persistConfig(true);
      this.render();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.stopRequested && !assistantMessage.content.trim()) {
        assistantMessage.content = '[Generation stopped.]';
      } else if (!assistantMessage.content.trim()) {
        this.messages = this.messages.filter(item => item.id !== assistantMessage.id);
      }

      if (!this.stopRequested) {
        new Notice(`Story chat generation failed: ${message}`);
        this.setStatus(`Failed: ${message}`);
      } else {
        this.setStatus('Stopped');
      }
      await this.persistConfig(true);
      this.render();
    } finally {
      this.isSending = false;
      this.stopRequested = false;
      this.render();
    }
  }
}
