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

export interface ScopePack {
  schemaVersion: number;
  scope: string;
  generatedAt: number;
  worldInfoEntries: LoreBookEntry[];
  ragDocuments: RagDocument[];
  ragChunks: RagChunk[];
  ragChunkEmbeddings: RagChunkEmbedding[];
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

export interface StoryChatContextMeta {
  usedLorebookContext: boolean;
  usedManualContext: boolean;
  usedSpecificNotesContext: boolean;
  usedChapterMemoryContext?: boolean;
  scopes: string[];
  specificNotePaths: string[];
  unresolvedNoteRefs: string[];
  chapterMemoryItems?: string[];
  layerTrace?: string[];
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
    worldInfo: {
      useGeneratedSummary: boolean;
    };
    chapter: {
      useGeneratedSummary: boolean;
    };
  };
  costTracking: {
    enabled: boolean;
    ledgerPath: string;
    defaultInputCostPerMillionUsd: number;
    defaultOutputCostPerMillionUsd: number;
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
    presets: CompletionPreset[];
    activePresetId: string;
  };
  storyChat: {
    chatFolder: string;
    activeConversationPath: string;
    selectedScopes: string[];
    useLorebookContext: boolean;
    manualContext: string;
    noteContextRefs: string[];
    messages: StoryChatMessage[];
    forkSnapshots: StoryChatForkSnapshot[];
    maxMessages: number;
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
    outputPath: 'lorebooks/'
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
    maxSummaryChars: 320,
    worldInfo: {
      useGeneratedSummary: true
    },
    chapter: {
      useGeneratedSummary: true
    }
  },
  costTracking: {
    enabled: false,
    ledgerPath: '.obsidian/plugins/lore-vault/cache/usage-ledger.json',
    defaultInputCostPerMillionUsd: 0,
    defaultOutputCostPerMillionUsd: 0
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
    presets: [],
    activePresetId: ''
  },
  storyChat: {
    chatFolder: 'LoreVault/chat',
    activeConversationPath: '',
    selectedScopes: [],
    useLorebookContext: true,
    manualContext: '',
    noteContextRefs: [],
    messages: [],
    forkSnapshots: [],
    maxMessages: 80
  }
};
