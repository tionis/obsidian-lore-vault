import { App, TFile } from 'obsidian';
import {
  asString,
  FrontmatterData,
  getFrontmatterValue,
  normalizeFrontmatter,
  stripFrontmatter,
  uniqueStrings
} from './frontmatter-utils';
import { sha256Hex, slugifyIdentifier } from './hash-utils';
import {
  ensureParentVaultFolderForFile,
  getVaultBasename,
  joinVaultPath,
  normalizeVaultPath,
  normalizeVaultRelativePath
} from './vault-path-utils';

export type StorySteeringScopeType = 'global' | 'thread' | 'chapter' | 'note';

export interface StorySteeringScope {
  type: StorySteeringScopeType;
  key: string;
}

export interface StorySteeringState {
  pinnedInstructions: string;
  storyNotes: string;
  sceneIntent: string;
  plotThreads: string[];
  openLoops: string[];
  canonDeltas: string[];
}

export interface StorySteeringLayer {
  scope: StorySteeringScope;
  filePath: string;
  state: StorySteeringState;
}

export interface StorySteeringEffectiveState {
  layers: StorySteeringLayer[];
  merged: StorySteeringState;
}

const EMPTY_STORY_STEERING_STATE: StorySteeringState = {
  pinnedInstructions: '',
  storyNotes: '',
  sceneIntent: '',
  plotThreads: [],
  openLoops: [],
  canonDeltas: []
};

const TEXT_SECTION_BY_HEADING: {[key: string]: keyof Pick<StorySteeringState, 'pinnedInstructions' | 'storyNotes' | 'sceneIntent'>} = {
  'pinned instructions': 'pinnedInstructions',
  'story notes': 'storyNotes',
  'scene intent': 'sceneIntent'
};

const LIST_SECTION_BY_HEADING: {[key: string]: keyof Pick<StorySteeringState, 'plotThreads' | 'openLoops' | 'canonDeltas'>} = {
  'active plot threads': 'plotThreads',
  'plot threads': 'plotThreads',
  'open loops': 'openLoops',
  'unresolved commitments': 'openLoops',
  'canon deltas': 'canonDeltas',
  'recent canon deltas': 'canonDeltas'
};

function normalizeTextField(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function normalizeListField(values: string[]): string[] {
  return uniqueStrings(values.map(item => item.trim()).filter(Boolean));
}

function collectListItems(sectionText: string): string[] {
  const items: string[] = [];
  const lines = sectionText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line === '_None._' || line === '[none]' || line === '(none)') {
      continue;
    }

    const bulletMatch = line.match(/^[-*+]\s+(.+)$/);
    if (bulletMatch) {
      items.push(bulletMatch[1].trim());
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      items.push(orderedMatch[1].trim());
      continue;
    }

    items.push(line);
  }

  return normalizeListField(items);
}

function splitLevelTwoSections(markdown: string): Array<{heading: string; body: string}> {
  const normalized = stripFrontmatter(markdown ?? '').replace(/\r\n?/g, '\n');
  const headingRegex = /^##\s+(.+)$/gm;
  const sections: Array<{heading: string; start: number; end: number}> = [];
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(normalized)) !== null) {
    sections.push({
      heading: match[1].trim(),
      start: match.index,
      end: headingRegex.lastIndex
    });
  }

  const resolved: Array<{heading: string; body: string}> = [];
  for (let index = 0; index < sections.length; index += 1) {
    const current = sections[index];
    const next = sections[index + 1];
    const sectionBody = normalized.slice(
      current.end,
      next ? next.start : normalized.length
    );
    resolved.push({
      heading: current.heading,
      body: sectionBody.trim()
    });
  }

  return resolved;
}

export function createEmptyStorySteeringState(): StorySteeringState {
  return {
    ...EMPTY_STORY_STEERING_STATE,
    plotThreads: [],
    openLoops: [],
    canonDeltas: []
  };
}

export function normalizeStorySteeringState(input: Partial<StorySteeringState> | null | undefined): StorySteeringState {
  const state = input ?? {};
  return {
    pinnedInstructions: normalizeTextField(state.pinnedInstructions),
    storyNotes: normalizeTextField(state.storyNotes),
    sceneIntent: normalizeTextField(state.sceneIntent),
    plotThreads: normalizeListField(Array.isArray(state.plotThreads) ? state.plotThreads : []),
    openLoops: normalizeListField(Array.isArray(state.openLoops) ? state.openLoops : []),
    canonDeltas: normalizeListField(Array.isArray(state.canonDeltas) ? state.canonDeltas : [])
  };
}

