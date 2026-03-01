import { App, TAbstractFile, TFile, getAllTags } from 'obsidian';
import { ConverterSettings, RagChunk } from './models';
import { extractLorebookScopesFromTags, normalizeScope, shouldIncludeInScope } from './lorebook-scoping';
import { ScopeContextPack, AssembledContext, ContextQueryOptions, SelectedWorldInfoEntry, assembleScopeContext } from './context-query';
import { collectLorebookNoteMetadata } from './lorebooks-manager-collector';
import { buildScopePack } from './scope-pack-builder';
import { EmbeddingService } from './embedding-service';
import { sha256HexAsync } from './hash-utils';
import { CompletionOperationLogger } from './completion-provider';

interface RefreshTask {
  changedPaths: Set<string>;
}

const MAX_WORLDINFO_PARAGRAPHS_PER_ENTRY = 24;
const MIN_WORLDINFO_PARAGRAPH_CHARS = 36;

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function splitParagraphs(bodyText: string): string[] {
  return bodyText
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
}

export class LiveContextIndex {
  private app: App;
  private getSettings: () => ConverterSettings;
  private scopes: Map<string, ScopeContextPack> = new Map();
  private fileScopesByPath: Map<string, string[]> = new Map();
  private task: RefreshTask = { changedPaths: new Set() };
  private refreshTimer: number | null = null;
  private refreshInFlight: Promise<void> | null = null;
  private version = 0;
  private embeddingService: EmbeddingService | null = null;
  private embeddingSignature = '';
  private onEmbeddingOperationLog: CompletionOperationLogger | undefined;

  constructor(
    app: App,
    getSettings: () => ConverterSettings,
    onEmbeddingOperationLog?: CompletionOperationLogger
  ) {
    this.app = app;
    this.getSettings = getSettings;
    this.onEmbeddingOperationLog = onEmbeddingOperationLog;
  }

  async initialize(): Promise<void> {
    await this.rebuildAllScopes();
  }

  markFileChanged(fileOrPath: TAbstractFile | string | null | undefined): void {
    if (!fileOrPath) {
      return;
    }

    const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
    if (!path.toLowerCase().endsWith('.md')) {
      return;
    }

    this.task.changedPaths.add(path);
    this.scheduleRefresh();
  }

  markRenamed(file: TAbstractFile | null | undefined, oldPath: string): void {
    this.markFileChanged(file);
    if (oldPath && oldPath.toLowerCase().endsWith('.md')) {
      this.task.changedPaths.add(oldPath);
    }
    this.scheduleRefresh();
  }

