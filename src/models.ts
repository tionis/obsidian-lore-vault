// Define interfaces for our data structures
export interface LoreBookEntry {
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

export interface RagDocument {
  uid: number;
  title: string;
  path: string;
  content: string;
  scope: string;
}

export interface RagChunk {
  chunkId: string;
  docUid: number;
  scope: string;
  path: string;
  title: string;
  chunkIndex: number;
  heading: string;
  text: string;
  textHash: string;
  tokenEstimate: number;
  startOffset: number;
  endOffset: number;
}

export interface RagChunkEmbedding {
  chunkId: string;
  provider: string;
  model: string;
  dimensions: number;
  vector: number[];
  cacheKey: string;
  createdAt: number;
}

export type ScopePackRetrievalMode = 'auto' | 'world_info' | 'rag' | 'both' | 'none';
export type ScopePackSummarySource = 'section' | 'frontmatter' | 'body';

export interface ScopePackSourceNote {
  uid: number;
  scope: string;
  path: string;
  basename: string;
  title: string;
  tags: string[];
  lorebookScopes: string[];
  aliases: string[];
  keywords: string[];
  keysecondary: string[];
  retrievalMode: ScopePackRetrievalMode;
  includeWorldInfo: boolean;
  includeRag: boolean;
  summary: string;
  summarySource: ScopePackSummarySource;
  summaryHash: string;
  noteBody: string;
  noteBodyHash: string;
  wikilinks: string[];
  modifiedTime: number;
  sizeBytes: number;
}

export interface ScopePackNoteEmbedding {
  uid: number;
  scope: string;
  provider: string;
  model: string;
  dimensions: number;
  aggregation: 'mean_normalized';
  sourceChunkCount: number;
  cacheKey: string;
  createdAt: number;
  vector: number[];
}

export interface ScopePackBuildMetadata {
  format: 'lorevault.scope-pack';
  schemaVersion: number;
  pluginId: string;
  pluginVersion: string;
  buildMode: 'single_scope' | 'multi_scope';
  sourceFileCount: number;
  sourceNoteCount: number;
  explicitRootUid: number | null;
  settingsSnapshot: {
    tagScoping: ConverterSettings['tagScoping'];
    weights: ConverterSettings['weights'];
    defaultEntry: ConverterSettings['defaultEntry'];
    retrieval: ConverterSettings['retrieval'];
    summaries: ConverterSettings['summaries'];
    embeddings: {
      enabled: boolean;
      provider: ConverterSettings['embeddings']['provider'];
      endpoint: string;
      model: string;
      instruction: string;
      batchSize: number;
      timeoutMs: number;
      chunkingMode: ConverterSettings['embeddings']['chunkingMode'];
      minChunkChars: number;
      maxChunkChars: number;
      overlapChars: number;
    };
  };
  settingsSignature: string;
}

export interface ScopePack {
  schemaVersion: number;
  scope: string;
  generatedAt: number;
  metadata: ScopePackBuildMetadata;
  worldInfoEntries: LoreBookEntry[];
  ragDocuments: RagDocument[];
  ragChunks: RagChunk[];
  ragChunkEmbeddings: RagChunkEmbedding[];
  sourceNotes: ScopePackSourceNote[];
  noteEmbeddings: ScopePackNoteEmbedding[];
}

export interface LoreBookSettings {
  orderByTitle: boolean;
  useDroste: boolean;
  useRecursion: boolean;
  tokenBudget: number;
  recursionBudget: number;
}

export interface LoreBook {
  entries: {[key: string]: LoreBookEntry};
  settings: LoreBookSettings;
}

export type PromptLayerPlacement = 'system' | 'pre_history' | 'pre_response';
export type StorySteeringExtractionSanitization = 'strict' | 'off';

export interface PromptLayerUsage {
  layer: string;
  placement: PromptLayerPlacement;
  reservedTokens: number;
  usedTokens: number;
  headroomTokens: number;
  trimmed: boolean;
  trimReason?: string;
}

export interface ContinuitySelection {
  includePlotThreads: boolean;
  includeOpenLoops: boolean;
  includeCanonDeltas: boolean;
}

export interface StoryChatContextMeta {
  usedLorebookContext: boolean;
  usedManualContext: boolean;
  usedSpecificNotesContext: boolean;
  usedChapterMemoryContext?: boolean;
  usedInlineDirectives?: boolean;
  usedContinuityState?: boolean;
  scopes: string[];
  steeringSourceRefs?: string[];
  steeringSourceScopes?: string[];
  unresolvedSteeringSourceRefs?: string[];
  specificNotePaths: string[];
  unresolvedNoteRefs: string[];
  chapterMemoryItems?: string[];
  inlineDirectiveItems?: string[];
  continuityPlotThreads?: string[];
  continuityOpenLoops?: string[];
  continuityCanonDeltas?: string[];
  continuitySelection?: ContinuitySelection;
  layerTrace?: string[];
  layerUsage?: PromptLayerUsage[];
  overflowTrace?: string[];
  chatToolTrace?: string[];
  chatToolCalls?: string[];
  chatToolWrites?: string[];
  contextTokens: number;
  worldInfoCount: number;
  ragCount: number;
  worldInfoItems: string[];
  ragItems: string[];
}

export interface StoryChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  contextMeta?: StoryChatContextMeta;
}

