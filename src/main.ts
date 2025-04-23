import { App, Plugin, PluginSettingTab, Setting, TFile, Notice, addIcon } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import Graph from 'graphology';
import pagerank from 'graphology-metrics/centrality/pagerank';
import betweenness from 'graphology-metrics/centrality/betweenness';
import { ProgressBar } from './progress-bar';
import { createTemplate } from './template-creator';

// Define interfaces for our data structures
interface LoreBookEntry {
  uid: number;
  key: string[];
  keysecondary: string[];
  comment: string;
  content: string;
  constant: boolean;
  vectorized: boolean;
  selective: boolean;
  selectiveLogic: number;
  addMemo: boolean;
  order: number;
  position: number;
  disable: boolean;
  excludeRecursion: boolean;
  preventRecursion: boolean;
  delayUntilRecursion: boolean;
  probability: number;
  useProbability: boolean;
  depth: number;
  group: string;
  groupOverride: boolean;
  groupWeight: number;
  scanDepth: null;
  caseSensitive: null;
  matchWholeWords: null;
  useGroupScoring: null;
  automationId: string;
  role: null;
  sticky: number;
  cooldown: number;
  delay: number;
  displayIndex: number;
  wikilinks?: string[];
}

interface LoreBookSettings {
  orderByTitle: boolean;
  useDroste: boolean;
  useRecursion: boolean;
  tokenBudget: number;
  recursionBudget: number;
}

interface LoreBook {
  entries: {[key: string]: LoreBookEntry};
  settings: LoreBookSettings;
}

interface ConverterSettings {
  weights: {
    hierarchy: number;
    in_degree: number;
    pagerank: number;
    betweenness: number;
    out_degree: number;
    total_degree: number;
    file_depth: number;
  };
  outputPath: string;
}

const DEFAULT_SETTINGS: ConverterSettings = {
  weights: {
    hierarchy: 8000,
    in_degree: 4000,
    pagerank: 2000,
    betweenness: 1000,
    out_degree: 500,
    total_degree: 100,
    file_depth: 2000
  },
  outputPath: ''
};

export default class LoreBookConverterPlugin extends Plugin {
  settings: ConverterSettings;
  graph: Graph = new Graph({ type: 'directed' });
  entries: {[key: number]: LoreBookEntry} = {};
  filenameToUid: {[key: string]: number} = {};
  nextUid: number = 0;
  rootUid: number | null = null;

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
          console.log('Template creation cancelled', error);
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
      // Reset data structures
      this.graph = new Graph({ type: 'directed' });
      this.entries = {};
      this.filenameToUid = {};
      this.nextUid = 0;
      this.rootUid = null;
      
      // Stage 1: Count files and initialize progress
      const files = this.app.vault.getMarkdownFiles();
      const progress = new ProgressBar(
        files.length + 2, // Files + graph building + exporting
        'Analyzing vault structure...'
      );
      
      // Stage 2: Find root file
      await this.findRootFile(progress);
      
      // Stage 3: Process all files
      await this.processFiles(files, progress);
      
      // Stage 4: Build graph
      progress.setStatus('Building relationship graph...');
      this.buildGraph();
      progress.update();
      
      // Stage 5: Calculate priorities
      progress.setStatus('Calculating entry priorities...');
      this.calculateEntryPriorities();
      
      // Stage 6: Export JSON
      progress.setStatus('Exporting to JSON...');
      const outputPath = this.settings.outputPath || 
                         `${this.app.vault.getName()}.json`;
      
      await this.exportLoreBookJson(outputPath);
      progress.update();
      
