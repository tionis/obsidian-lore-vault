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
    // Check if it has at least one of these tags: title, comment, key, keywords
    // We don't require content tag anymore as we'll use the entire file as content if not specified
    const hasIdentifier = /^# ([Tt]itle|[Cc]omment|[Kk]ey|[Kk]eywords):/m.test(content);
    
    // It's a valid entry if it has at least one identifier tag
    // If no identifier tags, we'll still try to parse it but with lower threshold
    return hasIdentifier || content.trim().length > 0;
  }

  parseDetailedMarkdown(content: string): any {
    // Create an object to store all parsed values
    const parsed: any = {};
    
    // Helper function to get specific predefined tags
    const getTag = (tag: string) => {
      const regex = new RegExp(`^# ${tag}: ?(.+)$`, 'mi'); // Case-insensitive match
      const match = content.match(regex);
      return match ? match[1].trim() : '';
    };
    
    // Try to extract content section first (special case due to multiline nature)
    const contentMatch = content.match(/^# [Cc]ontent:(?:[ \t]*\n)?([\s\S]+?)(?=^#|\s*$)/m);
    
    // If content tag found, use that section. Otherwise use the entire file content
    if (contentMatch && contentMatch[1]) {
      parsed.content = contentMatch[1].trim();
    } else {
      // Check if there are any # tags in the file
      const hasTags = /^# [A-Za-z0-9_]+:/m.test(content);
      
      if (hasTags) {
        // Extract all lines that don't start with a # tag
        const nonTagLines = content.split('\n')
          .filter(line => !line.trim().startsWith('# '))
          .join('\n');
        
        parsed.content = nonTagLines.trim();
      } else {
        // No tags at all, use entire content
        parsed.content = content.trim();
      }
    }
    
    // Process all other fields with format: # fieldName: value
    const arbitraryFieldPattern = /^# ([a-zA-Z0-9_]+): ?(.+?)$/gim; // Case-insensitive, multiline
    let fieldMatch;
    
    // Known array fields that should be parsed as comma-separated values
    const arrayFields = ['key', 'keysecondary', 'keywords'];
    
    while ((fieldMatch = arbitraryFieldPattern.exec(content)) !== null) {
      const fieldName = fieldMatch[1].toLowerCase(); // Convert to lowercase for consistency
      let fieldValue = fieldMatch[2].trim();
      
      // Skip content field as it's handled separately
      if (fieldName === 'content') {
        continue;
      }
      
      // Special handling for array fields
      if (arrayFields.includes(fieldName)) {
        parsed[fieldName] = fieldValue.split(',').map((v: string) => v.trim()).filter((v: string) => v);
        continue;
      }
      
      // Handle value types
      if (!isNaN(Number(fieldValue))) {
        // Convert to number
        parsed[fieldName] = Number(fieldValue);
      } else if (fieldValue.toLowerCase() === 'true') {
        parsed[fieldName] = true;
      } else if (fieldValue.toLowerCase() === 'false') {
        parsed[fieldName] = false;
      } else {
        parsed[fieldName] = fieldValue;
      }
    }
    
    // Handle trigger method special case
    if (parsed['trigger method']) {
      const triggerMethod = parsed['trigger method'].toLowerCase();
      delete parsed['trigger method']; // Remove the space-containing key
      
      parsed.trigger_method = triggerMethod;
      
      // Validate trigger method
      if (!['constant', 'vectorized', 'selective'].includes(parsed.trigger_method)) {
        parsed.trigger_method = 'selective';
      }
    } else if (!parsed.trigger_method) {
      parsed.trigger_method = 'selective'; // Default value
    }
    
    // Legacy support for keywords -> key
    if (parsed.keywords && (!parsed.key || parsed.key.length === 0)) {
      parsed.key = parsed.keywords;
    }
    
    // Special handling for title -> comment
    if (parsed.title && (!parsed.comment || parsed.comment === '')) {
      parsed.comment = parsed.title;
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
      
      // Only check validity if we're not accepting any field pattern
      // This allows for much more flexible entry structure
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
        key: parsed.key || [name], // Use parsed key if available, otherwise default to filename
        keysecondary: parsed.keysecondary || [],
        comment: parsed.comment || parsed.title || name, // Use parsed comment/title or default to filename
        content: parsed.content,
        constant: parsed.trigger_method === 'constant',
        vectorized: parsed.trigger_method === 'vectorized',
        selective: parsed.trigger_method === 'selective',
        selectiveLogic: parsed.selectivelogic !== undefined ? parsed.selectivelogic : 0,
        addMemo: parsed.addmemo !== undefined ? parsed.addmemo : true,
        order: parsed.order !== undefined ? parsed.order : 0,
        position: parsed.position !== undefined ? parsed.position : 0,
        disable: parsed.disable !== undefined ? parsed.disable : false,
        excludeRecursion: parsed.excluderecursion !== undefined ? parsed.excluderecursion : false,
        preventRecursion: parsed.preventrecursion !== undefined ? parsed.preventrecursion : false,
        delayUntilRecursion: parsed.delayuntilrecursion !== undefined ? parsed.delayuntilrecursion : false,
        probability: parsed.probability !== undefined ? parsed.probability : 100,
        useProbability: parsed.useprobability !== undefined ? parsed.useprobability : true,
        depth: parsed.depth !== undefined ? parsed.depth : 4,
        group: parsed.group !== undefined ? parsed.group : folder,
        groupOverride: parsed.groupoverride !== undefined ? parsed.groupoverride : false,
        groupWeight: parsed.groupweight !== undefined ? parsed.groupweight : 100,
        scanDepth: parsed.scandepth !== undefined ? parsed.scandepth : null,
        caseSensitive: parsed.casesensitive !== undefined ? parsed.casesensitive : null,
        matchWholeWords: parsed.matchwholewords !== undefined ? parsed.matchwholewords : null,
        useGroupScoring: parsed.usegroupscoring !== undefined ? parsed.usegroupscoring : null,
        automationId: parsed.automationid !== undefined ? parsed.automationid : "",
        role: parsed.role !== undefined ? parsed.role : null,
        sticky: parsed.sticky !== undefined ? parsed.sticky : 0,
        cooldown: parsed.cooldown !== undefined ? parsed.cooldown : 0,
        delay: parsed.delay !== undefined ? parsed.delay : 0,
        displayIndex: parsed.displayindex !== undefined ? parsed.displayindex : 0,
        wikilinks: wikilinks
      };
      
      return entry;
    } catch (e) {
      console.error(`Error processing ${file.path}:`, e);
      return null;
    }
  }

  async findRootFile(progress: ProgressBar): Promise<void> {
    // First search for files with '# Root' tag
    progress.setStatus("Searching for root file...");
    const files = this.app.vault.getMarkdownFiles();
    let rootFileFound = false;
    
    // First try to find a file with the '# Root' marker
    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        
        // Check if the file has the '# Root' marker
        if (/^# Root\s*$/m.test(content)) {
          progress.setStatus(`Found root file with '# Root' marker: ${file.path}`);
          
          const entry = await this.parseMarkdownFile(file);
          if (entry) {
            this.rootUid = entry.uid;
            const baseName = file.basename;
            this.filenameToUid[baseName] = entry.uid;
            this.entries[entry.uid] = entry;
            rootFileFound = true;
            break;
          }
        }
      } catch (e) {
        console.error(`Error checking file ${file.path} for Root marker:`, e);
      }
    }
    
    // If no file with '# Root' marker was found, fall back to standard filename approach
    if (!rootFileFound) {
      const rootCandidates = ['Root.md', 'root.md', 'index.md', 'World.md', 'world.md'];
      
      for (const rootFile of rootCandidates) {
        const rootFileObj = this.app.vault.getAbstractFileByPath(rootFile);
        
        if (rootFileObj instanceof TFile) {
          progress.setStatus(`Found root file by name: ${rootFile}`);
          
          try {
            const entry = await this.parseMarkdownFile(rootFileObj);
            if (entry) {
              this.rootUid = entry.uid;
              const baseName = rootFileObj.basename;
              this.filenameToUid[baseName] = entry.uid;
              this.entries[entry.uid] = entry;
              rootFileFound = true;
            }
          } catch (e) {
            console.error(`Error processing root file ${rootFile}:`, e);
          }
          
          if (this.rootUid !== null) {
            break;
          }
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