import { App } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import { LoreBookEntry, LoreBook, ConverterSettings } from './models';

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
    // Create entries dictionary with string keys and remove wikilinks
    const entriesDict: {[key: string]: Omit<LoreBookEntry, 'wikilinks'>} = {};
    
    for (const [uid, entry] of Object.entries(entries)) {
      const { wikilinks, ...entryWithoutWikilinks } = entry;
      
      // Apply default entry settings for any entries that haven't set these properties yet
      // This allows user-specified settings in entries to override the defaults
      if (entry.constant === undefined) entry.constant = settings.defaultEntry.constant;
      if (entry.vectorized === undefined) entry.vectorized = settings.defaultEntry.vectorized;
      if (entry.selective === undefined) entry.selective = settings.defaultEntry.selective;
      if (entry.selectiveLogic === undefined) entry.selectiveLogic = settings.defaultEntry.selectiveLogic;
      if (entry.probability === undefined) entry.probability = settings.defaultEntry.probability;
      if (entry.depth === undefined) entry.depth = settings.defaultEntry.depth;
      if (entry.groupWeight === undefined) entry.groupWeight = settings.defaultEntry.groupWeight;
      
      entriesDict[uid] = entryWithoutWikilinks;
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
        await this.app.vault.adapter.write(
          outputPath,
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