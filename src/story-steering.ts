import type { App, TFile } from 'obsidian';
import {
  asString,
  asStringArray,
  FrontmatterData,
  getFrontmatterValue,
  normalizeFrontmatter,
  stripFrontmatter,
  uniqueStrings
} from './frontmatter-utils';
import { slugifyIdentifier } from './hash-utils';
import { normalizeLinkTarget } from './link-target-index';
import {
  ensureParentVaultFolderForFile,
  getVaultBasename,
  joinVaultPath,
  normalizeVaultPath,
  normalizeVaultRelativePath
} from './vault-path-utils';

export type StorySteeringScopeType = 'note';

export interface StorySteeringScope {
  type: 'note';
  key: string;
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

const DEFAULT_AUTHOR_NOTE_FOLDER = 'LoreVault/author-notes';
const AUTHOR_NOTE_FRONTMATTER_KEY = 'authorNote';
const AUTHOR_NOTE_DOC_TYPE_KEY = 'lvDocType';
const AUTHOR_NOTE_DOC_TYPE_VALUE = 'authorNote';

function isVaultMarkdownFile(value: unknown): value is TFile {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { path?: unknown; basename?: unknown };
  return typeof candidate.path === 'string' && typeof candidate.basename === 'string';
}

function normalizeTextField(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
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
    authorNote: body
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

export function sanitizeStorySteeringExtractionState(state: StorySteeringState): StorySteeringState {
  const normalized = normalizeStorySteeringState(state);
  return normalizeStorySteeringState({
    authorNote: sanitizeExtractionTextField(normalized.authorNote)
  });
}

export function parseStorySteeringExtractionResponse(raw: string): StorySteeringState {
  const payload = extractJsonPayload(raw);
  if (!payload || typeof payload !== 'object') {
    throw new Error('Author-note rewrite payload is not an object.');
  }

  const objectPayload = payload as {[key: string]: unknown};
  const directAuthorNote = normalizeTextField(objectPayload.authorNote);
  if (!directAuthorNote) {
    throw new Error('Author-note rewrite payload must include a non-empty `authorNote` field.');
  }

  return normalizeStorySteeringState({
    authorNote: directAuthorNote
  });
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
  return normalizeVaultPath(value.trim());
}

function normalizeFrontmatterString(frontmatter: FrontmatterData, ...keys: string[]): string {
  return asString(getFrontmatterValue(frontmatter, ...keys)) ?? '';
}

function normalizeLinkLikeValue(raw: string): string {
  let normalized = raw.trim();
  if (!normalized) {
    return '';
  }

  const wikiMatch = normalized.match(/^\[\[([\s\S]+)\]\]$/);
  if (wikiMatch) {
    normalized = wikiMatch[1].trim();
  }

  const markdownLinkMatch = normalized.match(/^\[[^\]]*\]\(([^)]+)\)$/);
  if (markdownLinkMatch) {
    normalized = markdownLinkMatch[1].trim();
  }

  const angleBracketMatch = normalized.match(/^<([\s\S]+)>$/);
  if (angleBracketMatch) {
    normalized = angleBracketMatch[1].trim();
  }

  const pipeIndex = normalized.indexOf('|');
  if (pipeIndex >= 0) {
    normalized = normalized.slice(0, pipeIndex).trim();
  }

  return normalizeLinkTarget(normalized);
}

function renderWikilink(filePath: string): string {
  const normalized = normalizeLinkTarget(filePath);
  return `[[${normalized}]]`;
}

