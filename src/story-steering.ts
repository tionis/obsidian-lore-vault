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

export type StorySteeringCanonicalScopeType = 'global' | 'story' | 'chapter' | 'note';
export type StorySteeringScopeType = StorySteeringCanonicalScopeType | 'thread';

export interface StorySteeringScope {
  type: StorySteeringScopeType;
  key: string;
}

export interface StorySteeringScopeResolution {
  scope: StorySteeringScope;
  legacyScopes: StorySteeringScope[];
}

export interface StorySteeringScopeChainOptions {
  ensureScopeType?: StorySteeringCanonicalScopeType | null;
}

export interface StorySteeringState {
  authorNote: string;
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
  authorNote: ''
};

const NOTE_SCOPE_PREFIX = 'note:';
const STORY_STEERING_NOTE_ID_FRONTMATTER_KEY = 'lvNoteId';
const STORY_STEERING_STORY_ID_FRONTMATTER_KEY = 'lvStoryId';
const STORY_STEERING_CHAPTER_ID_FRONTMATTER_KEY = 'lvChapterId';

export function normalizeStorySteeringScopeType(value: string | null | undefined): StorySteeringCanonicalScopeType {
  if (value === 'story' || value === 'thread') {
    return 'story';
  }
  if (value === 'chapter' || value === 'note') {
    return value;
  }
  return 'global';
}

function normalizeTextField(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
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

function normalizeAuthorNoteBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return '';
  }

  const withoutTopHeading = trimmed
    .replace(/^#\s+LoreVault Steering\s*$/im, '')
    .replace(/^#\s+LoreVault Author Note\s*$/im, '')
    .trim();

  // Legacy structured steering files used many separate sections. Preserve intent by
  // normalizing those headings into one markdown author-note document.
  const sections = splitLevelTwoSections(withoutTopHeading);
  if (sections.length === 0) {
    return withoutTopHeading;
  }

  const lines: string[] = [];
  for (const section of sections) {
    const title = section.heading.trim();
    const bodyText = section.body.trim();
    if (!title || !bodyText || bodyText === '_None._') {
      continue;
    }

    if (/^(active lorebooks|lorebooks|lorebook scopes|active scopes)$/i.test(title)) {
      lines.push('## Active Lorebooks');
      lines.push('');
      const values = bodyText
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map(item => item.trim().replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, ''))
        .filter(Boolean);
      lines.push(...values.map(value => `- ${value}`));
      lines.push('');
      continue;
    }

    lines.push(`## ${title}`);
    lines.push('');
    lines.push(bodyText);
    lines.push('');
  }

  const normalized = lines.join('\n').trim();
  return normalized || withoutTopHeading;
}

export function createEmptyStorySteeringState(): StorySteeringState {
  return {
    ...EMPTY_STORY_STEERING_STATE
  };
}

export function normalizeStorySteeringState(input: Partial<StorySteeringState> | null | undefined): StorySteeringState {
  const state = input ?? {};
  return {
    authorNote: normalizeTextField(state.authorNote)
  };
}

export function parseStorySteeringMarkdown(markdown: string): StorySteeringState {
  const body = stripFrontmatter(markdown ?? '').trim();
  return normalizeStorySteeringState({
    authorNote: normalizeAuthorNoteBody(body)
  });
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

function looksLikeLorebookFact(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (/\b(who|what|where|when|why|how)\b/.test(normalized) && normalized.includes('?')) {
    return false;
  }

  if (/\b(keep|focus|avoid|ensure|escalate|resolve|foreshadow|tone|voice|pacing|intent|goal|constraint|must|should|do not|don't)\b/.test(normalized)) {
    return false;
  }

  if (/\b(appearance|looks|hair|eyes|height|weight|age|born|birth|backstory|biography|personality|occupation|species|race|nation|kingdom|city|worldbuilding|magic system)\b/.test(normalized)) {
    return true;
  }

  const simpleIdentity = normalized.replace(/[.!?]+$/g, '').trim();
  if (/^[a-z0-9 _'"-]{2,80}\s+is\s+(a|an)\s+[a-z0-9 _'"-]{2,120}$/i.test(simpleIdentity)) {
    return true;
  }

  return false;
}

function sanitizeExtractionTextField(value: string): string {
  if (!value) {
    return '';
  }
  const paragraphs = value
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map(item => item.trim())
    .filter(Boolean);
  const filtered = paragraphs.filter(item => !looksLikeLorebookFact(item));
  return filtered.join('\n\n').trim();
}

function toLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(item => item.trim().replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, ''))
      .filter(Boolean);
  }
  return [];
}