export interface StoryChatForkSnapshot {
  id: string;
  title: string;
  createdAt: number;
  messages: StoryChatMessage[];
  selectedScopes: string[];
  useLorebookContext: boolean;
  manualContext: string;
  steeringScopeRefs: string[];
  pinnedInstructions: string;
  storyNotes: string;
  sceneIntent: string;
  continuityPlotThreads: string[];
  continuityOpenLoops: string[];
  continuityCanonDeltas: string[];
  continuitySelection: ContinuitySelection;
  noteContextRefs: string[];
}

export interface CompletionPreset {
  id: string;
  name: string;
  provider: 'openrouter' | 'ollama' | 'openai_compatible';
  endpoint: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxOutputTokens: number;
  contextWindowTokens: number;
  promptReserveTokens: number;
  timeoutMs: number;
}

export interface TextCommandPromptTemplate {
  id: string;
  name: string;
  prompt: string;
  includeLorebookContext: boolean;
}

export const DEFAULT_TEXT_COMMAND_PROMPT_TEMPLATES: TextCommandPromptTemplate[] = [
  {
    id: 'clarity-tighten',
    name: 'Tighten for Clarity',
    prompt: 'Rewrite for clarity and flow while preserving meaning, tone, and key details. Remove redundancy and awkward phrasing.',
    includeLorebookContext: false
  },
  {
    id: 'concise-trim',
    name: 'Make More Concise',
    prompt: 'Condense this text to be shorter and sharper while retaining essential facts and intent.',
    includeLorebookContext: false
  },
  {
    id: 'style-prose',
    name: 'Improve Prose Style',
    prompt: 'Refine sentence rhythm and word choice for polished narrative prose without changing plot facts.',
    includeLorebookContext: false
  },
  {
    id: 'dialogue-naturalize',
    name: 'Naturalize Dialogue',
    prompt: 'Rewrite dialogue so it sounds natural and character-consistent while preserving speaker intent.',
    includeLorebookContext: true
  },
  {
    id: 'canon-consistency',
    name: 'Canon Consistency Pass',
    prompt: 'Edit this text to maximize factual consistency with lorebook facts and established character/world canon. Preserve intent, voice, and pacing; change only what is needed to resolve canon conflicts.',
    includeLorebookContext: true
  }
];

export function cloneDefaultTextCommandPromptTemplates(): TextCommandPromptTemplate[] {
  return DEFAULT_TEXT_COMMAND_PROMPT_TEMPLATES.map(template => ({
    ...template
  }));
}

