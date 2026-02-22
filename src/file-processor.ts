import { App, TFile } from 'obsidian';
import * as path from 'path';
import { LoreBookEntry } from './models';
import { ProgressBar } from './progress-bar';

export class FileProcessor {
  private app: App;
  private filenameToUid: {[key: string]: number} = {};
  private ambiguousTargets: Set<string> = new Set();
  private entries: {[key: number]: LoreBookEntry} = {};
  private nextUid: number = 0;
  private rootUid: number | null = null;
  private rootFilePath: string | null = null;

  constructor(app: App) {
    this.app = app;
  }

  generateUid(): number {
    const uid = this.nextUid;
    this.nextUid += 1;
    return uid;
  }

  private normalizeLinkTarget(target: string): string {
    // Obsidian-style link targets can include headings/block refs and optional .md suffixes.
    return target
      .trim()
      .replace(/\\/g, '/')
      .replace(/#.*$/, '')
      .replace(/\.md$/i, '')
      .trim();
  }

  private addTargetMapping(target: string, uid: number): void {
    const normalized = this.normalizeLinkTarget(target);
    if (!normalized) {
      return;
    }

    if (this.ambiguousTargets.has(normalized)) {
      return;
    }

    const existingUid = this.filenameToUid[normalized];
    if (existingUid === undefined) {
      this.filenameToUid[normalized] = uid;
      return;
    }

    if (existingUid !== uid) {
      delete this.filenameToUid[normalized];
      this.ambiguousTargets.add(normalized);
    }
  }

  private registerFileMappings(file: TFile, uid: number): void {
    const normalizedPath = this.normalizeLinkTarget(file.path);
    const normalizedBase = this.normalizeLinkTarget(file.basename);

    this.addTargetMapping(normalizedPath, uid);
    this.addTargetMapping(normalizedBase, uid);
  }

  extractWikilinks(content: string): string[] {
    const pattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    const links: string[] = [];
    let match;
    
    while ((match = pattern.exec(content)) !== null) {
      const rawLink = match[1].trim();
      const link = this.normalizeLinkTarget(rawLink);
      if (!link) {
        continue;
      }

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
    const contentTagMatch = /^# [Cc]ontent:(.*)$/m.exec(content);
    
    // If content tag found, use that section. Otherwise use the entire file content
    if (contentTagMatch) {
      const inlineContent = contentTagMatch[1].trim();
      const contentStart = contentTagMatch.index + contentTagMatch[0].length;
      const remaining = content.slice(contentStart);
      const nextFieldMatch = /\r?\n# [A-Za-z0-9_\s]+:/.exec(remaining);
      const contentBlock = nextFieldMatch
        ? remaining.slice(0, nextFieldMatch.index)
        : remaining;

      parsed.content = `${inlineContent}\n${contentBlock}`.trim();
    } else {
      // Check if there are any # tags in the file
      const hasTags = /^# [A-Za-z0-9_\s]+:/m.test(content);
      
      if (hasTags) {
        // Extract all lines that don't start with a field tag line such as "# Field: value"
        const nonTagLines = content.split('\n')
          .filter(line => !/^# [A-Za-z0-9_\s]+:/.test(line.trim()))
          .join('\n');
        
        parsed.content = nonTagLines.trim();
      } else {
        // No tags at all, use entire content
        parsed.content = content.trim();
      }
    }
    
    // Process all other fields with format: # fieldName: value
    const arbitraryFieldPattern = /^# ([a-zA-Z0-9_\s]+): ?(.+?)$/gim; // Case-insensitive, multiline, allow spaces
    let fieldMatch;
    
    // Known array fields that should be parsed as comma-separated values
    const arrayFields = ['key', 'keysecondary', 'keywords'];
    
    // Known boolean fields for validation
    const booleanFields = [
      'constant', 'vectorized', 'selective', 'addmemo', 'useprobability', 
      'disable', 'excluderecursion', 'preventrecursion', 'delayuntilrecursion', 
      'groupoverride'
    ];
    
    // Known numeric fields for validation
    const numericFields = [
      'selectivelogic', 'order', 'position', 'probability', 
      'depth', 'groupweight', 'sticky', 'cooldown', 'delay', 'displayindex'
    ];
    
    while ((fieldMatch = arbitraryFieldPattern.exec(content)) !== null) {
      // Convert field name to lowercase and remove spaces
      const rawFieldName = fieldMatch[1].trim();
      const fieldName = rawFieldName.toLowerCase().replace(/\s+/g, ''); 
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
      
      // Handle value types with validation
      if (numericFields.includes(fieldName) || !isNaN(Number(fieldValue))) {
        const numValue = Number(fieldValue);
        parsed[fieldName] = !isNaN(numValue) ? numValue : fieldValue;
      } else if (booleanFields.includes(fieldName) || /^(true|false)$/i.test(fieldValue)) {
        parsed[fieldName] = /^true$/i.test(fieldValue);
      } else {
        parsed[fieldName] = fieldValue;
      }
    }
    
    // Normalize trigger method fields
    if (parsed.triggermethod) {
      parsed.trigger_method = parsed.triggermethod;
      delete parsed.triggermethod;
    }

    // Support legacy string forms for selective logic and normalize into ST's 0..3 range.
    if (typeof parsed.selectivelogic === 'string') {
      const normalized = parsed.selectivelogic.trim().toLowerCase();
      const selectiveLogicMap: {[key: string]: number} = {
        'or': 0,
        'and any': 0,
        'and': 1,
        'and all': 1,
        'not any': 2,
        'not all': 3
      };

      if (normalized in selectiveLogicMap) {
        parsed.selectivelogic = selectiveLogicMap[normalized];
      }
    }

    if (typeof parsed.selectivelogic === 'number') {
      parsed.selectivelogic = Math.max(0, Math.min(3, Math.floor(parsed.selectivelogic)));
    }
    
    // Handle trigger method special case
    if (parsed['trigger method']) {
      const triggerMethod = parsed['trigger method'].toLowerCase();
      delete parsed['trigger method']; // Remove the space-containing key
      
      parsed.trigger_method = triggerMethod;
    }
    
    // Ensure only one trigger method is active based on explicit flags
    if (parsed.vectorized === true) {
      parsed.trigger_method = 'vectorized';
      parsed.constant = false;
      parsed.selective = false;
    } else if (parsed.constant === true) {
      parsed.trigger_method = 'constant';
      parsed.vectorized = false;
      parsed.selective = false;
    } else if (parsed.selective === true) {
      parsed.trigger_method = 'selective';
      parsed.vectorized = false;
      parsed.constant = false;
    } else if (parsed.trigger_method) {
      // If no explicit boolean flags but trigger_method is set, apply it
      parsed.constant = parsed.trigger_method === 'constant';
      parsed.vectorized = parsed.trigger_method === 'vectorized';
      parsed.selective = parsed.trigger_method === 'selective';
    } else {
      // Don't set defaults here - this allows the entry creation to use plugin settings
      parsed.trigger_method = null;
    }
    
    // Legacy support for keywords -> key
    if (parsed.keywords && (!parsed.key || parsed.key.length === 0)) {
      parsed.key = parsed.keywords;
    }
    
    // Special handling for title -> comment
    if (parsed.title && (!parsed.comment || parsed.comment === '')) {
      parsed.comment = parsed.title;
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
      const wikilinks = this.extractWikilinks(content);
      
      // Get plugin settings from app
      const plugin = (this.app as any).plugins.plugins['lorebook-converter'];
      let defaultSettings = null;
      if (plugin && plugin.settings) {
        defaultSettings = plugin.settings.defaultEntry;
      }
      
      // Create base entry with default values
      const entry: LoreBookEntry = {
        uid: uid,
        key: parsed.key || [name], // Use parsed key if available, otherwise default to filename
        keysecondary: parsed.keysecondary || [],
        comment: parsed.comment || parsed.title || name, // Use parsed comment/title or default to filename
        content: parsed.content,
        
        // Apply trigger method settings properly
        constant: parsed.constant !== undefined ? parsed.constant : 
                 (parsed.trigger_method === 'constant') ? true : 
                 (defaultSettings ? defaultSettings.constant : false),
        
        vectorized: parsed.vectorized !== undefined ? parsed.vectorized : 
                   (parsed.trigger_method === 'vectorized') ? true : 
                   (defaultSettings ? defaultSettings.vectorized : false),
        
        selective: parsed.selective !== undefined ? parsed.selective : 
                  (parsed.trigger_method === 'selective') ? true : 
                  (defaultSettings ? defaultSettings.selective : true),
        
        selectiveLogic: parsed.selectivelogic !== undefined ? parsed.selectivelogic : 
                       (defaultSettings ? defaultSettings.selectiveLogic : 0),
        addMemo: parsed.addmemo !== undefined ? parsed.addmemo : true,
        order: parsed.order !== undefined ? parsed.order : 0,
        position: parsed.position !== undefined ? parsed.position : 0,
        disable: parsed.disable !== undefined ? parsed.disable : false,
        excludeRecursion: parsed.excluderecursion !== undefined ? parsed.excluderecursion : false,
        preventRecursion: parsed.preventrecursion !== undefined ? parsed.preventrecursion : false,
        delayUntilRecursion: parsed.delayuntilrecursion !== undefined ? parsed.delayuntilrecursion : false,
        probability: parsed.probability !== undefined ? parsed.probability : 
                   (defaultSettings ? defaultSettings.probability : 100),
        useProbability: parsed.useprobability !== undefined ? parsed.useprobability : true,
        depth: parsed.depth !== undefined ? parsed.depth : 
              (defaultSettings ? defaultSettings.depth : 4),
        group: parsed.group !== undefined ? parsed.group : folder,
        groupOverride: parsed.groupoverride !== undefined ? parsed.groupoverride : false,
        groupWeight: parsed.groupweight !== undefined ? parsed.groupweight : 
                   (defaultSettings ? defaultSettings.groupWeight : 100),
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
    const files = this.app.vault.getMarkdownFiles()
      .sort((a, b) => a.path.localeCompare(b.path));
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
            this.rootFilePath = file.path;
            this.registerFileMappings(file, entry.uid);
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
              this.rootFilePath = rootFileObj.path;
              this.registerFileMappings(rootFileObj, entry.uid);
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
    const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));
    const total = sortedFiles.length;
    let processed = 0;
    
    for (const file of sortedFiles) {
      // Skip the root file if we already processed it
      if (this.rootFilePath !== null && file.path === this.rootFilePath) {
        progress.update();
        processed++;
        continue;
      }
      
      progress.setStatus(`Processing file ${processed+1}/${total}: ${file.basename}`);
      
      const entry = await this.parseMarkdownFile(file);
      
      if (entry) {
        this.registerFileMappings(file, entry.uid);
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
    this.ambiguousTargets = new Set();
    this.entries = {};
    this.nextUid = 0;
    this.rootUid = null;
    this.rootFilePath = null;
  }
}
