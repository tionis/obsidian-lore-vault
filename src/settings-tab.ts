import { App, PluginSettingTab, Setting } from 'obsidian';
import LoreBookConverterPlugin from './main';

export class LoreBookConverterSettingTab extends PluginSettingTab {
  plugin: LoreBookConverterPlugin;

  constructor(app: App, plugin: LoreBookConverterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('lorebook-converter-settings');

    containerEl.createEl('h2', { text: 'LoreVault Settings' });

    new Setting(containerEl)
      .setName('Downstream Output Subpath')
      .setDesc('Subpath under SQLite output root for downstream exports (.json world_info and .rag.md).')
      .addText(text => text
        .setPlaceholder('sillytavern/lorevault.json')
        .setValue(this.plugin.settings.outputPath)
        .onChange(async (value) => {
          this.plugin.settings.outputPath = value;
          await this.plugin.saveData(this.plugin.settings);
        }));

    // Lorebook Scope section
    containerEl.createEl('h3', { text: 'Lorebook Scope' });

    new Setting(containerEl)
      .setName('Lorebook Tag Prefix')
      .setDesc('Tag namespace used to detect lorebooks (without #), e.g. lorebook')
      .addText(text => text
        .setPlaceholder('lorebook')
        .setValue(this.plugin.settings.tagScoping.tagPrefix)
        .onChange(async (value) => {
          this.plugin.settings.tagScoping.tagPrefix = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Active Scope')
      .setDesc('Optional scope path under the tag prefix, e.g. universe/yggdrasil (empty = all lorebook tags)')
      .addText(text => text
        .setPlaceholder('universe/yggdrasil')
        .setValue(this.plugin.settings.tagScoping.activeScope)
        .onChange(async (value) => {
          this.plugin.settings.tagScoping.activeScope = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Membership Mode')
      .setDesc('Exact: include only exact scope tags. Cascade: include entries from child scopes too.')
      .addDropdown(dropdown => dropdown
        .addOptions({
          'exact': 'Exact',
          'cascade': 'Cascade'
        })
        .setValue(this.plugin.settings.tagScoping.membershipMode)
        .onChange(async (value) => {
          this.plugin.settings.tagScoping.membershipMode = value === 'cascade' ? 'cascade' : 'exact';
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Include Untagged Notes')
      .setDesc('If enabled, notes without lorebook tags are included in the active build.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.tagScoping.includeUntagged)
        .onChange(async (value) => {
          this.plugin.settings.tagScoping.includeUntagged = value;
          await this.plugin.saveData(this.plugin.settings);
        }));

    // Default LoreBook Settings section
    containerEl.createEl('h3', { text: 'Default LoreBook Settings' });
    
    new Setting(containerEl)
      .setName('Order By Title')
      .setDesc('Entries will be ordered by their titles instead of priority score')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.defaultLoreBook.orderByTitle)
        .onChange(async (value) => {
          this.plugin.settings.defaultLoreBook.orderByTitle = value;
          await this.plugin.saveData(this.plugin.settings);
        }));
    
    new Setting(containerEl)
      .setName('Use Droste Effect')
      .setDesc('Allow lorebook entries to trigger other lorebook entries')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.defaultLoreBook.useDroste)
        .onChange(async (value) => {
          this.plugin.settings.defaultLoreBook.useDroste = value;
          await this.plugin.saveData(this.plugin.settings);
        }));
    
    new Setting(containerEl)
      .setName('Use Recursion')
      .setDesc('Allow entries to call themselves recursively')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.defaultLoreBook.useRecursion)
        .onChange(async (value) => {
          this.plugin.settings.defaultLoreBook.useRecursion = value;
          await this.plugin.saveData(this.plugin.settings);
        }));
    
    new Setting(containerEl)
      .setName('Token Budget')
      .setDesc('Maximum tokens to spend on the lorebook')
      .addText(text => text
        .setValue(this.plugin.settings.defaultLoreBook.tokenBudget.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue > 0) {
            this.plugin.settings.defaultLoreBook.tokenBudget = numValue;
            await this.plugin.saveData(this.plugin.settings);
          }
        }));
    
    new Setting(containerEl)
      .setName('Recursion Budget')
      .setDesc('Maximum recursion depth for entries')
      .addText(text => text
        .setValue(this.plugin.settings.defaultLoreBook.recursionBudget.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue > 0) {
            this.plugin.settings.defaultLoreBook.recursionBudget = numValue;
            await this.plugin.saveData(this.plugin.settings);
          }
        }));

