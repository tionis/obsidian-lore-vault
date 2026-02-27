import { performance } from 'perf_hooks';
import { GraphAnalyzer } from '../src/graph-analyzer';
import { assembleScopeContext, ScopeContextPack } from '../src/context-query';
import { ConverterSettings, DEFAULT_SETTINGS, LoreBookEntry, RagDocument } from '../src/models';

interface ProfileOptions {
  entries: number;
  avgLinks: number;
  contentChars: number;
  runs: number;
}

function parseIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function getOptions(): ProfileOptions {
  return {
    entries: parseIntegerEnv('LOREVAULT_PROFILE_ENTRIES', 3000, 200, 20000),
    avgLinks: parseIntegerEnv('LOREVAULT_PROFILE_AVG_LINKS', 5, 1, 40),
    contentChars: parseIntegerEnv('LOREVAULT_PROFILE_CONTENT_CHARS', 420, 120, 6000),
    runs: parseIntegerEnv('LOREVAULT_PROFILE_RUNS', 3, 1, 12)
  };
}

function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function createSettings(): ConverterSettings {
  return {
    ...DEFAULT_SETTINGS,
    outputPath: '',
    sqlite: {
      enabled: false,
      outputPath: ''
    },
    embeddings: {
      ...DEFAULT_SETTINGS.embeddings,
      enabled: false
    },
    completion: {
      ...DEFAULT_SETTINGS.completion,
      enabled: false
    }
  };
}

function createEntry(uid: number, title: string, content: string, wikilinks: string[]): LoreBookEntry {
  return {
    uid,
    key: [title.toLowerCase()],
    keysecondary: [],
    comment: title,
    content,
    constant: false,
    vectorized: false,
    selective: true,
    selectiveLogic: 0,
    addMemo: true,
    order: 0,
    position: 0,
    disable: false,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: false,
    probability: 100,
    useProbability: true,
    depth: 4,
    group: `world/${Math.floor(uid / 60)}`,
    groupOverride: false,
    groupWeight: 100,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    role: null,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    displayIndex: 0,
    wikilinks
  };
}

function createSyntheticDataset(options: ProfileOptions): {
  entriesByUid: {[key: number]: LoreBookEntry};
  filenameToUid: {[key: string]: number};
  ragDocuments: RagDocument[];
} {
  const rng = createRng(1337);
  const entriesByUid: {[key: number]: LoreBookEntry} = {};
  const filenameToUid: {[key: string]: number} = {};
  const ragDocuments: RagDocument[] = [];

  for (let uid = 1; uid <= options.entries; uid += 1) {
    const title = uid % 97 === 0
      ? `東京-${uid}`
      : (uid % 89 === 0 ? `герой-${uid}` : `Entity-${uid}`);
    const pathName = `entity-${uid}`;

    const links = new Set<string>();
    const linkCount = Math.max(1, Math.floor(rng() * options.avgLinks * 2));
    for (let index = 0; index < linkCount; index += 1) {
      const target = 1 + Math.floor(rng() * options.entries);
      if (target === uid) {
        continue;
      }
      links.add(`entity-${target}`);
    }

    const contentSeed = [
      `Profile ${title}.`,
      'Chronicle context',
      'alliances and factions',
      `uid:${uid}`
    ].join(' ');
    let content = contentSeed;
    while (content.length < options.contentChars) {
      content += ` ${contentSeed}`;
    }
    content = content.slice(0, options.contentChars);

    entriesByUid[uid] = createEntry(uid, title, content, [...links].sort((a, b) => a.localeCompare(b)));
    filenameToUid[pathName] = uid;
    ragDocuments.push({
      uid,
      title,
      path: `notes/${pathName}.md`,
      content,
      scope: 'profile'
    });
  }

  return {
    entriesByUid,
    filenameToUid,
    ragDocuments
  };
}

function measureMs(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

function runProfile(options: ProfileOptions): void {
  const dataset = createSyntheticDataset(options);
  const settings = createSettings();
  const entryList = Object.values(dataset.entriesByUid).sort((a, b) => a.uid - b.uid);

  let graphBuildMs = 0;
  let graphRankMs = 0;
  let queryMs = 0;
  let selectedWorldInfo = 0;
  let selectedRag = 0;

  for (let run = 0; run < options.runs; run += 1) {
    const analyzer = new GraphAnalyzer(
      dataset.entriesByUid,
      dataset.filenameToUid,
      settings,
      1
    );

    graphBuildMs += measureMs(() => analyzer.buildGraph());
    graphRankMs += measureMs(() => analyzer.calculateEntryPriorities());

    const pack: ScopeContextPack = {
      scope: 'profile',
      builtAt: Date.now(),
      worldInfoEntries: entryList,
      ragDocuments: dataset.ragDocuments,
      ragChunks: [],
      ragChunkEmbeddings: []
    };

    const queryStart = performance.now();
    const context = assembleScopeContext(pack, {
      queryText: 'entity-42 alliance chronicle 東京 герой',
      tokenBudget: 3500,
      ragFallbackPolicy: 'always'
    });
    queryMs += performance.now() - queryStart;
    selectedWorldInfo += context.worldInfo.length;
    selectedRag += context.rag.length;
  }

  const summary = {
    options,
    averages: {
      graphBuildMs: Number((graphBuildMs / options.runs).toFixed(2)),
      graphRankMs: Number((graphRankMs / options.runs).toFixed(2)),
      queryMs: Number((queryMs / options.runs).toFixed(2)),
      selectedWorldInfo: Number((selectedWorldInfo / options.runs).toFixed(2)),
      selectedRag: Number((selectedRag / options.runs).toFixed(2))
    }
  };

  console.log('[LoreVault profile:large-vault]');
  console.log(JSON.stringify(summary, null, 2));
}

runProfile(getOptions());
