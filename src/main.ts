import { MarkdownView, Plugin, Notice, TFile, addIcon, getAllTags, Menu, Editor, MarkdownFileInfo } from 'obsidian';
import {
  CompletionPreset,
  ConverterSettings,
  DEFAULT_SETTINGS,
  LoreBookEntry,
  StoryChatContextMeta,
  StoryChatForkSnapshot,
  StoryChatMessage
} from './models';
import { ProgressBar } from './progress-bar';
import { createTemplate } from './template-creator';
import { LoreBookExporter } from './lorebook-exporter'; 
import { LoreBookConverterSettingTab } from './settings-tab';
import { extractLorebookScopesFromTags, normalizeScope, normalizeTagPrefix } from './lorebook-scoping';
import { RagExporter } from './rag-exporter';
import { LOREVAULT_MANAGER_VIEW_TYPE, LorebooksManagerView } from './lorebooks-manager-view';
import {
  LOREVAULT_ROUTING_DEBUG_VIEW_TYPE,
  LorebooksRoutingDebugView
} from './lorebooks-routing-debug-view';
import {
  LOREVAULT_QUERY_SIMULATION_VIEW_TYPE,
  LorebooksQuerySimulationView
} from './lorebooks-query-simulator-view';
import { LOREVAULT_STORY_CHAT_VIEW_TYPE, StoryChatView } from './story-chat-view';
import { LOREVAULT_HELP_VIEW_TYPE, LorevaultHelpView } from './lorevault-help-view';
import { LiveContextIndex } from './live-context-index';
import { ChapterSummaryStore } from './chapter-summary-store';
import { EmbeddingService } from './embedding-service';
import { requestStoryContinuationStream } from './completion-provider';
import { parseStoryScopesFromFrontmatter } from './story-scope-selector';
import {
  assertUniqueOutputPaths,
  ScopeOutputAssignment,
  resolveScopeOutputPaths
} from './scope-output-paths';
import { buildScopePack } from './scope-pack-builder';
import { SqlitePackExporter } from './sqlite-pack-exporter';
import { SqlitePackReader } from './sqlite-pack-reader';
import { AssembledContext, ScopeContextPack } from './context-query';
import {
  StoryThreadNode,
  parseStoryThreadNodeFromFrontmatter,
  resolveStoryThread
} from './story-thread-resolver';
import * as path from 'path';
import {
  FrontmatterData,
  normalizeFrontmatter,
  stripFrontmatter
} from './frontmatter-utils';
import { normalizeLinkTarget } from './link-target-index';

export interface GenerationTelemetry {
  state: 'idle' | 'preparing' | 'retrieving' | 'generating' | 'error';
  statusText: string;
  startedAt: number;
  updatedAt: number;
  provider: string;
  model: string;
  scopes: string[];
  contextWindowTokens: number;
  maxInputTokens: number;
  promptReserveTokens: number;
  estimatedInstructionTokens: number;
  storyTokens: number;
  contextUsedTokens: number;
  contextRemainingTokens: number;
  maxOutputTokens: number;
  generatedTokens: number;
  worldInfoCount: number;
  ragCount: number;
  worldInfoItems: string[];
  ragItems: string[];
  contextLayerTrace: string[];
  lastError: string;
}

export interface StoryChatTurnRequest {
  userMessage: string;
  selectedScopes: string[];
  useLorebookContext: boolean;
  manualContext: string;
  noteContextRefs: string[];
  history: StoryChatMessage[];
  onDelta: (delta: string) => void;
}

export interface StoryChatTurnResult {
  assistantText: string;
  contextMeta: StoryChatContextMeta;
}

export default class LoreBookConverterPlugin extends Plugin {
  settings: ConverterSettings;
  liveContextIndex: LiveContextIndex;
  private chapterSummaryStore!: ChapterSummaryStore;
  private generationStatusEl: HTMLElement | null = null;
  private generationInFlight = false;
  private generationAbortController: AbortController | null = null;
  private generationStatusLevel: 'idle' | 'busy' | 'error' = 'idle';
  private generationTelemetry: GenerationTelemetry = this.createDefaultGenerationTelemetry();
  private managerRefreshTimer: number | null = null;

  private getBaseOutputPath(): string {
    return this.settings.outputPath?.trim() || DEFAULT_SETTINGS.outputPath;
  }