export interface ConverterSettings {
  tagScoping: {
    tagPrefix: string;
    activeScope: string;
    membershipMode: 'exact' | 'cascade';
    includeUntagged: boolean;
  };
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
  defaultLoreBook: {
    orderByTitle: boolean;
    useDroste: boolean;
    useRecursion: boolean;
    tokenBudget: number;
    recursionBudget: number;
  };
  defaultEntry: {
    constant: boolean;
    vectorized: boolean;
    selective: boolean;
    selectiveLogic: number;
    probability: number;
    depth: number;
    groupWeight: number;
  };
  sqlite: {
    enabled: boolean;
    outputPath: string;
    exportFreshnessPolicy?: 'manual' | 'on_build' | 'background_debounced';
    backgroundDebounceMs?: number;
    lastCanonicalExportByScope?: {[scope: string]: number};
  };
  embeddings: {
    enabled: boolean;
    provider: 'openrouter' | 'ollama' | 'openai_compatible';
    endpoint: string;
    apiKey: string;
    model: string;
    instruction: string;
    batchSize: number;
    timeoutMs: number;
    cacheDir: string;
    chunkingMode: 'auto' | 'note' | 'section';
    minChunkChars: number;
    maxChunkChars: number;
    overlapChars: number;
  };
  retrieval: {
    maxGraphHops: number;
    graphHopDecay: number;
    includeBacklinksInGraphExpansion: boolean;
    ragFallbackPolicy: 'off' | 'auto' | 'always';
    ragFallbackSeedScoreThreshold: number;
    toolCalls: {
      enabled: boolean;
      maxCallsPerTurn: number;
      maxResultTokensPerTurn: number;
      maxPlanningTimeMs: number;
    };
  };
  summaries: {
    promptVersion: number;
    maxInputChars: number;
    maxSummaryChars: number;
  };
  costTracking: {
    enabled: boolean;
    ledgerPath: string;
    defaultInputCostPerMillionUsd: number;
    defaultOutputCostPerMillionUsd: number;
    reportOutputDir: string;
    dailyBudgetUsd: number;
    sessionBudgetUsd: number;
    modelPricingOverrides: Array<{
      provider: string;
      modelPattern: string;
      inputCostPerMillionUsd: number;
      outputCostPerMillionUsd: number;
      updatedAt: number;
      source: 'manual' | 'provider_sync';
    }>;
    budgetByOperationUsd: {[operation: string]: number};
    budgetByModelUsd: {[providerModel: string]: number};
    budgetByScopeUsd: {[scope: string]: number};
  };
  operationLog: {
    enabled: boolean;
    path: string;
    maxEntries: number;
    includeEmbeddings: boolean;
  };
  completion: {
    enabled: boolean;
    provider: 'openrouter' | 'ollama' | 'openai_compatible';
    endpoint: string;
    apiKey: string;
    model: string;
    systemPrompt: string;
    temperature: number;
    maxOutputTokens: number;
    contextWindowTokens: number;
    promptReserveTokens: number;
    timeoutMs: number;
    layerPlacement: {
      pinnedInstructions: PromptLayerPlacement;
      storyNotes: PromptLayerPlacement;
      sceneIntent: PromptLayerPlacement;
      inlineDirectives: PromptLayerPlacement;
    };
    presets: CompletionPreset[];
    activePresetId: string;
  };
  storyChat: {
    chatFolder: string;
    activeConversationPath: string;
    selectedScopes: string[];
    useLorebookContext: boolean;
    manualContext: string;
    steeringScopeRefs: string[];
    pinnedInstructions: string;
    storyNotes: string;
    sceneIntent: string;
    continuityPlotThreads: string[];
    continuityOpenLoops: string[];
    continuityCanonDeltas: string[];
    continuitySelection: ContinuitySelection;
    noteContextRefs: string[];
    messages: StoryChatMessage[];
    forkSnapshots: StoryChatForkSnapshot[];
    maxMessages: number;
    toolCalls: {
      enabled: boolean;
      maxCallsPerTurn: number;
      maxResultTokensPerTurn: number;
      maxPlanningTimeMs: number;
      allowWriteActions: boolean;
    };
  };
  storySteering: {
    folder: string;
    extractionSanitization: StorySteeringExtractionSanitization;
  };
  textCommands: {
    autoAcceptEdits: boolean;
    defaultIncludeLorebookContext: boolean;
    maxContextTokens: number;
    systemPrompt: string;
    promptsFolder: string;
  };
}

