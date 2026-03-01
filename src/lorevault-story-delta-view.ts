import { App, FuzzySuggestModal, ItemView, Notice, Setting, TFile, getAllTags, WorkspaceLeaf } from 'obsidian';
import LoreBookConverterPlugin from './main';
import { requestStoryContinuation } from './completion-provider';
import { applyImportedWikiPages, ImportedWikiPage } from './sillytavern-import';
import { openVaultFolderPicker } from './folder-suggest-modal';
import {
  buildStoryDeltaPlan,
  StoryDeltaConflict,
  StoryDeltaExistingPageInput,
  StoryDeltaPlannedChange,
  StoryDeltaPlannedPage,
  StoryDeltaResult,
  StoryDeltaUpdatePolicy
} from './story-delta-update';
import { extractLorebookScopesFromTags, normalizeScope, shouldIncludeInScope } from './lorebook-scoping';
import { normalizeVaultPath } from './vault-path-utils';
import { FrontmatterData, stripFrontmatter } from './frontmatter-utils';
import { parseStoryThreadNodeFromFrontmatter, resolveStoryThread, StoryThreadNode } from './story-thread-resolver';
import { resolveStoryDeltaSourcePaths, StoryDeltaSourceMode } from './story-delta-source';

export const LOREVAULT_STORY_DELTA_VIEW_TYPE = 'lorevault-story-delta-view';

type StoryDeltaConflictDecision = 'pending' | 'accept' | 'reject' | 'keep_both';
type StoryDeltaConflictFilter = 'all' | StoryDeltaConflictDecision;

class StoryDeltaSourceNotePickerModal extends FuzzySuggestModal<TFile> {
  private readonly files: TFile[];
  private readonly onChoose: (file: TFile) => void;

  constructor(app: App, files: TFile[], onChoose: (file: TFile) => void) {
    super(app);
    this.files = [...files].sort((left, right) => left.path.localeCompare(right.path));
    this.onChoose = onChoose;
    this.setPlaceholder('Pick story source note...');
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}

function buildConflictCompanionPath(path: string): string {
  const normalized = normalizeVaultPath(path);
  if (normalized.toLowerCase().endsWith('.md')) {
    return `${normalized.slice(0, -3)}.lorevault-proposed.md`;
  }
  return `${normalized}.lorevault-proposed.md`;
}

function buildConflictCompanionContent(
  page: StoryDeltaPlannedPage,
  conflict: StoryDeltaConflict,
  sourcePath: string
): string {
  const existing = (page.previousContent ?? '').trim();
  const proposed = (page.content ?? '').trim();
  const lines: string[] = [
    '---',
    'type: lorevault-conflict-proposal',
    `sourcePath: ${JSON.stringify(page.path)}`,
    `storyDeltaSource: ${JSON.stringify(sourcePath || '(inline markdown)')}`,
    `conflictId: ${JSON.stringify(conflict.id)}`,
    '---',
    `# Proposed Update for ${page.path}`,
    '',
    `## Conflict Summary`,
    '',
    `${conflict.summary}`,
    '',
    '## Existing Content Snapshot',
    '',
    '```markdown',
    existing || '(empty)',
    '```',
    '',
    '## Proposed Content Snapshot',
    '',
    '```markdown',
    proposed || '(empty)',
    '```',
    ''
  ];
  return lines.join('\n');
}

export class LorevaultStoryDeltaView extends ItemView {
  private plugin: LoreBookConverterPlugin;
  private sourceStoryNotePath = '';
  private sourceMode: StoryDeltaSourceMode = 'note';
  private storyMarkdown = '';
  private newNoteTargetFolder = 'LoreVault/import';
  private selectedLorebookScopes: string[] = [];
  private updatePolicy: StoryDeltaUpdatePolicy = 'safe_append';
  private defaultTags = '';
  private maxChunkChars = 5000;
  private maxOperationsPerChunk = 12;
  private maxExistingPagesInPrompt = 80;
  private lowConfidenceThreshold = 0.55;

  private running = false;
  private previewError = '';
  private applyStatus = '';
  private lastPreview: StoryDeltaResult | null = null;
  private approvedPaths = new Set<string>();
  private conflictDecisions = new Map<string, StoryDeltaConflictDecision>();
  private conflictFilter: StoryDeltaConflictFilter = 'all';
  private lastExistingPageCount = 0;

