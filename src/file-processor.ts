import { App, TFile, getAllTags } from 'obsidian';
import { ConverterSettings, LoreBookEntry, RagDocument } from './models';
import { ProgressBar } from './progress-bar';
import { LinkTargetIndex, extractWikilinks } from './link-target-index';
import {
  FrontmatterData,
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  getFrontmatterValue,
  normalizeFrontmatter,
  stripFrontmatter,
  uniqueStrings
} from './frontmatter-utils';
import { extractLorebookScopesFromTags, shouldIncludeInScope } from './lorebook-scoping';
import { parseRetrievalMode, resolveRetrievalTargets } from './retrieval-routing';
import { resolveWorldInfoContent } from './summary-utils';

const SELECTIVE_LOGIC_MAP: {[key: string]: number} = {
  'or': 0,
  'and any': 0,
  'and': 1,
  'and all': 1,
  'not any': 2,
  'not all': 3
};

function parseSelectiveLogic(value: unknown, fallback: number): number {
  const numeric = asNumber(value);
  if (numeric !== undefined) {
    return Math.max(0, Math.min(3, Math.floor(numeric)));
  }

  const stringValue = asString(value);
  if (stringValue) {
    const normalized = stringValue.toLowerCase();
    if (normalized in SELECTIVE_LOGIC_MAP) {
      return SELECTIVE_LOGIC_MAP[normalized];
    }
  }

  return fallback;
}

function parseTriggerMethod(frontmatter: FrontmatterData): 'constant' | 'vectorized' | 'selective' | null {
  const triggerMethod = asString(getFrontmatterValue(frontmatter, 'triggerMethod'));
  if (!triggerMethod) {
    return null;
  }

  const normalized = triggerMethod.toLowerCase();
  if (normalized === 'constant' || normalized === 'vectorized' || normalized === 'selective') {
    return normalized;
  }
  return null;
}

export class FileProcessor {
  private app: App;
  private settings: ConverterSettings;
  private linkTargetIndex: LinkTargetIndex = new LinkTargetIndex();
  private entries: {[key: number]: LoreBookEntry} = {};
  private worldInfoBodyByUid: {[key: number]: string} = {};
  private ragDocuments: RagDocument[] = [];
  private nextUid: number = 0;
  private rootUid: number | null = null;

  constructor(
    app: App,
    settings: ConverterSettings
  ) {
    this.app = app;
    this.settings = settings;
  }

  generateUid(): number {
    const uid = this.nextUid;
    this.nextUid += 1;
    return uid;
  }

  private getFrontmatter(file: TFile): FrontmatterData {
    const cache = this.app.metadataCache.getFileCache(file);
    return normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
  }

  private getLorebookScopes(file: TFile): string[] {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) {
      return [];
    }

