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
}

export const DEFAULT_SETTINGS: ConverterSettings = {
  tagScoping: {
    tagPrefix: 'lorebook',
    activeScope: '',
    membershipMode: 'exact',
    includeUntagged: false
  },
  weights: {
    hierarchy: 8000,
    in_degree: 4000,
    pagerank: 2000,
    betweenness: 1000,
    out_degree: 500,
    total_degree: 100,
    file_depth: 2000
  },
  outputPath: '',
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
    outputPath: ''
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
  }
};