export const DEFAULT_SETTINGS: ConverterSettings = {
  tagScoping: {
    tagPrefix: 'lorebook',
    activeScope: '',
    membershipMode: 'exact',
    includeUntagged: false
  },
  weights: {
    hierarchy: 3800,
    in_degree: 3300,
    pagerank: 3000,
    betweenness: 1700,
    out_degree: 700,
    total_degree: 250,
    file_depth: 850
  },
  outputPath: 'sillytavern/lorevault.json',
  defaultLoreBook: {
    orderByTitle: false,
    useDroste: true,
    useRecursion: true,
    tokenBudget: 2048,
    recursionBudget: 100
  },
  defaultEntry: {
    constant: false,
    vectorized: false,
    selective: true,
    selectiveLogic: 0,
    probability: 100,
    depth: 4,
    groupWeight: 100
  },
  sqlite: {
    enabled: true,
    outputPath: 'lorebooks/',
    exportFreshnessPolicy: 'on_build',
    backgroundDebounceMs: 1800,
    lastCanonicalExportByScope: {}
  },
  embeddings: {
    enabled: false,
    provider: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: 'qwen/qwen3-embedding-8b',
    instruction: '',
    batchSize: 16,
    timeoutMs: 45000,
    cacheDir: '.obsidian/plugins/lore-vault/cache/embeddings',
    chunkingMode: 'auto',
    minChunkChars: 300,
    maxChunkChars: 1800,
    overlapChars: 200
  },
  retrieval: {
    maxGraphHops: 2,
    graphHopDecay: 0.55,
    includeBacklinksInGraphExpansion: true,
    ragFallbackPolicy: 'auto',
    ragFallbackSeedScoreThreshold: 120,
    toolCalls: {
      enabled: false,
      maxCallsPerTurn: 4,
      maxResultTokensPerTurn: 1200,
      maxPlanningTimeMs: 8000
    }
  },
  summaries: {
    promptVersion: 1,
    maxInputChars: 12000,
    maxSummaryChars: 320
  },
  costTracking: {
    enabled: false,
    ledgerPath: '.obsidian/plugins/lore-vault/cache/usage-ledger.json',
    defaultInputCostPerMillionUsd: 0,
    defaultOutputCostPerMillionUsd: 0,
    reportOutputDir: '.obsidian/plugins/lore-vault/reports',
    dailyBudgetUsd: 0,
    sessionBudgetUsd: 0,
    modelPricingOverrides: [],
    budgetByOperationUsd: {},
    budgetByModelUsd: {},
    budgetByScopeUsd: {}
  },
  operationLog: {
    enabled: false,
    path: '.obsidian/plugins/lore-vault/cache/llm-operation-log.jsonl',
    maxEntries: 400,
    includeEmbeddings: false
  },
  completion: {
    enabled: false,
    provider: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: 'openai/gpt-4o-mini',
    systemPrompt: 'You are a story-writing assistant. Continue the story in the same tone, perspective, and tense. Use provided lore context as constraints. Output only the continuation text with no explanations or headings.',
    temperature: 0.7,
    maxOutputTokens: 700,
    contextWindowTokens: 8192,
    promptReserveTokens: 400,
    timeoutMs: 60000,
    layerPlacement: {
      pinnedInstructions: 'system',
      storyNotes: 'pre_history',
      sceneIntent: 'pre_response',
      inlineDirectives: 'pre_response'
    },
    presets: [],
    activePresetId: ''
  },
  storyChat: {
    chatFolder: 'LoreVault/chat',
    activeConversationPath: '',
    selectedScopes: [],
    useLorebookContext: true,
    manualContext: '',
    steeringScopeRefs: [],
    pinnedInstructions: '',
    storyNotes: '',
    sceneIntent: '',
    continuityPlotThreads: [],
    continuityOpenLoops: [],
    continuityCanonDeltas: [],
    continuitySelection: {
      includePlotThreads: true,
      includeOpenLoops: true,
      includeCanonDeltas: true
    },
    noteContextRefs: [],
    messages: [],
    forkSnapshots: [],
    maxMessages: 80,
    toolCalls: {
      enabled: false,
      maxCallsPerTurn: 6,
      maxResultTokensPerTurn: 2400,
      maxPlanningTimeMs: 10000,
      allowWriteActions: false
    }
  },
  storySteering: {
    folder: 'LoreVault/steering',
    extractionSanitization: 'strict'
  },
  textCommands: {
    autoAcceptEdits: false,
    defaultIncludeLorebookContext: false,
    maxContextTokens: 1400,
    systemPrompt: 'You are a precise editing assistant for markdown writing. Apply the user instruction to the provided text and return only the transformed text.',
    promptsFolder: 'LoreVault/prompts/text-commands'
  }
};
