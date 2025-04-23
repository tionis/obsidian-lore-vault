import { App, TFile } from 'obsidian';
import * as path from 'path';
import { LoreBookEntry } from './models';
import { ProgressBar } from './progress-bar';

export class FileProcessor {
  private app: App;
  private filenameToUid: {[key: string]: number} = {};
  private entries: {[key: number]: LoreBookEntry} = {};
  private nextUid: number = 0;
  private rootUid: number | null = null;

  constructor(app: App) {
    this.app = app;
  }

  generateUid(): number {
    const uid = this.nextUid;
    this.nextUid += 1;
    return uid;
  }

  extractWikilinks(content: string): string[] {
    const pattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    const links: string[] = [];
    let match;
    
    while ((match = pattern.exec(content)) !== null) {
      let link = match[1].trim();
      links.push(link);
      
      // Also add the base name
      const base = path.basename(link);
      if (base !== link) {
        links.push(base);
      }
      
      // Add variants with spaces replaced
      if (link.includes(' ')) {
        links.push(link.replace(/ /g, '-'));
        links.push(link.replace(/ /g, '_'));
      }
    }
    
    return [...new Set(links)]; // Remove duplicates
  }

  isValidLoreBookEntry(content: string): boolean {
    return /^# Title:/m.test(content) && 
           /^# Keywords:/m.test(content) && 
           /^# Content:/m.test(content);
  }