export function parseStorySteeringMarkdown(markdown: string): StorySteeringState {
  const next = createEmptyStorySteeringState();
  const sections = splitLevelTwoSections(markdown);
  for (const section of sections) {
    const heading = section.heading.trim().toLowerCase();
    const textKey = TEXT_SECTION_BY_HEADING[heading];
    if (textKey) {
      next[textKey] = normalizeTextField(section.body);
      continue;
    }

    const listKey = LIST_SECTION_BY_HEADING[heading];
    if (listKey) {
      next[listKey] = collectListItems(section.body);
    }
  }

  return normalizeStorySteeringState(next);
}

function extractJsonPayload(raw: string): unknown {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('Response did not contain a JSON object.');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function parseExtractionList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeListField(
      value
        .map(item => (typeof item === 'string' ? item : ''))
        .filter(Boolean)
    );
  }
  if (typeof value === 'string') {
    return normalizeListField(
      value
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map(item => item.trim().replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, ''))
        .filter(Boolean)
    );
  }
  return [];
}

export function parseStorySteeringExtractionResponse(raw: string): StorySteeringState {
  const payload = extractJsonPayload(raw);
  if (!payload || typeof payload !== 'object') {
    throw new Error('Steering extraction payload is not an object.');
  }

  const objectPayload = payload as {[key: string]: unknown};
  const candidate = (objectPayload.state && typeof objectPayload.state === 'object')
    ? (objectPayload.state as {[key: string]: unknown})
    : objectPayload;

  return normalizeStorySteeringState({
    pinnedInstructions: normalizeTextField(candidate.pinnedInstructions),
    storyNotes: normalizeTextField(candidate.storyNotes),
    sceneIntent: normalizeTextField(candidate.sceneIntent),
    plotThreads: parseExtractionList(candidate.plotThreads),
    openLoops: parseExtractionList(candidate.openLoops),
    canonDeltas: parseExtractionList(candidate.canonDeltas)
  });
}

function renderListSection(items: string[]): string {
  if (items.length === 0) {
    return '_None._';
  }
  return items.map(item => `- ${item}`).join('\n');
}

function escapeYamlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function stringifyStorySteeringMarkdown(scope: StorySteeringScope, state: StorySteeringState): string {
  const normalized = normalizeStorySteeringState(state);
  return [
    '---',
    'type: lorevault-steering',
    `scopeType: ${scope.type}`,
    `scopeKey: "${escapeYamlString(scope.key)}"`,
    '---',
    '# LoreVault Steering',
    '',
    '## Pinned Instructions',
    '',
    normalized.pinnedInstructions || '_None._',
    '',
    '## Story Notes',
    '',
    normalized.storyNotes || '_None._',
    '',
    '## Scene Intent',
    '',
    normalized.sceneIntent || '_None._',
    '',
    '## Active Plot Threads',
    '',
    renderListSection(normalized.plotThreads),
    '',
    '## Open Loops',
    '',
    renderListSection(normalized.openLoops),
    '',
    '## Canon Deltas',
    '',
    renderListSection(normalized.canonDeltas),
    ''
  ].join('\n');
}

function mergeTextLayers(values: string[]): string {
  const unique = uniqueStrings(values.map(value => value.trim()).filter(Boolean));
  return unique.join('\n\n');
}

export function mergeStorySteeringStates(states: StorySteeringState[]): StorySteeringState {
  const normalized = states.map(state => normalizeStorySteeringState(state));
  return {
    pinnedInstructions: mergeTextLayers(normalized.map(state => state.pinnedInstructions)),
    storyNotes: mergeTextLayers(normalized.map(state => state.storyNotes)),
    sceneIntent: mergeTextLayers(normalized.map(state => state.sceneIntent)),
    plotThreads: uniqueStrings(normalized.flatMap(state => state.plotThreads)),
    openLoops: uniqueStrings(normalized.flatMap(state => state.openLoops)),
    canonDeltas: uniqueStrings(normalized.flatMap(state => state.canonDeltas))
  };
}

function normalizeScopeKey(value: string): string {
  return value.trim();
}

function buildScopedFilename(key: string, fallbackPrefix: string): string {
  const basename = getVaultBasename(key) || key || fallbackPrefix;
  const slug = slugifyIdentifier(basename) || fallbackPrefix;
  const suffix = sha256Hex(key).slice(0, 10);
  return `${slug}-${suffix}.md`;
}

