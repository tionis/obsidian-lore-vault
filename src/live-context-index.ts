import { App, TAbstractFile, TFile, getAllTags } from 'obsidian';
import { ConverterSettings } from './models';
import { extractLorebookScopesFromTags, normalizeScope, shouldIncludeInScope } from './lorebook-scoping';
import { FileProcessor } from './file-processor';
import { GraphAnalyzer } from './graph-analyzer';
import { ProgressBar } from './progress-bar';
import { ScopeContextPack, AssembledContext, ContextQueryOptions, assembleScopeContext } from './context-query';
import { collectLorebookNoteMetadata } from './lorebooks-manager-collector';

interface RefreshTask {
  changedPaths: Set<string>;
}

function sortRagDocs<T extends { path: string; title: string; uid: number }>(a: T, b: T): number {
  return (
    a.path.localeCompare(b.path) ||
    a.title.localeCompare(b.title) ||
    a.uid - b.uid
  );
}

function createSilentProgress(): ProgressBar {
  return {
    setStatus: () => {},
    update: () => {},
    success: () => {},
    error: () => {},
    close: () => {}
  } as unknown as ProgressBar;
}

function cloneSettings(settings: ConverterSettings): ConverterSettings {
  return {
    ...settings,
    tagScoping: { ...settings.tagScoping },
    weights: { ...settings.weights },
    defaultLoreBook: { ...settings.defaultLoreBook },
    defaultEntry: { ...settings.defaultEntry }
  };
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

  constructor(app: App, getSettings: () => ConverterSettings) {
    this.app = app;
    this.getSettings = getSettings;
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

  private async buildScope(
    scope: string,
    buildAllScopes: boolean,
    files: TFile[],
    settings: ConverterSettings
  ): Promise<ScopeContextPack> {
    const scopedSettings = cloneSettings(settings);
    scopedSettings.tagScoping.activeScope = scope;
    if (buildAllScopes) {
      scopedSettings.tagScoping.includeUntagged = false;
    }

    const fileProcessor = new FileProcessor(this.app, scopedSettings);
    await fileProcessor.processFiles(files, createSilentProgress());

    const graphAnalyzer = new GraphAnalyzer(
      fileProcessor.getEntries(),
      fileProcessor.getFilenameToUid(),
      scopedSettings,
      fileProcessor.getRootUid()
    );
    graphAnalyzer.buildGraph();
    graphAnalyzer.calculateEntryPriorities();

    const worldInfoEntries = Object.values(fileProcessor.getEntries()).sort((a, b) => {
      return (
        b.order - a.order ||
        a.uid - b.uid
      );
    });

    const ragDocuments = [...fileProcessor.getRagDocuments()].sort(sortRagDocs);

    return {
      scope,
      worldInfoEntries,
      ragDocuments,
      builtAt: Date.now()
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

  async query(
    options: ContextQueryOptions,
    scopeOverride?: string
  ): Promise<AssembledContext> {
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

    return assembleScopeContext(pack, options);
  }
}
