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

export const DEFAULT_SETTINGS: ConverterSettings = {
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