import { App } from 'obsidian';
import { LoreBookEntry, LoreBook, ConverterSettings } from './models';
import {
  ensureParentVaultFolderForFile,
  normalizeVaultRelativePath
} from './vault-path-utils';

export class LoreBookExporter {
  private app: App;
  
  constructor(app: App) {
    this.app = app;
  }
  
  async exportLoreBookJson(
    entries: {[key: number]: LoreBookEntry}, 
    outputPath: string,
    settings: ConverterSettings
  ): Promise<void> {
    const normalizedOutputPath = normalizeVaultRelativePath(outputPath);

    // Create entries dictionary with string keys and remove wikilinks
    const entriesDict: {[key: string]: Omit<LoreBookEntry, 'wikilinks'>} = {};
    
    for (const [uid, entry] of Object.entries(entries)) {
      const { wikilinks, ...entryWithoutWikilinks } = entry;
      const normalizedEntry = { ...entryWithoutWikilinks };
      
      // Apply default entry settings for any entries that haven't set these properties yet
      // Only apply defaults for trigger methods if NONE are set to true
      if (!normalizedEntry.constant && !normalizedEntry.vectorized && !normalizedEntry.selective) {
        // Apply default trigger method from settings
        normalizedEntry.constant = settings.defaultEntry.constant;
        normalizedEntry.vectorized = settings.defaultEntry.vectorized;
        normalizedEntry.selective = settings.defaultEntry.selective;
      } else {
        // Ensure only one trigger method is active
        // If multiple are somehow true, prioritize in this order: constant > vectorized > selective
        if (normalizedEntry.constant) {
          normalizedEntry.vectorized = false;
          normalizedEntry.selective = false;
        } else if (normalizedEntry.vectorized) {
          normalizedEntry.constant = false;
          normalizedEntry.selective = false;
        } else if (normalizedEntry.selective) {
          normalizedEntry.constant = false;
          normalizedEntry.vectorized = false;
        }
      }
      
      // Apply other defaults
      if (normalizedEntry.selectiveLogic === undefined) {
        normalizedEntry.selectiveLogic = settings.defaultEntry.selectiveLogic;
      }
      if (normalizedEntry.probability === undefined) {
        normalizedEntry.probability = settings.defaultEntry.probability;
      }
      if (normalizedEntry.depth === undefined) {
        normalizedEntry.depth = settings.defaultEntry.depth;
      }
      if (normalizedEntry.groupWeight === undefined) {
        normalizedEntry.groupWeight = settings.defaultEntry.groupWeight;
      }
      
      entriesDict[uid] = normalizedEntry;
    }
    
    // Create the lorebook structure with default settings
    const lorebook: LoreBook = {
      entries: entriesDict as any, // Type assertion to satisfy TypeScript
      settings: {
        orderByTitle: settings.defaultLoreBook.orderByTitle,
        useDroste: settings.defaultLoreBook.useDroste,
        useRecursion: settings.defaultLoreBook.useRecursion,
        tokenBudget: settings.defaultLoreBook.tokenBudget,
        recursionBudget: settings.defaultLoreBook.recursionBudget
      }
    };
    
    try {
      await ensureParentVaultFolderForFile(this.app, normalizedOutputPath);
      await this.app.vault.adapter.write(
        normalizedOutputPath,
        JSON.stringify(lorebook, null, 2)
      );
      
      console.log(`Successfully exported ${Object.keys(entries).length} entries to ${normalizedOutputPath}`);
    } catch (e) {
      console.error(`Error writing JSON to ${normalizedOutputPath}:`, e);
      throw e;
    }
  }
}