  constructor(leaf: WorkspaceLeaf, plugin: LoreBookConverterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LOREVAULT_STORY_DELTA_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'LoreVault Story Delta';
  }

  getIcon(): string {
    return 'file-plus-2';
  }

  async onOpen(): Promise<void> {
    if (this.selectedLorebookScopes.length === 0) {
      const activeScope = normalizeScope(this.plugin.settings.tagScoping.activeScope);
      if (activeScope) {
        this.selectedLorebookScopes = [activeScope];
      }
    }
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  refresh(): void {
    this.render();
  }

  private canUseCompletion(): boolean {
    const completion = this.plugin.settings.completion;
    if (!completion.enabled) {
      new Notice('Writing completion is disabled. Enable it in settings first.');
      return false;
    }
    if (completion.provider !== 'ollama' && !completion.apiKey) {
      new Notice('Missing completion API key. Configure it in settings first.');
      return false;
    }
    return true;
  }

  private async resolveStoryMarkdown(): Promise<string> {
    const inline = this.storyMarkdown.trim();
    if (inline) {
      return inline;
    }

    const storyPath = normalizeVaultPath(this.sourceStoryNotePath.trim());
    if (!storyPath) {
      throw new Error('Paste story markdown or provide a source story note path.');
    }

    const file = this.app.vault.getAbstractFileByPath(storyPath);
    if (!(file instanceof TFile)) {
      throw new Error(`Story note not found: ${storyPath}`);
    }

    if (this.sourceMode === 'note') {
      const raw = await this.app.vault.read(file);
      const resolved = raw.trim();
      if (!resolved) {
        throw new Error(`Story note is empty: ${storyPath}`);
      }
      return resolved;
    }

    const nodes = this.collectStoryThreadNodes();
    const resolution = resolveStoryThread(nodes, file.path);
    if (!resolution) {
      throw new Error(`Selected source note is not part of a resolvable story thread: ${storyPath}`);
    }

    const targetPaths = resolveStoryDeltaSourcePaths(this.sourceMode, file.path, resolution);
    const targetFiles = targetPaths
      .map(path => this.app.vault.getAbstractFileByPath(path))
      .filter((candidate): candidate is TFile => candidate instanceof TFile);
    if (targetFiles.length === 0) {
      throw new Error(`No source files found for ${this.sourceMode} mode.`);
    }

    return this.buildStoryMarkdownFromFiles(
      targetFiles,
      this.sourceMode === 'chapter' ? 'chapter' : `story (${resolution.storyId})`
    );
  }

  private collectStoryThreadNodes(): StoryThreadNode[] {
    const nodes: StoryThreadNode[] = [];
    const files = [...this.app.vault.getMarkdownFiles()].sort((left, right) => left.path.localeCompare(right.path));
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = (cache?.frontmatter ?? {}) as FrontmatterData;
      const node = parseStoryThreadNodeFromFrontmatter(file.path, file.basename, frontmatter);
      if (node) {
        nodes.push(node);
      }
    }
    return nodes;
  }

  private async buildStoryMarkdownFromFiles(files: TFile[], sourceLabel: string): Promise<string> {
    const sections: string[] = [];

    for (const file of files) {
      const raw = await this.app.vault.read(file);
      const body = stripFrontmatter(raw).trim();
      if (!body) {
        continue;
      }
      const section = [
        `## ${file.basename}`,
        `Source: \`${file.path}\``,
        '',
        body
      ].join('\n');
      sections.push(section);
    }

    if (sections.length === 0) {
      throw new Error(`Selected ${sourceLabel} source contains no markdown content.`);
    }

    return [
      `# Story Delta Source (${sourceLabel})`,
      '',
      sections.join('\n\n---\n\n'),
      ''
    ].join('\n').trim();
  }

  private async collectTargetPages(): Promise<StoryDeltaExistingPageInput[]> {
    const selectedScopes = this.getNormalizedSelectedScopes();
    if (selectedScopes.length === 0) {
      throw new Error('Select at least one lorebook scope to consider.');
    }

    const prefix = this.plugin.settings.tagScoping.tagPrefix;
    const membershipMode = this.plugin.settings.tagScoping.membershipMode;
    const allFiles = this.app.vault.getMarkdownFiles();
    const files = [...allFiles].sort((left, right) => left.path.localeCompare(right.path));

    const selected: TFile[] = [];
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const tags = cache ? (getAllTags(cache) ?? []) : [];
      const noteScopes = extractLorebookScopesFromTags(tags, prefix);
      const inSelectedLorebook = selectedScopes.some(scope => shouldIncludeInScope(
        noteScopes,
        scope,
        membershipMode,
        false
      ));
      if (!inSelectedLorebook) {
        continue;
      }
      selected.push(file);
    }