  private estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }

  private trimTextToTokenBudget(text: string, tokenBudget: number): string {
    if (!text.trim()) {
      return '';
    }

    const maxChars = Math.max(256, tokenBudget * 4);
    if (text.length <= maxChars) {
      return text;
    }
    return text.slice(text.length - maxChars).trimStart();
  }

  private trimTextHeadToTokenBudget(text: string, tokenBudget: number): string {
    if (!text.trim()) {
      return '';
    }

    const maxChars = Math.max(256, tokenBudget * 4);
    if (text.length <= maxChars) {
      return text;
    }
    return text.slice(0, maxChars).trimEnd();
  }

  private renderScopeListLabel(scopes: string[]): string {
    if (scopes.length === 0) {
      return '(all)';
    }
    if (scopes.length <= 3) {
      return scopes.join(', ');
    }
    return `${scopes.slice(0, 3).join(', ')} +${scopes.length - 3}`;
  }

  private createDefaultGenerationTelemetry(): GenerationTelemetry {
    const now = Date.now();
    return {
      state: 'idle',
      statusText: 'idle',
      startedAt: 0,
      updatedAt: now,
      provider: '',
      model: '',
      scopes: [],
      contextWindowTokens: 0,
      maxInputTokens: 0,
      promptReserveTokens: 0,
      estimatedInstructionTokens: 0,
      storyTokens: 0,
      contextUsedTokens: 0,
      contextRemainingTokens: 0,
      maxOutputTokens: 0,
      generatedTokens: 0,
      worldInfoCount: 0,
      ragCount: 0,
      worldInfoItems: [],
      ragItems: [],
      contextLayerTrace: [],
      lastError: ''
    };
  }

  getGenerationTelemetry(): GenerationTelemetry {
    return {
      ...this.generationTelemetry,
      scopes: [...this.generationTelemetry.scopes],
      worldInfoItems: [...this.generationTelemetry.worldInfoItems],
      ragItems: [...this.generationTelemetry.ragItems],
      contextLayerTrace: [...this.generationTelemetry.contextLayerTrace]
    };
  }

  private scheduleManagerRefresh(): void {
    if (this.managerRefreshTimer !== null) {
      return;
    }
    if (this.app.workspace.getLeavesOfType(LOREVAULT_MANAGER_VIEW_TYPE).length === 0) {
      return;
    }

    this.managerRefreshTimer = window.setTimeout(() => {
      this.managerRefreshTimer = null;
      this.refreshManagerViews();
    }, 600);
  }

  private updateGenerationTelemetry(update: Partial<GenerationTelemetry>): void {
    const next: GenerationTelemetry = {
      ...this.generationTelemetry,
      ...update,
      updatedAt: Date.now()
    };
    if (update.scopes) {
      next.scopes = [...update.scopes];
    }
    if (update.worldInfoItems) {
      next.worldInfoItems = [...update.worldInfoItems];
    }
    if (update.ragItems) {
      next.ragItems = [...update.ragItems];
    }
    if (update.contextLayerTrace) {
      next.contextLayerTrace = [...update.contextLayerTrace];
    }
    this.generationTelemetry = next;
    this.scheduleManagerRefresh();
  }

  private setGenerationStatus(
    message: string,
    level: 'idle' | 'busy' | 'error' = 'busy'
  ): void {
    this.generationStatusLevel = level;
    if (!this.generationStatusEl) {
      return;
    }
    this.generationStatusEl.setText(`LoreVault ${message}`);
  }

  private syncIdleGenerationTelemetryToSettings(): void {
    if (this.generationInFlight) {
      return;
    }

    const completion = this.settings.completion;
    const maxInputTokens = Math.max(512, completion.contextWindowTokens - completion.maxOutputTokens);
    this.updateGenerationTelemetry({
      state: 'idle',
      statusText: 'idle',
      provider: completion.provider,
      model: completion.model,
      contextWindowTokens: completion.contextWindowTokens,
      maxInputTokens,
      promptReserveTokens: completion.promptReserveTokens,
      maxOutputTokens: completion.maxOutputTokens,
      contextUsedTokens: 0,
      contextRemainingTokens: Math.max(0, maxInputTokens - completion.promptReserveTokens),
      generatedTokens: 0,
      worldInfoCount: 0,
      ragCount: 0,
      worldInfoItems: [],
      ragItems: [],
      contextLayerTrace: []
    });
    this.setGenerationStatus('idle', 'idle');
  }

  private mapEntriesByUid(entries: LoreBookEntry[]): {[key: number]: LoreBookEntry} {
    const map: {[key: number]: LoreBookEntry} = {};
    for (const entry of entries) {
      map[entry.uid] = entry;
    }
    return map;
  }

  private refreshManagerViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(LOREVAULT_MANAGER_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof LorebooksManagerView) {
        leaf.view.refresh();
      }
    }
  }

  private refreshRoutingDebugViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(LOREVAULT_ROUTING_DEBUG_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof LorebooksRoutingDebugView) {
        leaf.view.refresh();
      }
    }
  }

  private refreshQuerySimulationViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(LOREVAULT_QUERY_SIMULATION_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof LorebooksQuerySimulationView) {
        leaf.view.refresh();
      }
    }
  }

  private refreshStoryChatViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(LOREVAULT_STORY_CHAT_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof StoryChatView) {
        leaf.view.refresh();
      }
    }
  }

  private refreshHelpViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(LOREVAULT_HELP_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof LorevaultHelpView) {
        leaf.view.refresh();
      }
    }
  }

  async openLorebooksManagerView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LOREVAULT_MANAGER_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: LOREVAULT_MANAGER_VIEW_TYPE,
        active: true
      });
    }

    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof LorebooksManagerView) {
      leaf.view.refresh();
    }
  }

  async openRoutingDebugView(scope?: string): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LOREVAULT_ROUTING_DEBUG_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: LOREVAULT_ROUTING_DEBUG_VIEW_TYPE,
        active: true
      });
    }

    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof LorebooksRoutingDebugView) {
      leaf.view.setScope(scope ?? null);
      leaf.view.refresh();
    }
  }

  async openQuerySimulationView(scopes?: string[]): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LOREVAULT_QUERY_SIMULATION_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: LOREVAULT_QUERY_SIMULATION_VIEW_TYPE,
        active: true
      });
    }

    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof LorebooksQuerySimulationView) {
      if (scopes && scopes.length > 0) {
        leaf.view.setScopes(scopes);
      }
      leaf.view.refresh();
    }
  }

  async openStoryChatView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LOREVAULT_STORY_CHAT_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: LOREVAULT_STORY_CHAT_VIEW_TYPE,
        active: true
      });
    }

    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof StoryChatView) {
      leaf.view.refresh();
    }
  }

  async openHelpView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LOREVAULT_HELP_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: LOREVAULT_HELP_VIEW_TYPE,
        active: true
      });
    }

    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof LorevaultHelpView) {
      leaf.view.refresh();
    }
  }

  private discoverAllScopes(files: TFile[]): string[] {
    const scopes = new Set<string>();

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) {
        continue;
      }
      const tags = getAllTags(cache) ?? [];
      const fileScopes = extractLorebookScopesFromTags(tags, this.settings.tagScoping.tagPrefix);

      for (const scope of fileScopes) {
        if (scope) {
          scopes.add(scope);
        }
      }
    }

    return [...scopes].sort((a, b) => a.localeCompare(b));
  }

  private createMessageId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  public getAvailableScopes(): string[] {
    const fromIndex = this.liveContextIndex?.getScopes() ?? [];
    if (fromIndex.length > 0) {
      return [...fromIndex].sort((a, b) => a.localeCompare(b));
    }

    const files = this.app.vault.getMarkdownFiles();
    return this.discoverAllScopes(files);
  }

  public getStoryChatMessages(): StoryChatMessage[] {
    return this.settings.storyChat.messages.map(message => ({
      ...message,
      contextMeta: message.contextMeta ? {
        ...message.contextMeta,
        scopes: [...message.contextMeta.scopes],
        specificNotePaths: [...message.contextMeta.specificNotePaths],
        unresolvedNoteRefs: [...message.contextMeta.unresolvedNoteRefs],
        chapterMemoryItems: [...(message.contextMeta.chapterMemoryItems ?? [])],
        layerTrace: [...(message.contextMeta.layerTrace ?? [])],
        worldInfoItems: [...message.contextMeta.worldInfoItems],
        ragItems: [...message.contextMeta.ragItems]
      } : undefined
    }));
  }

  public getStoryChatForkSnapshots(): StoryChatForkSnapshot[] {
    return this.settings.storyChat.forkSnapshots.map(snapshot => ({
      ...snapshot,
      selectedScopes: [...snapshot.selectedScopes],
      noteContextRefs: [...snapshot.noteContextRefs],
      messages: snapshot.messages.map(message => ({
        ...message,
        contextMeta: message.contextMeta ? {
          ...message.contextMeta,
          scopes: [...message.contextMeta.scopes],
          specificNotePaths: [...message.contextMeta.specificNotePaths],
          unresolvedNoteRefs: [...message.contextMeta.unresolvedNoteRefs],
          chapterMemoryItems: [...(message.contextMeta.chapterMemoryItems ?? [])],
          layerTrace: [...(message.contextMeta.layerTrace ?? [])],
          worldInfoItems: [...message.contextMeta.worldInfoItems],
          ragItems: [...message.contextMeta.ragItems]
        } : undefined
      }))
    }));
  }

  public getStoryChatConfig(): ConverterSettings['storyChat'] {
    return {
      ...this.settings.storyChat,
      selectedScopes: [...this.settings.storyChat.selectedScopes],
      noteContextRefs: [...this.settings.storyChat.noteContextRefs],
      messages: this.getStoryChatMessages(),
      forkSnapshots: this.getStoryChatForkSnapshots()
    };
  }

  public async updateStoryChatConfig(update: Partial<ConverterSettings['storyChat']>): Promise<void> {
    const merged: ConverterSettings = this.mergeSettings({
      ...this.settings,
      storyChat: {
        ...this.settings.storyChat,
        ...update
      }
    });
    this.settings = merged;
    await super.saveData(this.settings);
    this.refreshStoryChatViews();
  }

  public async setStoryChatMessages(messages: StoryChatMessage[]): Promise<void> {
    const trimmed = messages.slice(-this.settings.storyChat.maxMessages);
    await this.updateStoryChatConfig({ messages: trimmed });
  }

  public async clearStoryChatMessages(): Promise<void> {
    await this.setStoryChatMessages([]);
  }

  public async getScopeContextPack(scope?: string): Promise<ScopeContextPack> {
    return this.liveContextIndex.getScopePack(scope);
  }

  public stopActiveGeneration(): void {
    if (!this.generationAbortController) {
      return;
    }
    this.generationAbortController.abort();
  }

  private isAbortLikeError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const normalized = error.message.toLowerCase();
    return normalized.includes('aborted') || normalized.includes('cancelled');
  }

  private buildChatHistorySnippet(history: StoryChatMessage[]): string {
    if (history.length === 0) {
      return '';
    }

    const recent = history.slice(-8);
    const rendered = recent.map(message => {
      const label = message.role === 'assistant' ? 'Assistant' : 'User';
      const body = message.content.trim();
      return `${label}: ${body}`;
    }).join('\n\n');

    return this.trimTextToTokenBudget(rendered, 900);
  }

  private normalizeNoteContextRef(rawRef: string): string {
    let normalized = rawRef.trim();
    if (!normalized) {
      return '';
    }

    const wikilinkMatch = normalized.match(/^\[\[([\s\S]+)\]\]$/);
    if (wikilinkMatch) {
      normalized = wikilinkMatch[1].trim();
      const pipeIndex = normalized.indexOf('|');
      if (pipeIndex >= 0) {
        normalized = normalized.slice(0, pipeIndex);
      }
    }

    return normalizeLinkTarget(normalized);
  }

  private resolveNoteContextFile(ref: string): TFile | null {
    const normalizedRef = this.normalizeNoteContextRef(ref);
    if (!normalizedRef) {
      return null;
    }

    const activePath = this.app.workspace.getActiveFile()?.path ?? '';
    const resolvedFromLink = this.app.metadataCache.getFirstLinkpathDest(normalizedRef, activePath);
    if (resolvedFromLink instanceof TFile) {
      return resolvedFromLink;
    }

    const directCandidates = [normalizedRef, `${normalizedRef}.md`];
    for (const candidate of directCandidates) {
      const found = this.app.vault.getAbstractFileByPath(candidate);
      if (found instanceof TFile) {
        return found;
      }
    }

    const basename = path.basename(normalizedRef);
    const byBasename = this.app.vault
      .getMarkdownFiles()
      .filter(file => file.basename.localeCompare(basename, undefined, { sensitivity: 'accent' }) === 0);
    if (byBasename.length === 1) {
      return byBasename[0];
    }

    return null;
  }

  public previewNoteContextRefs(refs: string[]): {
    resolvedPaths: string[];
    unresolvedRefs: string[];
  } {
    const normalizedRefs = refs
      .map(ref => this.normalizeNoteContextRef(ref))
      .filter((ref, index, array): ref is string => Boolean(ref) && array.indexOf(ref) === index);

    const resolvedPaths: string[] = [];
    const unresolvedRefs: string[] = [];
    const seenPaths = new Set<string>();

    for (const ref of normalizedRefs) {
      const file = this.resolveNoteContextFile(ref);
      if (!file) {
        unresolvedRefs.push(ref);
        continue;
      }

      if (!seenPaths.has(file.path)) {
        seenPaths.add(file.path);
        resolvedPaths.push(file.path);
      }
    }

    return {
      resolvedPaths,
      unresolvedRefs
    };
  }

  private async buildSpecificNotesContext(
    refs: string[],
    tokenBudget: number
  ): Promise<{
    markdown: string;
    usedTokens: number;
    includedPaths: string[];
    unresolvedRefs: string[];
  }> {
    const normalizedRefs = refs
      .map(ref => this.normalizeNoteContextRef(ref))
      .filter((ref, index, array): ref is string => Boolean(ref) && array.indexOf(ref) === index);
    if (normalizedRefs.length === 0 || tokenBudget <= 0) {
      return {
        markdown: '',
        usedTokens: 0,
        includedPaths: [],
        unresolvedRefs: []
      };
    }

    let usedTokens = 0;
    const sections: string[] = [];
    const includedPaths: string[] = [];
    const unresolvedRefs: string[] = [];
    const usedFilePaths = new Set<string>();

    for (const ref of normalizedRefs) {
      const file = this.resolveNoteContextFile(ref);
      if (!file) {
        unresolvedRefs.push(ref);
        continue;
      }
      if (usedFilePaths.has(file.path)) {
        continue;
      }

      const remaining = tokenBudget - usedTokens;
      if (remaining < 32) {
        break;
      }

      const raw = await this.app.vault.cachedRead(file);
      const body = stripFrontmatter(raw).trim();
      if (!body) {
        continue;
      }

      // Reserve some structural overhead for headers/source labels.
      const bodyBudget = Math.max(64, remaining - 32);
      const snippet = this.trimTextHeadToTokenBudget(body, bodyBudget);
      const section = [
        `### ${file.basename}`,
        `Source: \`${file.path}\``,
        '',
        snippet
      ].join('\n');
      const sectionTokens = this.estimateTokens(section);
      if (usedTokens + sectionTokens > tokenBudget) {
        continue;
      }

      usedTokens += sectionTokens;
      usedFilePaths.add(file.path);
      includedPaths.push(file.path);
      sections.push(section);
    }

    return {
      markdown: sections.join('\n\n---\n\n'),
      usedTokens,
      includedPaths,
      unresolvedRefs
    };
  }

  public async runStoryChatTurn(request: StoryChatTurnRequest): Promise<StoryChatTurnResult> {
    if (this.generationInFlight) {
      throw new Error('LoreVault generation is already running.');
    }

    if (!this.settings.completion.enabled) {
      throw new Error('Writing completion is disabled. Enable it under LoreVault Settings → Writing Completion.');
    }
    if (this.settings.completion.provider !== 'ollama' && !this.settings.completion.apiKey) {
      throw new Error('Missing completion API key. Configure it under LoreVault Settings → Writing Completion.');
    }

    const completion = this.settings.completion;
    const selectedScopes = request.selectedScopes.length > 0
      ? request.selectedScopes.map(scope => normalizeScope(scope)).filter(Boolean)
      : [];
    const scopeLabels = selectedScopes.length > 0 ? selectedScopes : ['(none)'];
    const manualContext = request.manualContext.trim();
    const noteContextRefs = request.noteContextRefs
      .map(ref => this.normalizeNoteContextRef(ref))
      .filter((ref, index, array): ref is string => Boolean(ref) && array.indexOf(ref) === index);
    const chatHistory = this.buildChatHistorySnippet(request.history);
    const querySeed = [request.userMessage, chatHistory].filter(Boolean).join('\n');
    const chatHistoryTokens = chatHistory ? this.estimateTokens(chatHistory) : 0;

    const maxInputTokens = Math.max(512, completion.contextWindowTokens - completion.maxOutputTokens);
    const instructionOverhead = this.estimateTokens(completion.systemPrompt) + 180;
    const manualContextTokens = manualContext ? this.estimateTokens(manualContext) : 0;
    const remainingAfterPrompt = Math.max(
      64,
      maxInputTokens - completion.promptReserveTokens - instructionOverhead - manualContextTokens
    );

    const useSpecificNotesContext = noteContextRefs.length > 0;
    const useLorebookContext = request.useLorebookContext && selectedScopes.length > 0;
    let noteContextBudget = 0;
    if (useSpecificNotesContext) {
      noteContextBudget = useLorebookContext
        ? Math.max(96, Math.floor(remainingAfterPrompt * 0.4))
        : remainingAfterPrompt;
      noteContextBudget = Math.min(noteContextBudget, remainingAfterPrompt);
    }

    const noteContextResult = await this.buildSpecificNotesContext(noteContextRefs, noteContextBudget);
    const specificNotesContextMarkdown = noteContextResult.markdown;
    const specificNotesTokens = noteContextResult.usedTokens;
    const specificNotePaths = noteContextResult.includedPaths;
    const unresolvedNoteRefs = noteContextResult.unresolvedRefs;

    let chapterMemoryMarkdown = '';
    let chapterMemoryTokens = 0;
    let chapterMemoryItems: string[] = [];
    let chapterMemoryLayerTrace: string[] = [];
    const activeStoryFile = this.app.workspace.getActiveFile();
    if (activeStoryFile) {
      const remainingAfterSpecificNotes = Math.max(0, remainingAfterPrompt - specificNotesTokens);
      if (remainingAfterSpecificNotes > 96) {
        const chapterMemoryBudget = useLorebookContext
          ? Math.min(700, Math.max(96, Math.floor(remainingAfterSpecificNotes * 0.25)))
          : Math.min(900, Math.max(96, Math.floor(remainingAfterSpecificNotes * 0.45)));
        const chapterMemory = await this.buildChapterMemoryContext(activeStoryFile, chapterMemoryBudget);
        chapterMemoryMarkdown = chapterMemory.markdown;
        chapterMemoryTokens = chapterMemory.usedTokens;
        chapterMemoryItems = chapterMemory.items;
        chapterMemoryLayerTrace = chapterMemory.layerTrace;
      }
    }

    let availableForLorebookContext = remainingAfterPrompt - specificNotesTokens - chapterMemoryTokens;
    if (availableForLorebookContext < 64) {
      availableForLorebookContext = 64;
    }

    let contexts: AssembledContext[] = [];
    let usedContextTokens = 0;
    if (useLorebookContext) {
      let contextBudget = Math.min(
        this.settings.defaultLoreBook.tokenBudget,
        Math.max(64, availableForLorebookContext)
      );

      for (let attempt = 0; attempt < 4; attempt += 1) {
        contexts = [];
        const perScopeBudget = Math.max(64, Math.floor(contextBudget / selectedScopes.length));
        for (const scope of selectedScopes) {
          contexts.push(await this.liveContextIndex.query({
            queryText: querySeed || request.userMessage,
            tokenBudget: perScopeBudget
          }, scope));
        }

        usedContextTokens = contexts.reduce((sum, item) => sum + item.usedTokens, 0);
        const remaining = availableForLorebookContext - usedContextTokens;
        if (remaining >= 0 || contextBudget <= 64) {
          break;
        }
        const nextBudget = Math.max(64, contextBudget + remaining - 48);
        if (nextBudget === contextBudget) {
          break;
        }
        contextBudget = nextBudget;
      }
    }

    const contextMarkdown = contexts.map(context => context.markdown).join('\n\n---\n\n');
    const worldInfoItems = contexts
      .flatMap(context => context.worldInfo.slice(0, 6).map(item => item.entry.comment))
      .slice(0, 12);
    const ragItems = contexts
      .flatMap(context => context.rag.slice(0, 6).map(item => item.document.title))
      .slice(0, 12);
    const totalWorldInfoCount = contexts.reduce((sum, context) => sum + context.worldInfo.length, 0);
    const totalRagCount = contexts.reduce((sum, context) => sum + context.rag.length, 0);
    const ragPolicies = [...new Set(contexts.map(context => context.explainability.rag.policy))];
    const ragEnabledScopes = contexts.filter(context => context.explainability.rag.enabled).length;
    const layerTrace: string[] = [];
    layerTrace.push(`local_window: chat_history ~${chatHistoryTokens} tokens`);
    if (manualContextTokens > 0) {
      layerTrace.push(`manual_context: ~${manualContextTokens} tokens`);
    }
    if (specificNotesTokens > 0) {
      layerTrace.push(`specific_notes: ${specificNotePaths.length} notes, ~${specificNotesTokens} tokens`);
    }
    if (chapterMemoryTokens > 0) {
      layerTrace.push(`chapter_memory: ${chapterMemoryItems.length} chapter summaries, ~${chapterMemoryTokens} tokens`);
      layerTrace.push(...chapterMemoryLayerTrace);
    }
    if (useLorebookContext) {
      layerTrace.push(`graph_memory(world_info): ${totalWorldInfoCount} entries from ${selectedScopes.length} scope(s), ~${usedContextTokens} tokens`);
      layerTrace.push(`fallback_rag: ${totalRagCount} docs, policy ${ragPolicies.join('/')} (${ragEnabledScopes}/${selectedScopes.length} scopes enabled)`);
    }
    const contextMeta: StoryChatContextMeta = {
      usedLorebookContext: useLorebookContext,
      usedManualContext: manualContext.length > 0,
      usedSpecificNotesContext: specificNotePaths.length > 0,
      usedChapterMemoryContext: chapterMemoryItems.length > 0,
      scopes: selectedScopes,
      specificNotePaths,
      unresolvedNoteRefs,
      chapterMemoryItems,
      layerTrace,
      contextTokens: usedContextTokens + manualContextTokens + specificNotesTokens + chapterMemoryTokens,
      worldInfoCount: totalWorldInfoCount,
      ragCount: totalRagCount,
      worldInfoItems,
      ragItems
    };

    const userPrompt = [
      'You are assisting with story development in a chat workflow.',
      'Answer naturally as a writing partner.',
      'Respect lore context as canon constraints when provided.',
      '',
      '<chat_history>',
      chatHistory || '[No prior chat history.]',
      '</chat_history>',
      '',
      '<manual_context>',
      manualContext || '[No manual context provided.]',
      '</manual_context>',
      '',
      '<specific_notes_context>',
      specificNotesContextMarkdown || '[No specific notes selected.]',
      '</specific_notes_context>',
      '',
      '<chapter_memory_context>',
      chapterMemoryMarkdown || '[No chapter memory available.]',
      '</chapter_memory_context>',
      '',
      '<lorevault_scopes>',
      scopeLabels.join(', '),
      '</lorevault_scopes>',
      '',
      '<lorevault_context>',
      contextMarkdown || '[No lorebook context selected.]',
      '</lorevault_context>',
      '',
      '<user_message>',
      request.userMessage.trim(),
      '</user_message>'
    ].join('\n');

    this.generationInFlight = true;
    this.generationAbortController = new AbortController();
    this.updateGenerationTelemetry({
      ...this.createDefaultGenerationTelemetry(),
      state: 'generating',
      statusText: 'chat generating',
      startedAt: Date.now(),
      provider: completion.provider,
      model: completion.model,
      scopes: scopeLabels,
      contextWindowTokens: completion.contextWindowTokens,
      maxInputTokens,
      promptReserveTokens: completion.promptReserveTokens,
      contextUsedTokens: usedContextTokens + manualContextTokens + specificNotesTokens + chapterMemoryTokens,
      contextRemainingTokens: Math.max(0, maxInputTokens - completion.promptReserveTokens - instructionOverhead - usedContextTokens - manualContextTokens - specificNotesTokens - chapterMemoryTokens),
      maxOutputTokens: completion.maxOutputTokens,
      worldInfoCount: contextMeta.worldInfoCount,
      ragCount: contextMeta.ragCount,
      worldInfoItems,
      ragItems,
      contextLayerTrace: contextMeta.layerTrace ?? [],
      lastError: ''
    });
    this.setGenerationStatus('chat generating', 'busy');

    let assistantText = '';
    let streamFailure: Error | null = null;
    try {
      await requestStoryContinuationStream(completion, {
        systemPrompt: completion.systemPrompt,
        userPrompt,
        onDelta: (delta: string) => {
          if (!delta) {
            return;
          }
          assistantText += delta;
          request.onDelta(delta);
          this.updateGenerationTelemetry({
            generatedTokens: this.estimateTokens(assistantText),
            statusText: 'chat generating'
          });
        },
        abortSignal: this.generationAbortController.signal
      });
    } catch (error) {
      if (!this.isAbortLikeError(error)) {
        streamFailure = error instanceof Error ? error : new Error(String(error));
      }
    } finally {
      this.generationInFlight = false;
      this.generationAbortController = null;
      this.setGenerationStatus('idle', 'idle');
    }

    if (streamFailure) {
      this.updateGenerationTelemetry({
        state: 'error',
        statusText: 'error',
        lastError: streamFailure.message
      });
      throw streamFailure;
    }

    const normalizedAssistantText = assistantText.trim();
    if (!normalizedAssistantText) {
      this.updateGenerationTelemetry({
        state: 'idle',
        statusText: 'idle',
        lastError: 'Completion provider returned empty output.'
      });
      throw new Error('Completion provider returned empty output.');
    }

    this.updateGenerationTelemetry({
      state: 'idle',
      statusText: 'idle',
      generatedTokens: this.estimateTokens(normalizedAssistantText),
      contextUsedTokens: contextMeta.contextTokens,
      contextRemainingTokens: Math.max(0, maxInputTokens - completion.promptReserveTokens - instructionOverhead - contextMeta.contextTokens),
      worldInfoCount: contextMeta.worldInfoCount,
      ragCount: contextMeta.ragCount,
      worldInfoItems: contextMeta.worldInfoItems,
      ragItems: contextMeta.ragItems,
      contextLayerTrace: contextMeta.layerTrace ?? [],
      lastError: ''
    });

    return {
      assistantText: normalizedAssistantText,
      contextMeta
    };
  }

  private mergeSettings(data: Partial<ConverterSettings> | null | undefined): ConverterSettings {
    const merged: ConverterSettings = {
      ...DEFAULT_SETTINGS,
      ...data,
      tagScoping: {
        ...DEFAULT_SETTINGS.tagScoping,
        ...(data?.tagScoping ?? {})
      },
      weights: {
        ...DEFAULT_SETTINGS.weights,
        ...(data?.weights ?? {})
      },
      defaultLoreBook: {
        ...DEFAULT_SETTINGS.defaultLoreBook,
        ...(data?.defaultLoreBook ?? {})
      },
      defaultEntry: {
        ...DEFAULT_SETTINGS.defaultEntry,
        ...(data?.defaultEntry ?? {})
      },
      sqlite: {
        ...DEFAULT_SETTINGS.sqlite,
        ...(data?.sqlite ?? {})
      },
      embeddings: {
        ...DEFAULT_SETTINGS.embeddings,
        ...(data?.embeddings ?? {})
      },
      retrieval: {
        ...DEFAULT_SETTINGS.retrieval,
        ...(data?.retrieval ?? {})
      },
      completion: {
        ...DEFAULT_SETTINGS.completion,
        ...(data?.completion ?? {})
      },
      storyChat: {
        ...DEFAULT_SETTINGS.storyChat,
        ...(data?.storyChat ?? {})
      }
    };

    merged.tagScoping.tagPrefix = normalizeTagPrefix(merged.tagScoping.tagPrefix) || DEFAULT_SETTINGS.tagScoping.tagPrefix;
    merged.tagScoping.activeScope = normalizeScope(merged.tagScoping.activeScope);
    merged.tagScoping.membershipMode = merged.tagScoping.membershipMode === 'cascade' ? 'cascade' : 'exact';
    merged.tagScoping.includeUntagged = Boolean(merged.tagScoping.includeUntagged);
    merged.outputPath = merged.outputPath.trim();
    merged.outputPath = merged.outputPath.replace(/\\/g, '/');
    if (!merged.outputPath) {
      merged.outputPath = DEFAULT_SETTINGS.outputPath;
    }

    // Keep settings valid even when older config files contain incomplete trigger config.
    if (merged.defaultEntry.constant) {
      merged.defaultEntry.vectorized = false;
      merged.defaultEntry.selective = false;
    } else if (merged.defaultEntry.vectorized) {
      merged.defaultEntry.constant = false;
      merged.defaultEntry.selective = false;
    } else if (merged.defaultEntry.selective) {
      merged.defaultEntry.constant = false;
      merged.defaultEntry.vectorized = false;
    } else {
      merged.defaultEntry.selective = true;
    }

    merged.defaultEntry.selectiveLogic = Math.max(
      0,
      Math.min(3, Math.floor(merged.defaultEntry.selectiveLogic))
    );

    merged.sqlite.enabled = Boolean(merged.sqlite.enabled);
    merged.sqlite.outputPath = merged.sqlite.outputPath.trim();
    merged.sqlite.outputPath = merged.sqlite.outputPath.replace(/\\/g, '/');
    if (!merged.sqlite.outputPath) {
      merged.sqlite.outputPath = DEFAULT_SETTINGS.sqlite.outputPath;
    }

    merged.embeddings.enabled = Boolean(merged.embeddings.enabled);
    merged.embeddings.provider = (
      merged.embeddings.provider === 'ollama' ||
      merged.embeddings.provider === 'openai_compatible'
    ) ? merged.embeddings.provider : 'openrouter';
    merged.embeddings.endpoint = merged.embeddings.endpoint.trim();
    merged.embeddings.apiKey = merged.embeddings.apiKey.trim();
    merged.embeddings.model = merged.embeddings.model.trim() || DEFAULT_SETTINGS.embeddings.model;
    merged.embeddings.instruction = merged.embeddings.instruction.trim();
    merged.embeddings.batchSize = Math.max(1, Math.floor(merged.embeddings.batchSize));
    merged.embeddings.timeoutMs = Math.max(1000, Math.floor(merged.embeddings.timeoutMs));
    merged.embeddings.cacheDir = merged.embeddings.cacheDir.trim() || DEFAULT_SETTINGS.embeddings.cacheDir;
    merged.embeddings.chunkingMode = (
      merged.embeddings.chunkingMode === 'note' ||
      merged.embeddings.chunkingMode === 'section'
    ) ? merged.embeddings.chunkingMode : 'auto';
    merged.embeddings.minChunkChars = Math.max(100, Math.floor(merged.embeddings.minChunkChars));
    merged.embeddings.maxChunkChars = Math.max(
      merged.embeddings.minChunkChars,
      Math.floor(merged.embeddings.maxChunkChars)
    );
    merged.embeddings.overlapChars = Math.max(0, Math.floor(merged.embeddings.overlapChars));

    merged.retrieval.maxGraphHops = Math.max(0, Math.min(3, Math.floor(merged.retrieval.maxGraphHops)));
    merged.retrieval.graphHopDecay = Math.max(0.2, Math.min(0.9, Number(merged.retrieval.graphHopDecay)));
    merged.retrieval.ragFallbackPolicy = (
      merged.retrieval.ragFallbackPolicy === 'off' ||
      merged.retrieval.ragFallbackPolicy === 'always'
    ) ? merged.retrieval.ragFallbackPolicy : 'auto';
    merged.retrieval.ragFallbackSeedScoreThreshold = Math.max(
      1,
      Math.floor(Number(merged.retrieval.ragFallbackSeedScoreThreshold))
    );

    merged.completion.enabled = Boolean(merged.completion.enabled);
    merged.completion.provider = (
      merged.completion.provider === 'ollama' ||
      merged.completion.provider === 'openai_compatible'
    ) ? merged.completion.provider : 'openrouter';
    merged.completion.endpoint = merged.completion.endpoint.trim() || DEFAULT_SETTINGS.completion.endpoint;
    merged.completion.apiKey = merged.completion.apiKey.trim();
    merged.completion.model = merged.completion.model.trim() || DEFAULT_SETTINGS.completion.model;
    merged.completion.systemPrompt = merged.completion.systemPrompt.trim() || DEFAULT_SETTINGS.completion.systemPrompt;
    merged.completion.temperature = Math.max(0, Math.min(2, Number(merged.completion.temperature)));
    merged.completion.maxOutputTokens = Math.max(64, Math.floor(merged.completion.maxOutputTokens));
    merged.completion.contextWindowTokens = Math.max(
      merged.completion.maxOutputTokens + 512,
      Math.floor(merged.completion.contextWindowTokens)
    );
    merged.completion.promptReserveTokens = Math.max(0, Math.floor(merged.completion.promptReserveTokens));
    merged.completion.timeoutMs = Math.max(1000, Math.floor(merged.completion.timeoutMs));
    const rawPresets = Array.isArray(merged.completion.presets) ? merged.completion.presets : [];
    const normalizedPresets: CompletionPreset[] = [];
    for (const rawPreset of rawPresets) {
      if (!rawPreset || typeof rawPreset !== 'object') {
        continue;
      }
      const candidate = rawPreset as Partial<CompletionPreset>;
      const id = typeof candidate.id === 'string' && candidate.id.trim()
        ? candidate.id.trim()
        : `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const name = typeof candidate.name === 'string' && candidate.name.trim()
        ? candidate.name.trim()
        : 'Preset';
      const provider: CompletionPreset['provider'] = (
        candidate.provider === 'ollama' ||
        candidate.provider === 'openai_compatible'
      ) ? candidate.provider : 'openrouter';
      normalizedPresets.push({
        id,
        name,
        provider,
        endpoint: (candidate.endpoint ?? DEFAULT_SETTINGS.completion.endpoint).toString().trim() || DEFAULT_SETTINGS.completion.endpoint,
        apiKey: (candidate.apiKey ?? '').toString().trim(),
        model: (candidate.model ?? DEFAULT_SETTINGS.completion.model).toString().trim() || DEFAULT_SETTINGS.completion.model,
        systemPrompt: (candidate.systemPrompt ?? DEFAULT_SETTINGS.completion.systemPrompt).toString().trim() || DEFAULT_SETTINGS.completion.systemPrompt,
        temperature: Math.max(0, Math.min(2, Number(candidate.temperature ?? DEFAULT_SETTINGS.completion.temperature))),
        maxOutputTokens: Math.max(64, Math.floor(Number(candidate.maxOutputTokens ?? DEFAULT_SETTINGS.completion.maxOutputTokens))),
        contextWindowTokens: Math.max(
          Math.max(64, Math.floor(Number(candidate.maxOutputTokens ?? DEFAULT_SETTINGS.completion.maxOutputTokens))) + 512,
          Math.floor(Number(candidate.contextWindowTokens ?? DEFAULT_SETTINGS.completion.contextWindowTokens))
        ),
        promptReserveTokens: Math.max(0, Math.floor(Number(candidate.promptReserveTokens ?? DEFAULT_SETTINGS.completion.promptReserveTokens))),
        timeoutMs: Math.max(1000, Math.floor(Number(candidate.timeoutMs ?? DEFAULT_SETTINGS.completion.timeoutMs)))
      });
    }
    merged.completion.presets = normalizedPresets
      .filter((preset, index, array) => array.findIndex(item => item.id === preset.id) === index)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const activePresetId = (merged.completion.activePresetId ?? '').toString().trim();
    merged.completion.activePresetId = merged.completion.presets.some(preset => preset.id === activePresetId)
      ? activePresetId
      : '';

    const selectedScopes = Array.isArray(merged.storyChat.selectedScopes)
      ? merged.storyChat.selectedScopes
      : [];
    merged.storyChat.chatFolder = ((merged.storyChat.chatFolder ?? '').toString().trim() || DEFAULT_SETTINGS.storyChat.chatFolder).replace(/\\/g, '/');
    merged.storyChat.activeConversationPath = (merged.storyChat.activeConversationPath ?? '').toString().trim().replace(/\\/g, '/');
    merged.storyChat.selectedScopes = selectedScopes
      .map(scope => normalizeScope(scope))
      .filter((scope, index, array): scope is string => Boolean(scope) && array.indexOf(scope) === index);
    merged.storyChat.useLorebookContext = Boolean(merged.storyChat.useLorebookContext);
    merged.storyChat.manualContext = (merged.storyChat.manualContext ?? '').toString();
    const noteContextRefs = Array.isArray(merged.storyChat.noteContextRefs)
      ? merged.storyChat.noteContextRefs
      : [];
    merged.storyChat.noteContextRefs = noteContextRefs
      .map(ref => normalizeLinkTarget(String(ref ?? '')))
      .filter((ref, index, array): ref is string => Boolean(ref) && array.indexOf(ref) === index);
    merged.storyChat.maxMessages = Math.max(10, Math.floor(merged.storyChat.maxMessages || DEFAULT_SETTINGS.storyChat.maxMessages));

    const messages = Array.isArray(merged.storyChat.messages) ? merged.storyChat.messages : [];
    merged.storyChat.messages = messages
      .filter(message => message && (message.role === 'user' || message.role === 'assistant'))
      .map((message: any): StoryChatMessage => {
        const role: StoryChatMessage['role'] = message.role === 'assistant' ? 'assistant' : 'user';
        return {
          id: typeof message.id === 'string' && message.id ? message.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role,
          content: (message.content ?? '').toString(),
          createdAt: Number.isFinite(message.createdAt) ? Math.floor(message.createdAt) : Date.now(),
          contextMeta: message.contextMeta ? {
            usedLorebookContext: Boolean(message.contextMeta.usedLorebookContext),
            usedManualContext: Boolean(message.contextMeta.usedManualContext),
            usedSpecificNotesContext: Boolean(message.contextMeta.usedSpecificNotesContext),
            usedChapterMemoryContext: Boolean(message.contextMeta.usedChapterMemoryContext),
            scopes: Array.isArray(message.contextMeta.scopes)
              ? message.contextMeta.scopes
                .map((scope: string) => normalizeScope(scope))
                .filter((scope: string | null): scope is string => Boolean(scope))
              : [],
            specificNotePaths: Array.isArray(message.contextMeta.specificNotePaths)
              ? message.contextMeta.specificNotePaths.map((item: unknown) => String(item))
              : [],
            unresolvedNoteRefs: Array.isArray(message.contextMeta.unresolvedNoteRefs)
              ? message.contextMeta.unresolvedNoteRefs.map((item: unknown) => String(item))
              : [],
            chapterMemoryItems: Array.isArray(message.contextMeta.chapterMemoryItems)
              ? message.contextMeta.chapterMemoryItems.map((item: unknown) => String(item))
              : [],
            layerTrace: Array.isArray(message.contextMeta.layerTrace)
              ? message.contextMeta.layerTrace.map((item: unknown) => String(item))
              : [],
            contextTokens: Math.max(0, Math.floor(message.contextMeta.contextTokens ?? 0)),
            worldInfoCount: Math.max(0, Math.floor(message.contextMeta.worldInfoCount ?? 0)),
            ragCount: Math.max(0, Math.floor(message.contextMeta.ragCount ?? 0)),
            worldInfoItems: Array.isArray(message.contextMeta.worldInfoItems)
              ? message.contextMeta.worldInfoItems.map((item: unknown) => String(item))
              : [],
            ragItems: Array.isArray(message.contextMeta.ragItems)
              ? message.contextMeta.ragItems.map((item: unknown) => String(item))
              : []
          } : undefined
        };
      })
      .slice(-merged.storyChat.maxMessages);

    const forkSnapshots = Array.isArray(merged.storyChat.forkSnapshots) ? merged.storyChat.forkSnapshots : [];
    merged.storyChat.forkSnapshots = forkSnapshots
      .map((snapshot: any): StoryChatForkSnapshot | null => {
        if (!snapshot) {
          return null;
        }
        const snapshotMessages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
        const normalizedMessages: StoryChatMessage[] = snapshotMessages
          .filter((message: any) => message && (message.role === 'user' || message.role === 'assistant'))
          .map((message: any): StoryChatMessage => ({
            id: typeof message.id === 'string' && message.id ? message.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: (message.content ?? '').toString(),
            createdAt: Number.isFinite(message.createdAt) ? Math.floor(message.createdAt) : Date.now(),
            contextMeta: message.contextMeta ? {
              usedLorebookContext: Boolean(message.contextMeta.usedLorebookContext),
              usedManualContext: Boolean(message.contextMeta.usedManualContext),
              usedSpecificNotesContext: Boolean(message.contextMeta.usedSpecificNotesContext),
              usedChapterMemoryContext: Boolean(message.contextMeta.usedChapterMemoryContext),
              scopes: Array.isArray(message.contextMeta.scopes)
                ? message.contextMeta.scopes
                  .map((scope: string) => normalizeScope(scope))
                  .filter((scope: string | null): scope is string => Boolean(scope))
                : [],
              specificNotePaths: Array.isArray(message.contextMeta.specificNotePaths)
                ? message.contextMeta.specificNotePaths.map((item: unknown) => String(item))
                : [],
              unresolvedNoteRefs: Array.isArray(message.contextMeta.unresolvedNoteRefs)
                ? message.contextMeta.unresolvedNoteRefs.map((item: unknown) => String(item))
                : [],
              chapterMemoryItems: Array.isArray(message.contextMeta.chapterMemoryItems)
                ? message.contextMeta.chapterMemoryItems.map((item: unknown) => String(item))
                : [],
              layerTrace: Array.isArray(message.contextMeta.layerTrace)
                ? message.contextMeta.layerTrace.map((item: unknown) => String(item))
                : [],
              contextTokens: Math.max(0, Math.floor(message.contextMeta.contextTokens ?? 0)),
              worldInfoCount: Math.max(0, Math.floor(message.contextMeta.worldInfoCount ?? 0)),
              ragCount: Math.max(0, Math.floor(message.contextMeta.ragCount ?? 0)),
              worldInfoItems: Array.isArray(message.contextMeta.worldInfoItems)
                ? message.contextMeta.worldInfoItems.map((item: unknown) => String(item))
                : [],
              ragItems: Array.isArray(message.contextMeta.ragItems)
                ? message.contextMeta.ragItems.map((item: unknown) => String(item))
                : []
            } : undefined
          }))
          .slice(-merged.storyChat.maxMessages);

        const selectedSnapshotScopes = Array.isArray(snapshot.selectedScopes) ? snapshot.selectedScopes : [];
        const selectedScopes = selectedSnapshotScopes
          .map((scope: unknown) => normalizeScope(String(scope ?? '')))
          .filter((scope: string | null, index: number, array: Array<string | null>): scope is string => Boolean(scope) && array.indexOf(scope) === index);
        const noteRefs = Array.isArray(snapshot.noteContextRefs) ? snapshot.noteContextRefs : [];
        const noteContextRefs = noteRefs
          .map((ref: unknown) => normalizeLinkTarget(String(ref ?? '')))
          .filter((ref: string | null, index: number, array: Array<string | null>): ref is string => Boolean(ref) && array.indexOf(ref) === index);

        return {
          id: typeof snapshot.id === 'string' && snapshot.id ? snapshot.id : `fork-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title: typeof snapshot.title === 'string' && snapshot.title.trim() ? snapshot.title.trim() : 'Fork Snapshot',
          createdAt: Number.isFinite(snapshot.createdAt) ? Math.floor(snapshot.createdAt) : Date.now(),
          messages: normalizedMessages,
          selectedScopes,
          useLorebookContext: Boolean(snapshot.useLorebookContext),
          manualContext: (snapshot.manualContext ?? '').toString(),
          noteContextRefs
        };
      })
      .filter((snapshot): snapshot is StoryChatForkSnapshot => Boolean(snapshot))
      .slice(-20);

    return merged;
  }

  async onload() {
    // Load the settings
    this.settings = this.mergeSettings(await this.loadData());
    this.liveContextIndex = new LiveContextIndex(this.app, () => this.settings);
    this.chapterSummaryStore = new ChapterSummaryStore(this.app);
    this.registerView(LOREVAULT_MANAGER_VIEW_TYPE, leaf => new LorebooksManagerView(leaf, this));
    this.registerView(LOREVAULT_ROUTING_DEBUG_VIEW_TYPE, leaf => new LorebooksRoutingDebugView(leaf, this));
    this.registerView(LOREVAULT_QUERY_SIMULATION_VIEW_TYPE, leaf => new LorebooksQuerySimulationView(leaf, this));
    this.registerView(LOREVAULT_STORY_CHAT_VIEW_TYPE, leaf => new StoryChatView(leaf, this));
    this.registerView(LOREVAULT_HELP_VIEW_TYPE, leaf => new LorevaultHelpView(leaf, this));

    // Add custom ribbon icons with clearer intent.
    addIcon('lorevault-build', `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" d="M16 20h44a8 8 0 0 1 8 8v56a8 8 0 0 0-8-8H16z"/>
      <path fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" d="M68 28h16"/>
      <path fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" d="M76 20v16"/>
      <path fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" d="M30 38h24M30 52h20M30 66h16"/>
    </svg>`);
    addIcon('lorevault-manager', `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="12" y="16" width="76" height="68" rx="10" ry="10" fill="none" stroke="currentColor" stroke-width="8"/>
      <path fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" d="M28 36h24M28 52h24M28 68h24"/>
      <circle cx="68" cy="36" r="5" fill="currentColor"/>
      <circle cx="76" cy="52" r="5" fill="currentColor"/>
      <circle cx="64" cy="68" r="5" fill="currentColor"/>
    </svg>`);
    addIcon('lorevault-chat', `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round" d="M14 18h72a8 8 0 0 1 8 8v40a8 8 0 0 1-8 8H44l-20 16v-16H14a8 8 0 0 1-8-8V26a8 8 0 0 1 8-8z"/>
      <path fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" d="M26 38h46M26 52h34"/>
    </svg>`);

    // Add settings tab
    this.addSettingTab(new LoreBookConverterSettingTab(this.app, this));
    this.generationStatusEl = this.addStatusBarItem();
    this.syncIdleGenerationTelemetryToSettings();

    // Add ribbon icon
    this.addRibbonIcon('lorevault-build', 'Build Active Lorebook Scope', () => {
      void this.buildActiveScopeExport();
    });

    this.addRibbonIcon('lorevault-manager', 'Open LoreVault Manager', () => {
      void this.openLorebooksManagerView();
    });

    this.addRibbonIcon('lorevault-chat', 'Open Story Chat', () => {
      void this.openStoryChatView();
    });

    this.addRibbonIcon('help-circle', 'Open LoreVault Help', () => {
      void this.openHelpView();
    });

    // Add command
    this.addCommand({
      id: 'convert-to-lorebook',
      name: 'Build Active Lorebook Scope',
      callback: () => {
        void this.buildActiveScopeExport();
      }
    });

    this.addCommand({
      id: 'open-lorebooks-manager',
      name: 'Open LoreVault Manager',
      callback: () => {
        void this.openLorebooksManagerView();
      }
    });

    this.addCommand({
      id: 'open-routing-debug',
      name: 'Open LoreVault Routing Debug',
      callback: () => {
        void this.openRoutingDebugView();
      }
    });

    this.addCommand({
      id: 'open-query-simulation',
      name: 'Open LoreVault Query Simulation',
      callback: () => {
        void this.openQuerySimulationView();
      }
    });

    this.addCommand({
      id: 'open-story-chat',
      name: 'Open Story Chat',
      callback: () => {
        void this.openStoryChatView();
      }
    });

    this.addCommand({
      id: 'open-lorevault-help',
      name: 'Open LoreVault Help',
      callback: () => {
        void this.openHelpView();
      }
    });

    this.addCommand({
      id: 'continue-story-with-context',
      name: 'Continue Story with Context',
      callback: async () => {
        await this.continueStoryWithContext();
      }
    });

    this.registerEvent(this.app.workspace.on('editor-menu', (menu: Menu, _editor: Editor, _info: MarkdownView | MarkdownFileInfo) => {
      menu.addSeparator();
      menu.addItem(item => {
        if (this.generationInFlight) {
          item.setTitle('LoreVault: Generation Running');
          item.setDisabled(true);
          return;
        }

        item
          .setTitle('LoreVault: Continue Story with Context')
          .setIcon('book-open-text')
          .onClick(() => {
            void this.continueStoryWithContext();
          });
      });
    }));
    
    // Add template creation command
    this.addCommand({
      id: 'create-lorebook-template',
      name: 'Create LoreVault Entry Template',
      callback: async () => {
        try {
          const template = await createTemplate(this.app, this.settings);
          
          // Check if there's an active file
          const activeFile = this.app.workspace.getActiveFile();
          
          if (activeFile) {
            // If there's an active file, replace its content
            await this.app.vault.modify(activeFile, template);
            new Notice(`Template applied to ${activeFile.name}`);
          } else {
            // Otherwise create a new file
            const fileName = `LoreVault_Entry_${Date.now()}.md`;
            await this.app.vault.create(fileName, template);
            new Notice(`Created new template: ${fileName}`);
          }
        } catch (error) {
          console.error('Template creation cancelled', error);
        }
      }
    });

    this.registerEvent(this.app.vault.on('create', file => {
      this.liveContextIndex.markFileChanged(file);
      this.chapterSummaryStore.invalidatePath(file.path);
      this.refreshManagerViews();
      this.refreshRoutingDebugViews();
      this.refreshQuerySimulationViews();
      this.refreshStoryChatViews();
    }));

    this.registerEvent(this.app.vault.on('modify', file => {
      this.liveContextIndex.markFileChanged(file);
      this.chapterSummaryStore.invalidatePath(file.path);
      this.refreshManagerViews();
      this.refreshRoutingDebugViews();
      this.refreshQuerySimulationViews();
      this.refreshStoryChatViews();
    }));

    this.registerEvent(this.app.vault.on('delete', file => {
      this.liveContextIndex.markFileChanged(file);
      this.chapterSummaryStore.invalidatePath(file.path);
      this.refreshManagerViews();
      this.refreshRoutingDebugViews();
      this.refreshQuerySimulationViews();
      this.refreshStoryChatViews();
    }));

    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.liveContextIndex.markRenamed(file, oldPath);
      this.chapterSummaryStore.invalidatePath(oldPath);
      this.chapterSummaryStore.invalidatePath(file.path);
      this.refreshManagerViews();
      this.refreshRoutingDebugViews();
      this.refreshQuerySimulationViews();
      this.refreshStoryChatViews();
    }));

    void this.liveContextIndex.initialize().catch(error => {
      console.error('Failed to initialize live context index:', error);
    });
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(LOREVAULT_MANAGER_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_ROUTING_DEBUG_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_QUERY_SIMULATION_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_STORY_CHAT_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_HELP_VIEW_TYPE);
    if (this.managerRefreshTimer !== null) {
      window.clearTimeout(this.managerRefreshTimer);
      this.managerRefreshTimer = null;
    }
    this.generationStatusEl = null;
  }

  async saveData(settings: any) {
    this.settings = this.mergeSettings(settings as Partial<ConverterSettings>);
    await super.saveData(this.settings);
    this.liveContextIndex?.requestFullRefresh();
    this.syncIdleGenerationTelemetryToSettings();
    this.refreshManagerViews();
    this.refreshRoutingDebugViews();
    this.refreshQuerySimulationViews();
    this.refreshStoryChatViews();
    this.refreshHelpViews();
  }

  private resolveScopeFromActiveFile(activeFile: TFile | null): string | undefined {
    if (!activeFile) {
      return undefined;
    }

    const cache = this.app.metadataCache.getFileCache(activeFile);
    if (!cache) {
      return undefined;
    }

    const tags = getAllTags(cache) ?? [];
    const scopes = extractLorebookScopesFromTags(tags, this.settings.tagScoping.tagPrefix);
    if (scopes.length === 0) {
      return undefined;
    }
    return scopes[0];
  }

  private resolveStoryScopesFromFrontmatter(activeFile: TFile | null): string[] {
    if (!activeFile) {
      return [];
    }

    const cache = this.app.metadataCache.getFileCache(activeFile);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    return parseStoryScopesFromFrontmatter(frontmatter, this.settings.tagScoping.tagPrefix);
  }

  private collectStoryThreadNodes(): StoryThreadNode[] {
    const nodes: StoryThreadNode[] = [];
    const files = [...this.app.vault.getMarkdownFiles()].sort((a, b) => a.path.localeCompare(b.path));
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
      const node = parseStoryThreadNodeFromFrontmatter(file.path, file.basename, frontmatter);
      if (node) {
        nodes.push(node);
      }
    }
    return nodes;
  }

  private async buildChapterMemoryContext(
    activeFile: TFile | null,
    tokenBudget: number
  ): Promise<{
    markdown: string;
    usedTokens: number;
    items: string[];
    layerTrace: string[];
  }> {
    if (!activeFile || tokenBudget <= 0) {
      return { markdown: '', usedTokens: 0, items: [], layerTrace: [] };
    }

    const nodes = this.collectStoryThreadNodes();
    const resolution = resolveStoryThread(nodes, activeFile.path);
    if (!resolution || resolution.currentIndex <= 0) {
      return { markdown: '', usedTokens: 0, items: [], layerTrace: [] };
    }

    const nodeByPath = new Map(nodes.map(node => [node.path, node]));
    const priorPaths = resolution.orderedPaths
      .slice(0, resolution.currentIndex)
      .slice(-4);

    const sections: string[] = [];
    const items: string[] = [];
    const layerTrace: string[] = [];
    let usedTokens = 0;

    for (const priorPath of priorPaths) {
      if (usedTokens >= tokenBudget) {
        break;
      }

      const file = this.app.vault.getAbstractFileByPath(priorPath);
      if (!(file instanceof TFile)) {
        continue;
      }

      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
      const summary = await this.chapterSummaryStore.resolveSummary(
        file,
        frontmatter,
        body => this.trimTextHeadToTokenBudget(body, 180)
      );
      if (!summary?.text.trim()) {
        continue;
      }

      const node = nodeByPath.get(priorPath);
      const chapterPrefix = typeof node?.chapter === 'number'
        ? `Chapter ${node.chapter}`
        : 'Chapter';
      const chapterTitle = node?.chapterTitle || node?.title || file.basename;
      const section = [
        `### ${chapterPrefix}: ${chapterTitle}`,
        `Source: \`${priorPath}\``,
        '',
        summary.text
      ].join('\n');

      const sectionTokens = this.estimateTokens(section);
      if (usedTokens + sectionTokens > tokenBudget) {
        continue;
      }

      usedTokens += sectionTokens;
      sections.push(section);
      items.push(chapterTitle);
      layerTrace.push(`chapter_memory:${chapterTitle} (${summary.source}, ~${sectionTokens} tokens)`);
    }

    return {
      markdown: sections.join('\n\n---\n\n'),
      usedTokens,
      items,
      layerTrace
    };
  }

  private resolveBuildScopeFromContext(): string | null {
    const fromActiveFile = this.resolveScopeFromActiveFile(this.app.workspace.getActiveFile());
    if (fromActiveFile) {
      return fromActiveFile;
    }

    const configuredScope = normalizeScope(this.settings.tagScoping.activeScope);
    return configuredScope || null;
  }

  private async buildActiveScopeExport(): Promise<void> {
    const scope = this.resolveBuildScopeFromContext();
    if (!scope) {
      new Notice('No lorebook scope found for active file. Tag the note or set Active Scope.');
      return;
    }
    await this.convertToLorebook(scope);
  }

  private extractQueryWindow(text: string): string {
    const normalized = text.trim();
    if (!normalized) {
      return '';
    }

    const maxChars = 5000;
    if (normalized.length <= maxChars) {
      return normalized;
    }
    return normalized.slice(normalized.length - maxChars);
  }

  private extractStoryWindow(text: string): string {
    const normalized = text.trim();
    if (!normalized) {
      return '';
    }

    const maxChars = 12000;
    if (normalized.length <= maxChars) {
      return normalized;
    }
    return normalized.slice(normalized.length - maxChars);
  }

  async continueStoryWithContext(): Promise<void> {
    if (this.generationInFlight) {
      new Notice('LoreVault generation is already running.');
      return;
    }

    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView) {
      new Notice('No active markdown editor found.');
      return;
    }

    const editor = markdownView.editor;
    const activeFile = markdownView.file ?? this.app.workspace.getActiveFile();
    const cursor = editor.getCursor();
    const textBeforeCursor = editor.getRange({ line: 0, ch: 0 }, cursor);
    const queryText = this.extractQueryWindow(textBeforeCursor);
    const fallbackQuery = activeFile?.basename ?? 'story continuation';
    const scopedQuery = queryText || fallbackQuery;
    const frontmatterScopes = this.resolveStoryScopesFromFrontmatter(activeFile);
    const fallbackScope = this.resolveScopeFromActiveFile(activeFile) ?? normalizeScope(this.settings.tagScoping.activeScope);
    const scopesToQuery = frontmatterScopes.length > 0
      ? frontmatterScopes
      : (fallbackScope ? [fallbackScope] : []);
    const targetScopes = scopesToQuery.length > 0 ? scopesToQuery : [''];
    const targetScopeLabels = targetScopes.map(scope => scope || '(all)');
    const initialScopeLabel = this.renderScopeListLabel(targetScopeLabels);

    try {
      this.generationInFlight = true;
      this.generationAbortController = new AbortController();
      if (!this.settings.completion.enabled) {
        new Notice('Writing completion is disabled. Enable it under LoreVault Settings → Writing Completion.');
        return;
      }
      if (this.settings.completion.provider !== 'ollama' && !this.settings.completion.apiKey) {
        new Notice('Missing completion API key. Configure it under LoreVault Settings → Writing Completion.');
        return;
      }

      const completion = this.settings.completion;
      const startedAt = Date.now();
      this.updateGenerationTelemetry({
        ...this.createDefaultGenerationTelemetry(),
        state: 'preparing',
        statusText: 'preparing',
        startedAt,
        updatedAt: startedAt,
        provider: completion.provider,
        model: completion.model,
        scopes: targetScopeLabels,
        contextWindowTokens: completion.contextWindowTokens,
        maxInputTokens: Math.max(512, completion.contextWindowTokens - completion.maxOutputTokens),
        promptReserveTokens: completion.promptReserveTokens,
        maxOutputTokens: completion.maxOutputTokens
      });
      this.setGenerationStatus(`preparing | scopes ${initialScopeLabel}`, 'busy');

      const maxInputTokens = Math.max(512, completion.contextWindowTokens - completion.maxOutputTokens);
      const initialStoryWindow = this.extractStoryWindow(textBeforeCursor);
      const instructionOverhead = this.estimateTokens(completion.systemPrompt) + 180;
      const baselineStoryTarget = Math.max(256, Math.floor(maxInputTokens * 0.45));
      const maxStoryTokensForContext = Math.max(
        64,
        maxInputTokens - completion.promptReserveTokens - instructionOverhead - 128
      );
      const storyTokenTarget = Math.max(64, Math.min(baselineStoryTarget, maxStoryTokensForContext));
      let storyWindow = this.trimTextToTokenBudget(initialStoryWindow, storyTokenTarget);
      let storyTokens = this.estimateTokens(storyWindow);
      let availableForContext = maxInputTokens - completion.promptReserveTokens - instructionOverhead - storyTokens;

      if (availableForContext < 128 && initialStoryWindow.trim().length > 0) {
        const reducedStoryBudget = Math.max(
          64,
          maxInputTokens - completion.promptReserveTokens - instructionOverhead - 96
        );
        storyWindow = this.trimTextToTokenBudget(initialStoryWindow, reducedStoryBudget);
        storyTokens = this.estimateTokens(storyWindow);
        availableForContext = maxInputTokens - completion.promptReserveTokens - instructionOverhead - storyTokens;
      }

      let chapterMemoryMarkdown = '';
      let chapterMemoryTokens = 0;
      let chapterMemoryItems: string[] = [];
      let chapterMemoryLayerTrace: string[] = [];
      if (availableForContext > 96 && activeFile) {
        const chapterMemoryBudget = Math.min(
          900,
          Math.max(96, Math.floor(Math.max(0, availableForContext) * 0.3))
        );
        const chapterMemory = await this.buildChapterMemoryContext(activeFile, chapterMemoryBudget);
        chapterMemoryMarkdown = chapterMemory.markdown;
        chapterMemoryTokens = chapterMemory.usedTokens;
        chapterMemoryItems = chapterMemory.items;
        chapterMemoryLayerTrace = chapterMemory.layerTrace;
        availableForContext -= chapterMemoryTokens;
      }
      availableForContext = Math.max(64, availableForContext);

      let contextBudget = Math.min(
        this.settings.defaultLoreBook.tokenBudget,
        Math.max(64, availableForContext)
      );
      this.updateGenerationTelemetry({
        state: 'retrieving',
        statusText: 'retrieving',
        scopes: targetScopeLabels,
        maxInputTokens,
        promptReserveTokens: completion.promptReserveTokens,
        estimatedInstructionTokens: instructionOverhead,
        storyTokens,
        contextRemainingTokens: Math.max(0, availableForContext),
        contextUsedTokens: chapterMemoryTokens
      });
      this.setGenerationStatus(
        `retrieving | scopes ${initialScopeLabel} | ctx ${Math.max(0, availableForContext)} left`,
        'busy'
      );

      let contexts: AssembledContext[] = [];
      let remainingInputTokens = 0;
      let usedContextTokens = 0;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const perScopeBudget = Math.max(64, Math.floor(contextBudget / Math.max(1, targetScopes.length)));
        contexts = [];
        for (const scope of targetScopes) {
          contexts.push(await this.liveContextIndex.query({
            queryText: scopedQuery,
            tokenBudget: perScopeBudget
          }, scope));
        }

        usedContextTokens = contexts.reduce((sum, item) => sum + item.usedTokens, 0);
        remainingInputTokens = maxInputTokens - completion.promptReserveTokens - instructionOverhead - storyTokens - usedContextTokens;
        if (remainingInputTokens >= 0 || contextBudget <= 64) {
          break;
        }

        const nextBudget = Math.max(64, contextBudget + remainingInputTokens - 48);
        if (nextBudget === contextBudget) {
          break;
        }
        contextBudget = nextBudget;
      }

      const selectedScopeLabels = contexts.map(item => item.scope || '(all)');
      const combinedContextMarkdown = contexts
        .map(item => item.markdown)
        .join('\n\n---\n\n');
      const totalWorldInfo = contexts.reduce((sum, item) => sum + item.worldInfo.length, 0);
      const totalRag = contexts.reduce((sum, item) => sum + item.rag.length, 0);
      const worldInfoDetails = contexts
        .flatMap(item => item.worldInfo.slice(0, 6).map(entry => entry.entry.comment))
        .slice(0, 8);
      const ragDetails = contexts
        .flatMap(item => item.rag.slice(0, 6).map(entry => entry.document.title))
        .slice(0, 8);
      const ragPolicies = [...new Set(contexts.map(context => context.explainability.rag.policy))];
      const ragEnabledScopes = contexts.filter(context => context.explainability.rag.enabled).length;
      const contextLayerTrace: string[] = [
        `local_window: ~${storyTokens} tokens`,
        `chapter_memory: ${chapterMemoryItems.length} summaries, ~${chapterMemoryTokens} tokens`,
        ...chapterMemoryLayerTrace,
        `graph_memory(world_info): ${totalWorldInfo} entries, ~${usedContextTokens} tokens`,
        `fallback_rag: ${totalRag} docs, policy ${ragPolicies.join('/')} (${ragEnabledScopes}/${Math.max(1, contexts.length)} scopes enabled)`
      ];
      const scopeLabel = this.renderScopeListLabel(selectedScopeLabels);
      this.updateGenerationTelemetry({
        state: 'generating',
        statusText: 'generating',
        scopes: selectedScopeLabels,
        estimatedInstructionTokens: instructionOverhead,
        storyTokens,
        contextUsedTokens: usedContextTokens + chapterMemoryTokens,
        contextRemainingTokens: Math.max(0, remainingInputTokens),
        worldInfoCount: totalWorldInfo,
        ragCount: totalRag,
        worldInfoItems: worldInfoDetails,
        ragItems: ragDetails,
        contextLayerTrace,
        generatedTokens: 0,
        lastError: ''
      });

      this.setGenerationStatus(
        `generating | scopes ${scopeLabel} | ctx ${Math.max(0, remainingInputTokens)} left | out ~0/${completion.maxOutputTokens}`,
        'busy'
      );
      new Notice(
        [
          `LoreVault generating for scopes: ${scopeLabel}`,
          `Provider: ${completion.provider} (${completion.model})`,
          `Context window left: ${Math.max(0, remainingInputTokens)} tokens`,
          `chapter memory: ${chapterMemoryItems.join(', ') || '(none)'}`,
          `world_info: ${worldInfoDetails.join(', ') || '(none)'}`,
          `rag: ${ragDetails.join(', ') || '(none)'}`,
          `layers: ${contextLayerTrace.join(' | ')}`
        ].join('\n')
      );
      const userPrompt = [
        'Continue the story from where it currently ends.',
        'Respect the lore context as canon constraints.',
        'Output only the continuation text.',
        '',
        '<story_chapter_memory>',
        chapterMemoryMarkdown || '[No prior chapter memory available.]',
        '</story_chapter_memory>',
        '',
        `<lorevault_scopes>${selectedScopeLabels.join(', ')}</lorevault_scopes>`,
        '',
        '<lorevault_context>',
        combinedContextMarkdown,
        '</lorevault_context>',
        '',
        '<story_so_far>',
        storyWindow || '[No story text yet. Start the scene naturally.]',
        '</story_so_far>'
      ].join('\n');

      let insertPos = cursor;
      if (cursor.ch !== 0) {
        editor.replaceRange('\n', insertPos);
        const offset = editor.posToOffset(insertPos) + 1;
        insertPos = editor.offsetToPos(offset);
      }

      let generatedText = '';
      let lastStatusUpdate = 0;

      await requestStoryContinuationStream(completion, {
        systemPrompt: completion.systemPrompt,
        userPrompt,
        onDelta: (delta: string) => {
          if (!delta) {
            return;
          }

          editor.replaceRange(delta, insertPos);
          const nextOffset = editor.posToOffset(insertPos) + delta.length;
          insertPos = editor.offsetToPos(nextOffset);
          generatedText += delta;

          const now = Date.now();
          if (now - lastStatusUpdate >= 250) {
            lastStatusUpdate = now;
            const outTokens = this.estimateTokens(generatedText);
            this.updateGenerationTelemetry({
              generatedTokens: outTokens,
              statusText: 'generating'
            });
            this.setGenerationStatus(
              `generating | scopes ${scopeLabel} | ctx ${Math.max(0, remainingInputTokens)} left | out ~${outTokens}/${completion.maxOutputTokens}`,
              'busy'
            );
          }
        },
        abortSignal: this.generationAbortController.signal
      });

      if (!generatedText.trim()) {
        throw new Error('Completion provider returned empty output.');
      }
      editor.replaceRange('\n', insertPos);
      const generatedTokens = this.estimateTokens(generatedText);
      this.updateGenerationTelemetry({
        state: 'idle',
        statusText: 'idle',
        scopes: selectedScopeLabels,
        contextUsedTokens: usedContextTokens + chapterMemoryTokens,
        contextRemainingTokens: Math.max(0, remainingInputTokens),
        generatedTokens,
        worldInfoCount: totalWorldInfo,
        ragCount: totalRag,
        worldInfoItems: worldInfoDetails,
        ragItems: ragDetails,
        contextLayerTrace,
        lastError: ''
      });
      new Notice(
        `Inserted continuation for ${selectedScopeLabels.length} scope(s) (${totalWorldInfo} world_info, ${totalRag} rag, ~${generatedTokens} output tokens).`
      );
      this.setGenerationStatus('idle', 'idle');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateGenerationTelemetry({
        state: 'error',
        statusText: 'error',
        lastError: message
      });
      this.setGenerationStatus('error', 'error');
      console.error('Continue Story with Context failed:', error);
      new Notice(`Continue Story with Context failed: ${message}`);
    } finally {
      this.generationInFlight = false;
      this.generationAbortController = null;
      if (this.generationStatusLevel === 'error') {
        window.setTimeout(() => {
          if (!this.generationInFlight && this.generationStatusLevel === 'error') {
            this.setGenerationStatus('idle', 'idle');
          }
        }, 2500);
      }
    }
  }

  // This is the main conversion function
  async convertToLorebook(scopeOverride?: string) {
    try {
      const files = this.app.vault.getMarkdownFiles();
      const explicitScope = normalizeScope(scopeOverride ?? this.settings.tagScoping.activeScope);
      const discoveredScopes = this.discoverAllScopes(files);
      const buildAllScopes = explicitScope.length === 0 && discoveredScopes.length > 0;
      const scopesToBuild = explicitScope
        ? [explicitScope]
        : (discoveredScopes.length > 0 ? discoveredScopes : ['']);

      const baseOutputPath = this.getBaseOutputPath();
      const worldInfoExporter = new LoreBookExporter(this.app);
      const ragExporter = new RagExporter(this.app);
      const sqliteExporter = new SqlitePackExporter(this.app);
      const sqliteReader = new SqlitePackReader(this.app);
      const embeddingService = this.settings.embeddings.enabled
        ? new EmbeddingService(this.app, this.settings.embeddings)
        : null;
      const scopeAssignments: ScopeOutputAssignment[] = scopesToBuild.map(scope => ({
        scope,
        paths: resolveScopeOutputPaths(
          baseOutputPath,
          scope,
          buildAllScopes,
          this.settings.sqlite.outputPath
        )
      }));

      assertUniqueOutputPaths(scopeAssignments, {
        includeSqlite: this.settings.sqlite.enabled
      });

      for (const assignment of scopeAssignments) {
        const { scope, paths } = assignment;
        const progress = new ProgressBar(
          files.length + 7, // files + graph + chunks + embeddings + sqlite + sqlite-read + world_info + rag
          `Building LoreVault scope: ${scope || '(all)'}`
        );

        const scopePackResult = await buildScopePack(
          this.app,
          this.settings,
          scope,
          files,
          buildAllScopes,
          embeddingService,
          progress
        );

        const scopedSettings = scopePackResult.scopedSettings;
        let worldInfoEntries = scopePackResult.pack.worldInfoEntries;
        let ragDocuments = scopePackResult.pack.ragDocuments;

        if (this.settings.sqlite.enabled) {
          progress.setStatus(`Scope ${scope || '(all)'}: exporting canonical SQLite pack...`);
          await sqliteExporter.exportScopePack(scopePackResult.pack, paths.sqlitePath);
          progress.update();

          progress.setStatus(`Scope ${scope || '(all)'}: reading exports from SQLite pack...`);
          const readPack = await sqliteReader.readScopePack(paths.sqlitePath);
          worldInfoEntries = readPack.worldInfoEntries;
          ragDocuments = readPack.ragDocuments;
          progress.update();
        }

        progress.setStatus(`Scope ${scope || '(all)'}: exporting world_info JSON...`);
        await worldInfoExporter.exportLoreBookJson(
          this.mapEntriesByUid(worldInfoEntries),
          paths.worldInfoPath,
          scopedSettings
        );
        progress.update();

        progress.setStatus(`Scope ${scope || '(all)'}: exporting RAG markdown...`);
        await ragExporter.exportRagMarkdown(ragDocuments, paths.ragPath, scope || '(all)');
        progress.update();

        progress.success(
          `Scope ${scope || '(all)'} complete: ${worldInfoEntries.length} world_info entries, ${ragDocuments.length} rag docs.`
        );
      }

      new Notice(`LoreVault build complete for ${scopesToBuild.length} scope(s).`);
      this.liveContextIndex.requestFullRefresh();
      this.refreshManagerViews();
      this.refreshRoutingDebugViews();
      this.refreshQuerySimulationViews();
      this.refreshStoryChatViews();
    } catch (error) {
      console.error('Conversion failed:', error);
      new Notice(`Conversion failed: ${error.message}`);
    }
  }
}