    // Default Entry Settings section
    containerEl.createEl('h3', { text: 'Default Entry Settings' });
    
    // Trigger method setting with radio buttons
    const triggerSetting = new Setting(containerEl)
      .setName('Default Trigger Method')
      .setDesc('How entries are triggered by default');
    
    // Create container for the radio buttons
    const triggerOptions = document.createDocumentFragment();
    
    // Helper for creating radio buttons
    const createRadio = (container: DocumentFragment, 
                         label: string, 
                         value: string, 
                         checked: boolean) => {
      const radioItem = container.createEl('div', { cls: 'radio-item' });
      const radio = radioItem.createEl('input', {
        type: 'radio',
        attr: {
          id: `trigger-${value}`,
          name: 'trigger-method',
          value: value
        }
      });
      radio.checked = checked;
      radioItem.createEl('label', {
        text: label,
        attr: { for: `trigger-${value}` }
      });
      
      return radio;
    };
    
    // Create the radio buttons
    const constantRadio = createRadio(
      triggerOptions, 
      'Constant (always included)', 
      'constant',
      this.plugin.settings.defaultEntry.constant
    );
    
    const vectorizedRadio = createRadio(
      triggerOptions, 
      'Vectorized (AI determines relevance)', 
      'vectorized',
      this.plugin.settings.defaultEntry.vectorized
    );
    
    const selectiveRadio = createRadio(
      triggerOptions, 
      'Selective (triggered by keywords)', 
      'selective',
      this.plugin.settings.defaultEntry.selective
    );
    
    // Add change listeners
    constantRadio.addEventListener('change', async () => {
      if (constantRadio.checked) {
        this.plugin.settings.defaultEntry.constant = true;
        this.plugin.settings.defaultEntry.vectorized = false;
        this.plugin.settings.defaultEntry.selective = false;
        await this.plugin.saveData(this.plugin.settings);
      }
    });
    
    vectorizedRadio.addEventListener('change', async () => {
      if (vectorizedRadio.checked) {
        this.plugin.settings.defaultEntry.constant = false;
        this.plugin.settings.defaultEntry.vectorized = true;
        this.plugin.settings.defaultEntry.selective = false;
        await this.plugin.saveData(this.plugin.settings);
      }
    });
    
    selectiveRadio.addEventListener('change', async () => {
      if (selectiveRadio.checked) {
        this.plugin.settings.defaultEntry.constant = false;
        this.plugin.settings.defaultEntry.vectorized = false;
        this.plugin.settings.defaultEntry.selective = true;
        await this.plugin.saveData(this.plugin.settings);
      }
    });
    
    // Add radio buttons to the setting
    triggerSetting.settingEl.appendChild(triggerOptions);
    
    // Add selective logic dropdown (only relevant if selective is chosen)
    new Setting(containerEl)
      .setName('Selective Logic')
      .setDesc('How optional filter keys interact with primary keys (AND ANY, AND ALL, NOT ANY, NOT ALL)')
      .addDropdown(dropdown => dropdown
        .addOptions({
          '0': 'AND ANY',
          '1': 'AND ALL',
          '2': 'NOT ANY',
          '3': 'NOT ALL'
        })
        .setValue(this.plugin.settings.defaultEntry.selectiveLogic.toString())
        .onChange(async (value) => {
          this.plugin.settings.defaultEntry.selectiveLogic = parseInt(value);
          await this.plugin.saveData(this.plugin.settings);
        }));
    
