import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import * as path from 'path';
import { GraphAnalyzer } from '../src/graph-analyzer';
import { DEFAULT_SETTINGS, LoreBookEntry } from '../src/models';

interface CalibrationFixture {
  cases: Array<{
    name: string;
    rootUid: number;
    entries: Array<{
      uid: number;
      group: string;
      wikilinks: string[];
    }>;
    expectedRankedUids: number[];
  }>;
}

function readFixture<T>(relativePath: string): T {
  const fixturePath = path.join(__dirname, '..', '..', 'fixtures', relativePath);
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as T;
}

function createEntry(uid: number, group: string, wikilinks: string[]): LoreBookEntry {
  return {
    uid,
    key: [`entity-${uid}`],
    keysecondary: [],
    comment: `Entity ${uid}`,
    content: `Content for entity ${uid}`,
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
    group,
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

test('default ranking weights match representative calibration fixtures', () => {
  const fixture = readFixture<CalibrationFixture>(path.join('graph', 'default-weights-representative.json'));

  for (const fixtureCase of fixture.cases) {
    const entries: {[key: number]: LoreBookEntry} = {};
    const filenameToUid: {[key: string]: number} = {};
    for (const entry of fixtureCase.entries) {
      entries[entry.uid] = createEntry(entry.uid, entry.group, entry.wikilinks);
      filenameToUid[`entity-${entry.uid}`] = entry.uid;
    }

    const settings = {
      ...DEFAULT_SETTINGS,
      outputPath: '',
      sqlite: {
        ...DEFAULT_SETTINGS.sqlite,
        enabled: false
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

    const analyzer = new GraphAnalyzer(entries, filenameToUid, settings, fixtureCase.rootUid);
    analyzer.buildGraph();
    analyzer.calculateEntryPriorities();

    const ranked = Object.values(entries)
      .sort((left, right) => right.order - left.order || left.uid - right.uid)
      .map(entry => entry.uid);

    assert.deepEqual(ranked, fixtureCase.expectedRankedUids, fixtureCase.name);
  }
});