  requestFullRefresh(): void {
    this.task.changedPaths.clear();
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    void this.rebuildAllScopes();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.flushRefreshQueue();
    }, 350);
  }

  async flushRefreshQueue(): Promise<void> {
    if (this.refreshInFlight) {
      await this.refreshInFlight;
      return;
    }

    this.refreshInFlight = this.refreshIncremental(this.task.changedPaths);
    this.task.changedPaths = new Set();
    try {
      await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private discoverAllScopes(files: TFile[], settings: ConverterSettings): string[] {
    const scopes = new Set<string>();
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) {
        continue;
      }
      const tags = getAllTags(cache) ?? [];
      const extracted = extractLorebookScopesFromTags(tags, settings.tagScoping.tagPrefix);
      for (const scope of extracted) {
        if (scope) {
          scopes.add(scope);
        }
      }
    }
    return [...scopes].sort((a, b) => a.localeCompare(b));
  }

  private computeScopePlan(settings: ConverterSettings, files: TFile[]): {
    scopesToBuild: string[];
    buildAllScopes: boolean;
  } {
    const explicitScope = normalizeScope(settings.tagScoping.activeScope);
    const discoveredScopes = this.discoverAllScopes(files, settings);
    const buildAllScopes = explicitScope.length === 0 && discoveredScopes.length > 0;
    if (explicitScope) {
      return {
        scopesToBuild: [explicitScope],
        buildAllScopes
      };
    }
    if (discoveredScopes.length > 0) {
      return {
        scopesToBuild: discoveredScopes,
        buildAllScopes
      };
    }
    return {
      scopesToBuild: [''],
      buildAllScopes
    };
  }

  private getEmbeddingSignature(settings: ConverterSettings): string {
    const emb = settings.embeddings;
    return JSON.stringify({
      enabled: emb.enabled,
      provider: emb.provider,
      endpoint: emb.endpoint,
      model: emb.model,
      instruction: emb.instruction,
      batchSize: emb.batchSize,
      timeoutMs: emb.timeoutMs,
      cacheDir: emb.cacheDir,
      chunkingMode: emb.chunkingMode,
      minChunkChars: emb.minChunkChars,
      maxChunkChars: emb.maxChunkChars,
      overlapChars: emb.overlapChars
    });
  }

  private getEmbeddingService(settings: ConverterSettings): EmbeddingService | null {
    if (!settings.embeddings.enabled) {
      this.embeddingService = null;
      this.embeddingSignature = '';
      return null;
    }

    const signature = this.getEmbeddingSignature(settings);
    if (!this.embeddingService || this.embeddingSignature !== signature) {
      this.embeddingService = new EmbeddingService(this.app, settings.embeddings, {
        onOperationLog: this.onEmbeddingOperationLog
      });
      this.embeddingSignature = signature;
    }

    return this.embeddingService;
  }

  private async buildScope(
    scope: string,
    buildAllScopes: boolean,
    files: TFile[],
    settings: ConverterSettings
  ): Promise<ScopeContextPack> {
    const embeddingService = this.getEmbeddingService(settings);
    const result = await buildScopePack(
      this.app,
      settings,
      scope,
      files,
      buildAllScopes,
      embeddingService,
      undefined
    );

    return {
      scope: result.pack.scope,
      worldInfoEntries: result.pack.worldInfoEntries,
      worldInfoBodyByUid: result.worldInfoBodyByUid,
      ragDocuments: result.pack.ragDocuments,
      ragChunks: result.pack.ragChunks,
      ragChunkEmbeddings: result.pack.ragChunkEmbeddings,
      builtAt: result.pack.generatedAt
    };
  }

  private updateFileScopeIndex(settings: ConverterSettings): void {
    const metadata = collectLorebookNoteMetadata(this.app, settings);
    const nextMap = new Map<string, string[]>();

    for (const item of metadata) {
      const included = shouldIncludeInScope(
        item.scopes,
        settings.tagScoping.activeScope,
        settings.tagScoping.membershipMode,
        settings.tagScoping.includeUntagged
      );
      if (!included && settings.tagScoping.activeScope) {
        continue;
      }
      nextMap.set(item.path, item.scopes);
    }

    this.fileScopesByPath = nextMap;
  }

  async rebuildAllScopes(): Promise<void> {
    const settings = this.getSettings();
    const files = this.app.vault.getMarkdownFiles();
    const { scopesToBuild, buildAllScopes } = this.computeScopePlan(settings, files);
    const nextScopes = new Map<string, ScopeContextPack>();

    for (const scope of scopesToBuild) {
      const pack = await this.buildScope(scope, buildAllScopes, files, settings);
      nextScopes.set(scope, pack);
    }

    this.scopes = nextScopes;
    this.updateFileScopeIndex(settings);
    this.version += 1;
  }

  private async refreshIncremental(changedPaths: Set<string>): Promise<void> {
    if (this.scopes.size === 0) {
      await this.rebuildAllScopes();
      return;
    }

    const settings = this.getSettings();
    const files = this.app.vault.getMarkdownFiles();
    const { scopesToBuild, buildAllScopes } = this.computeScopePlan(settings, files);
    const explicitScope = normalizeScope(settings.tagScoping.activeScope);

    if (explicitScope) {
      const pack = await this.buildScope(explicitScope, buildAllScopes, files, settings);
      this.scopes.set(explicitScope, pack);
      this.scopes.forEach((_pack, scope) => {
        if (scope !== explicitScope) {
          this.scopes.delete(scope);
        }
      });
      this.updateFileScopeIndex(settings);
      this.version += 1;
      return;
    }

    if (changedPaths.size === 0) {
      return;
    }

    const currentMetadata = collectLorebookNoteMetadata(this.app, settings);
    const currentScopesByPath = new Map<string, string[]>();
    for (const item of currentMetadata) {
      currentScopesByPath.set(item.path, item.scopes);
    }

    const affectedScopes = new Set<string>();
    for (const changedPath of changedPaths) {
      const previousScopes = this.fileScopesByPath.get(changedPath) ?? [];
      const nextScopes = currentScopesByPath.get(changedPath) ?? [];

      for (const scope of [...previousScopes, ...nextScopes]) {
        const normalized = normalizeScope(scope);
        if (normalized) {
          affectedScopes.add(normalized);
        }
      }
    }

    for (const scope of scopesToBuild) {
      if (!this.scopes.has(scope)) {
        affectedScopes.add(scope);
      }
    }

    if (scopesToBuild.length === 1 && scopesToBuild[0] === '') {
      affectedScopes.add('');
    }

    if (affectedScopes.size === 0) {
      this.updateFileScopeIndex(settings);
      return;
    }

    for (const scope of affectedScopes) {
      if (!scopesToBuild.includes(scope)) {
        continue;
      }
      const pack = await this.buildScope(scope, buildAllScopes, files, settings);
      this.scopes.set(scope, pack);
    }

    for (const existingScope of [...this.scopes.keys()]) {
      if (!scopesToBuild.includes(existingScope)) {
        this.scopes.delete(existingScope);
      }
    }

    this.updateFileScopeIndex(settings);
    this.version += 1;
  }

  getScopes(): string[] {
    return [...this.scopes.keys()].sort((a, b) => a.localeCompare(b));
  }

  getVersion(): number {
    return this.version;
  }

  private async computeWorldInfoSemanticParagraphBoosts(
    pack: ScopeContextPack,
    selectedWorldInfo: SelectedWorldInfoEntry[],
    queryEmbedding: number[],
    embeddingService: EmbeddingService
  ): Promise<{[key: number]: {[paragraphIndex: number]: number}}> {
    const bodyByUid = pack.worldInfoBodyByUid ?? {};
    const chunkToParagraph = new Map<string, {uid: number; paragraphIndex: number}>();
    const chunks: RagChunk[] = [];

    for (const selected of selectedWorldInfo) {
      const uid = selected.entry.uid;
      const bodyText = (bodyByUid[uid] ?? '').trim();
      if (!bodyText) {
        continue;
      }

      const summaryText = selected.entry.content.trim();
      if (summaryText && bodyText === summaryText) {
        continue;
      }

      const paragraphs = splitParagraphs(bodyText);
      if (paragraphs.length === 0) {
        continue;
      }

      let added = 0;
      for (let index = 0; index < paragraphs.length; index += 1) {
        if (added >= MAX_WORLDINFO_PARAGRAPHS_PER_ENTRY) {
          break;
        }

        const paragraph = paragraphs[index];
        if (!paragraph) {
          continue;
        }
        if (index !== 0 && paragraph.length < MIN_WORLDINFO_PARAGRAPH_CHARS) {
          continue;
        }

        const textHash = await sha256HexAsync(paragraph);
        const chunkId = `worldinfo:${uid}:p:${index}:${textHash.slice(0, 12)}`;
        chunks.push({
          chunkId,
          docUid: uid,
          scope: pack.scope,
          path: `world_info/${uid}`,
          title: selected.entry.comment,
          chunkIndex: index,
          heading: '',
          text: paragraph,
          textHash,
          tokenEstimate: estimateTokens(paragraph),
          startOffset: 0,
          endOffset: paragraph.length
        });
        chunkToParagraph.set(chunkId, { uid, paragraphIndex: index });
        added += 1;
      }
    }

    if (chunks.length === 0) {
      return {};
    }

    const embeddings = await embeddingService.embedChunks(chunks);
    const scores = embeddingService.scoreChunks(queryEmbedding, chunks, embeddings);
    const boostsByUid: {[key: number]: {[paragraphIndex: number]: number}} = {};

    for (const scored of scores) {
      if (scored.score <= 0.01) {
        continue;
      }
      const paragraphRef = chunkToParagraph.get(scored.chunkId);
      if (!paragraphRef) {
        continue;
      }
      const byParagraph = boostsByUid[paragraphRef.uid] ?? {};
      const current = byParagraph[paragraphRef.paragraphIndex] ?? 0;
      if (scored.score > current) {
        byParagraph[paragraphRef.paragraphIndex] = scored.score;
      }
      boostsByUid[paragraphRef.uid] = byParagraph;
    }

    return boostsByUid;
  }

  async query(
    options: ContextQueryOptions,
    scopeOverride?: string
  ): Promise<AssembledContext> {
    const { pack } = await this.resolveScopePack(scopeOverride);

    const semanticBoostByDocUid: {[key: number]: number} = {};
    const settings = this.getSettings();
    const embeddingService = this.getEmbeddingService(settings);
    const worldInfoBodyLiftEnabled = options.worldInfoBodyLiftEnabled ?? true;
    let queryEmbedding: number[] | null = null;

    const shouldComputeQueryEmbedding = Boolean(
      embeddingService &&
      options.queryText.trim().length > 0 &&
      (
        (pack.ragChunks.length > 0 && pack.ragChunkEmbeddings.length > 0) ||
        (worldInfoBodyLiftEnabled && Object.keys(pack.worldInfoBodyByUid ?? {}).length > 0)
      )
    );

    if (embeddingService && shouldComputeQueryEmbedding) {
      try {
        queryEmbedding = await embeddingService.embedQuery(options.queryText);
      } catch (error) {
        console.warn('LoreVault: Query embedding failed; continuing without semantic boost.', error);
        queryEmbedding = null;
      }
    }

    if (queryEmbedding && embeddingService && pack.ragChunks.length > 0 && pack.ragChunkEmbeddings.length > 0) {
      const chunkScores = embeddingService.scoreChunks(queryEmbedding, pack.ragChunks, pack.ragChunkEmbeddings);

      for (const chunkScore of chunkScores) {
        // Boost lexical scores using best semantic chunk per document.
        const boost = chunkScore.score * 150;
        const current = semanticBoostByDocUid[chunkScore.docUid] ?? 0;
        if (boost > current) {
          semanticBoostByDocUid[chunkScore.docUid] = boost;
        }
      }
    }

    const resolvedOptions: ContextQueryOptions = {
      ...options,
      maxGraphHops: options.maxGraphHops ?? settings.retrieval.maxGraphHops,
      graphHopDecay: options.graphHopDecay ?? settings.retrieval.graphHopDecay,
      includeBacklinksInGraphExpansion: options.includeBacklinksInGraphExpansion ?? settings.retrieval.includeBacklinksInGraphExpansion,
      ragFallbackPolicy: options.ragFallbackPolicy ?? settings.retrieval.ragFallbackPolicy,
      ragFallbackSeedScoreThreshold: options.ragFallbackSeedScoreThreshold ?? settings.retrieval.ragFallbackSeedScoreThreshold,
      ragSemanticBoostByDocUid: semanticBoostByDocUid
    };

    const firstPass = assembleScopeContext(pack, resolvedOptions);
    if (!queryEmbedding || !embeddingService || !worldInfoBodyLiftEnabled || firstPass.worldInfo.length === 0) {
      return firstPass;
    }

    try {
      const semanticParagraphBoostByUid = await this.computeWorldInfoSemanticParagraphBoosts(
        pack,
        firstPass.worldInfo,
        queryEmbedding,
        embeddingService
      );
      if (Object.keys(semanticParagraphBoostByUid).length === 0) {
        return firstPass;
      }
      return assembleScopeContext(pack, {
        ...resolvedOptions,
        worldInfoBodySemanticBoostByUid: semanticParagraphBoostByUid
      });
    } catch (error) {
      console.warn('World-info semantic excerpt rerank failed; falling back to lexical excerpting.', error);
      return firstPass;
    }
  }

  async getScopePack(scopeOverride?: string): Promise<ScopeContextPack> {
    const { pack } = await this.resolveScopePack(scopeOverride);
    return pack;
  }

  private async resolveScopePack(scopeOverride?: string): Promise<{scope: string; pack: ScopeContextPack}> {
    await this.flushRefreshQueue();
    if (this.scopes.size === 0) {
      await this.rebuildAllScopes();
    }

    const requestedScope = normalizeScope(scopeOverride ?? this.getSettings().tagScoping.activeScope);
    let resolvedScope = requestedScope;
    if (!resolvedScope) {
      resolvedScope = this.getScopes()[0] ?? '';
    }

    if (!this.scopes.has(resolvedScope)) {
      const files = this.app.vault.getMarkdownFiles();
      const settings = this.getSettings();
      const { buildAllScopes } = this.computeScopePlan(settings, files);
      const pack = await this.buildScope(resolvedScope, buildAllScopes, files, settings);
      this.scopes.set(resolvedScope, pack);
    }

    const pack = this.scopes.get(resolvedScope);
    if (!pack) {
      throw new Error(`No context pack for scope "${resolvedScope || '(all)'}".`);
    }

    return {
      scope: resolvedScope,
      pack
    };
  }
}