  parseDetailedMarkdown(content: string): any {
    // Create an object to store all parsed values
    const parsed: any = {};
    
    // Helper function to get specific predefined tags
    const getTag = (tag: string) => {
      const regex = new RegExp(`^# ${tag}: ?(.+)$`, 'm');
      const match = content.match(regex);
      return match ? match[1].trim() : '';
    };
    
    // Parse standard fields
    parsed.title = getTag('Title');
    parsed.keywords = getTag('Keywords').split(',').map(k => k.trim()).filter(k => k);
    parsed.overview = getTag('Overview');
    parsed.trigger_method = (getTag('Trigger Method') || 'selective').toLowerCase();
    
    // Extract content section
    const contentMatch = content.match(/^# Content:(?:[ \t]*\n)?([\s\S]+)/);
    parsed.content = contentMatch ? contentMatch[1].trim() : content.trim();
    
    // Validate trigger method
    if (!['constant', 'vectorized', 'selective'].includes(parsed.trigger_method)) {
      parsed.trigger_method = 'selective';
    }
    
    // Parse any arbitrary field with format: # fieldName: value
    const arbitraryFieldPattern = /^# ([a-zA-Z0-9_]+): ?(.+)$/gm;
    let fieldMatch;
    while ((fieldMatch = arbitraryFieldPattern.exec(content)) !== null) {
      const fieldName = fieldMatch[1].toLowerCase();
      const fieldValue = fieldMatch[2].trim();
      
      // Skip fields we've already processed
      if (['title', 'keywords', 'overview', 'trigger method', 'content'].includes(fieldName.toLowerCase())) {
        continue;
      }
      
      // Try to convert numeric values
      if (!isNaN(Number(fieldValue))) {
        parsed[fieldName] = Number(fieldValue);
      } else if (fieldValue.toLowerCase() === 'true') {
        parsed[fieldName] = true;
      } else if (fieldValue.toLowerCase() === 'false') {
        parsed[fieldName] = false;
      } else {
        parsed[fieldName] = fieldValue;
      }
    }
    
    // Set default values if not specified
    if (parsed.probability === undefined) parsed.probability = 100;
    if (parsed.depth === undefined) parsed.depth = 4;
    
    // Ensure valid ranges for numeric values
    if (typeof parsed.probability === 'number') {
      parsed.probability = Math.max(0, Math.min(parsed.probability, 100));
    }
    if (typeof parsed.depth === 'number') {
      parsed.depth = Math.max(1, Math.min(parsed.depth, 10));
    }
    
    return parsed;
  }

  async parseMarkdownFile(file: TFile): Promise<LoreBookEntry | null> {
    try {
      const content = await this.app.vault.read(file);
      
      if (!this.isValidLoreBookEntry(content)) {
        return null;
      }
      
      const parsed = this.parseDetailedMarkdown(content);
      const uid = this.generateUid();
      const name = file.basename;
      const folder = file.parent ? file.parent.path : '';
      
      this.filenameToUid[name] = uid;
      const wikilinks = this.extractWikilinks(content);
      
      // Create base entry with default values
      const entry: LoreBookEntry = {
        uid: uid,
        key: [...parsed.keywords, name],
        keysecondary: [],
        comment: parsed.title,
        content: parsed.content,
        constant: parsed.trigger_method === 'constant',
        vectorized: parsed.trigger_method === 'vectorized',
        selective: parsed.trigger_method === 'selective',
        selectiveLogic: 0,
        addMemo: true,
        order: 0,
        position: 0,
        disable: false,
        excludeRecursion: false,
        preventRecursion: false,
        delayUntilRecursion: false,
        probability: parsed.probability,
        useProbability: true,
        depth: parsed.depth,
        group: folder,
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        automationId: "",
        role: null,
        sticky: 0,
        cooldown: 0,
        delay: 0,
        displayIndex: 0,
        wikilinks: wikilinks
      };
      
      // Apply any custom fields from parsing
      for (const [key, value] of Object.entries(parsed)) {
        // Skip fields we've already processed
        if (['title', 'keywords', 'overview', 'trigger_method', 'content', 'probability', 'depth'].includes(key)) {
          continue;
        }
        
        // Check if this key exists in the entry object
        if (key in entry) {
          // Apply the value from the parsed data
          (entry as any)[key] = value;
        }
      }
      
      return entry;
    } catch (e) {
      console.error(`Error processing ${file.path}:`, e);
      return null;
    }
  }

  async findRootFile(progress: ProgressBar): Promise<void> {
    const rootCandidates = ['Root.md', 'root.md', 'index.md', 'World.md', 'world.md'];
    
    for (const rootFile of rootCandidates) {
      const rootFileObj = this.app.vault.getAbstractFileByPath(rootFile);
      
      if (rootFileObj instanceof TFile) {
        progress.setStatus(`Found root file: ${rootFile}`);
        
        try {
          const entry = await this.parseMarkdownFile(rootFileObj);
          if (entry) {
            this.rootUid = entry.uid;
            const baseName = rootFileObj.basename;
            this.filenameToUid[baseName] = entry.uid;
            this.entries[entry.uid] = entry;
          }
        } catch (e) {
          console.error(`Error processing root file ${rootFile}:`, e);
        }
        
        if (this.rootUid !== null) {
          break;
        }
      }
    }
    
    if (this.rootUid !== null) {
      console.log(`Using designated root (UID: ${this.rootUid})`);
    } else {
      console.log("No designated root file found, will determine root based on graph metrics");
    }
  }

  async processFiles(files: TFile[], progress: ProgressBar): Promise<void> {
    const total = files.length;
    let processed = 0;
    
    for (const file of files) {
      // Skip the root file if we already processed it
      if (this.rootUid !== null && 
          this.filenameToUid[file.basename] === this.rootUid) {
        progress.update();
        processed++;
        continue;
      }
      
      progress.setStatus(`Processing file ${processed+1}/${total}: ${file.basename}`);
      
      const entry = await this.parseMarkdownFile(file);
      
      if (entry) {
        const baseName = file.basename;
        this.filenameToUid[baseName] = entry.uid;
        
        // Also store with folder path
        if (file.parent && file.parent.path) {
          const key = `${file.parent.path}/${baseName}`;
          this.filenameToUid[key] = entry.uid;
        }
        
        this.entries[entry.uid] = entry;
      }
      
      // Update progress
      progress.update();
      processed++;
    }
  }
  
  getRootUid(): number | null {
    return this.rootUid;
  }
  
  getFilenameToUid(): {[key: string]: number} {
    return this.filenameToUid;
  }
  
  getEntries(): {[key: number]: LoreBookEntry} {
    return this.entries;
  }
  
  reset(): void {
    this.filenameToUid = {};
    this.entries = {};
    this.nextUid = 0;
    this.rootUid = null;
  }
}