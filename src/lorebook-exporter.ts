import { App } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import { LoreBookEntry, LoreBook, ConverterSettings } from './models';
import { ensureParentVaultFolderForFile, normalizeVaultPath } from './vault-path-utils';

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
    const normalizedOutputPath = normalizeVaultPath(outputPath);

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
    
    // Save to file using Electron's fs module (available in Obsidian desktop)
    try {
      // Check if path is absolute or relative
      const isAbsolutePath = path.isAbsolute(outputPath);
      
      if (!isAbsolutePath) {
        // Path is relative to vault - use Obsidian's API
        await ensureParentVaultFolderForFile(this.app, normalizedOutputPath);
        await this.app.vault.adapter.write(
          normalizedOutputPath,
          JSON.stringify(lorebook, null, 2)
        );
      } else {
        // Path is outside the vault - use Node's fs
        const dirPath = path.dirname(outputPath);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
        fs.writeFileSync(outputPath, JSON.stringify(lorebook, null, 2), 'utf8');
      }
      
      console.log(`Successfully exported ${Object.keys(entries).length} entries to ${outputPath}`);
    } catch (e) {
      console.error(`Error writing JSON to ${outputPath}:`, e);
      throw e;
    }
  }
}