    // Probability setting
    new Setting(containerEl)
      .setName('Default Probability')
      .setDesc('Chance of entry being included (0-100%)')
      .addSlider(slider => slider
        .setLimits(0, 100, 1)
        .setValue(this.plugin.settings.defaultEntry.probability)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.defaultEntry.probability = value;
          await this.plugin.saveData(this.plugin.settings);
        }));
    
    // Depth setting
    new Setting(containerEl)
      .setName('Default Depth')
      .setDesc('Scanning depth for including entries (1-10)')
      .addSlider(slider => slider
        .setLimits(1, 10, 1)
        .setValue(this.plugin.settings.defaultEntry.depth)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.defaultEntry.depth = value;
          await this.plugin.saveData(this.plugin.settings);
        }));
    
    // Group weight setting
    new Setting(containerEl)
      .setName('Default Group Weight')
      .setDesc('Weight of entries in their group (0-100)')
      .addSlider(slider => slider
        .setLimits(0, 100, 1)
        .setValue(this.plugin.settings.defaultEntry.groupWeight)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.defaultEntry.groupWeight = value;
          await this.plugin.saveData(this.plugin.settings);
        }));

    // Priority Weights section
    containerEl.createEl('h3', { text: 'Priority Weights' });
    containerEl.createEl('p', { 
      text: 'These weights determine how entries are ordered in the lorebook. Higher weights give more importance to that factor.'
    });

    // The updated createWeightSetting function
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
              await this.plugin.saveData(this.plugin.settings);
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

    containerEl.createEl('h3', { text: 'SQLite Pack Export' });
    containerEl.createEl('p', {
      text: 'LoreVault SQLite pack is the canonical export format. ST world_info and RAG outputs are derived from this pipeline.'
    });

    new Setting(containerEl)
      .setName('Enable SQLite Pack Export')
      .setDesc('Write a SQLite pack per built scope.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.sqlite.enabled)
        .onChange(async (value) => {
          this.plugin.settings.sqlite.enabled = value;
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('SQLite Output Directory')
      .setDesc('Directory for canonical SQLite packs. LoreVault writes one <scope>.db file per lorebook.')
      .addText(text => text
        .setPlaceholder('lorebooks/')
        .setValue(this.plugin.settings.sqlite.outputPath)
        .onChange(async (value) => {
          this.plugin.settings.sqlite.outputPath = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    containerEl.createEl('h3', { text: 'Writing Completion' });
    containerEl.createEl('p', {
      text: 'Configure LLM generation for "Continue Story with Context".'
    });

    new Setting(containerEl)
      .setName('Enable Writing Completion')
      .setDesc('Generate continuation text instead of inserting a placeholder.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.completion.enabled)
        .onChange(async (value) => {
          this.plugin.settings.completion.enabled = value;
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Completion Provider')
      .setDesc('Inference backend for story continuation.')
      .addDropdown(dropdown => dropdown
        .addOptions({
          'openrouter': 'OpenRouter',
          'ollama': 'Ollama',
          'openai_compatible': 'OpenAI-Compatible'
        })
        .setValue(this.plugin.settings.completion.provider)
        .onChange(async (value) => {
          if (value === 'ollama' || value === 'openai_compatible') {
            this.plugin.settings.completion.provider = value;
          } else {
            this.plugin.settings.completion.provider = 'openrouter';
          }
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Completion Endpoint')
      .setDesc('Base endpoint URL (for example https://openrouter.ai/api/v1 or http://localhost:11434).')
      .addText(text => text
        .setPlaceholder('https://openrouter.ai/api/v1')
        .setValue(this.plugin.settings.completion.endpoint)
        .onChange(async (value) => {
          this.plugin.settings.completion.endpoint = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Completion API Key')
      .setDesc('API key for provider auth (not required for local Ollama).')
      .addText(text => text
        .setPlaceholder('sk-...')
        .setValue(this.plugin.settings.completion.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.completion.apiKey = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Completion Model')
      .setDesc('Model identifier used for continuation generation.')
      .addText(text => text
        .setPlaceholder('openai/gpt-4o-mini')
        .setValue(this.plugin.settings.completion.model)
        .onChange(async (value) => {
          this.plugin.settings.completion.model = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('System Prompt')
      .setDesc('Instruction that controls writing style and behavior.')
      .addTextArea(text => text
        .setValue(this.plugin.settings.completion.systemPrompt)
        .onChange(async (value) => {
          this.plugin.settings.completion.systemPrompt = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Completion Temperature')
      .setDesc('Creativity level (0.0-2.0).')
      .addText(text => text
        .setValue(this.plugin.settings.completion.temperature.toString())
        .onChange(async (value) => {
          const numValue = Number(value);
          if (!isNaN(numValue) && numValue >= 0 && numValue <= 2) {
            this.plugin.settings.completion.temperature = numValue;
            await this.plugin.saveData(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Max Output Tokens')
      .setDesc('Upper bound for generated continuation length.')
      .addText(text => text
        .setValue(this.plugin.settings.completion.maxOutputTokens.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 64) {
            this.plugin.settings.completion.maxOutputTokens = numValue;
            await this.plugin.saveData(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Completion Timeout (ms)')
      .setDesc('Request timeout for completion API calls.')
      .addText(text => text
        .setValue(this.plugin.settings.completion.timeoutMs.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 1000) {
            this.plugin.settings.completion.timeoutMs = numValue;
            await this.plugin.saveData(this.plugin.settings);
          }
        }));

    containerEl.createEl('h3', { text: 'Embeddings & Semantic RAG' });

    new Setting(containerEl)
      .setName('Enable Embeddings')
      .setDesc('Generate and cache embeddings for RAG chunks.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.embeddings.enabled)
        .onChange(async (value) => {
          this.plugin.settings.embeddings.enabled = value;
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Embedding Provider')
      .setDesc('Inference backend for embeddings.')
      .addDropdown(dropdown => dropdown
        .addOptions({
          'openrouter': 'OpenRouter',
          'ollama': 'Ollama',
          'openai_compatible': 'OpenAI-Compatible'
        })
        .setValue(this.plugin.settings.embeddings.provider)
        .onChange(async (value) => {
          if (value === 'ollama' || value === 'openai_compatible') {
            this.plugin.settings.embeddings.provider = value;
          } else {
            this.plugin.settings.embeddings.provider = 'openrouter';
          }
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Embedding Endpoint')
      .setDesc('Base endpoint URL (for example https://openrouter.ai/api/v1 or http://localhost:11434).')
      .addText(text => text
        .setPlaceholder('https://openrouter.ai/api/v1')
        .setValue(this.plugin.settings.embeddings.endpoint)
        .onChange(async (value) => {
          this.plugin.settings.embeddings.endpoint = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Embedding API Key')
      .setDesc('API key for provider auth (if required).')
      .addText(text => text
        .setPlaceholder('sk-...')
        .setValue(this.plugin.settings.embeddings.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.embeddings.apiKey = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Embedding Model')
      .setDesc('Embedding model identifier.')
      .addText(text => text
        .setPlaceholder('qwen/qwen3-embedding-8b')
        .setValue(this.plugin.settings.embeddings.model)
        .onChange(async (value) => {
          this.plugin.settings.embeddings.model = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Embedding Instruction')
      .setDesc('Optional instruction/prefix included in cache key and provider request.')
      .addTextArea(text => text
        .setPlaceholder('Represent this chunk for retrieval...')
        .setValue(this.plugin.settings.embeddings.instruction)
        .onChange(async (value) => {
          this.plugin.settings.embeddings.instruction = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Embedding Batch Size')
      .setDesc('Number of chunks per embedding request.')
      .addText(text => text
        .setValue(this.plugin.settings.embeddings.batchSize.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue > 0) {
            this.plugin.settings.embeddings.batchSize = numValue;
            await this.plugin.saveData(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Embedding Timeout (ms)')
      .setDesc('Request timeout for embedding API calls.')
      .addText(text => text
        .setValue(this.plugin.settings.embeddings.timeoutMs.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 1000) {
            this.plugin.settings.embeddings.timeoutMs = numValue;
            await this.plugin.saveData(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Embedding Cache Directory')
      .setDesc('One-file-per-hash cache directory (relative to vault root or absolute path).')
      .addText(text => text
        .setPlaceholder('.obsidian/plugins/lore-vault/cache/embeddings')
        .setValue(this.plugin.settings.embeddings.cacheDir)
        .onChange(async (value) => {
          this.plugin.settings.embeddings.cacheDir = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('RAG Chunking Mode')
      .setDesc('Auto uses note-size heuristics. Note and section force deterministic strategies.')
      .addDropdown(dropdown => dropdown
        .addOptions({
          'auto': 'Auto',
          'note': 'Note',
          'section': 'Section'
        })
        .setValue(this.plugin.settings.embeddings.chunkingMode)
        .onChange(async (value) => {
          if (value === 'note' || value === 'section') {
            this.plugin.settings.embeddings.chunkingMode = value;
          } else {
            this.plugin.settings.embeddings.chunkingMode = 'auto';
          }
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Min Chunk Chars')
      .setDesc('Minimum target chunk size in characters.')
      .addText(text => text
        .setValue(this.plugin.settings.embeddings.minChunkChars.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 100) {
            this.plugin.settings.embeddings.minChunkChars = numValue;
            await this.plugin.saveData(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Max Chunk Chars')
      .setDesc('Maximum chunk size before splitting.')
      .addText(text => text
        .setValue(this.plugin.settings.embeddings.maxChunkChars.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= this.plugin.settings.embeddings.minChunkChars) {
            this.plugin.settings.embeddings.maxChunkChars = numValue;
            await this.plugin.saveData(this.plugin.settings);
          }
        }));

    new Setting(containerEl)
      .setName('Chunk Overlap Chars')
      .setDesc('Character overlap when splitting long chunks.')
      .addText(text => text
        .setValue(this.plugin.settings.embeddings.overlapChars.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 0) {
            this.plugin.settings.embeddings.overlapChars = numValue;
            await this.plugin.saveData(this.plugin.settings);
          }
        }));
  }
}