function preserveFrontmatterWithBody(originalMarkdown: string, nextBody: string): string {
  const normalizedBody = nextBody.trim();
  const frontmatterMatch = originalMarkdown.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n)?/);
  if (!frontmatterMatch) {
    return normalizedBody ? `${normalizedBody}\n` : '';
  }

  if (!normalizedBody) {
    return frontmatterMatch[0];
  }

  return `${frontmatterMatch[0]}${normalizedBody}\n`;
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
      return DEFAULT_AUTHOR_NOTE_FOLDER;
    }
    return normalizeVaultRelativePath(raw);
  }

  private readFrontmatter(file: TFile): FrontmatterData {
    const cache = this.app.metadataCache.getFileCache(file);
    return normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
  }

  private resolveFileFromLinkTarget(target: string, sourcePath: string): TFile | null {
    const normalizedTarget = normalizeLinkLikeValue(target);
    if (!normalizedTarget) {
      return null;
    }

    const resolvedFromLink = this.app.metadataCache.getFirstLinkpathDest(normalizedTarget, sourcePath);
    if (isVaultMarkdownFile(resolvedFromLink)) {
      return resolvedFromLink;
    }

    const directCandidates = [normalizedTarget, `${normalizedTarget}.md`];
    for (const candidate of directCandidates) {
      const found = this.app.vault.getAbstractFileByPath(candidate);
      if (isVaultMarkdownFile(found)) {
        return found;
      }
    }

    const basename = getVaultBasename(normalizedTarget);
    const byBasename = this.app.vault
      .getMarkdownFiles()
      .filter(file => file.basename.localeCompare(basename, undefined, { sensitivity: 'accent' }) === 0);
    if (byBasename.length === 1) {
      return byBasename[0];
    }

    return null;
  }

  private resolveAuthorNoteTargetFromFrontmatter(frontmatter: FrontmatterData): string {
    const rawValue = getFrontmatterValue(frontmatter, AUTHOR_NOTE_FRONTMATTER_KEY);
    const listValue = asStringArray(rawValue).map(item => normalizeLinkLikeValue(item)).filter(Boolean);
    if (listValue.length > 0) {
      return listValue[0];
    }
    return normalizeLinkLikeValue(asString(rawValue) ?? '');
  }

  public getAuthorNoteRefForStory(file: TFile | null): string {
    if (!file) {
      return '';
    }
    const frontmatter = this.readFrontmatter(file);
    return this.resolveAuthorNoteTargetFromFrontmatter(frontmatter);
  }

  private resolveAuthorNoteFileForStoryWithRef(file: TFile | null): {file: TFile | null; ref: string} {
    if (!file) {
      return { file: null, ref: '' };
    }

    const frontmatter = this.readFrontmatter(file);
    const ref = this.resolveAuthorNoteTargetFromFrontmatter(frontmatter);
    if (!ref) {
      return { file: null, ref };
    }

    const resolved = this.resolveFileFromLinkTarget(ref, file.path);
    return {
      file: resolved,
      ref
    };
  }

  async resolveAuthorNoteFileForStory(file: TFile | null): Promise<TFile | null> {
    return this.resolveAuthorNoteFileForStoryWithRef(file).file;
  }

  private buildDefaultAuthorNotePath(storyFile: TFile): string {
    const folderPath = this.resolveFolderPath();
    const stem = slugifyIdentifier(`${storyFile.basename}-author-note`) || 'author-note';
    return joinVaultPath(folderPath, `${stem}.md`);
  }

  private async updateStoryAuthorNoteLink(storyFile: TFile, authorNoteFile: TFile): Promise<void> {
    await this.app.fileManager.processFrontMatter(storyFile, frontmatter => {
      frontmatter[AUTHOR_NOTE_FRONTMATTER_KEY] = renderWikilink(authorNoteFile.path);
    });
  }

  private async ensureAuthorNoteMetadata(authorNoteFile: TFile, _storyFile: TFile): Promise<void> {
    await this.app.fileManager.processFrontMatter(authorNoteFile, frontmatter => {
      const docTypeRaw = typeof frontmatter[AUTHOR_NOTE_DOC_TYPE_KEY] === 'string'
        ? String(frontmatter[AUTHOR_NOTE_DOC_TYPE_KEY]).trim()
        : '';
      if (!docTypeRaw) {
        frontmatter[AUTHOR_NOTE_DOC_TYPE_KEY] = AUTHOR_NOTE_DOC_TYPE_VALUE;
      }
    });
  }

  async ensureAuthorNoteForStory(storyFile: TFile): Promise<TFile> {
    const resolvedExisting = this.resolveAuthorNoteFileForStoryWithRef(storyFile).file;
    if (resolvedExisting) {
      await this.ensureAuthorNoteMetadata(resolvedExisting, storyFile);
      return resolvedExisting;
    }

    const initialPath = this.buildDefaultAuthorNotePath(storyFile);
    let candidatePath = initialPath;
    let suffix = 2;
    while (await this.app.vault.adapter.exists(candidatePath)) {
      candidatePath = initialPath.replace(/\.md$/i, `-${suffix}.md`);
      suffix += 1;
    }

    const initialMarkdown = [
      '---',
      `${AUTHOR_NOTE_DOC_TYPE_KEY}: ${AUTHOR_NOTE_DOC_TYPE_VALUE}`,
      '---',
      '',
      '## Author Note',
      ''
    ].join('\n');

    await ensureParentVaultFolderForFile(this.app, candidatePath);
    await this.app.vault.adapter.write(candidatePath, initialMarkdown);

    const created = this.app.vault.getAbstractFileByPath(candidatePath);
    if (!isVaultMarkdownFile(created)) {
      throw new Error(`Failed to create author note at ${candidatePath}`);
    }

    await this.updateStoryAuthorNoteLink(storyFile, created);
    return created;
  }

  async getLinkedStoryFilesForAuthorNote(authorNoteFile: TFile): Promise<TFile[]> {
    const linked = new Map<string, TFile>();
    const files = [...this.app.vault.getMarkdownFiles()].sort((left, right) => left.path.localeCompare(right.path));
    for (const candidate of files) {
      if (candidate.path === authorNoteFile.path) {
        continue;
      }
      const resolved = this.resolveAuthorNoteFileForStoryWithRef(candidate).file;
      if (!isVaultMarkdownFile(resolved) || resolved.path !== authorNoteFile.path) {
        continue;
      }
      linked.set(candidate.path, candidate);
    }

    return [...linked.values()].sort((left, right) => left.path.localeCompare(right.path));
  }

  async isAuthorNoteFile(file: TFile | null): Promise<boolean> {
    if (!file) {
      return false;
    }

    const frontmatter = this.readFrontmatter(file);
    const docType = normalizeFrontmatterString(frontmatter, AUTHOR_NOTE_DOC_TYPE_KEY).toLowerCase();
    if (docType === AUTHOR_NOTE_DOC_TYPE_VALUE.toLowerCase()) {
      return true;
    }

    const linkedStories = await this.getLinkedStoryFilesForAuthorNote(file);
    return linkedStories.length > 0;
  }

  resolveScopePath(scope: StorySteeringScope): string {
    return normalizeScopeKey(scope.key);
  }

  private async readScopeByPath(path: string): Promise<StorySteeringState | null> {
    const normalizedPath = normalizeVaultPath(path);
    if (!normalizedPath) {
      return null;
    }

    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!isVaultMarkdownFile(file)) {
      return null;
    }

    const markdown = await this.app.vault.cachedRead(file);
    return parseStorySteeringMarkdown(markdown);
  }

  private async writeScopeByPath(path: string, state: StorySteeringState): Promise<string> {
    const normalizedPath = normalizeVaultPath(path);
    if (!normalizedPath) {
      throw new Error('Author note path is required.');
    }

    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!isVaultMarkdownFile(file)) {
      throw new Error(`Author note file not found: ${normalizedPath}`);
    }

    const existingMarkdown = await this.app.vault.cachedRead(file);
    const nextMarkdown = preserveFrontmatterWithBody(existingMarkdown, normalizeStorySteeringState(state).authorNote);
    await this.app.vault.modify(file, nextMarkdown);
    return file.path;
  }

  async loadScope(scope: StorySteeringScope): Promise<StorySteeringState> {
    const path = this.resolveScopePath(scope);
    const loaded = await this.readScopeByPath(path);
    return loaded ?? createEmptyStorySteeringState();
  }

  async saveScope(scope: StorySteeringScope, state: StorySteeringState): Promise<string> {
    const path = this.resolveScopePath(scope);
    return this.writeScopeByPath(path, state);
  }

  async getScopeChainForFile(file: TFile | null): Promise<StorySteeringScope[]> {
    const scope = await this.getScopeForFile(file);
    return scope ? [scope] : [];
  }

  async getScopeForFile(file: TFile | null): Promise<StorySteeringScope | null> {
    if (!file) {
      return null;
    }

    const resolvedFromStory = await this.resolveAuthorNoteFileForStory(file);
    if (resolvedFromStory) {
      return {
        type: 'note',
        key: normalizeVaultPath(resolvedFromStory.path)
      };
    }

    if (await this.isAuthorNoteFile(file)) {
      return {
        type: 'note',
        key: normalizeVaultPath(file.path)
      };
    }

    return null;
  }

  async resolveEffectiveStateForFile(file: TFile | null): Promise<StorySteeringEffectiveState> {
    const scope = await this.getScopeForFile(file);
    if (!scope) {
      return {
        layers: [],
        merged: createEmptyStorySteeringState()
      };
    }

    const state = await this.loadScope(scope);
    const layer: StorySteeringLayer = {
      scope,
      filePath: scope.key,
      state
    };

    return {
      layers: [layer],
      merged: mergeStorySteeringStates([state])
    };
  }
}
