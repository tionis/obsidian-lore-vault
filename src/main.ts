import { App, Plugin, Notice, TFile, addIcon, getAllTags } from 'obsidian';
import { ConverterSettings, DEFAULT_SETTINGS } from './models';
import { ProgressBar } from './progress-bar';
import { createTemplate } from './template-creator';
import { FileProcessor } from './file-processor';
import { GraphAnalyzer } from './graph-analyzer';
import { LoreBookExporter } from './lorebook-exporter'; 
import { LoreBookConverterSettingTab } from './settings-tab';
import { extractLorebookScopesFromTags, normalizeScope, normalizeTagPrefix } from './lorebook-scoping';
import { RagExporter } from './rag-exporter';
import {
  assertUniqueOutputPaths,
  ScopeOutputAssignment,
  resolveScopeOutputPaths
} from './scope-output-paths';

export default class LoreBookConverterPlugin extends Plugin {
  settings: ConverterSettings;

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
      }
    };

    merged.tagScoping.tagPrefix = normalizeTagPrefix(merged.tagScoping.tagPrefix) || DEFAULT_SETTINGS.tagScoping.tagPrefix;
    merged.tagScoping.activeScope = normalizeScope(merged.tagScoping.activeScope);
    merged.tagScoping.membershipMode = merged.tagScoping.membershipMode === 'cascade' ? 'cascade' : 'exact';
    merged.tagScoping.includeUntagged = Boolean(merged.tagScoping.includeUntagged);

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

    return merged;
  }

  async onload() {
    // Load the settings
    this.settings = this.mergeSettings(await this.loadData());

    // Add custom icon
    addIcon('lorebook', `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path fill="currentColor" d="M25,10 L80,10 C85,10 90,15 90,20 L90,80 C90,85 85,90 80,90 L25,90 C20,90 15,85 15,80 L15,20 C15,15 20,10 25,10 Z M25,20 L25,80 L80,80 L80,20 Z M35,30 L70,30 L70,35 L35,35 Z M35,45 L70,45 L70,50 L35,50 Z M35,60 L70,60 L70,65 L35,65 Z"/>
    </svg>`);

    // Add settings tab
    this.addSettingTab(new LoreBookConverterSettingTab(this.app, this));

    // Add ribbon icon
    this.addRibbonIcon('lorebook', 'Build LoreVault Export', () => {
      this.convertToLorebook();
    });

    // Add command
    this.addCommand({
      id: 'convert-to-lorebook',
      name: 'Build LoreVault Export',
      callback: () => {
        this.convertToLorebook();
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
  }

  async saveData(settings: any) {
    await super.saveData(settings);
  }
  
  // This is the main conversion function
  async convertToLorebook() {
    try {
      const files = this.app.vault.getMarkdownFiles();
      const explicitScope = normalizeScope(this.settings.tagScoping.activeScope);
      const discoveredScopes = this.discoverAllScopes(files);
      const buildAllScopes = explicitScope.length === 0 && discoveredScopes.length > 0;
      const scopesToBuild = explicitScope
        ? [explicitScope]
        : (discoveredScopes.length > 0 ? discoveredScopes : ['']);

      const baseOutputPath = this.settings.outputPath || `${this.app.vault.getName()}-lorevault.json`;
      const worldInfoExporter = new LoreBookExporter(this.app);
      const ragExporter = new RagExporter(this.app);
      const scopeAssignments: ScopeOutputAssignment[] = scopesToBuild.map(scope => ({
        scope,
        paths: resolveScopeOutputPaths(baseOutputPath, scope, buildAllScopes)
      }));

      assertUniqueOutputPaths(scopeAssignments);

      for (const assignment of scopeAssignments) {
        const { scope, paths } = assignment;
        const scopedSettings = this.mergeSettings({
          ...this.settings,
          tagScoping: {
            ...this.settings.tagScoping,
            activeScope: scope,
            // Avoid duplicating untagged notes in every scope during all-scope builds.
            includeUntagged: buildAllScopes ? false : this.settings.tagScoping.includeUntagged
          }
        });

        const fileProcessor = new FileProcessor(this.app, scopedSettings);
        const progress = new ProgressBar(
          files.length + 3, // Files + graph build + world_info export + rag export
          `Building LoreVault scope: ${scope || '(all)'}`
        );

        progress.setStatus(`Scope ${scope || '(all)'}: processing files...`);
        await fileProcessor.processFiles(files, progress);

        progress.setStatus(`Scope ${scope || '(all)'}: building relationship graph...`);
        const graphAnalyzer = new GraphAnalyzer(
          fileProcessor.getEntries(),
          fileProcessor.getFilenameToUid(),
          scopedSettings,
          fileProcessor.getRootUid()
        );
        graphAnalyzer.buildGraph();
        progress.update();

        progress.setStatus(`Scope ${scope || '(all)'}: calculating world_info priorities...`);
        graphAnalyzer.calculateEntryPriorities();

        progress.setStatus(`Scope ${scope || '(all)'}: exporting world_info JSON...`);
        await worldInfoExporter.exportLoreBookJson(fileProcessor.getEntries(), paths.worldInfoPath, scopedSettings);
        progress.update();

        progress.setStatus(`Scope ${scope || '(all)'}: exporting RAG markdown...`);
        await ragExporter.exportRagMarkdown(fileProcessor.getRagDocuments(), paths.ragPath, scope || '(all)');
        progress.update();

        progress.success(
          `Scope ${scope || '(all)'} complete: ${Object.keys(fileProcessor.getEntries()).length} world_info entries, ${fileProcessor.getRagDocuments().length} rag docs.`
        );
      }

      new Notice(`LoreVault build complete for ${scopesToBuild.length} scope(s).`);
    } catch (error) {
      console.error('Conversion failed:', error);
      new Notice(`Conversion failed: ${error.message}`);
    }
  }
}