    const tags = getAllTags(cache) ?? [];
    return extractLorebookScopesFromTags(tags, this.settings.tagScoping.tagPrefix);
  }

  private isSourceFile(file: TFile, frontmatter: FrontmatterData): boolean {
    if (asBoolean(getFrontmatterValue(frontmatter, 'exclude')) === true) {
      return false;
    }

    const scopes = this.getLorebookScopes(file);
    return shouldIncludeInScope(
      scopes,
      this.settings.tagScoping.activeScope,
      this.settings.tagScoping.membershipMode,
      this.settings.tagScoping.includeUntagged
    );
  }

  async parseMarkdownFile(file: TFile): Promise<LoreBookEntry | null> {
    try {
      const rawContent = await this.app.vault.read(file);
      const frontmatter = this.getFrontmatter(file);

      if (!this.isSourceFile(file, frontmatter)) {
        return null;
      }

      const uid = this.generateUid();
      const name = file.basename;
      const folder = file.parent ? file.parent.path : '';
      const wikilinks = extractWikilinks(rawContent);
      const defaultSettings = this.settings.defaultEntry;

      const noteBody = stripFrontmatter(rawContent).trim();
      const summaryOverride = asString(getFrontmatterValue(frontmatter, 'summary'));
      const content = resolveWorldInfoContent(noteBody, summaryOverride);

      const aliases = asStringArray(getFrontmatterValue(frontmatter, 'aliases'));
      const frontmatterKeywords = asStringArray(getFrontmatterValue(frontmatter, 'key', 'keywords'));
      const key = uniqueStrings([
        ...frontmatterKeywords,
        ...aliases
      ]);

      const keysecondary = uniqueStrings(
        asStringArray(getFrontmatterValue(frontmatter, 'keySecondary'))
      );

      const comment = asString(getFrontmatterValue(frontmatter, 'comment', 'title')) ?? name;
      const triggerMethod = parseTriggerMethod(frontmatter);
      const rootFlag = asBoolean(getFrontmatterValue(frontmatter, 'lorebookRoot', 'root'));
      const retrievalMode = parseRetrievalMode(getFrontmatterValue(frontmatter, 'retrieval')) ?? 'auto';
      const routing = resolveRetrievalTargets(retrievalMode, frontmatterKeywords.length > 0);
      const scope = this.settings.tagScoping.activeScope;

      if (!routing.includeWorldInfo && !routing.includeRag) {
        return null;
      }

      if (routing.includeRag) {
        this.ragDocuments.push({
          uid,
          title: comment,
          path: file.path,
          content: noteBody,
          scope
        });
      }

      if (!routing.includeWorldInfo) {
        return null;
      }

      const entry: LoreBookEntry = {
        uid,
        key,
        keysecondary,
        comment,
        content,
        constant: asBoolean(getFrontmatterValue(frontmatter, 'constant')) ??
                  (triggerMethod === 'constant' ? true : defaultSettings.constant),
        vectorized: asBoolean(getFrontmatterValue(frontmatter, 'vectorized')) ??
                    (triggerMethod === 'vectorized' ? true : defaultSettings.vectorized),
        selective: asBoolean(getFrontmatterValue(frontmatter, 'selective')) ??
                   (triggerMethod === 'selective' ? true : defaultSettings.selective),
        selectiveLogic: parseSelectiveLogic(
          getFrontmatterValue(frontmatter, 'selectiveLogic'),
          defaultSettings.selectiveLogic
        ),
        addMemo: asBoolean(getFrontmatterValue(frontmatter, 'addMemo')) ?? true,
        order: asNumber(getFrontmatterValue(frontmatter, 'order')) ?? 0,
        position: asNumber(getFrontmatterValue(frontmatter, 'position')) ?? 0,
        disable: asBoolean(getFrontmatterValue(frontmatter, 'disable')) ?? false,
        excludeRecursion: asBoolean(getFrontmatterValue(frontmatter, 'excludeRecursion')) ?? false,
        preventRecursion: asBoolean(getFrontmatterValue(frontmatter, 'preventRecursion')) ?? false,
        delayUntilRecursion: asBoolean(getFrontmatterValue(frontmatter, 'delayUntilRecursion')) ?? false,
        probability: asNumber(getFrontmatterValue(frontmatter, 'probability')) ?? defaultSettings.probability,
        useProbability: asBoolean(getFrontmatterValue(frontmatter, 'useProbability')) ?? true,
        depth: asNumber(getFrontmatterValue(frontmatter, 'depth')) ?? defaultSettings.depth,
        group: asString(getFrontmatterValue(frontmatter, 'group')) ?? folder,
        groupOverride: asBoolean(getFrontmatterValue(frontmatter, 'groupOverride')) ?? false,
        groupWeight: asNumber(getFrontmatterValue(frontmatter, 'groupWeight')) ?? defaultSettings.groupWeight,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        automationId: asString(getFrontmatterValue(frontmatter, 'automationId')) ?? '',
        role: null,
        sticky: asNumber(getFrontmatterValue(frontmatter, 'sticky')) ?? 0,
        cooldown: asNumber(getFrontmatterValue(frontmatter, 'cooldown')) ?? 0,
        delay: asNumber(getFrontmatterValue(frontmatter, 'delay')) ?? 0,
        displayIndex: asNumber(getFrontmatterValue(frontmatter, 'displayIndex')) ?? 0,
        wikilinks
      };

      // Keep trigger mode mutually exclusive for predictable output.
      if (entry.constant) {
        entry.vectorized = false;
        entry.selective = false;
      } else if (entry.vectorized) {
        entry.constant = false;
        entry.selective = false;
      } else if (entry.selective) {
        entry.constant = false;
        entry.vectorized = false;
      } else {
        entry.selective = true;
      }

      if (rootFlag === true && this.rootUid === null) {
        this.rootUid = uid;
      }
      this.worldInfoBodyByUid[uid] = noteBody;

      return entry;
    } catch (e) {
      console.error(`Error processing ${file.path}:`, e);
      return null;
    }
  }

  async processFiles(files: TFile[], progress: ProgressBar): Promise<void> {
    const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));
    const total = sortedFiles.length;
    let processed = 0;

    for (const file of sortedFiles) {
      progress.setStatus(`Processing file ${processed + 1}/${total}: ${file.basename}`);

      const entry = await this.parseMarkdownFile(file);

      if (entry) {
        this.linkTargetIndex.registerFileMappings(file.path, file.basename, entry.uid);
        this.entries[entry.uid] = entry;
      }

      progress.update();
      processed++;
    }
  }

  getRootUid(): number | null {
    return this.rootUid;
  }

  getFilenameToUid(): {[key: string]: number} {
    return this.linkTargetIndex.getMappings();
  }

  getEntries(): {[key: number]: LoreBookEntry} {
    return this.entries;
  }

  getWorldInfoBodyByUid(): {[key: number]: string} {
    return this.worldInfoBodyByUid;
  }

  getRagDocuments(): RagDocument[] {
    return this.ragDocuments;
  }

  reset(): void {
    this.linkTargetIndex.reset();
    this.entries = {};
    this.worldInfoBodyByUid = {};
    this.ragDocuments = [];
    this.nextUid = 0;
    this.rootUid = null;
  }
}
