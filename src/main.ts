import { App, Plugin, Notice, addIcon } from 'obsidian';
import { ConverterSettings, DEFAULT_SETTINGS } from './models';
import { ProgressBar } from './progress-bar';
import { createTemplate } from './template-creator';
import { FileProcessor } from './file-processor';
import { GraphAnalyzer } from './graph-analyzer';
import { LoreBookExporter } from './lorebook-exporter'; 
import { LoreBookConverterSettingTab } from './settings-tab';

export default class LoreBookConverterPlugin extends Plugin {
  settings: ConverterSettings;

  async onload() {
    await this.loadSettings();

    // Add custom icon
    addIcon('lorebook', `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path fill="currentColor" d="M25,10 L80,10 C85,10 90,15 90,20 L90,80 C90,85 85,90 80,90 L25,90 C20,90 15,85 15,80 L15,20 C15,15 20,10 25,10 Z M25,20 L25,80 L80,80 L80,20 Z M35,30 L70,30 L70,35 L35,35 Z M35,45 L70,45 L70,50 L35,50 Z M35,60 L70,60 L70,65 L35,65 Z"/>
    </svg>`);

    // Add settings tab
    this.addSettingTab(new LoreBookConverterSettingTab(this.app, this));

    // Add ribbon icon
    this.addRibbonIcon('lorebook', 'Convert to Lorebook', () => {
      this.convertToLorebook();
    });

    // Add command
    this.addCommand({
      id: 'convert-to-lorebook',
      name: 'Convert Vault to Lorebook',
      callback: () => {
        this.convertToLorebook();
      }
    });
    
    // Add template creation command
    this.addCommand({
      id: 'create-lorebook-template',
      name: 'Create Lorebook Entry Template',
      callback: async () => {
        try {
          const template = await createTemplate(this.app);
          
          // Check if there's an active file
          const activeFile = this.app.workspace.getActiveFile();
          
          if (activeFile) {
            // If there's an active file, replace its content
            await this.app.vault.modify(activeFile, template);
            new Notice(`Template applied to ${activeFile.name}`);
          } else {
            // Otherwise create a new file
            const fileName = `Lorebook_Entry_${Date.now()}.md`;
            await this.app.vault.create(fileName, template);
            new Notice(`Created new template: ${fileName}`);
          }
        } catch (error) {
          console.error('Template creation cancelled', error);
        }
      }
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
  
  // This is the main conversion function
  async convertToLorebook() {
    try {
      // Initialize processors
      const fileProcessor = new FileProcessor(this.app);
      
      // Stage 1: Count files and initialize progress
      const files = this.app.vault.getMarkdownFiles();
      const progress = new ProgressBar(
        files.length + 2, // Files + graph building + exporting
        'Analyzing vault structure...'
      );
      
      // Stage 2: Find root file
      await fileProcessor.findRootFile(progress);
      
      // Stage 3: Process all files
      await fileProcessor.processFiles(files, progress);
      
      // Stage 4: Build graph
      progress.setStatus('Building relationship graph...');
      const graphAnalyzer = new GraphAnalyzer(
        fileProcessor.getEntries(),
        fileProcessor.getFilenameToUid(),
        this.settings,
        fileProcessor.getRootUid()
      );
      graphAnalyzer.buildGraph();
      progress.update();
      
      // Stage 5: Calculate priorities
      progress.setStatus('Calculating entry priorities...');
      graphAnalyzer.calculateEntryPriorities();
      
      // Stage 6: Export JSON
      progress.setStatus('Exporting to JSON...');
      const outputPath = this.settings.outputPath || 
                        `${this.app.vault.getName()}.json`;
      
      const exporter = new LoreBookExporter(this.app);
      await exporter.exportLoreBookJson(fileProcessor.getEntries(), outputPath);
      progress.update();
      
      // Complete
      progress.success(`Conversion complete! Processed ${Object.keys(fileProcessor.getEntries()).length} entries.`);
    } catch (error) {
      console.error('Conversion failed:', error);
      new Notice(`Conversion failed: ${error.message}`);
    }
  }
}