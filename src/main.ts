import { App, MarkdownView, Plugin, Notice, TFile, addIcon, getAllTags } from 'obsidian';
import { ConverterSettings, DEFAULT_SETTINGS, LoreBookEntry } from './models';
import { ProgressBar } from './progress-bar';
import { createTemplate } from './template-creator';
import { LoreBookExporter } from './lorebook-exporter'; 
import { LoreBookConverterSettingTab } from './settings-tab';
import { extractLorebookScopesFromTags, normalizeScope, normalizeTagPrefix } from './lorebook-scoping';
import { RagExporter } from './rag-exporter';
import { LOREVAULT_MANAGER_VIEW_TYPE, LorebooksManagerView } from './lorebooks-manager-view';
import { LiveContextIndex } from './live-context-index';
import { EmbeddingService } from './embedding-service';
import { requestStoryContinuation } from './completion-provider';
import { parseStoryScopesFromFrontmatter } from './story-scope-selector';
import {
  assertUniqueOutputPaths,
  ScopeOutputAssignment,
  resolveScopeOutputPaths
} from './scope-output-paths';
import { buildScopePack } from './scope-pack-builder';
import { SqlitePackExporter } from './sqlite-pack-exporter';
import { SqlitePackReader } from './sqlite-pack-reader';
import * as path from 'path';
import { FrontmatterData, normalizeFrontmatter } from './frontmatter-utils';

export default class LoreBookConverterPlugin extends Plugin {
  settings: ConverterSettings;
  liveContextIndex: LiveContextIndex;

  private getBaseOutputPath(): string {
    return this.settings.outputPath?.trim() || DEFAULT_SETTINGS.outputPath;
  }

  private getSQLiteOutputRootPath(): string {
    const configured = this.settings.sqlite.outputPath?.trim() || DEFAULT_SETTINGS.sqlite.outputPath;
    const hasDbExtension = path.extname(configured).toLowerCase() === '.db';
    let outputRoot = hasDbExtension ? path.dirname(configured) : configured;
    outputRoot = outputRoot.trim() || '.';

    if (outputRoot.includes('{scope}')) {
      outputRoot = outputRoot.replace(/\{scope\}/g, 'root');
    }

    return outputRoot;
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
      completion: {
        ...DEFAULT_SETTINGS.completion,
        ...(data?.completion ?? {})
      }
    };

    merged.tagScoping.tagPrefix = normalizeTagPrefix(merged.tagScoping.tagPrefix) || DEFAULT_SETTINGS.tagScoping.tagPrefix;
    merged.tagScoping.activeScope = normalizeScope(merged.tagScoping.activeScope);
    merged.tagScoping.membershipMode = merged.tagScoping.membershipMode === 'cascade' ? 'cascade' : 'exact';
    merged.tagScoping.includeUntagged = Boolean(merged.tagScoping.includeUntagged);
    merged.outputPath = merged.outputPath.trim();
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
    merged.completion.timeoutMs = Math.max(1000, Math.floor(merged.completion.timeoutMs));