      // Complete
      progress.success(`Conversion complete! Processed ${Object.keys(this.entries).length} entries.`);
    } catch (error) {
      console.error('Conversion failed:', error);
      new Notice(`Conversion failed: ${error.message}`);
    }
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
    const getTag = (tag: string) => {
      const regex = new RegExp(`^# ${tag}: ?(.+)$`, 'm');
      const match = content.match(regex);
      return match ? match[1].trim() : '';
    };
    
    const title = getTag('Title');
    const keywords = getTag('Keywords').split(',').map(k => k.trim()).filter(k => k);
    const overview = getTag('Overview');
    const trigger = getTag('Trigger Method');
    
    const probMatch = content.match(/^# Probability: (\d+)$/m);
    const depthMatch = content.match(/^# Depth: (\d+)$/m);
    
    const contentMatch = content.match(/^# Content:(?:[ \t]*\n)?([\s\S]+)/);
    
    const parsed: any = {
      title: title,
      keywords: keywords,
      overview: overview,
      trigger_method: (trigger ? trigger.toLowerCase() : 'selective')
    };
    
    // Validate trigger
    if (!['constant', 'vectorized', 'selective'].includes(parsed.trigger_method)) {
      parsed.trigger_method = 'selective';
    }
    
    // Numeric values
    parsed.probability = probMatch ? Math.max(0, Math.min(parseInt(probMatch[1]), 100)) : 100;
    parsed.depth = depthMatch ? Math.max(1, Math.min(parseInt(depthMatch[1]), 10)) : 4;
    parsed.content = contentMatch ? contentMatch[1].trim() : content.trim();
    
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

  buildGraph(): void {
    // Initialize the graphology graph
    this.graph = new Graph({ type: 'directed' });
    
    // Add all nodes to the graph
    for (const uid of Object.keys(this.entries).map(Number)) {
      this.graph.addNode(uid.toString(), { 
        entry: this.entries[uid] 
      });
    }
    
    // Add all edges based on wikilinks
    console.log("Building relationship graph based on wikilinks");
    
    for (const [uid, entry] of Object.entries(this.entries)) {
      if (entry.wikilinks) {
        for (const link of entry.wikilinks) {
          if (link in this.filenameToUid) {
            const linkedUid = this.filenameToUid[link];
            if (linkedUid in this.entries) {
              // Create edge from source to target
              try {
                this.graph.addEdge(uid, linkedUid.toString());
              } catch (e) {
                // Edge might already exist, ignore
              }
            }
          }
        }
      }
    }
    
    console.log(`Created graph with ${this.graph.order} nodes and ${this.graph.size} edges`);
  }

  calculateEntryPriorities(): void {
    console.log("Calculating entry priorities with graphology");
    
    // Calculate BFS depths from root
    const hierarchyDepths: {[key: number]: number} = {};
    let maxHierarchyDepth = 0;
    
    if (this.rootUid !== null) {
      const queue: [string, number][] = [[this.rootUid.toString(), 0]];
      const visited = new Set<string>([this.rootUid.toString()]);
      
      while (queue.length > 0) {
        const [node, depth] = queue.shift()!;
        hierarchyDepths[parseInt(node)] = depth;
        maxHierarchyDepth = Math.max(maxHierarchyDepth, depth);
        
        // Use graphology's outNeighbors method
        this.graph.outNeighbors(node).forEach(neighbor => {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push([neighbor, depth + 1]);
          }
        });
      }
    }
    maxHierarchyDepth = Math.max(maxHierarchyDepth, 1);
    
    // Calculate in-degree and out-degree
    const inDegree: {[key: number]: number} = {};
    const outDegree: {[key: number]: number} = {};
    let maxInDegree = 1;
    let maxOutDegree = 1;
    
    this.graph.forEachNode(node => {
      const nodeId = parseInt(node);
      inDegree[nodeId] = this.graph.inDegree(node);
      outDegree[nodeId] = this.graph.outDegree(node);
      
      maxInDegree = Math.max(maxInDegree, inDegree[nodeId]);
      maxOutDegree = Math.max(maxOutDegree, outDegree[nodeId]);
    });
    
    // Calculate total degree
    const totalDegree: {[key: number]: number} = {};
    let maxTotalDegree = 1;
    
    this.graph.forEachNode(node => {
      const nodeId = parseInt(node);
      totalDegree[nodeId] = this.graph.degree(node);
      maxTotalDegree = Math.max(maxTotalDegree, totalDegree[nodeId]);
    });
    
    // Calculate PageRank using graphology-metrics
    const prOptions = {
      alpha: 0.85,
      tolerance: 1e-6,
      maxIterations: 100,
      getEdgeWeight: () => 1
    };
    
    const pageRankResult = pagerank(this.graph, prOptions);
    
    // Convert the results from node strings to numeric UIDs
    const pageRankByUID: {[key: number]: number} = {};
    let maxPageRank = 0;
    
    for (const [node, rank] of Object.entries(pageRankResult)) {
      const nodeId = parseInt(node);
      pageRankByUID[nodeId] = rank;
      maxPageRank = Math.max(maxPageRank, rank);
    }
    maxPageRank = maxPageRank || 1; // Avoid division by zero
    
    // Calculate betweenness centrality using graphology-metrics
    const betweennessResult = betweenness(this.graph);
    
    // Convert the results from node strings to numeric UIDs
    const betweennessByUID: {[key: number]: number} = {};
    let maxBetweenness = 0;
    
    for (const [node, bc] of Object.entries(betweennessResult)) {
      const nodeId = parseInt(node);
      betweennessByUID[nodeId] = bc;
      maxBetweenness = Math.max(maxBetweenness, bc);
    }
    maxBetweenness = maxBetweenness || 1; // Avoid division by zero
    
    // File hierarchy depths
    const fileDepths: {[key: number]: number} = {};
    let maxFileDepth = 1;
    
    for (const [uid, entry] of Object.entries(this.entries)) {
      const depth = entry.group ? entry.group.split('/').length - 1 : 0;
      fileDepths[parseInt(uid)] = depth;
      maxFileDepth = Math.max(maxFileDepth, depth);
    }
    
    // Compute priorities
    const w = this.settings.weights;
    
    for (const uid of Object.keys(this.entries).map(Number)) {
      const hFac = (hierarchyDepths[uid] || 0) / maxHierarchyDepth;
      const iFac = (inDegree[uid] || 0) / maxInDegree;
      const pFac = (pageRankByUID[uid] || 0) / maxPageRank;
      const bFac = (betweennessByUID[uid] || 0) / maxBetweenness;
      const oFac = (outDegree[uid] || 0) / maxOutDegree;
      const tFac = (totalDegree[uid] || 0) / maxTotalDegree;
      const fFac = (fileDepths[uid] || 0) / maxFileDepth;
      
      const score = (
        w.hierarchy * hFac +
        w.in_degree * iFac +
        w.pagerank * pFac +
        w.betweenness * bFac +
        w.out_degree * oFac +
        w.total_degree * tFac +
        w.file_depth * fFac
      );
      
      this.entries[uid].order = Math.max(1, Math.floor(score));
    }
    
    // Break ties with randomization
    const valueCounts: {[key: number]: number[]} = {};
    
    for (const [node, entry] of Object.entries(this.entries)) {
      const uid = parseInt(node);
      const order = entry.order;
      
      if (!valueCounts[order]) {
        valueCounts[order] = [];
      }
      
      valueCounts[order].push(uid);
    }
    
    for (const [val, nodes] of Object.entries(valueCounts)) {
      if (nodes.length > 1) {
        // Shuffle the nodes
        for (let i = nodes.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
        }
        
        // Add small offset to break ties
        for (let i = 0; i < nodes.length; i++) {
          this.entries[nodes[i]].order += i + 1;
        }
      }
    }
  }

  async exportLoreBookJson(outputPath: string): Promise<void> {
    // Create entries dictionary with string keys and remove wikilinks
    const entriesDict: {[key: string]: Omit<LoreBookEntry, 'wikilinks'>} = {};
    
    for (const [uid, entry] of Object.entries(this.entries)) {
      const { wikilinks, ...entryWithoutWikilinks } = entry;
      entriesDict[uid] = entryWithoutWikilinks;
    }
    
    // Create the lorebook structure
    const lorebook: LoreBook = {
      entries: entriesDict as any, // Type assertion to satisfy TypeScript
      settings: {
        orderByTitle: false,
        useDroste: true,
        useRecursion: true,
        tokenBudget: 2048,
        recursionBudget: 100
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
      
      console.log(`Successfully exported ${Object.keys(this.entries).length} entries to ${outputPath}`);
    } catch (e) {
      console.error(`Error writing JSON to ${outputPath}:`, e);
      throw e;
    }
  }
}

class LoreBookConverterSettingTab extends PluginSettingTab {
  plugin: LoreBookConverterPlugin;

  constructor(app: App, plugin: LoreBookConverterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('lorebook-converter-settings');

    containerEl.createEl('h2', { text: 'Lorebook Converter Settings' });

    new Setting(containerEl)
      .setName('Output Path')
      .setDesc('Path where the Lorebook JSON file will be saved')
      .addText(text => text
        .setPlaceholder(`${this.app.vault.getName()}.json`)
        .setValue(this.plugin.settings.outputPath)
        .onChange(async (value) => {
          this.plugin.settings.outputPath = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: 'Priority Weights' });
    containerEl.createEl('p', { 
      text: 'These weights determine how entries are ordered in the lorebook. Higher weights give more importance to that factor.'
    });

    // The updated createWeightSetting function for LoreBookConverterSettingTab

    const createWeightSetting = (key: keyof typeof this.plugin.settings.weights, name: string, desc: string) => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText(text => text
          .setValue(this.plugin.settings.weights[key].toString())
          .onChange(async (value) => {
            // Parse the input to a number
            const numValue = parseInt(value);
            
            // Validate the input is a valid number
            if (!isNaN(numValue)) {
              this.plugin.settings.weights[key] = numValue;
              await this.plugin.saveSettings();
            }
          }));
    };

    createWeightSetting('hierarchy', 'Hierarchy', 
      'Distance from root document (lower depth = higher priority)');
    createWeightSetting('in_degree', 'In-Degree', 
      'Number of links pointing to this document');
    createWeightSetting('pagerank', 'PageRank', 
      'Overall importance based on network centrality');
    createWeightSetting('betweenness', 'Betweenness', 
      'How important this node is as a connector');
    createWeightSetting('out_degree', 'Out-Degree', 
      'Number of outgoing links');
    createWeightSetting('total_degree', 'Total Degree', 
      'Total number of links, in + out');
    createWeightSetting('file_depth', 'File Depth', 
      'Position in folder hierarchy');
  }
}