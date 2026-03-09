import { App, FuzzySuggestModal, ItemView, Notice, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import LoreBookConverterPlugin from './main';
import { requestStoryContinuation } from './completion-provider';
import { applyImportedWikiPages, ImportedWikiPage } from './sillytavern-import';
import {
  extractWikiPagesFromStory,
  StoryExtractionProgressEvent,
  StoryExtractionResult
} from './story-extraction';
import { openVaultFolderPicker } from './folder-suggest-modal';
import { LorebookScopeSuggestModal } from './lorebook-scope-suggest-modal';
import { readVaultBinary } from './vault-binary-io';
import { normalizeVaultPath } from './vault-path-utils';
import { upsertSummarySectionInMarkdown } from './summary-utils';
import {
  buildChapterFileStem,
  deriveStoryIdFromTitle,
  formatStoryChapterRef,
  StoryChapterFrontmatterData,
  upsertStoryChapterFrontmatter
} from './story-chapter-management';
import { ConverterSettings } from './models';
import { parseEpub, parseTxt, EbookChapter, ParsedEbook } from './ebook-parser';

export const LOREVAULT_EBOOK_IMPORT_VIEW_TYPE = 'lorevault-ebook-import-view';

type EbookImportSubMode = 'story_chapters' | 'lorebook_extraction' | 'raw_text';

// --- File picker modal ---

class EbookFileSuggestModal extends FuzzySuggestModal<TFile> {
  private readonly files: TFile[];
  private resolver: ((value: TFile | null) => void) | null = null;
  private resolved = false;
  private selectedFile: TFile | null = null;

  constructor(app: App, files: TFile[]) {
    super(app);
    this.files = files;
    this.setPlaceholder('Pick an ebook file (.epub or .txt)...');
  }

  waitForSelection(): Promise<TFile | null> {
    return new Promise(resolve => {
      this.resolver = resolve;
    });
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.selectedFile = file;
    this.finish(file);
  }

  onClose(): void {
    super.onClose();
    window.setTimeout(() => {
      this.finish(this.selectedFile);
    }, 0);
  }

  private finish(file: TFile | null): void {
    if (this.resolved || !this.resolver) return;
    this.resolved = true;
    const resolve = this.resolver;
    this.resolver = null;
    resolve(file);
  }
}

// --- Module-level helpers (no Obsidian deps) ---

function yamlQuote(value: string): string {
  return JSON.stringify(value);
}

function buildSummaryFromText(text: string, maxChars: number): string {
  const singleLine = text.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!singleLine) return '';
  if (!Number.isFinite(maxChars) || maxChars <= 0 || singleLine.length <= maxChars) {
    return singleLine;
  }
  return `${singleLine.slice(0, maxChars).trimEnd()}...`;
}

function normalizeTagValue(value: string): string {
  return value.trim().replace(/^#+/, '').replace(/^\/+|\/+$/g, '');
}

function parseDefaultTagsList(raw: string): string[] {
  const tags = raw.split(/[\n,]+/).map(normalizeTagValue).filter(Boolean);
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (!seen.has(key)) { seen.add(key); deduped.push(tag); }
  }
  return deduped;
}

function normalizeTagPrefix(tagPrefix: string): string {
  const normalized = tagPrefix.trim().replace(/^#+/, '').replace(/^\/+|\/+$/g, '');
  return normalized || 'lorebook';
}

function normalizeLorebookNameToScope(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/[^a-z0-9/_\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/-+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '');
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (!seen.has(key)) { seen.add(key); result.push(v); }
  }
  return result;
}

function toSafeFileStem(value: string): string {
  const normalized = [...value]
    .filter(c => c.charCodeAt(0) >= 32)
    .join('')
    .trim()
    .toLowerCase()
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/[^a-z0-9._ -]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return normalized || 'ebook';
}

function buildEbookChapterNote(
  chapter: EbookChapter,
  chapterData: StoryChapterFrontmatterData,
  tags: string[],
  maxSummaryChars: number
): string {
  // Build base frontmatter with lorebook fields
  const fmLines: string[] = ['---'];
  fmLines.push(`title: ${yamlQuote(chapter.title)}`);
  if (tags.length > 0) {
    fmLines.push('tags:');
    for (const tag of tags) fmLines.push(`  - ${yamlQuote(tag)}`);
  }
  fmLines.push('sourceType: "ebook_chapter_import"');
  fmLines.push('---');

  const body = `# ${chapter.title}\n\n${chapter.bodyText.trim()}`;
  const baseContent = `${fmLines.join('\n')}\n\n${body}`;

  // Merge story chapter nav fields (storyId, chapter, chapterTitle, previousChapter, nextChapter)
  const withNavFields = upsertStoryChapterFrontmatter(baseContent, chapterData);

  if (maxSummaryChars <= 0) return withNavFields;
  const summary = buildSummaryFromText(chapter.bodyText, maxSummaryChars);
  if (!summary) return withNavFields;
  return upsertSummarySectionInMarkdown(withNavFields, summary);
}

function buildRawChapterNote(
  chapter: EbookChapter,
  tags: string[]
): string {
  const fmLines: string[] = ['---'];
  fmLines.push(`title: ${yamlQuote(chapter.title)}`);
  if (tags.length > 0) {
    fmLines.push('tags:');
    for (const tag of tags) fmLines.push(`  - ${yamlQuote(tag)}`);
  }
  fmLines.push('sourceType: "ebook_raw_import"');
  fmLines.push('---');
  return `${fmLines.join('\n')}\n\n# ${chapter.title}\n\n${chapter.bodyText.trim()}\n`;
}

// --- View ---

export class LorevaultEbookImportView extends ItemView {
  private plugin: LoreBookConverterPlugin;