    const pages: StoryDeltaExistingPageInput[] = [];
    for (const file of selected) {
      const content = await this.app.vault.read(file);
      pages.push({
        path: file.path,
        content
      });
    }

    return pages;
  }

  private setStoryPathFromActiveNote(): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile)) {
      new Notice('No active markdown note to use as source.');
      return;
    }
    this.sourceStoryNotePath = activeFile.path;
    this.render();
  }

  private openStorySourceNotePicker(): void {
    const files = this.app.vault.getMarkdownFiles();
    if (files.length === 0) {
      new Notice('No markdown notes found.');
      return;
    }
    const modal = new StoryDeltaSourceNotePickerModal(this.app, files, file => {
      this.sourceStoryNotePath = file.path;
      this.render();
    });
    modal.open();
  }

  private getNormalizedSelectedScopes(): string[] {
    const normalized = this.selectedLorebookScopes
      .map(scope => normalizeScope(scope))
      .filter(Boolean);
    return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
  }

  private addLorebookScope(scope: string): void {
    const normalized = normalizeScope(scope);
    if (!normalized) {
      return;
    }
    if (this.selectedLorebookScopes.some(item => normalizeScope(item) === normalized)) {
      return;
    }
    this.selectedLorebookScopes.push(normalized);
    this.selectedLorebookScopes.sort((left, right) => left.localeCompare(right));
    this.render();
  }

  private removeLorebookScope(scope: string): void {
    const normalized = normalizeScope(scope);
    this.selectedLorebookScopes = this.selectedLorebookScopes
      .filter(item => normalizeScope(item) !== normalized);
    this.render();
  }

  private getAvailableLorebookScopes(): string[] {
    return this.plugin.getCachedLorebookScopes();
  }

  private getSelectedPages(): StoryDeltaPlannedPage[] {
    if (!this.lastPreview) {
      return [];
    }
    return this.lastPreview.pages.filter(page => this.approvedPaths.has(page.path));
  }

  private getConflicts(): StoryDeltaConflict[] {
    return this.lastPreview?.conflicts ?? [];
  }

  private getConflictDecision(conflictId: string): StoryDeltaConflictDecision {
    return this.conflictDecisions.get(conflictId) ?? 'pending';
  }

  private setConflictDecision(conflictId: string, decision: StoryDeltaConflictDecision): void {
    this.conflictDecisions.set(conflictId, decision);
    this.render();
  }

  private setAllConflictDecisions(decision: StoryDeltaConflictDecision): void {
    for (const conflict of this.getConflicts()) {
      this.conflictDecisions.set(conflict.id, decision);
    }
    this.render();
  }

  private getConflictCounts(conflicts: StoryDeltaConflict[]): Record<StoryDeltaConflictDecision, number> {
    const counts: Record<StoryDeltaConflictDecision, number> = {
      pending: 0,
      accept: 0,
      reject: 0,
      keep_both: 0
    };
    for (const conflict of conflicts) {
      const decision = this.getConflictDecision(conflict.id);
      counts[decision] += 1;
    }
    return counts;
  }

  private getFilteredConflicts(conflicts: StoryDeltaConflict[]): StoryDeltaConflict[] {
    if (this.conflictFilter === 'all') {
      return conflicts;
    }
    return conflicts.filter(conflict => this.getConflictDecision(conflict.id) === this.conflictFilter);
  }

  private resolveSelectedApplyPages(selected: StoryDeltaPlannedPage[]): ImportedWikiPage[] {
    const pagesByPath = new Map(selected.map(page => [page.path, page]));
    const conflictByPath = new Map(this.getConflicts().map(conflict => [conflict.path, conflict]));
    const sourcePath = normalizeVaultPath(this.sourceStoryNotePath.trim());
    const writes: ImportedWikiPage[] = [];
    let uidCounter = 0;

    for (const page of selected) {
      const conflict = conflictByPath.get(page.path);
      const decision = conflict ? this.getConflictDecision(conflict.id) : 'accept';
      if (conflict && decision === 'reject') {
        continue;
      }
      if (conflict && decision === 'keep_both') {
        const companionPath = buildConflictCompanionPath(page.path);
        const companionContent = buildConflictCompanionContent(page, conflict, sourcePath);
        writes.push({
          path: companionPath,
          content: companionContent,
          uid: uidCounter
        });
        uidCounter += 1;
        continue;
      }

      const resolved = pagesByPath.get(page.path);
      if (!resolved) {
        continue;
      }
      writes.push({
        path: resolved.path,
        content: resolved.content,
        uid: uidCounter
      });
      uidCounter += 1;
    }

    return writes;
  }

  private setAllApprovals(value: boolean): void {
    if (!this.lastPreview) {
      return;
    }
    if (value) {
      this.approvedPaths = new Set(this.lastPreview.pages.map(page => page.path));
    } else {
      this.approvedPaths = new Set<string>();
    }
    this.render();
  }

  private toggleApproval(path: string, value: boolean): void {
    if (value) {
      this.approvedPaths.add(path);
    } else {
      this.approvedPaths.delete(path);
    }
    this.render();
  }

  private async runPreview(): Promise<void> {
    if (this.running) {
      return;
    }
    if (!this.canUseCompletion()) {
      return;
    }

    this.running = true;
    this.previewError = '';
    this.applyStatus = '';
    this.render();

    try {
      const storyMarkdown = await this.resolveStoryMarkdown();
      const existingPages = await this.collectTargetPages();
      this.lastExistingPageCount = existingPages.length;
      const selectedScopes = this.getNormalizedSelectedScopes();

      const completion = this.plugin.settings.completion;
      const result = await buildStoryDeltaPlan({
        storyMarkdown,
        newNoteFolder: this.newNoteTargetFolder,
        defaultTagsRaw: this.defaultTags,
        lorebookScopes: selectedScopes,
        tagPrefix: this.plugin.settings.tagScoping.tagPrefix,
        updatePolicy: this.updatePolicy,
        maxChunkChars: this.maxChunkChars,
        maxSummaryChars: this.plugin.settings.summaries.maxSummaryChars,
        maxOperationsPerChunk: this.maxOperationsPerChunk,
        maxExistingPagesInPrompt: this.maxExistingPagesInPrompt,
        lowConfidenceThreshold: this.lowConfidenceThreshold,
        existingPages,
        callModel: (systemPrompt, userPrompt) => requestStoryContinuation(completion, {
          systemPrompt,
          userPrompt,
          operationName: 'story_delta_preview',
          onOperationLog: record => this.plugin.appendCompletionOperationLog(record)
        })
      });

      this.lastPreview = result;
      this.approvedPaths = new Set(result.pages.map(page => page.path));
      const nextDecisions = new Map<string, StoryDeltaConflictDecision>();
      for (const conflict of result.conflicts) {
        nextDecisions.set(conflict.id, this.conflictDecisions.get(conflict.id) ?? 'pending');
      }
      this.conflictDecisions = nextDecisions;
      this.conflictFilter = 'all';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Story delta preview failed:', error);
      this.lastPreview = null;
      this.conflictDecisions = new Map<string, StoryDeltaConflictDecision>();
      this.previewError = message;
      new Notice(`Story delta preview failed: ${message}`);
    } finally {
      this.running = false;
      this.render();
    }
  }

  private async applySelectedPreview(): Promise<void> {
    if (!this.lastPreview) {
      new Notice('Run preview before applying story delta updates.');
      return;
    }

    const selected = this.getSelectedPages();
    if (selected.length === 0) {
      new Notice('Select at least one planned change before applying.');
      return;
    }

    try {
      const pages = this.resolveSelectedApplyPages(selected);
      if (pages.length === 0) {
        new Notice('No writes selected after conflict decisions (all selected conflicts were rejected).');
        return;
      }
      const applied = await applyImportedWikiPages(this.app, pages);
      const conflicts = this.getConflicts();
      const counts = this.getConflictCounts(conflicts);
      this.applyStatus = `Applied ${pages.length} write(s): ${applied.created} created, ${applied.updated} updated. Conflicts -> accept ${counts.accept}, reject ${counts.reject}, keep_both ${counts.keep_both}, pending ${counts.pending}.`;
      new Notice(`Story delta applied: ${applied.created} created, ${applied.updated} updated.`);
      this.render();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Story delta apply failed:', error);
      this.applyStatus = `Apply failed: ${message}`;
      new Notice(`Story delta apply failed: ${message}`);
      this.render();
    }
  }

  private clearPreview(): void {
    this.lastPreview = null;
    this.approvedPaths = new Set<string>();
    this.conflictDecisions = new Map<string, StoryDeltaConflictDecision>();
    this.conflictFilter = 'all';
    this.previewError = '';
    this.applyStatus = '';
    this.lastExistingPageCount = 0;
    this.render();
  }

  private renderChangeItem(
    container: HTMLElement,
    change: StoryDeltaPlannedChange,
    page: StoryDeltaPlannedPage | undefined
  ): void {
    const row = container.createDiv({ cls: 'lorevault-story-delta-change' });
    const header = row.createDiv({ cls: 'lorevault-story-delta-change-header' });

    const checkbox = header.createEl('input', { type: 'checkbox' });
    checkbox.checked = this.approvedPaths.has(change.path);
    checkbox.addEventListener('change', () => {
      this.toggleApproval(change.path, checkbox.checked);
    });

    const rationaleSnippet = change.rationales[0] ? ` | rationale: ${change.rationales[0]}` : '';
    header.createEl('span', {
      text: `[${change.action}] ${change.path} | +${change.diffAddedLines} -${change.diffRemovedLines} | ops=${change.appliedOperations} | confidence=${change.confidence.toFixed(2)}${rationaleSnippet}`
    });

    if (change.skippedLowConfidence > 0) {
      row.createEl('p', {
        text: `Skipped low-confidence ops for this page: ${change.skippedLowConfidence}`
      });
    }

    if (page) {
      const details = row.createEl('details');
      details.createEl('summary', {
        text: `Diff Preview${page.diff.truncated ? ' (truncated)' : ''}`
      });
      details.createEl('pre', {
        text: page.diff.preview
      });
    }
  }

  private renderConflictReview(container: HTMLElement, conflicts: StoryDeltaConflict[]): void {
    if (conflicts.length === 0) {
      return;
    }

    const section = container.createDiv({ cls: 'lorevault-story-delta-conflict-section' });
    section.createEl('h4', { text: 'Conflict Review' });
    const counts = this.getConflictCounts(conflicts);
    section.createEl('p', {
      cls: 'lorevault-routing-subtle',
      text: `Conflicts: ${conflicts.length} | pending ${counts.pending} | accept ${counts.accept} | reject ${counts.reject} | keep_both ${counts.keep_both}`
    });

    const controls = section.createDiv({ cls: 'lorevault-import-actions' });
    const filterSelect = controls.createEl('select');
    const filterOptions: Array<{value: StoryDeltaConflictFilter; label: string}> = [
      { value: 'all', label: 'All Conflicts' },
      { value: 'pending', label: 'Pending' },
      { value: 'accept', label: 'Accept' },
      { value: 'reject', label: 'Reject' },
      { value: 'keep_both', label: 'Keep Both' }
    ];
    for (const option of filterOptions) {
      const el = filterSelect.createEl('option');
      el.value = option.value;
      el.text = option.label;
    }
    filterSelect.value = this.conflictFilter;
    filterSelect.addEventListener('change', () => {
      const value = filterSelect.value as StoryDeltaConflictFilter;
      this.conflictFilter = value;
      this.render();
    });

    const acceptAllButton = controls.createEl('button', { text: 'Accept All' });
    acceptAllButton.addEventListener('click', () => this.setAllConflictDecisions('accept'));
    const rejectAllButton = controls.createEl('button', { text: 'Reject All' });
    rejectAllButton.addEventListener('click', () => this.setAllConflictDecisions('reject'));
    const keepAllButton = controls.createEl('button', { text: 'Keep Both All' });
    keepAllButton.addEventListener('click', () => this.setAllConflictDecisions('keep_both'));

    const filtered = this.getFilteredConflicts(conflicts);
    if (filtered.length === 0) {
      section.createEl('p', { text: 'No conflicts match the current filter.' });
      return;
    }

    const list = section.createDiv({ cls: 'lorevault-story-delta-change-list' });
    for (const conflict of filtered) {
      const row = list.createDiv({ cls: 'lorevault-story-delta-conflict-row' });
      const decision = this.getConflictDecision(conflict.id);
      row.createEl('p', {
        text: `[${conflict.severity}] ${conflict.path} | ${conflict.summary} | decision=${decision}`
      });
      row.createEl('p', {
        cls: 'lorevault-routing-subtle',
        text: `${conflict.title || conflict.pageKey} | +${conflict.diffAddedLines} -${conflict.diffRemovedLines}`
      });
      const actions = row.createDiv({ cls: 'lorevault-import-actions' });
      const accept = actions.createEl('button', { text: decision === 'accept' ? 'Accepted' : 'Accept' });
      accept.disabled = decision === 'accept';
      accept.addEventListener('click', () => this.setConflictDecision(conflict.id, 'accept'));
      const reject = actions.createEl('button', { text: decision === 'reject' ? 'Rejected' : 'Reject' });
      reject.disabled = decision === 'reject';
      reject.addEventListener('click', () => this.setConflictDecision(conflict.id, 'reject'));
      const keepBoth = actions.createEl('button', { text: decision === 'keep_both' ? 'Keeping Both' : 'Keep Both' });
      keepBoth.disabled = decision === 'keep_both';
      keepBoth.addEventListener('click', () => this.setConflictDecision(conflict.id, 'keep_both'));
    }
  }

  private renderPreviewOutput(container: HTMLElement): void {
    if (this.running) {
      container.createEl('p', { text: 'Running story delta preview...' });
      return;
    }

    if (this.previewError) {
      container.createEl('p', { text: `Preview failed: ${this.previewError}` });
      return;
    }

    if (!this.lastPreview) {
      container.createEl('p', {
        text: 'Run preview to inspect deterministic story-delta changes, approve specific changes, then apply selected writes.'
      });
      return;
    }

    const selectedCount = this.getSelectedPages().length;
    const createCount = this.lastPreview.pages.filter(page => page.action === 'create').length;
    const updateCount = this.lastPreview.pages.filter(page => page.action === 'update').length;
    const conflictCount = this.lastPreview.conflicts.length;

    container.createEl('p', {
      text: `Preview complete: ${this.lastPreview.pages.length} write(s) (${createCount} create, ${updateCount} update), ${conflictCount} conflict(s), ${this.lastPreview.skippedLowConfidence} low-confidence skipped. Selected for apply: ${selectedCount}.`
    });
    if (this.lastExistingPageCount > 0) {
      const scopes = this.getNormalizedSelectedScopes();
      container.createEl('p', {
        text: `Existing pages considered: ${this.lastExistingPageCount} | Lorebooks: ${scopes.join(', ')}`
      });
    }

    if (this.applyStatus) {
      container.createEl('p', { text: this.applyStatus });
    }

    const selectionActions = container.createDiv({ cls: 'lorevault-import-actions' });
    const selectAllButton = selectionActions.createEl('button', { text: 'Select All' });
    selectAllButton.addEventListener('click', () => this.setAllApprovals(true));

    const selectNoneButton = selectionActions.createEl('button', { text: 'Select None' });
    selectNoneButton.addEventListener('click', () => this.setAllApprovals(false));

    this.renderConflictReview(container, this.lastPreview.conflicts);

    const chunkDetails = container.createEl('details');
    chunkDetails.createEl('summary', { text: 'Chunk Diagnostics' });
    const chunkList = chunkDetails.createEl('ul');
    for (const chunk of this.lastPreview.chunks) {
      const warningSuffix = chunk.warnings.length > 0 ? ` | warnings: ${chunk.warnings.join('; ')}` : '';
      chunkList.createEl('li', {
        text: `Chunk ${chunk.chunkIndex}: ${chunk.operationCount} operation(s)${warningSuffix}`
      });
    }

    if (this.lastPreview.warnings.length > 0) {
      const warningDetails = container.createEl('details');
      warningDetails.createEl('summary', { text: `Warnings (${this.lastPreview.warnings.length})` });
      const warningList = warningDetails.createEl('ul');
      for (const warning of this.lastPreview.warnings.slice(0, 80)) {
        warningList.createEl('li', { text: warning });
      }
      if (this.lastPreview.warnings.length > 80) {
        warningDetails.createEl('p', { text: `... ${this.lastPreview.warnings.length - 80} more warnings` });
      }
    }

    const pagesByPath = new Map<string, StoryDeltaPlannedPage>();
    for (const page of this.lastPreview.pages) {
      pagesByPath.set(page.path, page);
    }

    const changeContainer = container.createDiv({ cls: 'lorevault-story-delta-change-list' });
    for (const change of this.lastPreview.changes) {
      this.renderChangeItem(changeContainer, change, pagesByPath.get(change.path));
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-import-view');
    contentEl.createEl('h2', { text: 'Apply Story Delta to Existing Wiki' });

    new Setting(contentEl)
      .setName('Source Story Note Path (Optional)')
      .setDesc('Used when Story Markdown is empty. In chapter/story mode, this note anchors thread resolution.')
      .addText(text => text
        .setPlaceholder('Stories/Book One/Chapter 03.md')
        .setValue(this.sourceStoryNotePath)
        .onChange(value => {
          this.sourceStoryNotePath = value.trim();
        }))
      .addButton(button => button
        .setButtonText('Pick Note')
        .onClick(() => {
          this.openStorySourceNotePicker();
        }))
      .addButton(button => button
        .setButtonText('Use Active Note')
        .onClick(() => {
          this.setStoryPathFromActiveNote();
        }));

    new Setting(contentEl)
      .setName('Source Scope')
      .setDesc('How Source Story Note Path is expanded when Story Markdown is empty.')
      .addDropdown(dropdown => {
        dropdown.addOption('note', 'Note (selected note only)');
        dropdown.addOption('chapter', 'Chapter (selected chapter note)');
        dropdown.addOption('story', 'Story (full story thread)');
        dropdown
          .setValue(this.sourceMode)
          .onChange(value => {
            this.sourceMode = value === 'chapter' || value === 'story' ? value : 'note';
            this.render();
          });
      });
    contentEl.createEl('p', {
      cls: 'lorevault-routing-subtle',
      text: this.sourceMode === 'story'
        ? 'Story mode loads all notes in deterministic story-thread order from the selected source note.'
        : this.sourceMode === 'chapter'
          ? 'Chapter mode requires story/chapter frontmatter and loads the selected chapter note.'
          : 'Note mode loads exactly the selected source note content.'
    });

    new Setting(contentEl)
      .setName('Story Markdown')
      .setDesc('Paste story markdown. Leave empty to load from Source Story Note Path.')
      .addTextArea(text => {
        text.inputEl.rows = 10;
        text
          .setPlaceholder('# Chapter\n...')
          .setValue(this.storyMarkdown)
          .onChange(value => {
            this.storyMarkdown = value;
          });
      });

    const availableScopes = this.getAvailableLorebookScopes();
    const selectedScopes = this.getNormalizedSelectedScopes();
    const unselectedScopes = availableScopes.filter(scope => !selectedScopes.includes(scope));

    const scopesSetting = new Setting(contentEl)
      .setName('Lorebooks to Consider')
      .setDesc('Only notes in these lorebook scopes are considered for existing-page updates.');
    const selectedList = scopesSetting.controlEl.createDiv({ cls: 'lorevault-import-review-list' });
    if (selectedScopes.length === 0) {
      selectedList.createEl('p', { text: 'No lorebooks selected.' });
    } else {
      for (const scope of selectedScopes) {
        const row = selectedList.createDiv({ cls: 'lorevault-import-review-item' });
        row.createEl('code', { text: scope });
        const removeButton = row.createEl('button', { text: 'Remove' });
        removeButton.addEventListener('click', () => {
          this.removeLorebookScope(scope);
        });
      }
    }

    const scopeActions = scopesSetting.controlEl.createDiv({ cls: 'lorevault-import-actions' });
    const scopeSelect = scopeActions.createEl('select');
    if (unselectedScopes.length === 0) {
      const option = scopeSelect.createEl('option');
      option.value = '';
      option.text = availableScopes.length === 0
        ? 'No lorebooks found'
        : 'All lorebooks already selected';
      scopeSelect.disabled = true;
    } else {
      for (const scope of unselectedScopes) {
        const option = scopeSelect.createEl('option');
        option.value = scope;
        option.text = scope;
      }
    }
    const addScopeButton = scopeActions.createEl('button', { text: 'Add Lorebook' });
    addScopeButton.disabled = unselectedScopes.length === 0;
    addScopeButton.addEventListener('click', () => {
      const value = scopeSelect.value.trim();
      if (!value) {
        return;
      }
      this.addLorebookScope(value);
    });
    const activeScope = normalizeScope(this.plugin.settings.tagScoping.activeScope);
    const addActiveScopeButton = scopeActions.createEl('button', { text: 'Add Active Scope' });
    addActiveScopeButton.disabled = !activeScope || selectedScopes.includes(activeScope);
    addActiveScopeButton.addEventListener('click', () => {
      if (activeScope) {
        this.addLorebookScope(activeScope);
      }
    });

    let newNoteTargetFolderInput: { setValue: (value: string) => void } | null = null;
    new Setting(contentEl)
      .setName('New Note Target Folder')
      .setDesc('Used only when Story Delta creates new notes.')
      .addText(text => {
        newNoteTargetFolderInput = text;
        text
          .setPlaceholder('LoreVault/import')
          .setValue(this.newNoteTargetFolder)
          .onChange(value => {
            this.newNoteTargetFolder = value.trim();
          });
      })
      .addButton(button => button
        .setButtonText('Browse')
        .onClick(() => {
          openVaultFolderPicker(this.app, path => {
            this.newNoteTargetFolder = path;
            newNoteTargetFolderInput?.setValue(path);
          });
        }));

    new Setting(contentEl)
      .setName('Update Policy')
      .setDesc('safe_append keeps existing metadata; structured_merge updates summary-section/keywords/aliases too.')
      .addDropdown(dropdown => {
        dropdown.addOption('safe_append', 'safe_append');
        dropdown.addOption('structured_merge', 'structured_merge');
        dropdown.setValue(this.updatePolicy);
        dropdown.onChange(value => {
          if (value === 'safe_append' || value === 'structured_merge') {
            this.updatePolicy = value;
          }
        });
      });

    new Setting(contentEl)
      .setName('Default Tags')
      .setDesc('Applied to newly created notes (comma/newline separated).')
      .addTextArea(text => {
        text.inputEl.rows = 2;
        text
          .setPlaceholder('wiki, updated')
          .setValue(this.defaultTags)
          .onChange(value => {
            this.defaultTags = value;
          });
      });

    new Setting(contentEl)
      .setName('Max Chunk Chars')
      .setDesc('Deterministic chunk size target for story delta extraction.')
      .addText(text => text
        .setValue(this.maxChunkChars.toString())
        .onChange(value => {
          const parsed = parseInt(value, 10);
          if (!isNaN(parsed) && parsed >= 200) {
            this.maxChunkChars = parsed;
          }
        }));

    new Setting(contentEl)
      .setName('Max Operations Per Chunk')
      .setDesc('Upper bound on proposed update operations for each chunk.')
      .addText(text => text
        .setValue(this.maxOperationsPerChunk.toString())
        .onChange(value => {
          const parsed = parseInt(value, 10);
          if (!isNaN(parsed) && parsed >= 1) {
            this.maxOperationsPerChunk = parsed;
          }
        }));

    new Setting(contentEl)
      .setName('Max Existing Pages In Prompt')
      .setDesc('Cap on existing page snapshots injected per chunk.')
      .addText(text => text
        .setValue(this.maxExistingPagesInPrompt.toString())
        .onChange(value => {
          const parsed = parseInt(value, 10);
          if (!isNaN(parsed) && parsed >= 1) {
            this.maxExistingPagesInPrompt = parsed;
          }
        }));

    new Setting(contentEl)
      .setName('Low Confidence Threshold')
      .setDesc('Operations below this confidence are skipped and reported in preview warnings.')
      .addText(text => text
        .setValue(this.lowConfidenceThreshold.toString())
        .onChange(value => {
          const parsed = Number(value);
          if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
            this.lowConfidenceThreshold = parsed;
          }
        }));

    const selectedCount = this.getSelectedPages().length;
    const actions = contentEl.createDiv({ cls: 'lorevault-import-actions' });
    const output = contentEl.createDiv({ cls: 'lorevault-import-output' });

    const previewButton = actions.createEl('button', { text: this.running ? 'Preview Running...' : 'Preview Story Delta' });
    previewButton.addClass('mod-cta');
    previewButton.disabled = this.running;
    previewButton.addEventListener('click', () => {
      void this.runPreview();
    });

    const applyButton = actions.createEl('button', { text: 'Apply Selected' });
    applyButton.disabled = this.running || !this.lastPreview || selectedCount === 0;
    applyButton.addEventListener('click', () => {
      void this.applySelectedPreview();
    });

    const clearButton = actions.createEl('button', { text: 'Clear Preview' });
    clearButton.disabled = this.running || !this.lastPreview;
    clearButton.addEventListener('click', () => {
      this.clearPreview();
    });

    this.renderPreviewOutput(output);
  }
}
