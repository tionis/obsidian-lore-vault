import { App, Plugin, Notice, addIcon } from 'obsidian';
import { ConverterSettings, DEFAULT_SETTINGS } from './models';
import { ProgressBar } from './progress-bar';
import { createTemplate } from './template-creator';
import { FileProcessor } from './file-processor';
import { GraphAnalyzer } from './graph-analyzer';
import { LoreBookExporter } from './lorebook-exporter'; 
import { LoreBookConverterSettingTab } from './settings-tab';
import { normalizeScope, normalizeTagPrefix } from './lorebook-scoping';

export default class LoreBookConverterPlugin extends Plugin {
  settings: ConverterSettings;

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
      // Initialize processors
      const fileProcessor = new FileProcessor(this.app, this.settings);
      
      // Stage 1: Count files and initialize progress
      const files = this.app.vault.getMarkdownFiles();
      const progress = new ProgressBar(
        files.length + 2, // Files + graph building + exporting
        'Building LoreVault context...'
      );
      
      // Stage 2: Process files based on lorebook tag scoping rules
      await fileProcessor.processFiles(files, progress);
      
      // Stage 3: Build graph
      progress.setStatus('Building relationship graph...');
      const graphAnalyzer = new GraphAnalyzer(
        fileProcessor.getEntries(),
        fileProcessor.getFilenameToUid(),
        this.settings,
        fileProcessor.getRootUid()
      );
      graphAnalyzer.buildGraph();
      progress.update();
      
      // Stage 4: Calculate priorities
      progress.setStatus('Calculating entry priorities...');
      graphAnalyzer.calculateEntryPriorities();
      
      // Stage 5: Export JSON
      progress.setStatus('Exporting to JSON...');
      const outputPath = this.settings.outputPath || `${this.app.vault.getName()}-lorevault.json`;
      
      const exporter = new LoreBookExporter(this.app);
      await exporter.exportLoreBookJson(fileProcessor.getEntries(), outputPath, this.settings);
      progress.update();
      
      // Complete
      progress.success(`LoreVault build complete. Processed ${Object.keys(fileProcessor.getEntries()).length} entries.`);
    } catch (error) {
      console.error('Conversion failed:', error);
      new Notice(`Conversion failed: ${error.message}`);
    }
  }
}