    return merged;
  }

  async onload() {
    // Load the settings
    this.settings = this.mergeSettings(await this.loadData());
    this.liveContextIndex = new LiveContextIndex(this.app, () => this.settings);
    this.registerView(LOREVAULT_MANAGER_VIEW_TYPE, leaf => new LorebooksManagerView(leaf, this));

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

    // Add settings tab
    this.addSettingTab(new LoreBookConverterSettingTab(this.app, this));

    // Add ribbon icon
    this.addRibbonIcon('lorevault-build', 'Build Active Lorebook Scope', () => {
      void this.buildActiveScopeExport();
    });

    this.addRibbonIcon('lorevault-manager', 'Open LoreVault Manager', () => {
      void this.openLorebooksManagerView();
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
      id: 'continue-story-with-context',
      name: 'Continue Story with Context',
      callback: async () => {
        await this.continueStoryWithContext();
      }
    });
    
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
      this.refreshManagerViews();
    }));

    this.registerEvent(this.app.vault.on('modify', file => {
      this.liveContextIndex.markFileChanged(file);
      this.refreshManagerViews();
    }));

    this.registerEvent(this.app.vault.on('delete', file => {
      this.liveContextIndex.markFileChanged(file);
      this.refreshManagerViews();
    }));

    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.liveContextIndex.markRenamed(file, oldPath);
      this.refreshManagerViews();
    }));

    void this.liveContextIndex.initialize().catch(error => {
      console.error('Failed to initialize live context index:', error);
    });
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(LOREVAULT_MANAGER_VIEW_TYPE);
  }

  async saveData(settings: any) {
    this.settings = this.mergeSettings(settings as Partial<ConverterSettings>);
    await super.saveData(this.settings);
    this.liveContextIndex?.requestFullRefresh();
    this.refreshManagerViews();
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

  private prepareInsertText(cursorCh: number, continuation: string): string {
    const body = continuation.trim();
    if (!body) {
      return '';
    }

    if (cursorCh === 0) {
      return `${body}\n`;
    }
    return `\n${body}\n`;
  }

  async continueStoryWithContext(): Promise<void> {
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
    const storyWindow = this.extractStoryWindow(textBeforeCursor);
    const fallbackQuery = activeFile?.basename ?? 'story continuation';
    const scopedQuery = queryText || fallbackQuery;
    const frontmatterScopes = this.resolveStoryScopesFromFrontmatter(activeFile);
    const fallbackScope = this.resolveScopeFromActiveFile(activeFile) ?? normalizeScope(this.settings.tagScoping.activeScope);
    const scopesToQuery = frontmatterScopes.length > 0
      ? frontmatterScopes
      : (fallbackScope ? [fallbackScope] : []);

    try {
      if (!this.settings.completion.enabled) {
        new Notice('Writing completion is disabled. Enable it under LoreVault Settings → Writing Completion.');
        return;
      }
      if (this.settings.completion.provider !== 'ollama' && !this.settings.completion.apiKey) {
        new Notice('Missing completion API key. Configure it under LoreVault Settings → Writing Completion.');
        return;
      }

      const perScopeBudget = Math.max(
        128,
        Math.floor(this.settings.defaultLoreBook.tokenBudget / Math.max(1, scopesToQuery.length || 1))
      );
      const contexts = [];

      if (scopesToQuery.length === 0) {
        contexts.push(await this.liveContextIndex.query({
          queryText: scopedQuery,
          tokenBudget: perScopeBudget
        }));
      } else {
        for (const scope of scopesToQuery) {
          contexts.push(await this.liveContextIndex.query({
            queryText: scopedQuery,
            tokenBudget: perScopeBudget
          }, scope));
        }
      }

      const selectedScopeLabels = contexts.map(item => item.scope || '(all)');
      const combinedContextMarkdown = contexts
        .map(item => item.markdown)
        .join('\n\n---\n\n');
      const totalWorldInfo = contexts.reduce((sum, item) => sum + item.worldInfo.length, 0);
      const totalRag = contexts.reduce((sum, item) => sum + item.rag.length, 0);

      new Notice(`Generating continuation for ${selectedScopeLabels.length} scope(s)...`);
      const userPrompt = [
        'Continue the story from where it currently ends.',
        'Respect the lore context as canon constraints.',
        'Output only the continuation text.',
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

      const completion = await requestStoryContinuation(this.settings.completion, {
        systemPrompt: this.settings.completion.systemPrompt,
        userPrompt
      });
      const insertText = this.prepareInsertText(cursor.ch, completion);
      if (!insertText.trim()) {
        throw new Error('Completion provider returned empty output.');
      }

      editor.replaceRange(insertText, cursor);
      new Notice(
        `Inserted continuation for ${selectedScopeLabels.length} scope(s) (${totalWorldInfo} world_info, ${totalRag} rag).`
      );
    } catch (error) {
      console.error('Continue Story with Context failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Continue Story with Context failed: ${message}`);
    }
  }

  async openOutputFolder(): Promise<void> {
    const outputPath = this.getSQLiteOutputRootPath();
    const adapter = this.app.vault.adapter as any;
    const isAbsolute = path.isAbsolute(outputPath);

    let folderPath = isAbsolute ? path.dirname(outputPath) : '.';
    if (!isAbsolute) {
      if (typeof adapter.getBasePath === 'function') {
        const vaultRoot = adapter.getBasePath() as string;
        const relativeDir = path.dirname(outputPath);
        folderPath = relativeDir === '.' ? vaultRoot : path.join(vaultRoot, relativeDir);
      } else {
        throw new Error('Unable to resolve vault base path for relative output folders.');
      }
    }

    const electron = (window as any).require?.('electron');
    if (!electron?.shell?.openPath) {
      throw new Error('Electron shell API unavailable.');
    }

    const openResult = await electron.shell.openPath(folderPath);
    if (openResult) {
      throw new Error(openResult);
    }

    new Notice(`Opened output folder: ${folderPath}`);
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
    } catch (error) {
      console.error('Conversion failed:', error);
      new Notice(`Conversion failed: ${error.message}`);
    }
  }
}