export function buildStorySteeringFilePath(folderPath: string, scope: StorySteeringScope): string {
  const root = normalizeVaultRelativePath(folderPath);
  const key = normalizeScopeKey(scope.key);
  if (scope.type === 'global') {
    return joinVaultPath(root, 'global.md');
  }

  if (!key) {
    throw new Error(`Scope key is required for ${scope.type} steering scope.`);
  }

  if (scope.type === 'thread') {
    return joinVaultPath(root, 'thread', buildScopedFilename(key, 'thread'));
  }
  if (scope.type === 'chapter') {
    return joinVaultPath(root, 'chapter', buildScopedFilename(key, 'chapter'));
  }
  return joinVaultPath(root, 'note', buildScopedFilename(key, 'note'));
}

function normalizeFrontmatterString(frontmatter: FrontmatterData, ...keys: string[]): string {
  return asString(getFrontmatterValue(frontmatter, ...keys)) ?? '';
}

function resolveThreadKey(frontmatter: FrontmatterData): string {
  return normalizeFrontmatterString(frontmatter, 'storyId', 'threadId', 'thread', 'story', 'lvThread');
}

function resolveChapterValue(frontmatter: FrontmatterData): string {
  return normalizeFrontmatterString(frontmatter, 'chapterId', 'chapter');
}

function buildChapterKey(threadKey: string, notePath: string, chapterValue: string): string {
  if (threadKey) {
    return `${threadKey}::chapter:${chapterValue}`;
  }
  return `${normalizeVaultPath(notePath)}::chapter:${chapterValue}`;
}

function buildScopeChainForFile(file: TFile | null, frontmatter: FrontmatterData): StorySteeringScope[] {
  const scopes: StorySteeringScope[] = [{ type: 'global', key: 'global' }];
  if (!file) {
    return scopes;
  }

  const threadKey = resolveThreadKey(frontmatter);
  if (threadKey) {
    scopes.push({ type: 'thread', key: threadKey });
  }

  const chapterValue = resolveChapterValue(frontmatter);
  if (chapterValue) {
    scopes.push({
      type: 'chapter',
      key: buildChapterKey(threadKey, file.path, chapterValue)
    });
  }

  scopes.push({
    type: 'note',
    key: normalizeVaultPath(file.path)
  });
  return scopes;
}

export class StorySteeringStore {
  private app: App;
  private getFolderPath: () => string;

  constructor(app: App, getFolderPath: () => string) {
    this.app = app;
    this.getFolderPath = getFolderPath;
  }

  private resolveFolderPath(): string {
    const raw = this.getFolderPath().trim();
    if (!raw) {
      return 'LoreVault/steering';
    }
    return normalizeVaultRelativePath(raw);
  }

  resolveScopePath(scope: StorySteeringScope): string {
    return buildStorySteeringFilePath(this.resolveFolderPath(), scope);
  }

  async loadScope(scope: StorySteeringScope): Promise<StorySteeringState> {
    const path = this.resolveScopePath(scope);
    const exists = await this.app.vault.adapter.exists(path);
    if (!exists) {
      return createEmptyStorySteeringState();
    }

    const markdown = await this.app.vault.adapter.read(path);
    return parseStorySteeringMarkdown(markdown);
  }

  async saveScope(scope: StorySteeringScope, state: StorySteeringState): Promise<string> {
    const path = this.resolveScopePath(scope);
    const markdown = stringifyStorySteeringMarkdown(scope, state);
    await ensureParentVaultFolderForFile(this.app, path);
    await this.app.vault.adapter.write(path, markdown);
    return path;
  }

  getScopeChainForFile(file: TFile | null): StorySteeringScope[] {
    if (!file) {
      return [{ type: 'global', key: 'global' }];
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    return buildScopeChainForFile(file, frontmatter);
  }

  async resolveEffectiveStateForFile(file: TFile | null): Promise<StorySteeringEffectiveState> {
    const scopes = this.getScopeChainForFile(file);
    const layers: StorySteeringLayer[] = [];

    for (const scope of scopes) {
      const filePath = this.resolveScopePath(scope);
      const state = await this.loadScope(scope);
      layers.push({
        scope,
        filePath,
        state
      });
    }

    return {
      layers,
      merged: mergeStorySteeringStates(layers.map(layer => layer.state))
    };
  }
}