function buildLegacyAuthorNote(candidate: {[key: string]: unknown}): string {
  const sections: string[] = [];
  const textSections: Array<{title: string; keys: string[]}> = [
    { title: 'General Writing Instructions', keys: ['pinnedInstructions', 'pinned'] },
    { title: 'Story Notes', keys: ['storyNotes'] },
    { title: 'Scene Intent', keys: ['sceneIntent'] }
  ];
  const listSections: Array<{title: string; keys: string[]}> = [
    { title: 'Active Lorebooks', keys: ['activeLorebooks', 'lorebooks', 'lorebookScopes', 'activeScopes'] },
    { title: 'Active Plot Threads', keys: ['plotThreads'] },
    { title: 'Open Questions', keys: ['openLoops'] },
    { title: 'Canon Deltas', keys: ['canonDeltas'] }
  ];

  for (const section of textSections) {
    const rawValue = section.keys
      .map(key => candidate[key])
      .find(value => typeof value === 'string');
    const text = normalizeTextField(rawValue);
    if (!text) {
      continue;
    }
    sections.push(`## ${section.title}\n\n${text}`);
  }

  for (const section of listSections) {
    const rawValue = section.keys
      .map(key => candidate[key])
      .find(value => Array.isArray(value) || typeof value === 'string');
    const items = toLines(rawValue);
    if (items.length === 0) {
      continue;
    }
    sections.push(`## ${section.title}\n\n${items.map(item => `- ${item}`).join('\n')}`);
  }

  return sections.join('\n\n').trim();
}

export function sanitizeStorySteeringExtractionState(state: StorySteeringState): StorySteeringState {
  const normalized = normalizeStorySteeringState(state);
  return normalizeStorySteeringState({
    authorNote: sanitizeExtractionTextField(normalized.authorNote)
  });
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

  const directAuthorNote = normalizeTextField(candidate.authorNote);
  if (directAuthorNote) {
    return normalizeStorySteeringState({
      authorNote: directAuthorNote
    });
  }

  const legacyAuthorNote = buildLegacyAuthorNote(candidate);
  return normalizeStorySteeringState({
    authorNote: legacyAuthorNote
  });
}

function escapeYamlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function stringifyStorySteeringMarkdown(scope: StorySteeringScope, state: StorySteeringState): string {
  const scopeType = normalizeStorySteeringScopeType(scope.type);
  const normalized = normalizeStorySteeringState(state);
  return [
    '---',
    'type: lorevault-steering',
    `scopeType: ${scopeType}`,
    `scopeKey: "${escapeYamlString(scope.key)}"`,
    '---',
    '# LoreVault Author Note',
    '',
    normalized.authorNote || '_None._',
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
    authorNote: mergeTextLayers(normalized.map(state => state.authorNote))
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
  const canonicalType = normalizeStorySteeringScopeType(scope.type);
  const key = normalizeScopeKey(scope.key);
  if (canonicalType === 'global') {
    return joinVaultPath(root, 'global.md');
  }

  if (!key) {
    throw new Error(`Scope key is required for ${canonicalType} steering scope.`);
  }

  if (scope.type === 'thread') {
    return joinVaultPath(root, 'thread', buildScopedFilename(key, 'thread'));
  }
  if (canonicalType === 'story') {
    return joinVaultPath(root, 'story', buildScopedFilename(key, 'story'));
  }
  if (canonicalType === 'chapter') {
    return joinVaultPath(root, 'chapter', buildScopedFilename(key, 'chapter'));
  }
  return joinVaultPath(root, 'note', buildScopedFilename(key, 'note'));
}

function normalizeFrontmatterString(frontmatter: FrontmatterData, ...keys: string[]): string {
  return asString(getFrontmatterValue(frontmatter, ...keys)) ?? '';
}

function normalizeSteeringId(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._:-]/g, '');
}