  // Ebook source
  private ebookFilePath = '';
  private parsedEbook: ParsedEbook | null = null;
  private parsedEbookPath = '';     // path used to produce parsedEbook (cache key)
  private loadingChapters = false;

  // Chapter selection: empty set = all selected; populated set = only these indices selected
  private selectedChapterIndices: Set<number> = new Set();
  private chapterSelectionAll = true;

  // Shared output config
  private targetFolder = '';
  private defaultTags = '';
  private selectedLorebooks: string[] = [];
  private selectedCompletionPresetId = '';

  // Sub-mode
  private subMode: EbookImportSubMode = 'story_chapters';

  // story_chapters sub-mode
  private storyId = '';

  // lorebook_extraction sub-mode
  private lorebookName = '';
  private maxChunkChars = 5000;
  private maxOperationsPerChunk = 12;
  private maxExistingPagesInPrompt = 80;

  // raw_text sub-mode
  private combineIntoSingleNote = false;

  // Async state
  private running = false;
  private runningMode: 'parse' | 'preview' | 'import' | null = null;
  private progressStage = '';
  private progressDetails = '';
  private progressLastUpdated = 0;

  // Output state
  private lastError = '';
  private previewWarnings: string[] = [];
  private previewSummary = '';
  private previewPaths: string[] = [];
  private importSummary = '';

  // story_chapters / raw_text cache
  private preparedPages: ImportedWikiPage[] = [];
  private preparedKey = '';