function createFallbackUuidLike(): string {
  const hex = sha256Hex(`${Date.now()}-${Math.random()}-${Math.random()}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function createStorySteeringNoteId(): string {
  const cryptoRef = (globalThis as typeof globalThis & { crypto?: { randomUUID?: () => string } }).crypto;
  const randomUuid = cryptoRef?.randomUUID?.();
  const resolved = typeof randomUuid === 'string' && randomUuid.trim().length > 0
    ? randomUuid.trim().toLowerCase()
    : createFallbackUuidLike();
  return `lvn-${resolved}`;
}

function normalizeStorySteeringScopedBasename(filePath: string, fallback: string): string {
  const rawBasename = getVaultBasename(normalizeVaultPath(filePath))
    .replace(/\.md$/i, '')
    .trim();
  return slugifyIdentifier(rawBasename) || fallback;
}

export function createStorySteeringStoryId(filePath: string, noteId: string): string {
  const basename = normalizeStorySteeringScopedBasename(filePath, 'story');
  const idSource = normalizeSteeringId(noteId) || normalizeVaultPath(filePath);
  const suffix = sha256Hex(`story:${idSource}`).slice(0, 6);
  return `${basename}-${suffix}`;
}

export function createStorySteeringChapterId(filePath: string, noteId: string): string {
  const basename = normalizeStorySteeringScopedBasename(filePath, 'chapter');
  const idSource = normalizeSteeringId(noteId) || normalizeVaultPath(filePath);
  const suffix = sha256Hex(`chapter:${idSource}`).slice(0, 6);
  return `${basename}-${suffix}`;
}

function resolveNoteId(frontmatter: FrontmatterData): string {
  return normalizeSteeringId(normalizeFrontmatterString(frontmatter, 'lvNoteId', 'lorevaultNoteId'));
}

function buildNoteScopeKey(filePath: string, noteId: string): {key: string; legacyKey: string} {
  const normalizedPath = normalizeVaultPath(filePath);
  const normalizedNoteId = normalizeSteeringId(noteId);
  if (!normalizedNoteId) {
    return {
      key: normalizedPath,
      legacyKey: normalizedPath
    };
  }
  return {
    key: `${NOTE_SCOPE_PREFIX}${normalizedNoteId}`,
    legacyKey: normalizedPath
  };
}

export function buildStorySteeringScopeResolutions(
  filePath: string,
  frontmatter: FrontmatterData,
  noteId: string
): StorySteeringScopeResolution[] {
  const normalizedPath = normalizeVaultPath(filePath);
  const { key: noteScopeKey, legacyKey: noteLegacyKey } = buildNoteScopeKey(normalizedPath, noteId);
  const noteLegacyScopes = noteScopeKey !== noteLegacyKey
    ? [{ type: 'note' as const, key: noteLegacyKey }]
    : [];
  return [{
    scope: {
      type: 'note',
      key: noteScopeKey
    },
    legacyScopes: noteLegacyScopes
  }];
}

function toPrimaryScope(scope: StorySteeringScope): StorySteeringScope {
  const canonicalType = normalizeStorySteeringScopeType(scope.type);
  return {
    type: canonicalType,
    key: canonicalType === 'global' ? 'global' : scope.key
  };
}

function buildScopeResolutionWithAliases(scope: StorySteeringScope): StorySteeringScopeResolution {
  const primaryScope = toPrimaryScope(scope);
  const legacyScopes: StorySteeringScope[] = [];
  if (primaryScope.type === 'story') {
    legacyScopes.push({
      type: 'thread',
      key: primaryScope.key
    });
  }
  return {
    scope: primaryScope,
    legacyScopes
  };
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

  private readFrontmatter(file: TFile): FrontmatterData {
    const cache = this.app.metadataCache.getFileCache(file);
    return normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
  }

  private async ensureNoteIdentifierForFile(file: TFile, frontmatter: FrontmatterData): Promise<FrontmatterData> {
    const existingNoteId = resolveNoteId(frontmatter);
    if (existingNoteId) {
      return frontmatter;
    }

    const generatedNoteId = createStorySteeringNoteId();

    try {
      await this.app.fileManager.processFrontMatter(file, rawFrontmatter => {
        const normalizedCurrent = normalizeFrontmatter(rawFrontmatter as FrontmatterData);
        if (!resolveNoteId(normalizedCurrent)) {
          rawFrontmatter[STORY_STEERING_NOTE_ID_FRONTMATTER_KEY] = generatedNoteId;
        }
      });
      return this.readFrontmatter(file);
    } catch (error) {
      console.warn(
        `LoreVault: Failed to persist Story Steering note ID (${STORY_STEERING_NOTE_ID_FRONTMATTER_KEY}) for ${file.path}`,
        error
      );
      return frontmatter;
    }
  }

  private async resolveScopeResolutionsForFile(
    file: TFile | null,
    options?: StorySteeringScopeChainOptions
  ): Promise<StorySteeringScopeResolution[]> {
    if (!file) {
      return [];
    }

    const requestedType = normalizeStorySteeringScopeType(options?.ensureScopeType ?? 'note');
    if (requestedType === 'global') {
      return [{
        scope: { type: 'global', key: 'global' },
        legacyScopes: []
      }];
    }

    const frontmatter = await this.ensureNoteIdentifierForFile(
      file,
      this.readFrontmatter(file)
    );
    const noteId = resolveNoteId(frontmatter);
    return buildStorySteeringScopeResolutions(file.path, frontmatter, noteId);
  }

  private async readScopeByPath(path: string): Promise<StorySteeringState | null> {
    const exists = await this.app.vault.adapter.exists(path);
    if (!exists) {
      return null;
    }
    const markdown = await this.app.vault.adapter.read(path);
    return parseStorySteeringMarkdown(markdown);
  }

  private async loadScopeWithFallbacks(
    resolution: StorySteeringScopeResolution
  ): Promise<{state: StorySteeringState; filePath: string}> {
    const primaryPath = this.resolveScopePath(resolution.scope);
    const primaryState = await this.readScopeByPath(primaryPath);
    if (primaryState) {
      return {
        state: primaryState,
        filePath: primaryPath
      };
    }

    for (const legacyScope of resolution.legacyScopes) {
      const legacyPath = this.resolveScopePath(legacyScope);
      const legacyState = await this.readScopeByPath(legacyPath);
      if (!legacyState) {
        continue;
      }

      try {
        await this.saveScope(resolution.scope, legacyState);
        return {
          state: legacyState,
          filePath: primaryPath
        };
      } catch (error) {
        console.warn(`LoreVault: Failed to migrate legacy steering scope ${legacyPath} -> ${primaryPath}`, error);
        return {
          state: legacyState,
          filePath: legacyPath
        };
      }
    }

    return {
      state: createEmptyStorySteeringState(),
      filePath: primaryPath
    };
  }

  async loadScope(scope: StorySteeringScope): Promise<StorySteeringState> {
    const loaded = await this.loadScopeWithFallbacks(buildScopeResolutionWithAliases(scope));
    return loaded.state;
  }

  async saveScope(scope: StorySteeringScope, state: StorySteeringState): Promise<string> {
    const primaryScope = toPrimaryScope(scope);
    const path = this.resolveScopePath(primaryScope);
    const markdown = stringifyStorySteeringMarkdown(primaryScope, state);
    await ensureParentVaultFolderForFile(this.app, path);
    await this.app.vault.adapter.write(path, markdown);
    return path;
  }

  async getScopeChainForFile(file: TFile | null, options?: StorySteeringScopeChainOptions): Promise<StorySteeringScope[]> {
    const resolutions = await this.resolveScopeResolutionsForFile(file, options);
    return resolutions.map(item => item.scope);
  }

  async resolveEffectiveStateForFile(file: TFile | null): Promise<StorySteeringEffectiveState> {
    const scopeResolutions = await this.resolveScopeResolutionsForFile(file);
    const layers: StorySteeringLayer[] = [];

    for (const resolution of scopeResolutions) {
      const loaded = await this.loadScopeWithFallbacks(resolution);
      layers.push({
        scope: resolution.scope,
        filePath: loaded.filePath,
        state: loaded.state
      });
    }

    return {
      layers,
      merged: mergeStorySteeringStates(layers.map(layer => layer.state))
    };
  }
}