  // lorebook_extraction result
  private lastExtractionPreview: StoryExtractionResult | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: LoreBookConverterPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.targetFolder = this.plugin.getDefaultLorebookImportLocation();
  }

  getViewType(): string { return LOREVAULT_EBOOK_IMPORT_VIEW_TYPE; }
  getDisplayText(): string { return 'LoreVault Ebook Import'; }
  getIcon(): string { return 'book-open'; }

  async onOpen(): Promise<void> { this.render(); }
  async onClose(): Promise<void> { this.contentEl.empty(); }
  refresh(): void { this.render(); }

  // --- Helpers ---

  private getNormalizedLorebooks(): string[] {
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const lb of this.selectedLorebooks) {
      const normalized = lb.trim();
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(normalized);
    }
    deduped.sort((a, b) => a.localeCompare(b));
    return deduped;
  }

  private addLorebook(scope: string): void {
    const normalized = scope.trim();
    if (!normalized) return;
    const exists = this.selectedLorebooks.some(s => s.trim().toLowerCase() === normalized.toLowerCase());
    if (exists) return;
    this.selectedLorebooks.push(normalized);
    this.selectedLorebooks = this.getNormalizedLorebooks();
    this.invalidatePreparedState();
    this.render();
  }

  private removeLorebook(scope: string): void {
    const key = scope.trim().toLowerCase();
    this.selectedLorebooks = this.selectedLorebooks.filter(s => s.trim().toLowerCase() !== key);
    this.invalidatePreparedState();
    this.render();
  }

  private deriveFormatFromPath(vaultPath: string): 'epub' | 'txt' | null {
    const ext = vaultPath.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'epub') return 'epub';
    if (ext === 'txt') return 'txt';
    return null;
  }

  private setProgress(stage: string, details = ''): void {
    this.progressStage = stage;
    this.progressDetails = details;
    this.progressLastUpdated = Date.now();
    this.render();
  }

  private clearOutput(): void {
    this.lastError = '';
    this.previewWarnings = [];
    this.previewSummary = '';
    this.previewPaths = [];
    this.importSummary = '';
  }

  private invalidatePreparedState(): void {
    this.preparedPages = [];
    this.preparedKey = '';
    this.lastExtractionPreview = null;
  }

  private getPreparedKey(): string {
    if (this.subMode === 'lorebook_extraction') return '';
    const base = [
      this.subMode,
      this.ebookFilePath.trim(),
      this.targetFolder.trim(),
      this.defaultTags,
      this.storyId.trim(),
      String(this.combineIntoSingleNote),
      this.chapterSelectionAll
        ? 'all'
        : [...this.selectedChapterIndices].sort((a, b) => a - b).join(','),
      this.getNormalizedLorebooks().join(','),
      this.plugin.settings.tagScoping.tagPrefix,
      String(this.plugin.settings.summaries.maxSummaryChars)
    ];
    return base.join('\u0000');
  }

  private buildLorebookTags(): string[] {
    const tagPrefix = normalizeTagPrefix(this.plugin.settings.tagScoping.tagPrefix);
    const lbs = this.getNormalizedLorebooks();
    const scopes = lbs.map(normalizeLorebookNameToScope).filter(Boolean);
    return uniqueStrings(scopes).map(scope => `${tagPrefix}/${scope}`);
  }

  private buildNoteTags(): string[] {
    const defaultTags = parseDefaultTagsList(this.defaultTags);
    const lorebookTags = this.buildLorebookTags();
    return uniqueStrings([...defaultTags, ...lorebookTags]);
  }

  private getSelectedChapters(parsed: ParsedEbook): EbookChapter[] {
    if (this.chapterSelectionAll) return parsed.chapters;
    return parsed.chapters.filter(ch => this.selectedChapterIndices.has(ch.index));
  }

  private getSelectedBodyText(parsed: ParsedEbook): string {
    return this.getSelectedChapters(parsed)
      .map(ch => ch.bodyText)
      .join('\n\n');
  }

  private getCompletionProfileOptions(): Array<{ value: string; label: string }> {
    const options: Array<{ value: string; label: string }> = [
      { value: '', label: '(Workspace effective profile)' }
    ];
    for (const preset of this.plugin.getCompletionPresetItems()) {
      options.push({ value: preset.id, label: preset.name });
    }
    return options;
  }

  private resolveCompletionProfileLabel(): string {
    const id = this.selectedCompletionPresetId.trim();
    if (!id) return 'workspace effective profile';
    return this.plugin.getCompletionPresetById(id)?.name ?? id;
  }

  private async resolveCompletionConfig(): Promise<{
    completion: ConverterSettings['completion'];
    profileLabel: string;
    profileSource: string;
    profileId: string;
    profileName: string;
    costProfile: string;
    autoCostProfile: string;
  }> {
    const selectedPresetId = this.selectedCompletionPresetId.trim();
    if (selectedPresetId) {
      const selectedPreset = this.plugin.getCompletionPresetById(selectedPresetId);
      if (!selectedPreset) {
        new Notice(`Selected completion profile is missing: ${selectedPresetId}`);
        throw new Error(`Missing completion profile: ${selectedPresetId}`);
      }
      const resolved = this.plugin.resolveEffectiveCompletionForStoryChat(selectedPresetId);
      const completion = resolved.completion;
      if (!completion.enabled) {
        new Notice('Writing completion is disabled. Enable it in settings first.');
        throw new Error('Writing completion is disabled.');
      }
      if (completion.provider !== 'ollama' && !completion.apiKey) {
        new Notice('Missing completion API key. Configure it in settings first.');
        throw new Error('Missing completion API key.');
      }
      return {
        completion,
        profileLabel: selectedPreset.name,
        profileSource: resolved.source,
        profileId: resolved.presetId,
        profileName: resolved.presetName,
        costProfile: this.plugin.resolveEffectiveCostProfileForApiKey(completion.apiKey),
        autoCostProfile: this.plugin.buildAutoCostProfileForApiKey(completion.apiKey)
      };
    }

    const resolution = await this.plugin.resolveEffectiveCompletionForFile();
    const completion = resolution.completion;
    if (!completion.enabled) {
      new Notice('Writing completion is disabled. Enable it in settings first.');
      throw new Error('Writing completion is disabled.');
    }
    if (completion.provider !== 'ollama' && !completion.apiKey) {
      new Notice('Missing completion API key. Configure it in settings first.');
      throw new Error('Missing completion API key.');
    }
    return {
      completion,
      profileLabel: resolution.presetName || 'workspace effective profile',
      profileSource: resolution.source,
      profileId: resolution.presetId,
      profileName: resolution.presetName,
      costProfile: this.plugin.resolveEffectiveCostProfileForApiKey(completion.apiKey),
      autoCostProfile: this.plugin.buildAutoCostProfileForApiKey(completion.apiKey)
    };
  }

  private async pickEbookFile(): Promise<string | null> {
    const allFiles = this.app.vault.getFiles();
    const ebookFiles = allFiles.filter(f => {
      const ext = f.extension.toLowerCase();
      return ext === 'epub' || ext === 'txt';
    });
    if (ebookFiles.length === 0) {
      new Notice('No .epub or .txt files found in vault.');
      return null;
    }
    const modal = new EbookFileSuggestModal(this.app, ebookFiles);
    const result = modal.waitForSelection();
    modal.open();
    const selected = await result;
    return selected?.path ?? null;
  }

  private async parseEbookFile(): Promise<ParsedEbook> {
    const filePath = normalizeVaultPath(this.ebookFilePath.trim());
    if (!filePath) throw new Error('No ebook file selected.');

    // Return cached result if same file
    if (this.parsedEbook && this.parsedEbookPath === filePath) {
      return this.parsedEbook;
    }

    const format = this.deriveFormatFromPath(filePath);
    if (!format) {
      throw new Error(`Unsupported file format. Only .epub and .txt are supported.`);
    }

    const abstract = this.app.vault.getAbstractFileByPath(filePath);
    if (!(abstract instanceof TFile)) {
      throw new Error(`File not found in vault: ${filePath}`);
    }

    let parsed: ParsedEbook;
    if (format === 'epub') {
      const bytes = await readVaultBinary(this.app, filePath);
      parsed = parseEpub(bytes);
    } else {
      const text = await this.app.vault.read(abstract);
      parsed = parseTxt(text, abstract.basename);
    }

    this.parsedEbook = parsed;
    this.parsedEbookPath = filePath;
    // Reset chapter selection when a new file is loaded
    this.chapterSelectionAll = true;
    this.selectedChapterIndices = new Set();
    return parsed;
  }

  // --- Sub-mode: story_chapters ---

  private buildStoryChapterPages(parsed: ParsedEbook): ImportedWikiPage[] {
    const folder = normalizeVaultPath(this.targetFolder.trim());
    if (!folder) throw new Error('Target folder is required.');

    const chapters = this.getSelectedChapters(parsed);
    if (chapters.length === 0) throw new Error('No chapters selected.');

    const rawStoryId = this.storyId.trim() || deriveStoryIdFromTitle(parsed.title);
    const storyId = rawStoryId || 'story';
    const tags = this.buildNoteTags();
    const maxSummaryChars = this.plugin.settings.summaries.maxSummaryChars;

    // Pass 1: compute all paths
    const usedPaths = new Set<string>();
    const paths: string[] = [];
    for (const chapter of chapters) {
      const stem = buildChapterFileStem(storyId, chapter.index, chapter.title);
      let candidate = normalizeVaultPath(`${folder}/${stem}.md`);
      let attempt = 1;
      while (usedPaths.has(candidate.toLowerCase())) {
        attempt += 1;
        candidate = normalizeVaultPath(`${folder}/${stem}-${attempt}.md`);
      }
      usedPaths.add(candidate.toLowerCase());
      paths.push(candidate);
    }

    // Pass 2: build notes with prev/next refs
    const pages: ImportedWikiPage[] = [];
    for (let i = 0; i < chapters.length; i += 1) {
      const chapter = chapters[i];
      const prevPath = paths[i - 1];
      const nextPath = paths[i + 1];
      const chapterData: StoryChapterFrontmatterData = {
        storyId,
        chapter: chapter.index,
        chapterTitle: chapter.title,
        previousChapterRefs: prevPath ? [formatStoryChapterRef(prevPath)] : [],
        nextChapterRefs: nextPath ? [formatStoryChapterRef(nextPath)] : []
      };
      const content = buildEbookChapterNote(chapter, chapterData, tags, maxSummaryChars);
      pages.push({ path: paths[i], content, uid: chapter.index });
    }

    return pages;
  }

  // --- Sub-mode: raw_text ---

  private buildRawTextPages(parsed: ParsedEbook): ImportedWikiPage[] {
    const folder = normalizeVaultPath(this.targetFolder.trim());
    if (!folder) throw new Error('Target folder is required.');

    const chapters = this.getSelectedChapters(parsed);
    if (chapters.length === 0) throw new Error('No chapters selected.');

    const tags = this.buildNoteTags();
    const bookStem = toSafeFileStem(parsed.title || this.ebookFilePath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'ebook');

    if (this.combineIntoSingleNote) {
      const bodyLines: string[] = [];
      if (parsed.title) bodyLines.push(`# ${parsed.title}`, '');
      for (const chapter of chapters) {
        bodyLines.push(`## ${chapter.title}`, '', chapter.bodyText.trim(), '');
      }
      const fmLines = [
        '---',
        `title: ${JSON.stringify(parsed.title || bookStem)}`,
        ...(tags.length > 0 ? ['tags:', ...tags.map(t => `  - ${JSON.stringify(t)}`)] : []),
        'sourceType: "ebook_raw_import"',
        '---'
      ];
      const content = `${fmLines.join('\n')}\n\n${bodyLines.join('\n').trim()}\n`;
      const path = normalizeVaultPath(`${folder}/${bookStem}.md`);
      return [{ path, content, uid: 0 }];
    }

    // Separate note per chapter
    const usedPaths = new Set<string>();
    const pages: ImportedWikiPage[] = [];
    for (const chapter of chapters) {
      const chStem = toSafeFileStem(chapter.title || `chapter-${chapter.index}`);
      const stem = `${bookStem}-ch${String(chapter.index).padStart(2, '0')}-${chStem}`;
      let candidate = normalizeVaultPath(`${folder}/${stem}.md`);
      let attempt = 1;
      while (usedPaths.has(candidate.toLowerCase())) {
        attempt += 1;
        candidate = normalizeVaultPath(`${folder}/${stem}-${attempt}.md`);
      }
      usedPaths.add(candidate.toLowerCase());
      const content = buildRawChapterNote(chapter, tags);
      pages.push({ path: candidate, content, uid: chapter.index });
    }
    return pages;
  }

  // --- Sub-mode: lorebook_extraction ---

  private onExtractionProgress(event: StoryExtractionProgressEvent): void {
    const chunkLabel = event.chunkTotal
      ? `chunk ${event.chunkIndex ?? 0}/${event.chunkTotal}`
      : event.chunkIndex ? `chunk ${event.chunkIndex}` : '';
    if (event.stage === 'starting') {
      this.setProgress('Starting extraction...', event.chunkTotal ? `${event.chunkTotal} chunk(s)` : '');
    } else if (event.stage === 'chunk_start') {
      this.setProgress('Processing chunk...', chunkLabel);
    } else if (event.stage === 'chunk_success') {
      const opLabel = typeof event.operationCount === 'number' ? `${event.operationCount} operation(s)` : '';
      this.setProgress('Chunk processed', [chunkLabel, opLabel].filter(Boolean).join(' | '));
    } else if (event.stage === 'chunk_error') {
      this.setProgress('Chunk failed', [chunkLabel, event.warning ?? 'unknown error'].filter(Boolean).join(' | '));
    } else if (event.stage === 'rendering_pages') {
      this.setProgress('Rendering extracted pages...');
    } else if (event.stage === 'completed') {
      this.setProgress(
        'Extraction preview complete',
        event.pageCount !== undefined ? `${event.pageCount} page(s)` : ''
      );
    }
  }

  private async runLorebookExtraction(): Promise<void> {
    if (this.running) return;

    let parsed: ParsedEbook;
    try {
      parsed = await this.parseEbookFile();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = `Parse failed: ${message}`;
      this.setProgress('Parse failed', message);
      return;
    }

    let completionResolution: Awaited<ReturnType<typeof this.resolveCompletionConfig>>;
    try {
      completionResolution = await this.resolveCompletionConfig();
    } catch {
      return;
    }

    this.running = true;
    this.runningMode = 'preview';
    this.clearOutput();
    this.setProgress('Starting lorebook extraction...', `Profile: ${completionResolution.profileLabel}`);

    try {
      const storyText = this.getSelectedBodyText(parsed);
      if (!storyText.trim()) throw new Error('No chapter text to extract from.');

      const result = await extractWikiPagesFromStory({
        storyMarkdown: storyText,
        targetFolder: this.targetFolder,
        defaultTagsRaw: this.defaultTags,
        lorebookName: this.lorebookName.trim() || toSafeFileStem(parsed.title || 'ebook'),
        lorebookNames: this.getNormalizedLorebooks(),
        tagPrefix: this.plugin.settings.tagScoping.tagPrefix,
        maxChunkChars: this.maxChunkChars,
        maxSummaryChars: this.plugin.settings.summaries.maxSummaryChars,
        maxOperationsPerChunk: this.maxOperationsPerChunk,
        maxExistingPagesInPrompt: this.maxExistingPagesInPrompt,
        callModel: (systemPrompt, userPrompt) => requestStoryContinuation(completionResolution.completion, {
          systemPrompt,
          userPrompt,
          operationName: 'ebook_lorebook_extraction',
          onOperationLog: record => this.plugin.appendCompletionOperationLog(record, {
            costProfile: completionResolution.costProfile
          }),
          onUsage: usage => {
            void this.plugin.recordCompletionUsage('ebook_lorebook_extraction', usage, {
              ebookPath: this.ebookFilePath.trim(),
              lorebookName: this.lorebookName.trim(),
              completionProfileSource: completionResolution.profileSource,
              completionProfileId: completionResolution.profileId,
              completionProfileName: completionResolution.profileName,
              autoCostProfile: completionResolution.autoCostProfile
            });
          }
        }),
        onProgress: event => this.onExtractionProgress(event)
      });

      this.lastExtractionPreview = result;
      this.previewSummary = `Preview: ${result.pages.length} page(s), ${result.chunks.length} chunk(s).`;
      this.previewPaths = result.pages.map(p => p.path);
      this.previewWarnings = result.warnings;
      new Notice(`Extraction preview complete: ${result.pages.length} page(s).`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('LoreVault ebook extraction failed:', err);
      this.lastError = `Extraction failed: ${message}`;
      this.setProgress('Extraction failed', message);
      new Notice(`Ebook extraction failed: ${message}`);
    } finally {
      this.running = false;
      this.runningMode = null;
      this.render();
    }
  }

  // --- Chapter loading ---

  private async loadChapters(): Promise<void> {
    if (this.loadingChapters) return;
    this.loadingChapters = true;
    this.render();

    try {
      const parsed = await this.parseEbookFile();
      this.previewWarnings = parsed.warnings;
      if (parsed.warnings.length > 0) {
        this.previewSummary = `Loaded: ${parsed.chapters.length} chapter(s).`;
      } else {
        this.previewSummary = `Loaded: ${parsed.chapters.length} chapter(s)${parsed.title ? ` — ${parsed.title}` : ''}.`;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = `Failed to load ebook: ${message}`;
      new Notice(`Failed to load ebook: ${message}`);
    } finally {
      this.loadingChapters = false;
      this.render();
    }
  }

  // --- Preview / Import orchestration ---

  private computeNonExtractionPages(parsed: ParsedEbook): ImportedWikiPage[] {
    if (this.subMode === 'story_chapters') return this.buildStoryChapterPages(parsed);
    return this.buildRawTextPages(parsed);
  }

  private async runPreview(): Promise<void> {
    if (this.subMode === 'lorebook_extraction') {
      await this.runLorebookExtraction();
      return;
    }
    if (this.running) return;

    this.running = true;
    this.runningMode = 'preview';
    this.clearOutput();
    this.setProgress('Loading ebook...');

    try {
      const parsed = await this.parseEbookFile();
      this.setProgress('Building preview...');
      const pages = this.computeNonExtractionPages(parsed);
      this.preparedPages = pages;
      this.preparedKey = this.getPreparedKey();
      this.previewPaths = pages.map(p => p.path);
      this.previewWarnings = parsed.warnings;
      this.previewSummary = `Preview: ${pages.length} note(s).`;
      this.setProgress('Preview complete', `${pages.length} note(s)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = `Preview failed: ${message}`;
      this.setProgress('Preview failed', message);
    } finally {
      this.running = false;
      this.runningMode = null;
      this.render();
    }
  }

  private normalizePagesForApply(pages: ImportedWikiPage[]): ImportedWikiPage[] {
    const seen = new Set<string>();
    return pages.map((page, index) => {
      const path = normalizeVaultPath((page.path ?? '').trim());
      if (!path) throw new Error(`Page ${index + 1} is missing a target path.`);
      const key = path.toLowerCase();
      if (seen.has(key)) throw new Error(`Duplicate planned file path: ${path}`);
      seen.add(key);
      return { ...page, path, content: typeof page.content === 'string' ? page.content : '' };
    });
  }

  private async runImport(): Promise<void> {
    if (this.subMode === 'lorebook_extraction') {
      await this.runExtractionApply();
      return;
    }
    if (this.running) return;

    this.running = true;
    this.runningMode = 'import';
    this.clearOutput();
    this.setProgress('Preparing import...');

    try {
      let pages: ImportedWikiPage[];
      const currentKey = this.getPreparedKey();
      if (this.preparedPages.length > 0 && this.preparedKey === currentKey) {
        pages = this.normalizePagesForApply(this.preparedPages);
        this.setProgress('Using preview plan...', `${pages.length} note(s)`);
      } else {
        const parsed = await this.parseEbookFile();
        pages = this.normalizePagesForApply(this.computeNonExtractionPages(parsed));
        this.preparedPages = pages;
        this.preparedKey = currentKey;
      }

      this.previewPaths = pages.map(p => p.path);
      this.setProgress('Writing notes...', `${pages.length} note(s)`);

      const applied = await applyImportedWikiPages(this.app, pages, {
        onProgress: event => {
          this.setProgress('Writing notes...', `${event.index}/${event.total} | ${event.action} ${event.path}`);
        }
      });

      this.importSummary = `Import complete: ${applied.created} created, ${applied.updated} updated (${pages.length} total).`;
      this.setProgress('Import complete', `${applied.created} created, ${applied.updated} updated`);
      new Notice(this.importSummary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('LoreVault ebook import failed:', err);
      this.lastError = `Import failed: ${message}`;
      this.setProgress('Import failed', message);
      new Notice(`Ebook import failed: ${message}`);
    } finally {
      this.running = false;
      this.runningMode = null;
      this.render();
    }
  }

  private async runExtractionApply(): Promise<void> {
    if (this.running) return;
    if (!this.lastExtractionPreview) {
      new Notice('Run extraction preview before applying.');
      return;
    }

    this.running = true;
    this.runningMode = 'import';
    this.importSummary = '';
    this.setProgress('Applying extracted pages...');
    this.render();

    const wikiPages: ImportedWikiPage[] = this.lastExtractionPreview.pages.map((page, i) => ({
      path: page.path,
      content: page.content,
      uid: i
    }));

    try {
      const applied = await applyImportedWikiPages(this.app, wikiPages, {
        onProgress: event => {
          this.setProgress('Applying extracted pages...', `${event.index}/${event.total} | ${event.action} ${event.path}`);
        }
      });
      this.importSummary = `Applied: ${applied.created} created, ${applied.updated} updated.`;
      this.setProgress('Apply complete', `${applied.created} created, ${applied.updated} updated`);
      new Notice(`Ebook extraction applied: ${applied.created} created, ${applied.updated} updated.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('LoreVault ebook extraction apply failed:', err);
      this.lastError = `Apply failed: ${message}`;
      this.setProgress('Apply failed', message);
      new Notice(`Ebook extraction apply failed: ${message}`);
    } finally {
      this.running = false;
      this.runningMode = null;
      this.render();
    }
  }

  // --- UI builders ---

  private buildSharedInputs(container: HTMLElement): void {
    if (!this.targetFolder.trim()) {
      this.targetFolder = this.plugin.getDefaultLorebookImportLocation();
    }
    const defaultFolder = this.plugin.getDefaultLorebookImportLocation();
    let folderInput: { setValue: (v: string) => void } | null = null;

    new Setting(container)
      .setName('Target Folder')
      .setDesc('Folder where imported notes will be created/updated.')
      .addText(text => {
        folderInput = text;
        text
          .setPlaceholder(defaultFolder)
          .setValue(this.targetFolder)
          .onChange(value => {
            this.targetFolder = value.trim();
            this.invalidatePreparedState();
          });
      })
      .addButton(btn => btn
        .setButtonText('Browse')
        .onClick(() => {
          openVaultFolderPicker(this.app, path => {
            this.targetFolder = path;
            this.invalidatePreparedState();
            folderInput?.setValue(path);
          });
        }));

    new Setting(container)
      .setName('Default Tags')
      .setDesc('Comma or newline separated tags applied to every imported note.')
      .addTextArea(text => {
        text.inputEl.rows = 2;
        text
          .setPlaceholder('ebook, imported')
          .setValue(this.defaultTags)
          .onChange(value => {
            this.defaultTags = value;
            this.invalidatePreparedState();
          });
      });

    new Setting(container)
      .setName('Import Mode')
      .setDesc('How to import the ebook content.')
      .addDropdown(dd => dd
        .addOption('story_chapters', 'Story Chapters')
        .addOption('lorebook_extraction', 'Lorebook Extraction (AI)')
        .addOption('raw_text', 'Raw Text Notes')
        .setValue(this.subMode)
        .onChange(value => {
          this.subMode = value as EbookImportSubMode;
          this.clearOutput();
          this.invalidatePreparedState();
          this.render();
        }));

    new Setting(container)
      .setName('Completion Profile')
      .setDesc('AI profile used for lorebook extraction.')
      .addDropdown(dd => {
        const options = this.getCompletionProfileOptions();
        for (const opt of options) dd.addOption(opt.value, opt.label);
        const selected = this.selectedCompletionPresetId.trim();
        if (selected && !options.some(o => o.value === selected)) {
          dd.addOption(selected, `[Missing] ${selected}`);
        }
        dd.setValue(selected).onChange(value => {
          this.selectedCompletionPresetId = value.trim();
          this.invalidatePreparedState();
        });
      });

    // Lorebook chips
    const availableScopes = this.plugin.getCachedLorebookScopes();
    const selectedScopes = this.getNormalizedLorebooks();
    const unselectedScopes = availableScopes.filter(s => !selectedScopes.includes(s));

    const lorebookSetting = new Setting(container)
      .setName('Lorebooks')
      .setDesc('Lorebook tags added to every imported note.');
    const chipList = lorebookSetting.controlEl.createDiv({ cls: 'lorevault-import-review-list' });
    if (selectedScopes.length === 0) {
      chipList.createEl('p', { text: 'No lorebooks selected.' });
    } else {
      for (const scope of selectedScopes) {
        const row = chipList.createDiv({ cls: 'lorevault-import-review-item' });
        row.createEl('code', { text: scope });
        const btn = row.createEl('button', { text: 'Remove' });
        btn.addEventListener('click', () => this.removeLorebook(scope));
      }
    }
    const chipActions = lorebookSetting.controlEl.createDiv({ cls: 'lorevault-import-actions' });
    const addBtn = chipActions.createEl('button', { text: 'Add Lorebook' });
    addBtn.disabled = unselectedScopes.length === 0;
    addBtn.addEventListener('click', () => {
      void (async () => {
        const modal = new LorebookScopeSuggestModal(this.app, unselectedScopes, 'Pick a lorebook to add...');
        const resultP = modal.waitForSelection();
        modal.open();
        const result = await resultP;
        if (result) this.addLorebook(result);
      })();
    });
    const customInput = chipActions.createEl('input', { type: 'text', cls: 'lorevault-story-delta-scope-input' });
    customInput.placeholder = 'Add custom lorebook and press Enter';
    customInput.addEventListener('keydown', evt => {
      if (evt.key !== 'Enter') return;
      evt.preventDefault();
      const val = customInput.value.trim();
      if (val) { this.addLorebook(val); customInput.value = ''; }
    });
  }

  private buildEbookFileInput(container: HTMLElement): void {
    let pathInput: { setValue: (v: string) => void } | null = null;
    const format = this.deriveFormatFromPath(this.ebookFilePath);
    const desc = format
      ? `Selected format: ${format.toUpperCase()}`
      : 'Pick an .epub or .txt file from the vault.';

    new Setting(container)
      .setName('Ebook File')
      .setDesc(desc)
      .addText(text => {
        pathInput = text;
        text
          .setPlaceholder('books/my-novel.epub')
          .setValue(this.ebookFilePath)
          .onChange(value => {
            const newPath = value.trim();
            if (newPath !== this.ebookFilePath) {
              this.ebookFilePath = newPath;
              this.parsedEbook = null;
              this.parsedEbookPath = '';
              this.chapterSelectionAll = true;
              this.selectedChapterIndices = new Set();
              this.invalidatePreparedState();
            }
          });
      })
      .addButton(btn => btn
        .setButtonText('Browse')
        .onClick(() => {
          void (async () => {
            const selected = await this.pickEbookFile();
            if (!selected) return;
            this.ebookFilePath = selected;
            this.parsedEbook = null;
            this.parsedEbookPath = '';
            this.chapterSelectionAll = true;
            this.selectedChapterIndices = new Set();
            this.invalidatePreparedState();
            pathInput?.setValue(selected);
            this.render();
          })();
        }));
  }

  private buildChapterSelector(container: HTMLElement, parsed: ParsedEbook): void {
    const chapterSetting = new Setting(container)
      .setName('Chapters')
      .setDesc(`${parsed.chapters.length} chapter(s) detected. Uncheck to exclude.`);

    const allToggle = chapterSetting.controlEl.createEl('label', { cls: 'lorevault-ebook-chapter-all' });
    const allCheck = allToggle.createEl('input', { type: 'checkbox' });
    allCheck.checked = this.chapterSelectionAll;
    allToggle.createSpan({ text: ' All chapters' });
    allCheck.addEventListener('change', () => {
      this.chapterSelectionAll = allCheck.checked;
      if (this.chapterSelectionAll) this.selectedChapterIndices = new Set();
      this.invalidatePreparedState();
      this.render();
    });

    if (!this.chapterSelectionAll) {
      const listEl = container.createDiv({ cls: 'lorevault-ebook-chapter-list' });
      for (const chapter of parsed.chapters) {
        const row = listEl.createDiv({ cls: 'lorevault-ebook-chapter-row' });
        const label = row.createEl('label');
        const check = label.createEl('input', { type: 'checkbox' });
        check.checked = this.selectedChapterIndices.has(chapter.index);
        label.createSpan({ text: ` ${chapter.index}. ${chapter.title}` });
        label.createSpan({
          cls: 'lorevault-ebook-chapter-chars',
          text: ` (${chapter.bodyText.length.toLocaleString()} chars)`
        });
        check.addEventListener('change', () => {
          if (check.checked) {
            this.selectedChapterIndices.add(chapter.index);
          } else {
            this.selectedChapterIndices.delete(chapter.index);
          }
          this.invalidatePreparedState();
        });
      }
    }
  }

  private buildLoadChaptersButton(container: HTMLElement): void {
    const loadSetting = new Setting(container)
      .setName('Chapter List')
      .setDesc(this.parsedEbook
        ? `${this.parsedEbook.chapters.length} chapter(s) loaded.`
        : 'Load the ebook to see and select chapters.');
    const loadBtn = loadSetting.controlEl.createEl('button', {
      text: this.loadingChapters ? 'Loading...' : (this.parsedEbook ? 'Reload' : 'Load Chapters')
    });
    loadBtn.disabled = this.loadingChapters || !this.ebookFilePath.trim();
    loadBtn.addEventListener('click', () => { void this.loadChapters(); });
  }

  private buildStoryChaptersInputs(container: HTMLElement): void {
    this.buildEbookFileInput(container);

    new Setting(container)
      .setName('Story ID')
      .setDesc('Identifier linking chapters together. Defaults to the book title.')
      .addText(text => text
        .setPlaceholder(this.parsedEbook ? deriveStoryIdFromTitle(this.parsedEbook.title) : 'my-story')
        .setValue(this.storyId)
        .onChange(value => {
          this.storyId = value.trim();
          this.invalidatePreparedState();
        }));

    this.buildLoadChaptersButton(container);
    if (this.parsedEbook) {
      this.buildChapterSelector(container, this.parsedEbook);
    }
  }

  private buildLorebookExtractionInputs(container: HTMLElement): void {
    this.buildEbookFileInput(container);

    new Setting(container)
      .setName('Lorebook Name')
      .setDesc(`Primary lorebook tag scope for extracted wiki entries (under "${this.plugin.settings.tagScoping.tagPrefix}").`)
      .addText(text => text
        .setPlaceholder('my-book')
        .setValue(this.lorebookName)
        .onChange(value => {
          this.lorebookName = value;
          this.invalidatePreparedState();
        }));

    new Setting(container)
      .setName('Max Chunk Chars')
      .setDesc('Target character size for each extraction chunk.')
      .addText(text => text
        .setValue(String(this.maxChunkChars))
        .onChange(value => {
          const n = parseInt(value, 10);
          if (!isNaN(n) && n >= 200) this.maxChunkChars = n;
        }));

    new Setting(container)
      .setName('Max Operations Per Chunk')
      .setDesc('Upper bound on extracted wiki page operations per chunk.')
      .addText(text => text
        .setValue(String(this.maxOperationsPerChunk))
        .onChange(value => {
          const n = parseInt(value, 10);
          if (!isNaN(n) && n >= 1) this.maxOperationsPerChunk = n;
        }));

    new Setting(container)
      .setName('Max Existing Pages In Prompt')
      .setDesc('Cap on existing page state included in each chunk prompt.')
      .addText(text => text
        .setValue(String(this.maxExistingPagesInPrompt))
        .onChange(value => {
          const n = parseInt(value, 10);
          if (!isNaN(n) && n >= 1) this.maxExistingPagesInPrompt = n;
        }));

    this.buildLoadChaptersButton(container);
    if (this.parsedEbook) {
      this.buildChapterSelector(container, this.parsedEbook);
    }
  }

  private buildRawTextInputs(container: HTMLElement): void {
    this.buildEbookFileInput(container);

    new Setting(container)
      .setName('Combine into Single Note')
      .setDesc('When enabled, all selected chapters are merged into one markdown file.')
      .addToggle(toggle => toggle
        .setValue(this.combineIntoSingleNote)
        .onChange(value => {
          this.combineIntoSingleNote = value;
          this.invalidatePreparedState();
        }));

    this.buildLoadChaptersButton(container);
    if (this.parsedEbook) {
      this.buildChapterSelector(container, this.parsedEbook);
    }
  }

  private renderOutput(container: HTMLElement): void {
    if (this.progressStage) {
      const suffix = this.progressLastUpdated > 0
        ? ` | updated ${new Date(this.progressLastUpdated).toLocaleTimeString()}`
        : '';
      container.createEl('p', {
        text: this.progressDetails
          ? `${this.progressStage} — ${this.progressDetails}${suffix}`
          : `${this.progressStage}${suffix}`
      });
    }

    if (this.lastError) {
      container.createEl('p', { text: this.lastError });
      return;
    }

    if (this.previewSummary) container.createEl('p', { text: this.previewSummary });
    if (this.importSummary) container.createEl('p', { text: this.importSummary });

    if (this.previewWarnings.length > 0) {
      const details = container.createEl('details');
      details.createEl('summary', { text: `Warnings (${this.previewWarnings.length})` });
      const list = details.createEl('ul');
      for (const w of this.previewWarnings.slice(0, 80)) list.createEl('li', { text: w });
      if (this.previewWarnings.length > 80) {
        details.createEl('p', { text: `... ${this.previewWarnings.length - 80} more warnings` });
      }
    }

    if (this.subMode === 'lorebook_extraction' && this.lastExtractionPreview) {
      const preview = this.lastExtractionPreview;
      const chunkDetails = container.createEl('details');
      chunkDetails.createEl('summary', { text: `Chunk Summary (${preview.chunks.length})` });
      const chunkList = chunkDetails.createEl('ul');
      for (const chunk of preview.chunks) {
        const warnSuffix = chunk.warnings.length > 0 ? ` | warnings: ${chunk.warnings.join('; ')}` : '';
        chunkList.createEl('li', { text: `Chunk ${chunk.chunkIndex}: ${chunk.operationCount} operation(s)${warnSuffix}` });
      }
    }

    if (this.previewPaths.length > 0) {
      const details = container.createEl('details');
      details.createEl('summary', { text: `Planned File Paths (${this.previewPaths.length})` });
      const list = details.createEl('ul');
      for (const p of this.previewPaths.slice(0, 120)) list.createEl('li', { text: p });
      if (this.previewPaths.length > 120) {
        details.createEl('p', { text: `... ${this.previewPaths.length - 120} more` });
      }
    }

    if (!this.previewSummary && !this.importSummary && !this.running) {
      const hint: Record<EbookImportSubMode, string> = {
        story_chapters: 'Load an ebook, then run Preview or Import to create linked chapter notes.',
        lorebook_extraction: 'Load an ebook, then run Extraction Preview to extract lore with AI.',
        raw_text: 'Load an ebook, then run Preview or Import to create plain text notes.'
      };
      container.createEl('p', { text: hint[this.subMode] });
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-import-view');

    const titles: Record<EbookImportSubMode, string> = {
      story_chapters: 'Import Ebook as Story Chapters',
      lorebook_extraction: 'Extract Lorebook from Ebook (AI)',
      raw_text: 'Import Ebook as Raw Text Notes'
    };
    contentEl.createEl('h2', { text: titles[this.subMode] });

    this.buildSharedInputs(contentEl);

    if (this.subMode === 'story_chapters') {
      this.buildStoryChaptersInputs(contentEl);
    } else if (this.subMode === 'lorebook_extraction') {
      this.buildLorebookExtractionInputs(contentEl);
    } else {
      this.buildRawTextInputs(contentEl);
    }

    const actions = contentEl.createDiv({ cls: 'lorevault-import-actions' });
    const output = contentEl.createDiv({ cls: 'lorevault-import-output' });

    const isExtraction = this.subMode === 'lorebook_extraction';
    const previewLabel = this.running && this.runningMode === 'preview'
      ? (isExtraction ? 'Extracting...' : 'Preview Running...')
      : (isExtraction ? 'Preview Extraction' : 'Preview');
    const previewBtn = actions.createEl('button', { text: previewLabel });
    previewBtn.addClass('mod-cta');
    previewBtn.disabled = this.running;
    previewBtn.addEventListener('click', () => { void this.runPreview(); });

    const importLabel = this.running && this.runningMode === 'import'
      ? 'Applying...'
      : (isExtraction ? 'Apply Extraction' : 'Import');
    const importBtn = actions.createEl('button', { text: importLabel });
    importBtn.disabled = this.running || (isExtraction && !this.lastExtractionPreview);
    importBtn.addEventListener('click', () => { void this.runImport(); });

    const clearBtn = actions.createEl('button', { text: 'Clear' });
    clearBtn.disabled = this.running;
    clearBtn.addEventListener('click', () => {
      this.ebookFilePath = '';
      this.parsedEbook = null;
      this.parsedEbookPath = '';
      this.chapterSelectionAll = true;
      this.selectedChapterIndices = new Set();
      this.clearOutput();
      this.invalidatePreparedState();
      this.progressStage = '';
      this.render();
    });

    this.renderOutput(output);
  }
}
