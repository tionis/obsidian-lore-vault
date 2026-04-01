import {
  App,
  FuzzySuggestModal,
  Modal,
  MarkdownView,
  Plugin,
  Notice,
  TAbstractFile,
  TFile,
  addIcon,
  getAllTags,
  Menu,
  Editor,
  MarkdownFileInfo
} from 'obsidian';
import {
  CompletionSemanticChapterRecallSettings,
  CostProfileBudgetSettings,
  ContinuitySelection,
  cloneDefaultTextCommandPromptTemplates,
  CompletionPreset,
  ConverterSettings,
  DEFAULT_SETTINGS,
  LoreBookEntry,
  RagChunk,
  PromptLayerPlacement,
  PromptLayerUsage,
  TextCommandPromptTemplate,
  StoryChatContextMeta,
  StoryChatForkSnapshot,
  StoryChatMessage
} from './models';
import {
  cloneReasoningConfig,
  normalizeCompletionPreset,
  normalizeReasoningConfig,
  resolveDeviceCompletionFallback
} from './completion-settings';
import {
  normalizeIgnoredCalloutTypes,
  stripIgnoredCallouts
} from './callout-utils';
import { shouldShowInsertInlineDirectiveContextAction } from './editor-action-visibility';
import { ProgressBar } from './progress-bar';
import { createTemplate } from './template-creator';
import { LoreBookExporter } from './lorebook-exporter'; 
import { LoreBookConverterSettingTab } from './settings-tab';
import {
  extractLorebookScopesFromTags,
  normalizeScope,
  normalizeTagPrefix,
  shouldIncludeInScope
} from './lorebook-scoping';
import { RagExporter } from './rag-exporter';
import { LOREVAULT_MANAGER_VIEW_TYPE, LorebooksManagerView } from './lorebooks-manager-view';
import {
  LOREVAULT_ROUTING_DEBUG_VIEW_TYPE,
  LorebooksRoutingDebugView
} from './lorebooks-routing-debug-view';
import {
  LOREVAULT_QUERY_SIMULATION_VIEW_TYPE,
  LorebooksQuerySimulationView
} from './lorebooks-query-simulator-view';
import { LOREVAULT_STORY_CHAT_VIEW_TYPE, StoryChatView } from './story-chat-view';
import {
  LOREVAULT_STORY_STARTER_VIEW_TYPE,
  LorevaultStoryStarterView
} from './lorevault-story-starter-view';
import { LOREVAULT_STORY_STEERING_VIEW_TYPE, StorySteeringView } from './story-steering-view';
import { LOREVAULT_HELP_VIEW_TYPE, LorevaultHelpView } from './lorevault-help-view';
import { openVaultFolderPicker } from './folder-suggest-modal';
import {
  LOREVAULT_OPERATION_LOG_VIEW_TYPE,
  LorevaultOperationLogView
} from './lorevault-operation-log-view';
import {
  LOREVAULT_COST_ANALYZER_VIEW_TYPE,
  LorevaultCostAnalyzerView
} from './lorevault-cost-analyzer-view';
import internalDbWorkerSource from 'virtual:internal-db-worker-source';
import { InternalDbClient } from './internal-db-client';
import {
  OperationLogLoadResult,
  OperationLogStore,
  OperationLogStoreStatus
} from './operation-log-store';
import type { ParsedOperationLogEntry } from './operation-log';
import { LOREVAULT_IMPORT_VIEW_TYPE, LorevaultImportView } from './lorevault-import-view';
import {
  LOREVAULT_STORY_EXTRACT_VIEW_TYPE,
  LorevaultStoryExtractView
} from './lorevault-story-extract-view';
import {
  LOREVAULT_EBOOK_IMPORT_VIEW_TYPE,
  LorevaultEbookImportView
} from './lorevault-ebook-import-view';
import {
  LOREVAULT_STORY_DELTA_VIEW_TYPE,
  LorevaultStoryDeltaView
} from './lorevault-story-delta-view';
import {
  LOREVAULT_LORE_DELTA_VIEW_TYPE,
  LorevaultLoreDeltaView
} from './lorevault-lore-delta-view';
import {
  createLorevaultCharacterBasesViewRegistration,
  LOREVAULT_CHARACTER_BASES_VIEW_ID
} from './character-card-bases-view';
import { LiveContextIndex } from './live-context-index';
import { ChapterSummaryStore } from './chapter-summary-store';
import { EmbeddingService } from './embedding-service';
import {
  CompletionOperationKind,
  CompletionOperationLogRecord,
  CompletionToolDefinition,
  CompletionToolPlannerMessage,
  CompletionUsageReport,
  createCompletionToolPlanner,
  createCompletionRetrievalToolPlanner,
  requestStoryContinuation,
  requestStoryContinuationStream
} from './completion-provider';
import { parseStoryScopesFromFrontmatter, parseStoryScopesFromRawValues } from './story-scope-selector';
import {
  assertUniqueOutputPaths,
  ScopeOutputAssignment,
  resolveScopeOutputPaths
} from './scope-output-paths';
import { buildScopePack } from './scope-pack-builder';
import { SqlitePackExporter } from './sqlite-pack-exporter';
import { SqlitePackReader } from './sqlite-pack-reader';
import { AssembledContext, ScopeContextPack } from './context-query';
import { createRetrievalToolCatalog, runModelDrivenRetrievalHooks } from './retrieval-tool-hooks';
import {
  StoryThreadNode,
  parseStoryThreadNodeFromFrontmatter,
  resolveStoryThreadLineage
} from './story-thread-resolver';
import {
  asBoolean,
  asString,
  asStringArray,
  FrontmatterData,
  getFrontmatterValue,
  normalizeFrontmatter,
  stripFrontmatter,
  uniqueStrings
} from './frontmatter-utils';
import { normalizeLinkTarget } from './link-target-index';
import {
  GeneratedSummaryMode,
  normalizeGeneratedSummaryText,
  resolveNoteSummary,
  stripSummarySectionFromBody,
  upsertSummarySectionInMarkdown
} from './summary-utils';
import { SummaryReviewModal, SummaryReviewResult } from './summary-review-modal';
import { TextCommandPromptModal, TextCommandPromptSelectionResult } from './text-command-modal';
import { TextCommandReviewModal } from './text-command-review-modal';
import {
  cloneTextCommandPosition,
  cloneTextCommandTargetSnapshot,
  doesTextCommandSelectionMatchSnapshot,
  replaceTextCommandTargetRange,
  TextCommandTargetSnapshot
} from './text-command-target';
import { AuthorNoteRewriteModal } from './author-note-rewrite-modal';
import { AuthorNoteLinkModal } from './author-note-link-modal';
import { InlineDirectiveInsertModal } from './inline-directive-insert-modal';
import { GreetingSelectorModal, GreetingOption } from './greeting-selector-modal';
import { KeywordReviewModal, KeywordReviewResult } from './keyword-review-modal';
import {
  collectLorebookNoteMetadata,
  collectLorebookNoteMetadataForFile
} from './lorebooks-manager-collector';
import { buildScopeSummaries, LorebookNoteMetadata } from './lorebooks-manager-data';
import { UsageLedgerStore, type UsageLedgerStoreStatus } from './usage-ledger-store';
import { estimateUsageCostUsdWithRateSelection } from './cost-utils';
import {
  serializeUsageLedgerEntriesCsv,
  UsageLedgerReportSnapshot
} from './usage-ledger-report';
import { parseGeneratedKeywords, upsertKeywordsFrontmatter } from './keyword-utils';
import {
  ensureParentVaultFolderForFile,
  getVaultBasename,
  getVaultDirname,
  getVaultExtname,
  joinVaultPath,
  normalizeVaultPath,
  normalizeVaultRelativePath
} from './vault-path-utils';
import { readVaultBinary, writeVaultBinary } from './vault-binary-io';
import {
  ChapterMemoryAggressiveness,
  estimateChapterMemoryExcerptChapterWindow,
  estimateChapterMemoryExcerptReserveTokens,
  estimateChapterMemoryPriorChapterWindow,
  estimateChapterMemorySummaryTokenBudget,
  extractAdaptiveQueryWindow,
  extractAdaptiveStoryWindow,
  normalizeChapterMemoryAggressiveness,
  resolveChapterMemoryExcerptSectionTokenRange
} from './context-window-strategy';
import { renderInlineLoreDirectivesAsTags, stripInlineLoreDirectives } from './inline-directives';
import { sha256Hex, slugifyIdentifier, stableJsonHash } from './hash-utils';
import {
  createEmptyStorySteeringState,
  mergeStorySteeringStates,
  parseStorySteeringMarkdown,
  normalizeStorySteeringState,
  parseStorySteeringExtractionResponse,
  sanitizeStorySteeringExtractionState,
  StorySteeringEffectiveState,
  StorySteeringScope,
  StorySteeringState,
  StorySteeringStore
} from './story-steering';
import {
  normalizeStoryChatSteeringRefs,
  parseStoryChatSteeringRef,
  stringifyStoryChatSteeringRef
} from './story-chat-steering-refs';
import {
  applyDeterministicOverflow,
  estimateTextTokens,
  PromptSegment,
  toPromptLayerUsage,
  trimTextForTokenBudget
} from './prompt-staging';
import { LorebookScopeCache } from './lorebook-scope-cache';
import {
  applyCharacterCardWriteBackToPayload,
  buildCharacterCardEventInjectionSystemPrompt,
  buildCharacterCardEventInjectionUserPrompt,
  CharacterCardEventInjectionContext,
  CharacterCardWriteBackFields,
  parseCharacterCardEventInjectionResponse,
  ParsedCharacterCard,
  parseSillyTavernCharacterCardJson,
  parseSillyTavernCharacterCardPngBytes,
  serializeCharacterCardJsonPayload,
  upsertSillyTavernCharacterCardPngPayload
} from './sillytavern-character-card';
import {
  CharacterCardDetailsContent,
  CHARACTER_CARD_DETAILS_BLOCK_BEGIN,
  CHARACTER_CARD_DETAILS_BLOCK_END,
  CHARACTER_CARD_DETAILS_BLOCK_VERSION,
  CHARACTER_CARD_DETAILS_BLOCK_VERSION_PREFIX,
  parseCharacterCardDetailsContentFromMarkdown
} from './character-card-details';
import {
  buildCharacterCardSummarySystemPrompt,
  buildCharacterCardSummaryUserPrompt,
  CharacterCardSummaryPayload,
  parseCharacterCardSummaryResponse
} from './character-card-summary';
import {
  buildChapterFileStem,
  buildStoryChapterNoteMarkdown,
  formatStoryChapterRef,
  splitStoryMarkdownIntoChapterSections,
  upsertStoryChapterFrontmatter
} from './story-chapter-management';

const STEERING_RESERVE_FRACTION = 0.14;
const STEERING_GUIDANCE_SYSTEM_PROMPT = [
  'Follow guidance in `<story_author_note>` when present.',
  'Follow any `<inline_story_directive>` tags in context blocks as instructions tied to nearby text.',
  'Do not copy directive tags or directive contents into the final response.'
].join('\n');

type SteeringLayerKey = 'author_note';

interface SteeringLayerSection {
  key: SteeringLayerKey;
  label: string;
  tag: string;
  placement: PromptLayerPlacement;
  text: string;
  reservedTokens: number;
  usedTokens: number;
  trimmed: boolean;
  trimReason?: string;
  locked: boolean;
}

interface CharacterCardEventOption extends GreetingOption {
  category: 'first' | 'alternate' | 'group';
}

export interface GenerationTelemetry {
  state: 'idle' | 'preparing' | 'retrieving' | 'generating' | 'error';
  statusText: string;
  startedAt: number;
  updatedAt: number;
  provider: string;
  model: string;
  scopes: string[];
  contextWindowTokens: number;
  maxInputTokens: number;
  promptReserveTokens: number;
  estimatedInstructionTokens: number;
  storyTokens: number;
  contextUsedTokens: number;
  contextRemainingTokens: number;
  maxOutputTokens: number;
  generatedTokens: number;
  worldInfoCount: number;
  ragCount: number;
  worldInfoItems: string[];
  ragItems: string[];
  inlineDirectiveItems: string[];
  continuityPlotThreads: string[];
  continuityOpenLoops: string[];
  continuityCanonDeltas: string[];
  layerUsage: PromptLayerUsage[];
  overflowTrace: string[];
  contextLayerTrace: string[];
  lastError: string;
}

export interface StoryChatTurnRequest {
  userMessage: string;
  selectedScopes: string[];
  completionPresetId?: string;
  useLorebookContext: boolean;
  manualContext: string;
  steeringScopeRefs: string[];
  continuityPlotThreads: string[];
  continuityOpenLoops: string[];
  continuityCanonDeltas: string[];
  continuitySelection: ContinuitySelection;
  noteContextRefs: string[];
  history: StoryChatMessage[];
  onDelta: (delta: string) => void;
  onReasoning?: (delta: string) => void;
}

export interface StoryChatTurnResult {
  assistantText: string;
  contextMeta: StoryChatContextMeta;
  reasoning?: string;
}

export interface LoreVaultLocalStorageHealth {
  operationLog: OperationLogStoreStatus;
  usageLedger: UsageLedgerStoreStatus;
  usageBytes: number | null;
  quotaBytes: number | null;
}

export interface LinkedStoryDisplayItem {
  path: string;
  chapter: number | null;
  chapterTitle: string;
}

type StoryChatAgentToolName =
  | 'search_lorebook_entries'
  | 'get_lorebook_entry'
  | 'search_story_notes'
  | 'read_story_note'
  | 'get_steering_scope'
  | 'update_steering_scope'
  | 'create_lorebook_entry_note';

interface StoryChatAgentToolCall {
  id: string;
  name: StoryChatAgentToolName;
  argumentsJson: string;
}

interface StoryChatAgentToolExecutionResult {
  ok: boolean;
  payload: Record<string, unknown>;
  estimatedTokens: number;
  trace: string;
  isWrite: boolean;
  callSummary: string;
  writeSummary?: string;
  contextSnippet?: string;
}

interface StoryChatAgentToolRunResult {
  markdown: string;
  usedTokens: number;
  trace: string[];
  callSummaries: string[];
  writeSummaries: string[];
}

interface ConvertToLorebookOptions {
  silentSuccessNotice?: boolean;
  suppressErrorNotice?: boolean;
  deferViewRefresh?: boolean;
  quietProgress?: boolean;
}

interface LoreVaultSecretStorage {
  setSecret(key: string, value: string): Promise<void>;
  getSecret(key: string): Promise<string | null>;
  listSecrets?(): Promise<string[]> | string[];
}

interface DeviceProfileState {
  activeCompletionPresetId: string;
  activeStoryChatPresetId: string;
  activeCostProfile: string;
}

type CompletionProfileSource = 'author_note' | 'device' | 'base';
type StoryChatCompletionProfileSource = 'chat' | 'device' | 'base';

interface CompletionProfileResolution {
  completion: ConverterSettings['completion'];
  source: CompletionProfileSource;
  presetId: string;
  presetName: string;
  authorNotePath: string;
}

interface CompletionProfileWorkspaceStatus {
  effective: CompletionProfileResolution;
  devicePresetId: string;
  devicePresetName: string;
  authorNotePresetId: string;
  authorNotePresetName: string;
  authorNotePath: string;
  costProfile: string;
  effectiveCostProfile: string;
}

interface UsageReportSnapshotOptions {
  costProfile?: string | null;
  includeAllProfiles?: boolean;
}

interface OperationLogAppendOptions {
  costProfile?: string;
}

interface CompletionPresetSuggestItem {
  id: string;
  label: string;
}

interface PendingTextCommandReview {
  id: string;
  promptName: string;
  target: TextCommandTargetSnapshot;
  revisedText: string;
  includeLorebookContext: boolean;
  scopeLabels: string[];
  worldInfoCount: number;
  ragCount: number;
  worldInfoDetails: string[];
  ragDetails: string[];
  createdAt: number;
}

type TextCommandApplyResult =
  | { ok: true }
  | {
    ok: false;
    reason: 'selection_changed' | 'target_missing' | 'write_failed';
    message?: string;
  };

class CompletionPresetSuggestModal extends FuzzySuggestModal<CompletionPresetSuggestItem> {
  private readonly items: CompletionPresetSuggestItem[];
  private resolveResult: ((value: CompletionPresetSuggestItem | null) => void) | null = null;
  private resolved = false;
  private selectedItem: CompletionPresetSuggestItem | null = null;

  constructor(app: App, items: CompletionPresetSuggestItem[], placeholder: string) {
    super(app);
    this.items = items;
    this.setPlaceholder(placeholder);
  }

  waitForSelection(): Promise<CompletionPresetSuggestItem | null> {
    return new Promise(resolve => {
      this.resolveResult = resolve;
    });
  }

  getItems(): CompletionPresetSuggestItem[] {
    return this.items;
  }

  getItemText(item: CompletionPresetSuggestItem): string {
    return item.label;
  }

  onChooseItem(item: CompletionPresetSuggestItem): void {
    this.selectedItem = item;
    this.finish(item);
  }

  onClose(): void {
    super.onClose();
    window.setTimeout(() => {
      this.finish(this.selectedItem);
    }, 0);
  }

  private finish(value: CompletionPresetSuggestItem | null): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    if (this.resolveResult) {
      this.resolveResult(value);
      this.resolveResult = null;
    }
  }
}

class StoryForkNameModal extends Modal {
  private readonly sourceName: string;
  private readonly initialName: string;
  private resolveResult: ((value: string | null) => void) | null = null;
  private settled = false;
  private inputEl: HTMLInputElement | null = null;

  constructor(app: App, sourceName: string, initialName: string) {
    super(app);
    this.sourceName = sourceName.trim();
    this.initialName = initialName.trim();
  }

  waitForResult(): Promise<string | null> {
    return new Promise(resolve => {
      this.resolveResult = resolve;
    });
  }

  onOpen(): void {
    this.setTitle('Fork Story');
    this.contentEl.empty();
    this.contentEl.createEl('p', {
      text: 'Enter a name for the forked story note. It must be different from the current note name.'
    });

    const row = this.contentEl.createDiv({ cls: 'lorevault-modal-input-row' });
    row.createEl('label', { text: 'Fork Note Name' });
    const input = row.createEl('input', {
      type: 'text',
      cls: 'lorevault-modal-input'
    });
    input.value = this.initialName;
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.submit();
      }
    });
    this.inputEl = input;

    const actions = this.contentEl.createDiv({ cls: 'lorevault-modal-actions' });
    const cancelButton = actions.createEl('button', { text: 'Cancel' });
    cancelButton.addEventListener('click', () => this.close());

    const submitButton = actions.createEl('button', { text: 'Create Fork' });
    submitButton.addClass('mod-cta');
    submitButton.addEventListener('click', () => this.submit());

    window.setTimeout(() => {
      this.inputEl?.focus();
      this.inputEl?.select();
    }, 0);
  }

  onClose(): void {
    this.finish(null);
  }

  private submit(): void {
    const value = this.inputEl?.value.trim() ?? '';
    if (!value) {
      new Notice('Fork note name cannot be empty.');
      return;
    }
    if (value.localeCompare(this.sourceName, undefined, { sensitivity: 'accent' }) === 0) {
      new Notice('Fork note name must be different from the source note name.');
      return;
    }
    this.finish(value);
    this.close();
  }

  private finish(value: string | null): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.resolveResult?.(value);
    this.resolveResult = null;
  }
}

interface LorebookForkRequest {
  targetScope: string;
  targetFolder: string;
}

class LorebookForkModal extends Modal {
  private readonly sourceScope: string;
  private readonly defaultTargetFolder: string;
  private resolveResult: ((value: LorebookForkRequest | null) => void) | null = null;
  private settled = false;
  private scopeInputEl: HTMLInputElement | null = null;
  private folderInputEl: HTMLInputElement | null = null;

  constructor(app: App, sourceScope: string, defaultTargetFolder: string) {
    super(app);
    this.sourceScope = sourceScope;
    this.defaultTargetFolder = defaultTargetFolder;
  }

  waitForResult(): Promise<LorebookForkRequest | null> {
    return new Promise(resolve => {
      this.resolveResult = resolve;
    });
  }

  onOpen(): void {
    this.setTitle('Fork Lorebook');
    this.contentEl.empty();
    this.contentEl.createEl('p', {
      text: `Create a lorebook fork from "${this.sourceScope}" by choosing a new lorebook and target folder.`
    });

    const scopeRow = this.contentEl.createDiv({ cls: 'lorevault-modal-input-row' });
    scopeRow.createEl('label', { text: 'New Lorebook' });
    const scopeInput = scopeRow.createEl('input', {
      type: 'text',
      cls: 'lorevault-modal-input'
    });
    scopeInput.value = this.sourceScope;
    scopeInput.placeholder = 'universe/my-fork';
    scopeInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.submit();
      }
    });
    this.scopeInputEl = scopeInput;

    const folderRow = this.contentEl.createDiv({ cls: 'lorevault-modal-input-row' });
    folderRow.createEl('label', { text: 'Target Folder' });
    const folderInput = folderRow.createEl('input', {
      type: 'text',
      cls: 'lorevault-modal-input'
    });
    folderInput.value = this.defaultTargetFolder;
    folderInput.placeholder = 'LoreVault/import/my-fork';
    folderInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.submit();
      }
    });
    this.folderInputEl = folderInput;
    const browseButton = folderRow.createEl('button', { text: 'Browse' });
    browseButton.addEventListener('click', () => {
      openVaultFolderPicker(this.app, path => {
        if (this.folderInputEl) {
          this.folderInputEl.value = path;
        }
      });
    });

    const actions = this.contentEl.createDiv({ cls: 'lorevault-modal-actions' });
    const cancelButton = actions.createEl('button', { text: 'Cancel' });
    cancelButton.addEventListener('click', () => this.close());

    const submitButton = actions.createEl('button', { text: 'Create Fork' });
    submitButton.addClass('mod-cta');
    submitButton.addEventListener('click', () => this.submit());

    window.setTimeout(() => {
      this.scopeInputEl?.focus();
      this.scopeInputEl?.select();
    }, 0);
  }

  onClose(): void {
    this.finish(null);
  }

  private submit(): void {
    const targetScope = this.scopeInputEl?.value.trim() ?? '';
    const targetFolder = this.folderInputEl?.value.trim() ?? '';
    if (!targetScope) {
      new Notice('New lorebook cannot be empty.');
      return;
    }
    if (!targetFolder) {
      new Notice('Target folder cannot be empty.');
      return;
    }
    this.finish({ targetScope, targetFolder });
    this.close();
  }

  private finish(value: LorebookForkRequest | null): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.resolveResult?.(value);
    this.resolveResult = null;
  }
}

const LOREVAULT_DEVICE_STATE_KEY = 'lorevault/device-state/v1';
const AUTHOR_NOTE_COMPLETION_PROFILE_FRONTMATTER_KEY = 'completionProfile';
const COMPLETION_PRESET_SECRET_PREFIX = 'lorevault-completion-';
const CHARACTER_CARD_META_DOC_TYPE = 'characterCard';
const CHARACTER_CARD_SOURCE_EXTENSIONS = new Set(['png', 'json']);

export default class LoreBookConverterPlugin extends Plugin {
  settings: ConverterSettings;
  liveContextIndex: LiveContextIndex;
  private usageLedgerStore!: UsageLedgerStore;
  private storySteeringStore!: StorySteeringStore;
  private lorebookScopeCache!: LorebookScopeCache;
  private readonly sessionStartedAt = Date.now();
  private chapterSummaryStore!: ChapterSummaryStore;
  private generationStatusEl: HTMLElement | null = null;
  private pendingTextCommandReviewEl: HTMLElement | null = null;
  private generationInFlight = false;
  private generationAbortController: AbortController | null = null;
  private generationStatusLevel: 'idle' | 'busy' | 'error' = 'idle';
  private generationTelemetry: GenerationTelemetry = this.createDefaultGenerationTelemetry();
  private pendingTextCommandReviews: PendingTextCommandReview[] = [];
  private pendingTextCommandReviewInFlight = false;
  private managerRefreshTimer: number | null = null;
  private exportScopeIndexByPath: Map<string, string[]> = new Map();
  private exportRebuildTimer: number | null = null;
  private exportRebuildInFlight = false;
  private pendingExportScopes = new Set<string>();
  private internalDbWorkerObjectUrl: string | null = null;
  private internalDbClient: InternalDbClient | null = null;
  private operationLogStore: OperationLogStore | null = null;
  private operationLogWriteQueue: Promise<void> = Promise.resolve();
  private operationLogViewRefreshTimer: number | null = null;
  private storagePersisted: boolean | null = null;
  private knownCostProfilesCache: Promise<string[]> | null = null;
  // Note: the plugin keeps its own EmbeddingService for chapter-memory operations
  // (separate from the one inside LiveContextIndex) so that usage events are tagged
  // with source:'chapter_memory' rather than source:'live_context_index'.  Both
  // instances share the same on-disk EmbeddingCache, so no redundant network calls
  // occur for content that has already been embedded.
  private chapterMemoryEmbeddingService: EmbeddingService | null = null;
  private chapterMemoryEmbeddingSignature = '';
  /** Lazily-built cache: normalised source path (lower-case) → meta note path. */
  private cardMetaPathCache: Map<string, string> | null = null;
  private deviceProfileState: DeviceProfileState = {
    activeCompletionPresetId: '',
    activeStoryChatPresetId: '',
    activeCostProfile: ''
  };

  private getBaseOutputPath(): string {
    return this.settings.outputPath?.trim() || DEFAULT_SETTINGS.outputPath;
  }

  public getDefaultLorebookImportLocation(): string {
    return this.settings.defaultLorebookImportLocation?.trim() || DEFAULT_SETTINGS.defaultLorebookImportLocation;
  }

  public getCharacterCardSourceFolderPath(): string {
    return this.settings.characterCards.sourceFolder?.trim() || DEFAULT_SETTINGS.characterCards.sourceFolder;
  }

  public getCharacterCardMetaFolderPath(): string {
    return this.settings.characterCards.metaFolder?.trim() || DEFAULT_SETTINGS.characterCards.metaFolder;
  }

  private isPathInVaultFolder(path: string, folder: string): boolean {
    const normalizedPath = normalizeVaultPath(path).toLowerCase();
    const normalizedFolder = normalizeVaultPath(folder).toLowerCase();
    if (!normalizedPath || !normalizedFolder) {
      return false;
    }
    return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
  }

  private getCharacterCardSourceFiles(): TFile[] {
    const sourceFolder = this.getCharacterCardSourceFolderPath();
    return this.app.vault.getFiles()
      .filter(file => this.isPathInVaultFolder(file.path, sourceFolder))
      .filter(file => CHARACTER_CARD_SOURCE_EXTENSIONS.has(file.extension.toLowerCase()))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  public listCharacterCardSourceFiles(): TFile[] {
    return this.getCharacterCardSourceFiles();
  }

  /** Build (or return the cached) map of normalised source path → meta note path. */
  private buildCardMetaPathCache(): Map<string, string> {
    if (this.cardMetaPathCache) {
      return this.cardMetaPathCache;
    }
    const result = new Map<string, string>();
    const metaFolder = this.getCharacterCardMetaFolderPath();
    const candidates = this.app.vault.getMarkdownFiles()
      .filter(file => this.isPathInVaultFolder(file.path, metaFolder));
    for (const file of candidates) {
      const fileCache = this.app.metadataCache.getFileCache(file);
      const frontmatter = normalizeFrontmatter((fileCache?.frontmatter ?? {}) as FrontmatterData);
      const docType = (asString(getFrontmatterValue(frontmatter, 'lvDocType')) ?? '').toLowerCase();
      if (docType !== CHARACTER_CARD_META_DOC_TYPE.toLowerCase()) {
        continue;
      }
      const cardPath = normalizeVaultPath(
        asString(getFrontmatterValue(frontmatter, 'cardPath', 'characterCardPath')) ?? ''
      );
      if (cardPath) {
        result.set(cardPath.toLowerCase(), file.path);
      }
    }
    this.cardMetaPathCache = result;
    return result;
  }

  public findCharacterCardMetaPathBySourcePath(sourcePath: string): string {
    const normalizedSourcePath = normalizeVaultPath(sourcePath.trim());
    if (!normalizedSourcePath) {
      return '';
    }
    return this.buildCardMetaPathCache().get(normalizedSourcePath.toLowerCase()) ?? '';
  }

  private invalidateCardMetaPathCache(): void {
    this.cardMetaPathCache = null;
  }

  private getRawOperationLogBasePath(): string {
    const raw = (this.settings.operationLog.path ?? '')
      .toString()
      .trim()
      .replace(/\\/g, '/');
    return raw || DEFAULT_SETTINGS.operationLog.path;
  }

  private normalizeCostProfileForFileSegment(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  private appendCostProfileSuffixToPath(basePath: string, costProfile: string): string {
    const normalizedProfile = this.normalizeCostProfileForFileSegment(costProfile) || 'default';
    const extension = getVaultExtname(basePath);
    if (extension) {
      const stem = basePath.slice(0, -extension.length);
      return `${stem}--${normalizedProfile}${extension}`;
    }
    return `${basePath}--${normalizedProfile}.jsonl`;
  }

  public getOperationLogPath(costProfile?: string | null): string {
    const resolvedProfile = (costProfile ?? '').trim() || this.getDeviceEffectiveCostProfileLabel();
    return this.appendCostProfileSuffixToPath(
      this.getRawOperationLogBasePath(),
      resolvedProfile || 'default'
    );
  }

  private getOperationLogMaxEntries(): number {
    return Math.max(
      20,
      Math.min(20000, Math.floor(Number(this.settings.operationLog.maxEntries) || DEFAULT_SETTINGS.operationLog.maxEntries))
    );
  }

  private createInternalDbWorkerUrl(): string | null {
    try {
      if (this.internalDbWorkerObjectUrl) {
        URL.revokeObjectURL(this.internalDbWorkerObjectUrl);
        this.internalDbWorkerObjectUrl = null;
      }
      const blob = new Blob(
        [
          `${internalDbWorkerSource}\n//# sourceURL=lorevault-internal-db-worker.js`
        ],
        { type: 'text/javascript' }
      );
      this.internalDbWorkerObjectUrl = URL.createObjectURL(blob);
      return this.internalDbWorkerObjectUrl;
    } catch (error) {
      console.warn('LoreVault: Failed to create internal DB worker URL:', error);
      return null;
    }
  }

  private async requestPersistentBrowserStorage(): Promise<boolean | null> {
    if (typeof navigator === 'undefined' || typeof navigator.storage?.persist !== 'function') {
      return null;
    }
    try {
      return await navigator.storage.persist();
    } catch (error) {
      console.warn('LoreVault: Failed to request persistent browser storage:', error);
      return null;
    }
  }

  private isEmbeddingOperationLogEnabled(): boolean {
    return this.settings.operationLog.enabled && this.settings.operationLog.includeEmbeddings;
  }

  private async appendOperationLogRecord(
    record: CompletionOperationLogRecord,
    options: OperationLogAppendOptions = {}
  ): Promise<void> {
    const costProfile = (options.costProfile ?? record.costProfile ?? '').trim() || this.getDeviceEffectiveCostProfileLabel() || 'default';
    const store = this.operationLogStore;
    if (!store) {
      return;
    }

    this.operationLogWriteQueue = this.operationLogWriteQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          await store.append({
            ...record,
            costProfile
          }, costProfile);
        } catch (error) {
          console.warn('LoreVault: Failed to persist operation log entry:', error);
        }
      });

    await this.operationLogWriteQueue;
    this.queueOperationLogViewRefresh();
  }

  public async appendCompletionOperationLog(
    record: CompletionOperationLogRecord,
    options: OperationLogAppendOptions = {}
  ): Promise<void> {
    if (!this.settings.operationLog.enabled) {
      return;
    }
    await this.appendOperationLogRecord(record, options);
  }

  public async appendEmbeddingOperationLog(
    record: CompletionOperationLogRecord,
    options: OperationLogAppendOptions = {}
  ): Promise<void> {
    if (!this.isEmbeddingOperationLogEnabled()) {
      return;
    }
    await this.appendOperationLogRecord(record, options);
  }

  public async loadOperationLogEntries(options: {
    costProfile?: string | null;
    kindFilter?: 'all' | CompletionOperationKind;
    statusFilter?: 'all' | 'ok' | 'error';
    searchQuery?: string;
    limit?: number;
  }): Promise<OperationLogLoadResult> {
    if (!this.operationLogStore) {
      return {
        entries: [],
        issues: [],
        totalEntries: 0,
        hasMoreEntries: false,
        backendLabel: 'Unavailable',
        legacyPath: this.getOperationLogPath(options.costProfile),
        warningMessage: ''
      };
    }
    return this.operationLogStore.query({
      costProfile: (options.costProfile ?? '').trim() || this.getDeviceEffectiveCostProfileLabel() || 'default',
      kindFilter: options.kindFilter ?? 'all',
      statusFilter: options.statusFilter ?? 'all',
      searchQuery: options.searchQuery ?? '',
      limit: Math.max(10, Math.min(5000, Math.floor(options.limit ?? 120)))
    });
  }

  public async loadOperationLogEntryDetail(options: {
    costProfile?: string | null;
    id: string;
  }): Promise<ParsedOperationLogEntry | null> {
    if (!this.operationLogStore) {
      return null;
    }
    return this.operationLogStore.getEntryDetail(
      (options.costProfile ?? '').trim() || this.getDeviceEffectiveCostProfileLabel() || 'default',
      options.id
    );
  }

  public async loadOperationLogEntryRequestPayload(options: {
    costProfile?: string | null;
    id: string;
  }): Promise<unknown> {
    if (!this.operationLogStore) {
      return null;
    }
    return this.operationLogStore.getEntryRequestPayload(
      (options.costProfile ?? '').trim() || this.getDeviceEffectiveCostProfileLabel() || 'default',
      options.id
    );
  }

  public async loadOperationLogEntryAttempts(options: {
    costProfile?: string | null;
    id: string;
  }) {
    if (!this.operationLogStore) {
      return [];
    }
    return this.operationLogStore.getEntryAttempts(
      (options.costProfile ?? '').trim() || this.getDeviceEffectiveCostProfileLabel() || 'default',
      options.id
    );
  }

  public async loadOperationLogEntryFinalText(options: {
    costProfile?: string | null;
    id: string;
  }): Promise<string | null> {
    if (!this.operationLogStore) {
      return null;
    }
    return this.operationLogStore.getEntryFinalText(
      (options.costProfile ?? '').trim() || this.getDeviceEffectiveCostProfileLabel() || 'default',
      options.id
    );
  }

  public async getOperationLogStorageStatus(costProfile?: string | null): Promise<OperationLogStoreStatus> {
    if (!this.operationLogStore) {
      return {
        internalDb: {
          available: false,
          backend: null,
          backendLabel: 'uninitialized',
          sqliteVersion: '',
          storagePersisted: this.storagePersisted,
          errorMessage: ''
        },
        legacyPath: this.getOperationLogPath(costProfile)
      };
    }
    return this.operationLogStore.getStatus(costProfile);
  }

  public async getUsageLedgerStorageStatus(): Promise<UsageLedgerStoreStatus> {
    if (!this.usageLedgerStore) {
      return {
        internalDb: {
          available: false,
          backend: null,
          backendLabel: 'uninitialized',
          sqliteVersion: '',
          storagePersisted: this.storagePersisted,
          errorMessage: ''
        },
        canonicalRootPath: this.resolveUsageLedgerPath().replace(/\.json$/i, ''),
        legacyFilePath: this.resolveUsageLedgerPath().toLowerCase().endsWith('.json')
          ? this.resolveUsageLedgerPath()
          : null,
        knownRecordCount: 0,
        pendingChangedRecordCount: 0,
        staleSourceRootCount: 0,
        lastSuccessfulSyncAt: 0
      };
    }
    return this.usageLedgerStore.getStatus();
  }

  public async getLocalStorageHealth(): Promise<LoreVaultLocalStorageHealth> {
    const [operationLog, usageLedger] = await Promise.all([
      this.getOperationLogStorageStatus(),
      this.getUsageLedgerStorageStatus()
    ]);
    let usageBytes: number | null = null;
    let quotaBytes: number | null = null;
    try {
      const estimate = typeof navigator !== 'undefined'
        ? await navigator.storage?.estimate?.()
        : undefined;
      usageBytes = typeof estimate?.usage === 'number' ? estimate.usage : null;
      quotaBytes = typeof estimate?.quota === 'number' ? estimate.quota : null;
    } catch (_error) {
      usageBytes = null;
      quotaBytes = null;
    }
    return {
      operationLog,
      usageLedger,
      usageBytes,
      quotaBytes
    };
  }

  public async rebuildLocalIndexes(): Promise<void> {
    await this.usageLedgerStore.rebuildLocalIndex();
    this.invalidateKnownCostProfilesCache();
    this.refreshOperationLogViews();
    this.refreshCostAnalyzerViews();
  }

  public async resetLocalDb(): Promise<void> {
    if (!this.internalDbClient) {
      throw new Error('Local internal DB is not configured in this runtime.');
    }
    await this.internalDbClient.resetLocalDb();
    this.usageLedgerStore.resetLocalIndexState();
    await this.usageLedgerStore.initialize();
    this.invalidateKnownCostProfilesCache();
    this.refreshOperationLogViews();
    this.refreshCostAnalyzerViews();
  }

  public async importLegacyUsageLedgerNow(): Promise<number> {
    const imported = await this.usageLedgerStore.importLegacyLedgerNow();
    this.invalidateKnownCostProfilesCache();
    this.refreshCostAnalyzerViews();
    return imported;
  }

  public async revealCanonicalUsageLedgerFolder(): Promise<string> {
    const canonicalRootPath = this.usageLedgerStore.getCanonicalRootPath();
    if (!canonicalRootPath) {
      return '';
    }
    const existing = this.app.vault.getAbstractFileByPath(canonicalRootPath);
    if (!existing) {
      await this.app.vault.createFolder(canonicalRootPath);
    }
    const folder = this.app.vault.getAbstractFileByPath(canonicalRootPath);
    const explorerLeaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
    const explorerView = explorerLeaf?.view as { revealInFolder?: (file: TAbstractFile) => void } | undefined;
    if (folder && typeof explorerView?.revealInFolder === 'function') {
      explorerView.revealInFolder(folder);
    }
    return canonicalRootPath;
  }

  private getSecretStorage(): LoreVaultSecretStorage | null {
    // Obsidian does not expose a stable typed API for secret storage as of the
    // current SDK version.  We detect it via duck-typing so that the plugin
    // degrades gracefully (stores keys in plain settings JSON) on hosts where
    // the field is absent or renamed.  If Obsidian formalises the API this
    // should be replaced with the official typed accessor.
    const maybe = (this.app as App & {secretStorage?: LoreVaultSecretStorage}).secretStorage;
    if (
      maybe
      && typeof maybe.setSecret === 'function'
      && typeof maybe.getSecret === 'function'
    ) {
      return maybe;
    }
    return null;
  }

  public async listSecretIds(): Promise<string[]> {
    const storage = this.getSecretStorage();
    if (!storage || typeof storage.listSecrets !== 'function') {
      return [];
    }
    try {
      const listed = await Promise.resolve(storage.listSecrets());
      if (!Array.isArray(listed)) {
        return [];
      }
      const unique = new Set<string>();
      for (const value of listed) {
        const normalized = value.toString().trim();
        if (normalized) {
          unique.add(normalized);
        }
      }
      return [...unique].sort((left, right) => left.localeCompare(right));
    } catch (error) {
      console.warn('LoreVault: Failed to list secret ids:', error);
      return [];
    }
  }

  private buildStableSecretHash(value: string): string {
    const normalized = value.trim().toLowerCase();
    const fnv1a32 = (input: string): string => {
      let hash = 0x811c9dc5;
      for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    };
    const left = fnv1a32(normalized);
    const right = fnv1a32(normalized.split('').reverse().join(''));
    return `${left}${right}`;
  }

  private buildAutoCostProfileLabel(apiKey: string): string {
    const normalized = apiKey.trim();
    if (!normalized) {
      return '';
    }
    return `key-${this.buildStableSecretHash(normalized).slice(0, 12)}`;
  }

  private normalizeSecretIdentifier(value: string, fallback: string): string {
    const normalize = (raw: string): string => raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
    return normalize(value) || normalize(fallback);
  }

  private resolveEmbeddingsSecretKey(): string {
    return this.normalizeSecretIdentifier(
      this.settings.embeddings.apiKeySecretName,
      DEFAULT_SETTINGS.embeddings.apiKeySecretName
    );
  }

  private buildDefaultCompletionPresetSecretName(presetId: string): string {
    const normalized = presetId.trim().toLowerCase();
    const slug = normalized
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 18);
    const hash = this.buildStableSecretHash(normalized || 'preset');
    return `${COMPLETION_PRESET_SECRET_PREFIX}${slug ? `${slug}-` : ''}${hash}`;
  }

  private resolvePresetSecretName(preset: CompletionPreset): string {
    return this.normalizeSecretIdentifier(
      preset.apiKeySecretName,
      this.buildDefaultCompletionPresetSecretName(preset.id)
    );
  }

  private getCompletionPresetSecretKey(preset: CompletionPreset): string {
    const key = this.resolvePresetSecretName(preset);
    return key
      .slice(0, 64)
      .replace(/-+$/g, '');
  }

  private normalizeDeviceProfileState(raw: unknown): DeviceProfileState {
    if (!raw || typeof raw !== 'object') {
      return {
        activeCompletionPresetId: '',
        activeStoryChatPresetId: '',
        activeCostProfile: ''
      };
    }
    const objectState = raw as Partial<DeviceProfileState>;
    return {
      activeCompletionPresetId: (objectState.activeCompletionPresetId ?? '').toString().trim(),
      activeStoryChatPresetId: (objectState.activeStoryChatPresetId ?? '').toString().trim(),
      activeCostProfile: (objectState.activeCostProfile ?? '').toString().trim()
    };
  }

  private async loadDeviceProfileState(): Promise<void> {
    let rawState: unknown = null;
    try {
      rawState = await this.app.loadLocalStorage(LOREVAULT_DEVICE_STATE_KEY);
    } catch (error) {
      console.warn('LoreVault: Failed to load local device profile state:', error);
    }

    const loaded = this.normalizeDeviceProfileState(rawState);
    if (!loaded.activeCompletionPresetId) {
      const legacySharedPresetId = (this.settings.completion.activePresetId ?? '').toString().trim();
      if (legacySharedPresetId) {
        loaded.activeCompletionPresetId = legacySharedPresetId;
      }
    }

    if (
      loaded.activeCompletionPresetId
      && !this.settings.completion.presets.some(preset => preset.id === loaded.activeCompletionPresetId)
    ) {
      loaded.activeCompletionPresetId = '';
    }
    if (!loaded.activeStoryChatPresetId) {
      loaded.activeStoryChatPresetId = loaded.activeCompletionPresetId;
    }
    if (
      loaded.activeStoryChatPresetId
      && !this.settings.completion.presets.some(preset => preset.id === loaded.activeStoryChatPresetId)
    ) {
      loaded.activeStoryChatPresetId = '';
    }

    this.deviceProfileState = loaded;
    try {
      await this.app.saveLocalStorage(LOREVAULT_DEVICE_STATE_KEY, this.deviceProfileState);
    } catch (error) {
      console.warn('LoreVault: Failed to persist local device profile state:', error);
    }
  }

  private async persistDeviceProfileState(): Promise<void> {
    try {
      await this.app.saveLocalStorage(LOREVAULT_DEVICE_STATE_KEY, this.deviceProfileState);
    } catch (error) {
      console.warn('LoreVault: Failed to persist local device profile state:', error);
    }
  }

  public getDeviceActiveCompletionPresetId(): string {
    return this.deviceProfileState.activeCompletionPresetId;
  }

  public getDeviceActiveStoryChatPresetId(): string {
    return this.deviceProfileState.activeStoryChatPresetId;
  }

  public getDeviceActiveCostProfile(): string {
    return this.deviceProfileState.activeCostProfile;
  }

  private resolveDeviceCompletionFallback(): CompletionProfileResolution {
    const resolution = resolveDeviceCompletionFallback(
      this.cloneCompletionConfig(this.settings.completion),
      this.deviceProfileState.activeCompletionPresetId,
      presetId => this.getCompletionPresetById(presetId),
      (base, preset) => this.applyCompletionPresetToConfig(base, preset)
    );
    return {
      ...resolution,
      authorNotePath: ''
    };
  }

  private resolveEffectiveCostProfileLabel(apiKey: string): string {
    const explicit = this.deviceProfileState.activeCostProfile.trim();
    if (explicit) {
      return explicit;
    }
    return this.buildAutoCostProfileLabel(apiKey);
  }

  public resolveEffectiveCostProfileForApiKey(apiKey: string): string {
    return this.resolveEffectiveCostProfileLabel(apiKey);
  }

  public buildAutoCostProfileForApiKey(apiKey: string): string {
    return this.buildAutoCostProfileLabel(apiKey);
  }

  public getDeviceEffectiveCostProfileLabel(): string {
    const explicit = this.deviceProfileState.activeCostProfile.trim();
    if (explicit) {
      return explicit;
    }
    const resolution = this.resolveDeviceCompletionFallback();
    return this.buildAutoCostProfileLabel(resolution.completion.apiKey);
  }

  public async listKnownCostProfiles(): Promise<string[]> {
    if (!this.knownCostProfilesCache) {
      const cachePromise = (async () => {
        const profiles = new Set<string>();
        const deviceExplicit = this.deviceProfileState.activeCostProfile.trim();
        if (deviceExplicit) {
          profiles.add(deviceExplicit);
        }
        const deviceEffective = this.getDeviceEffectiveCostProfileLabel().trim();
        if (deviceEffective) {
          profiles.add(deviceEffective);
        }
        const configuredBudgetProfiles = this.settings.costTracking.budgetByCostProfileUsd ?? {};
        for (const key of Object.keys(configuredBudgetProfiles)) {
          const normalized = key.trim();
          if (!normalized || normalized === '__default__') {
            continue;
          }
          profiles.add(normalized);
        }
        const knownLedgerProfiles = await this.usageLedgerStore.listKnownCostProfiles();
        for (const profile of knownLedgerProfiles) {
          if (profile) {
            profiles.add(profile);
          }
        }
        return [...profiles].sort((left, right) => left.localeCompare(right));
      })();
      this.knownCostProfilesCache = cachePromise;
      cachePromise.catch(() => {
        if (this.knownCostProfilesCache === cachePromise) {
          this.knownCostProfilesCache = null;
        }
      });
    }
    return [...await this.knownCostProfilesCache];
  }

  public async setDeviceActiveCompletionPresetId(presetId: string): Promise<void> {
    const normalized = presetId.trim();
    const nextId = normalized && this.settings.completion.presets.some(preset => preset.id === normalized)
      ? normalized
      : '';
    if (nextId === this.deviceProfileState.activeCompletionPresetId) {
      return;
    }
    this.deviceProfileState.activeCompletionPresetId = nextId;
    await this.persistDeviceProfileState();
    this.invalidateKnownCostProfilesCache();
    this.syncIdleGenerationTelemetryToSettings();
    this.refreshStorySteeringViews();
  }

  public async setDeviceActiveStoryChatPresetId(presetId: string): Promise<void> {
    const normalized = presetId.trim();
    const nextId = normalized && this.settings.completion.presets.some(preset => preset.id === normalized)
      ? normalized
      : '';
    if (nextId === this.deviceProfileState.activeStoryChatPresetId) {
      return;
    }
    this.deviceProfileState.activeStoryChatPresetId = nextId;
    await this.persistDeviceProfileState();
    this.refreshStoryChatViews();
  }

  public async setDeviceActiveCostProfile(costProfile: string): Promise<void> {
    const normalized = costProfile.trim();
    if (normalized === this.deviceProfileState.activeCostProfile) {
      return;
    }
    this.deviceProfileState.activeCostProfile = normalized;
    await this.persistDeviceProfileState();
    this.invalidateKnownCostProfilesCache();
    this.refreshStorySteeringViews();
  }

  public getCompletionPresetById(presetId: string): CompletionPreset | null {
    const normalized = presetId.trim();
    if (!normalized) {
      return null;
    }
    return this.settings.completion.presets.find(preset => preset.id === normalized) ?? null;
  }

  public getCompletionPresetItems(): CompletionPreset[] {
    return [...this.settings.completion.presets]
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
      .map(item => ({ ...item }));
  }

  public getIgnoredLlmCalloutTypes(): string[] {
    return [...this.settings.completion.ignoredCalloutTypes];
  }

  private getPromptCleanupOptions(): { ignoredCalloutTypes: string[] } {
    return {
      ignoredCalloutTypes: this.getIgnoredLlmCalloutTypes()
    };
  }

  private stripMarkdownForLlm(source: string): string {
    return stripInlineLoreDirectives(source, this.getPromptCleanupOptions()).trim();
  }

  private stripIgnoredCalloutsForLlm(source: string): string {
    return stripIgnoredCallouts(source, this.getIgnoredLlmCalloutTypes()).trim();
  }

  private renderInlineLoreDirectivesForLlm(source: string): ReturnType<typeof renderInlineLoreDirectivesAsTags> {
    return renderInlineLoreDirectivesAsTags(source, this.getPromptCleanupOptions());
  }

  private async promptCompletionPresetSelection(
    options: {
      includeNoneOption?: boolean;
      noneLabel?: string;
      placeholder?: string;
    } = {}
  ): Promise<string | null> {
    const includeNoneOption = options.includeNoneOption !== false;
    const noneLabel = options.noneLabel?.trim() || '(none)';
    const placeholder = options.placeholder?.trim() || 'Pick a completion profile...';
    const presetItems = this.getCompletionPresetItems().map(item => ({
      id: item.id,
      label: item.name
    }));
    const items: CompletionPresetSuggestItem[] = includeNoneOption
      ? [{ id: '', label: noneLabel }, ...presetItems]
      : presetItems;
    if (items.length === 0) {
      new Notice('No completion presets available.');
      return null;
    }
    const modal = new CompletionPresetSuggestModal(this.app, items, placeholder);
    const resultPromise = modal.waitForSelection();
    modal.open();
    const result = await resultPromise;
    if (!result) {
      return null;
    }
    return result.id;
  }

  public async promptAndSetAuthorNoteCompletionPresetForActiveNote(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    const authorNoteFile = await this.resolveAuthorNoteForCompletion(activeFile);
    if (!(authorNoteFile instanceof TFile)) {
      throw new Error('No author note is linked to the active note.');
    }
    const selection = await this.promptCompletionPresetSelection({
      includeNoneOption: true,
      noneLabel: '(clear author-note override)',
      placeholder: 'Pick author-note completion profile...'
    });
    if (selection === null) {
      return;
    }
    await this.setAuthorNoteCompletionPresetForPath(authorNoteFile.path, selection);
    if (selection) {
      const preset = this.getCompletionPresetById(selection);
      new Notice(`Author note completion profile set: ${preset?.name ?? selection}`);
    } else {
      new Notice('Author note completion profile cleared.');
    }
  }

  private cloneCompletionConfig(config: ConverterSettings['completion']): ConverterSettings['completion'] {
    return {
      ...config,
      reasoning: cloneReasoningConfig(config.reasoning),
      ignoredCalloutTypes: [...config.ignoredCalloutTypes],
      semanticChapterRecall: { ...config.semanticChapterRecall },
      layerPlacement: { ...config.layerPlacement },
      presets: config.presets.map(preset => ({
        ...preset,
        reasoning: cloneReasoningConfig(preset.reasoning)
      }))
    };
  }

  private applyCompletionPresetToConfig(
    base: ConverterSettings['completion'],
    preset: CompletionPreset
  ): ConverterSettings['completion'] {
    return {
      ...this.cloneCompletionConfig(base),
      provider: preset.provider,
      endpoint: preset.endpoint,
      apiKey: preset.apiKey,
      apiKeySecretName: preset.apiKeySecretName,
      model: preset.model,
      systemPrompt: preset.systemPrompt,
      temperature: preset.temperature,
      maxOutputTokens: preset.maxOutputTokens,
      contextWindowTokens: preset.contextWindowTokens,
      promptReserveTokens: preset.promptReserveTokens,
      timeoutMs: preset.timeoutMs,
      promptCachingEnabled: preset.promptCachingEnabled ?? base.promptCachingEnabled,
      providerRouting: preset.providerRouting ?? base.providerRouting,
      reasoning: cloneReasoningConfig(preset.reasoning ?? base.reasoning)
    };
  }

  private resolveAuthorNoteCompletionPresetId(authorNoteFile: TFile | null): string {
    if (!(authorNoteFile instanceof TFile)) {
      return '';
    }
    const cache = this.app.metadataCache.getFileCache(authorNoteFile);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    return (asString(getFrontmatterValue(frontmatter, AUTHOR_NOTE_COMPLETION_PROFILE_FRONTMATTER_KEY)) ?? '').trim();
  }

  private async resolveAuthorNoteForCompletion(file: TFile | null): Promise<TFile | null> {
    if (!(file instanceof TFile)) {
      return null;
    }
    if (this.noteIsAuthorNote(file)) {
      return file;
    }
    const linkedAuthorNote = await this.storySteeringStore.resolveAuthorNoteFileForStory(file);
    if (linkedAuthorNote) {
      return linkedAuthorNote;
    }
    if (await this.storySteeringStore.isAuthorNoteFile(file)) {
      return file;
    }
    return null;
  }

  public async setAuthorNoteCompletionPresetForPath(authorNotePath: string, presetId: string): Promise<void> {
    const normalizedPath = normalizeVaultPath(authorNotePath);
    const authorNoteFile = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!(authorNoteFile instanceof TFile)) {
      throw new Error(`Author note not found: ${normalizedPath}`);
    }
    const normalizedPresetId = presetId.trim();
    const hasPreset = normalizedPresetId && this.settings.completion.presets.some(preset => preset.id === normalizedPresetId);
    await this.app.fileManager.processFrontMatter(authorNoteFile, frontmatter => {
      if (hasPreset) {
        frontmatter[AUTHOR_NOTE_COMPLETION_PROFILE_FRONTMATTER_KEY] = normalizedPresetId;
      } else {
        delete frontmatter[AUTHOR_NOTE_COMPLETION_PROFILE_FRONTMATTER_KEY];
      }
    });
    this.refreshStorySteeringViews();
  }

  public async setAuthorNoteCompletionPresetForActiveNote(presetId: string): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    const authorNoteFile = await this.resolveAuthorNoteForCompletion(activeFile);
    if (!(authorNoteFile instanceof TFile)) {
      throw new Error('No author note is linked to the active note.');
    }
    await this.setAuthorNoteCompletionPresetForPath(authorNoteFile.path, presetId);
  }

  public async resolveEffectiveCompletionForFile(file?: TFile | null): Promise<CompletionProfileResolution> {
    const activeFile = file ?? this.app.workspace.getActiveFile();
    const baseCompletion = this.cloneCompletionConfig(this.settings.completion);

    const authorNoteFile = await this.resolveAuthorNoteForCompletion(activeFile ?? null);
    const authorNotePath = authorNoteFile?.path ?? '';
    const authorNotePresetId = this.resolveAuthorNoteCompletionPresetId(authorNoteFile);
    if (authorNotePresetId) {
      const preset = this.getCompletionPresetById(authorNotePresetId);
      if (preset) {
        return {
          completion: this.applyCompletionPresetToConfig(baseCompletion, preset),
          source: 'author_note',
          presetId: preset.id,
          presetName: preset.name,
          authorNotePath
        };
      }
    }

    const fallback = this.resolveDeviceCompletionFallback();
    return {
      completion: fallback.completion,
      source: fallback.source,
      presetId: fallback.presetId,
      presetName: fallback.presetName,
      authorNotePath
    };
  }

  public resolveEffectiveCompletionForStoryChat(chatPresetId?: string | null): {
    completion: ConverterSettings['completion'];
    source: StoryChatCompletionProfileSource;
    presetId: string;
    presetName: string;
  } {
    const baseCompletion = this.cloneCompletionConfig(this.settings.completion);
    const requestedPresetId = (chatPresetId ?? '').trim();
    if (requestedPresetId) {
      const preset = this.getCompletionPresetById(requestedPresetId);
      if (preset) {
        return {
          completion: this.applyCompletionPresetToConfig(baseCompletion, preset),
          source: 'chat',
          presetId: preset.id,
          presetName: preset.name
        };
      }
    }

    const deviceStoryChatPresetId = this.deviceProfileState.activeStoryChatPresetId;
    if (deviceStoryChatPresetId) {
      const preset = this.getCompletionPresetById(deviceStoryChatPresetId);
      if (preset) {
        return {
          completion: this.applyCompletionPresetToConfig(baseCompletion, preset),
          source: 'chat',
          presetId: preset.id,
          presetName: preset.name
        };
      }
    }

    const devicePresetId = this.deviceProfileState.activeCompletionPresetId;
    if (devicePresetId) {
      const preset = this.getCompletionPresetById(devicePresetId);
      if (preset) {
        return {
          completion: this.applyCompletionPresetToConfig(baseCompletion, preset),
          source: 'device',
          presetId: preset.id,
          presetName: preset.name
        };
      }
    }

    return {
      completion: baseCompletion,
      source: 'base',
      presetId: '',
      presetName: ''
    };
  }

  public async getCompletionProfileWorkspaceStatus(file?: TFile | null): Promise<CompletionProfileWorkspaceStatus> {
    const effective = await this.resolveEffectiveCompletionForFile(file);
    const devicePreset = this.getCompletionPresetById(this.deviceProfileState.activeCompletionPresetId);
    let authorNotePresetId = '';
    if (effective.authorNotePath) {
      const authorNoteFile = this.app.vault.getAbstractFileByPath(effective.authorNotePath);
      if (authorNoteFile instanceof TFile) {
        authorNotePresetId = this.resolveAuthorNoteCompletionPresetId(authorNoteFile);
      }
    }
    const authorNotePreset = this.getCompletionPresetById(authorNotePresetId);
    const explicitCostProfile = this.deviceProfileState.activeCostProfile.trim();
    const effectiveCostProfile = this.resolveEffectiveCostProfileLabel(effective.completion.apiKey);

    return {
      effective,
      devicePresetId: devicePreset?.id ?? '',
      devicePresetName: devicePreset?.name ?? '',
      authorNotePresetId: authorNotePreset?.id ?? '',
      authorNotePresetName: authorNotePreset?.name ?? '',
      authorNotePath: effective.authorNotePath,
      costProfile: explicitCostProfile,
      effectiveCostProfile
    };
  }

  private hasInlineApiKeys(settings: ConverterSettings): boolean {
    if (settings.completion.apiKey.trim() || settings.embeddings.apiKey.trim()) {
      return true;
    }
    return settings.completion.presets.some(preset => preset.apiKey.trim().length > 0);
  }

  private sanitizeSettingsForStorage(settings: ConverterSettings): ConverterSettings {
    const sanitized = this.mergeSettings(settings);
    sanitized.completion.apiKey = '';
    sanitized.embeddings.apiKey = '';
    sanitized.completion.presets = sanitized.completion.presets.map(preset => ({
      ...preset,
      apiKey: ''
    }));
    sanitized.completion.activePresetId = '';
    return sanitized;
  }

  private async syncSettingsApiKeysToSecretStorage(): Promise<void> {
    const storage = this.getSecretStorage();
    if (!storage) {
      return;
    }

    const createSecretIfMissing = async (secretKey: string, candidateValue: string): Promise<void> => {
      const normalizedValue = candidateValue.trim();
      if (!normalizedValue) {
        return;
      }
      const existing = await storage.getSecret(secretKey);
      if (existing !== null) {
        return;
      }
      await storage.setSecret(secretKey, normalizedValue);
    };

    const embeddingsSecretKey = this.resolveEmbeddingsSecretKey();
    await createSecretIfMissing(embeddingsSecretKey, this.settings.embeddings.apiKey);

    for (const preset of this.settings.completion.presets) {
      preset.apiKeySecretName = this.resolvePresetSecretName(preset);
      await createSecretIfMissing(this.getCompletionPresetSecretKey(preset), preset.apiKey);
    }
  }

  private async hydrateSettingsApiKeysFromSecretStorage(): Promise<void> {
    const storage = this.getSecretStorage();
    if (!storage) {
      return;
    }
    const embeddingsSecretKey = this.resolveEmbeddingsSecretKey();
    this.settings.embeddings.apiKey = (await storage.getSecret(embeddingsSecretKey) ?? '').trim();
    for (const preset of this.settings.completion.presets) {
      preset.apiKeySecretName = this.resolvePresetSecretName(preset);
      preset.apiKey = (await storage.getSecret(this.getCompletionPresetSecretKey(preset)) ?? '').trim();
    }
  }

  private async persistSettingsSnapshot(syncSecrets = true): Promise<void> {
    const hasSecretStorage = Boolean(this.getSecretStorage());
    if (syncSecrets && hasSecretStorage) {
      try {
        await this.syncSettingsApiKeysToSecretStorage();
        await this.hydrateSettingsApiKeysFromSecretStorage();
      } catch (error) {
        console.error('LoreVault: Failed to sync secrets. Falling back to plain settings persistence.', error);
        await super.saveData(this.settings);
        return;
      }
    }
    if (hasSecretStorage) {
      await super.saveData(this.sanitizeSettingsForStorage(this.settings));
      return;
    }
    await super.saveData(this.settings);
  }

  private estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }

  private resolveMarkdownViewForFile(file: TFile | null): MarkdownView | null {
    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeMarkdownView?.editor) {
      if (!file || activeMarkdownView.file?.path === file.path) {
        return activeMarkdownView;
      }
    }

    const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
    for (const leaf of markdownLeaves) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || !view.editor) {
        continue;
      }
      if (!file || view.file?.path === file.path) {
        return view;
      }
    }

    return null;
  }

  private async resolveEditableMarkdownViewForFile(file: TFile | null): Promise<MarkdownView | null> {
    const existing = this.resolveMarkdownViewForFile(file);
    if (existing) {
      return existing;
    }

    if (file) {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      const opened = leaf.view;
      if (opened instanceof MarkdownView && opened.editor) {
        return opened;
      }
    }

    const fallback = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (fallback?.editor) {
      return fallback;
    }
    return null;
  }

  private resolvePromptLayerPlacement(value: unknown, fallback: PromptLayerPlacement): PromptLayerPlacement {
    if (value === 'system' || value === 'pre_history' || value === 'pre_response') {
      return value;
    }
    return fallback;
  }

  private getCompletionLayerPlacementConfig(): ConverterSettings['completion']['layerPlacement'] {
    const configured = this.settings.completion.layerPlacement ?? DEFAULT_SETTINGS.completion.layerPlacement;
    return {
      storyNotes: this.resolvePromptLayerPlacement(
        configured.storyNotes,
        DEFAULT_SETTINGS.completion.layerPlacement.storyNotes
      )
    };
  }

  private createSteeringSections(args: {
    maxInputTokens: number;
    authorNote: string;
  }): SteeringLayerSection[] {
    const placements = this.getCompletionLayerPlacementConfig();
    const steeringReserve = Math.max(
      160,
      Math.min(24000, Math.floor(args.maxInputTokens * STEERING_RESERVE_FRACTION))
    );

    const layerSpecs: Array<{
      key: SteeringLayerKey;
      label: string;
      tag: string;
      placement: PromptLayerPlacement;
      text: string;
      reserveFraction: number;
      locked: boolean;
    }> = [
      {
        key: 'author_note',
        label: 'Author Note',
        tag: 'story_author_note',
        placement: placements.storyNotes,
        text: args.authorNote,
        reserveFraction: 1,
        locked: false
      }
    ];

    return layerSpecs.map(spec => {
      const normalizedText = this.stripIgnoredCalloutsForLlm(spec.text);
      const reservedTokens = normalizedText
        ? Math.max(48, Math.floor(steeringReserve * spec.reserveFraction))
        : 0;
      const trimmedText = trimTextForTokenBudget(normalizedText, reservedTokens, 'head');
      const rawTokens = estimateTextTokens(normalizedText);
      const usedTokens = estimateTextTokens(trimmedText);
      return {
        key: spec.key,
        label: spec.label,
        tag: spec.tag,
        placement: spec.placement,
        text: trimmedText,
        reservedTokens,
        usedTokens,
        trimmed: rawTokens > usedTokens,
        trimReason: rawTokens > usedTokens ? `reservation (${rawTokens} -> ${usedTokens})` : undefined,
        locked: spec.locked
      };
    });
  }

  private renderSteeringPlacement(
    sections: SteeringLayerSection[],
    placement: PromptLayerPlacement
  ): string {
    return sections
      .filter(section => section.placement === placement && section.text.trim().length > 0)
      .map(section => [
        `<${section.tag}>`,
        section.text,
        `</${section.tag}>`
      ].join('\n'))
      .join('\n\n');
  }

  private normalizeContinuityItems(values: string[]): string[] {
    return uniqueStrings(
      values
        .map(value => value.trim())
        .filter(Boolean)
    );
  }

  private resolveContinuityFromFrontmatter(file: TFile | null): {
    plotThreads: string[];
    openLoops: string[];
    canonDeltas: string[];
    selection: ContinuitySelection;
  } {
    if (!file) {
      return {
        plotThreads: [],
        openLoops: [],
        canonDeltas: [],
        selection: {
          includePlotThreads: true,
          includeOpenLoops: true,
          includeCanonDeltas: true
        }
      };
    }

    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    const plotThreads = this.normalizeContinuityItems(
      asStringArray(getFrontmatterValue(frontmatter, 'lvPlotThreads', 'plotThreads', 'activePlotThreads'))
    );
    const openLoops = this.normalizeContinuityItems(
      asStringArray(getFrontmatterValue(frontmatter, 'lvOpenLoops', 'openLoops', 'unresolvedCommitments'))
    );
    const canonDeltas = this.normalizeContinuityItems(
      asStringArray(getFrontmatterValue(frontmatter, 'lvCanonDeltas', 'canonDeltas', 'recentCanonDeltas'))
    );

    return {
      plotThreads,
      openLoops,
      canonDeltas,
      selection: {
        includePlotThreads: asBoolean(
          getFrontmatterValue(frontmatter, 'lvIncludePlotThreads', 'includePlotThreads')
        ) ?? true,
        includeOpenLoops: asBoolean(
          getFrontmatterValue(frontmatter, 'lvIncludeOpenLoops', 'includeOpenLoops')
        ) ?? true,
        includeCanonDeltas: asBoolean(
          getFrontmatterValue(frontmatter, 'lvIncludeCanonDeltas', 'includeCanonDeltas')
        ) ?? true
      }
    };
  }

  private buildContinuityMarkdown(input: {
    plotThreads: string[];
    openLoops: string[];
    canonDeltas: string[];
    selection: ContinuitySelection;
  }): string {
    const sections: string[] = [];
    if (input.selection.includePlotThreads && input.plotThreads.length > 0) {
      sections.push(`### Active Plot Threads\n${input.plotThreads.map((item, index) => `${index + 1}. ${item}`).join('\n')}`);
    }
    if (input.selection.includeOpenLoops && input.openLoops.length > 0) {
      sections.push(`### Unresolved Commitments\n${input.openLoops.map((item, index) => `${index + 1}. ${item}`).join('\n')}`);
    }
    if (input.selection.includeCanonDeltas && input.canonDeltas.length > 0) {
      sections.push(`### Recent Canon Deltas\n${input.canonDeltas.map((item, index) => `${index + 1}. ${item}`).join('\n')}`);
    }
    return sections.join('\n\n');
  }

  private trimTextToTokenBudget(text: string, tokenBudget: number): string {
    if (!text.trim()) {
      return '';
    }

    const maxChars = Math.max(256, tokenBudget * 4);
    if (text.length <= maxChars) {
      return text;
    }
    return text.slice(text.length - maxChars).trimStart();
  }

  private trimTextHeadToTokenBudget(text: string, tokenBudget: number): string {
    if (!text.trim()) {
      return '';
    }

    const maxChars = Math.max(256, tokenBudget * 4);
    if (text.length <= maxChars) {
      return text;
    }
    return text.slice(0, maxChars).trimEnd();
  }

  private trimTextHeadTailToTokenBudget(text: string, tokenBudget: number): string {
    if (!text.trim()) {
      return '';
    }

    const maxChars = Math.max(256, tokenBudget * 4);
    if (text.length <= maxChars) {
      return text;
    }

    const separator = '\n\n...[truncated for context window]...\n\n';
    const separatorChars = separator.length;
    const headChars = Math.max(128, Math.floor((maxChars - separatorChars) * 0.55));
    const tailChars = Math.max(128, Math.max(0, maxChars - separatorChars - headChars));
    const head = text.slice(0, headChars).trimEnd();
    const tail = text.slice(Math.max(0, text.length - tailChars)).trimStart();
    return `${head}${separator}${tail}`;
  }

  private preserveFrontmatterWithBody(originalMarkdown: string, nextBody: string): string {
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

  private renderScopeListLabel(scopes: string[]): string {
    if (scopes.length === 0) {
      return '(all)';
    }
    if (scopes.length <= 3) {
      return scopes.join(', ');
    }
    return `${scopes.slice(0, 3).join(', ')} +${scopes.length - 3}`;
  }

  private createDefaultGenerationTelemetry(): GenerationTelemetry {
    const now = Date.now();
    return {
      state: 'idle',
      statusText: 'idle',
      startedAt: 0,
      updatedAt: now,
      provider: '',
      model: '',
      scopes: [],
      contextWindowTokens: 0,
      maxInputTokens: 0,
      promptReserveTokens: 0,
      estimatedInstructionTokens: 0,
      storyTokens: 0,
      contextUsedTokens: 0,
      contextRemainingTokens: 0,
      maxOutputTokens: 0,
      generatedTokens: 0,
      worldInfoCount: 0,
      ragCount: 0,
      worldInfoItems: [],
      ragItems: [],
      inlineDirectiveItems: [],
      continuityPlotThreads: [],
      continuityOpenLoops: [],
      continuityCanonDeltas: [],
      layerUsage: [],
      overflowTrace: [],
      contextLayerTrace: [],
      lastError: ''
    };
  }

  private resolveUsageLedgerPath(): string {
    const configured = this.settings.costTracking.ledgerPath.trim();
    if (!configured) {
      return DEFAULT_SETTINGS.costTracking.ledgerPath;
    }
    return configured;
  }

  private syncUsageLedgerStorePath(): void {
    if (!this.usageLedgerStore) {
      return;
    }
    this.usageLedgerStore.setFilePath(this.resolveUsageLedgerPath());
  }

  private wildcardPatternMatch(pattern: string, value: string): boolean {
    const trimmedPattern = pattern.trim();
    if (!trimmedPattern || trimmedPattern === '*') {
      return true;
    }
    const escaped = trimmedPattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    const regex = new RegExp(`^${escaped}$`, 'i');
    return regex.test(value.trim());
  }

  private resolveModelPricingOverride(provider: string, model: string): ConverterSettings['costTracking']['modelPricingOverrides'][number] | null {
    const overrides = Array.isArray(this.settings.costTracking.modelPricingOverrides)
      ? this.settings.costTracking.modelPricingOverrides
      : [];
    const normalizedProvider = provider.trim().toLowerCase();
    const normalizedModel = model.trim().toLowerCase();
    const matches = overrides
      .filter(override => {
        const overrideProvider = (override.provider ?? '').toString().trim().toLowerCase();
        const providerMatches = !overrideProvider || overrideProvider === '*' || overrideProvider === normalizedProvider;
        if (!providerMatches) {
          return false;
        }
        return this.wildcardPatternMatch((override.modelPattern ?? '').toString(), normalizedModel);
      })
      .sort((left, right) => (
        ((right.modelPattern ?? '').toString().length - (left.modelPattern ?? '').toString().length) ||
        (Math.floor(Number(right.updatedAt ?? 0)) - Math.floor(Number(left.updatedAt ?? 0)))
      ));
    return matches[0] ?? null;
  }

  private resolveCostRateSelection(provider: string, model: string): {
    inputCostPerMillionUsd: number;
    outputCostPerMillionUsd: number;
    source: 'model_override' | 'default_rates' | 'none';
    rule?: string;
    snapshotAt?: number | null;
  } {
    const matchedOverride = this.resolveModelPricingOverride(provider, model);
    if (matchedOverride) {
      return {
        inputCostPerMillionUsd: Number(matchedOverride.inputCostPerMillionUsd ?? 0),
        outputCostPerMillionUsd: Number(matchedOverride.outputCostPerMillionUsd ?? 0),
        source: 'model_override',
        rule: `${matchedOverride.provider}:${matchedOverride.modelPattern}`,
        snapshotAt: Number(matchedOverride.updatedAt ?? 0)
      };
    }

    const defaultInput = Number(this.settings.costTracking.defaultInputCostPerMillionUsd);
    const defaultOutput = Number(this.settings.costTracking.defaultOutputCostPerMillionUsd);
    if (
      (Number.isFinite(defaultInput) && defaultInput > 0) ||
      (Number.isFinite(defaultOutput) && defaultOutput > 0)
    ) {
      return {
        inputCostPerMillionUsd: defaultInput,
        outputCostPerMillionUsd: defaultOutput,
        source: 'default_rates',
        rule: 'settings.default_rates',
        snapshotAt: Date.now()
      };
    }

    return {
      inputCostPerMillionUsd: 0,
      outputCostPerMillionUsd: 0,
      source: 'none',
      rule: 'settings.none',
      snapshotAt: null
    };
  }

  private resolveNoteScopesForUsage(notePath: string): string[] {
    const normalizedPath = normalizeVaultPath(notePath);
    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!(file instanceof TFile)) {
      return [];
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const tags = cache ? (getAllTags(cache) ?? []) : [];
    return this.normalizeExportScopeList(
      extractLorebookScopesFromTags(tags, this.settings.tagScoping.tagPrefix)
    );
  }

  private enrichUsageMetadata(metadata: {[key: string]: unknown}): {[key: string]: unknown} {
    const base = { ...metadata };
    const resolvedScopes = new Set<string>();
    const explicitCostProfile = this.deviceProfileState.activeCostProfile.trim();
    const autoCostProfile = typeof base.autoCostProfile === 'string'
      ? base.autoCostProfile.trim()
      : '';
    delete base.autoCostProfile;
    if (explicitCostProfile) {
      base.costProfile = explicitCostProfile;
    } else if (autoCostProfile) {
      base.costProfile = autoCostProfile;
    }

    if (Array.isArray(base.scopes)) {
      for (const item of base.scopes) {
        const normalized = normalizeScope(String(item ?? ''));
        if (normalized) {
          resolvedScopes.add(normalized);
        }
      }
    } else if (typeof base.scope === 'string') {
      const normalized = normalizeScope(base.scope);
      if (normalized) {
        resolvedScopes.add(normalized);
      }
    }

    if (typeof base.notePath === 'string' && base.notePath.trim()) {
      const noteScopes = this.resolveNoteScopesForUsage(base.notePath);
      for (const scope of noteScopes) {
        resolvedScopes.add(scope);
      }
    }

    const sortedScopes = [...resolvedScopes].sort((left, right) => left.localeCompare(right));
    if (sortedScopes.length > 0) {
      base.scopes = sortedScopes;
      base.scope = sortedScopes[0];
      base.scopeCount = sortedScopes.length;
    }

    return base;
  }

  private normalizeBudgetMap(input: {[key: string]: number} | undefined): {[key: string]: number} {
    const normalized: {[key: string]: number} = {};
    if (!input || typeof input !== 'object') {
      return normalized;
    }
    for (const [key, value] of Object.entries(input)) {
      const cleanedKey = key.trim();
      const cleanedValue = Number(value);
      if (!cleanedKey || !Number.isFinite(cleanedValue) || cleanedValue <= 0) {
        continue;
      }
      normalized[cleanedKey] = cleanedValue;
    }
    return normalized;
  }

  private createEmptyCostProfileBudgetSettings(): CostProfileBudgetSettings {
    return {
      dailyBudgetUsd: 0,
      sessionBudgetUsd: 0,
      budgetByOperationUsd: {},
      budgetByModelUsd: {},
      budgetByScopeUsd: {}
    };
  }

  private normalizeCostProfileBudgetSettings(
    raw: Partial<CostProfileBudgetSettings> | null | undefined
  ): CostProfileBudgetSettings {
    const source = raw ?? {};
    const dailyBudgetCandidate = Number(source.dailyBudgetUsd);
    const sessionBudgetCandidate = Number(source.sessionBudgetUsd);
    return {
      dailyBudgetUsd: Number.isFinite(dailyBudgetCandidate) && dailyBudgetCandidate >= 0
        ? dailyBudgetCandidate
        : 0,
      sessionBudgetUsd: Number.isFinite(sessionBudgetCandidate) && sessionBudgetCandidate >= 0
        ? sessionBudgetCandidate
        : 0,
      budgetByOperationUsd: this.normalizeBudgetMap(source.budgetByOperationUsd),
      budgetByModelUsd: this.normalizeBudgetMap(source.budgetByModelUsd),
      budgetByScopeUsd: this.normalizeBudgetMap(source.budgetByScopeUsd)
    };
  }

  private resolveCostProfileBudgetSettings(costProfile: string): CostProfileBudgetSettings {
    const normalizedProfile = costProfile.trim();
    const perProfileMap = this.settings.costTracking.budgetByCostProfileUsd ?? {};
    const normalizedEntries = Object.entries(perProfileMap)
      .map(([rawKey, value]) => [rawKey.trim(), value] as const)
      .filter(([key]) => key.length > 0);
    const hasPerProfileBudgets = normalizedEntries.length > 0;
    if (hasPerProfileBudgets) {
      const byProfile = new Map<string, CostProfileBudgetSettings>();
      for (const [key, value] of normalizedEntries) {
        byProfile.set(key, this.normalizeCostProfileBudgetSettings(value));
      }
      if (normalizedProfile && byProfile.has(normalizedProfile)) {
        return this.normalizeCostProfileBudgetSettings(byProfile.get(normalizedProfile));
      }
      if (byProfile.has('__default__')) {
        return this.normalizeCostProfileBudgetSettings(byProfile.get('__default__'));
      }
      return this.createEmptyCostProfileBudgetSettings();
    }

    // Legacy fallback for older settings without per-cost-profile budget mappings.
    return this.normalizeCostProfileBudgetSettings({
      dailyBudgetUsd: this.settings.costTracking.dailyBudgetUsd,
      sessionBudgetUsd: this.settings.costTracking.sessionBudgetUsd,
      budgetByOperationUsd: this.settings.costTracking.budgetByOperationUsd,
      budgetByModelUsd: this.settings.costTracking.budgetByModelUsd,
      budgetByScopeUsd: this.settings.costTracking.budgetByScopeUsd
    });
  }

  public async recordCompletionUsage(
    operation: string,
    usage: CompletionUsageReport,
    metadata: {[key: string]: unknown} = {}
  ): Promise<void> {
    if (!this.settings.costTracking.enabled) {
      return;
    }

    const rateSelection = this.resolveCostRateSelection(usage.provider, usage.model);
    const cost = estimateUsageCostUsdWithRateSelection(
      usage.promptTokens,
      usage.completionTokens,
      rateSelection,
      usage.reportedCostUsd
    );
    const cacheMetadata: Record<string, unknown> = {};
    if (usage.cachedReadTokens > 0) {
      cacheMetadata.cachedReadTokens = usage.cachedReadTokens;
    }
    if (usage.cacheWriteTokens > 0) {
      cacheMetadata.cacheWriteTokens = usage.cacheWriteTokens;
    }
    const enrichedMetadata = { ...this.enrichUsageMetadata(metadata), ...cacheMetadata };

    try {
      await this.usageLedgerStore.append({
        timestamp: Date.now(),
        operation,
        provider: usage.provider,
        model: usage.model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        reportedCostUsd: cost.reportedCostUsd,
        estimatedCostUsd: cost.estimatedCostUsd,
        costSource: cost.source,
        pricingSource: cost.pricingSource,
        inputCostPerMillionUsd: cost.inputCostPerMillionUsd,
        outputCostPerMillionUsd: cost.outputCostPerMillionUsd,
        pricingRule: cost.pricingRule,
        pricingSnapshotAt: cost.pricingSnapshotAt,
        metadata: enrichedMetadata
      });
      this.invalidateKnownCostProfilesCache();
      this.refreshStorySteeringViews();
      this.refreshCostAnalyzerViews();
    } catch (error) {
      console.error('Failed to record usage entry:', error);
    }
  }

  private recordEmbeddingUsage(
    operation: string,
    usage: CompletionUsageReport,
    apiKey: string,
    metadata: {[key: string]: unknown} = {}
  ): void {
    void this.recordCompletionUsage(operation, usage, {
      ...metadata,
      autoCostProfile: this.buildAutoCostProfileLabel(apiKey)
    });
  }

  private normalizeVaultPath(value: string, fallback: string): string {
    const normalized = (value ?? '').toString().trim().replace(/\\/g, '/');
    return normalized || fallback;
  }

  private resolveUsageReportOutputDir(): string {
    return this.normalizeVaultPath(
      this.settings.costTracking.reportOutputDir,
      DEFAULT_SETTINGS.costTracking.reportOutputDir
    );
  }

  private formatReportTimestamp(timestamp: number): string {
    return new Date(timestamp).toISOString().replace(/[:.]/g, '-');
  }

  private isPathAlreadyExistsError(error: unknown): boolean {
    const maybe = error as { code?: string; message?: string };
    const code = typeof maybe?.code === 'string' ? maybe.code.toUpperCase() : '';
    if (code === 'EEXIST') {
      return true;
    }
    const message = typeof maybe?.message === 'string' ? maybe.message.toLowerCase() : String(error ?? '').toLowerCase();
    return message.includes('already exists');
  }

  private async ensureVaultDirectory(pathValue: string): Promise<void> {
    const normalizedParts = pathValue
      .split('/')
      .map(part => part.trim())
      .filter(Boolean);
    if (normalizedParts.length === 0) {
      return;
    }

    let current = '';
    for (const part of normalizedParts) {
      current = current ? `${current}/${part}` : part;
      const exists = await this.app.vault.adapter.exists(current);
      if (!exists) {
        try {
          await this.app.vault.adapter.mkdir(current);
        } catch (error) {
          if (!this.isPathAlreadyExistsError(error)) {
            throw error;
          }
        }
      }
    }
  }

  public async getUsageReportSnapshot(options: UsageReportSnapshotOptions = {}): Promise<UsageLedgerReportSnapshot> {
    const includeAllProfiles = options.includeAllProfiles === true;
    const selectedProfile = includeAllProfiles
      ? ''
      : (options.costProfile ?? this.getDeviceEffectiveCostProfileLabel() ?? '').trim();
    const nowMs = Date.now();
    const budgetSettings = includeAllProfiles
      ? this.createEmptyCostProfileBudgetSettings()
      : this.resolveCostProfileBudgetSettings(selectedProfile);
    return this.usageLedgerStore.getReportSnapshot({
      costProfile: includeAllProfiles ? null : selectedProfile,
      nowMs,
      sessionStartAt: this.sessionStartedAt,
      dailyBudgetUsd: budgetSettings.dailyBudgetUsd,
      sessionBudgetUsd: budgetSettings.sessionBudgetUsd,
      budgetByOperationUsd: budgetSettings.budgetByOperationUsd,
      budgetByModelUsd: budgetSettings.budgetByModelUsd,
      budgetByScopeUsd: budgetSettings.budgetByScopeUsd
    });
  }

  private async exportUsageReport(format: 'json' | 'csv'): Promise<void> {
    try {
      const entries = await this.usageLedgerStore.listEntries();
      const snapshot = await this.getUsageReportSnapshot({ includeAllProfiles: true });
      const outputDir = this.resolveUsageReportOutputDir();
      await this.ensureVaultDirectory(outputDir);

      const stamp = this.formatReportTimestamp(Date.now());
      const filePath = `${outputDir}/usage-report-${stamp}.${format === 'json' ? 'json' : 'csv'}`;
      if (format === 'json') {
        const payload = {
          schemaVersion: 1,
          snapshot,
          entries
        };
        await this.app.vault.adapter.write(filePath, JSON.stringify(payload, null, 2));
      } else {
        const csv = serializeUsageLedgerEntriesCsv(entries);
        await this.app.vault.adapter.write(filePath, csv);
      }

      new Notice(`Usage report exported: ${filePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Usage report export failed:', error);
      new Notice(`Usage report export failed: ${message}`);
    }
  }

  getGenerationTelemetry(): GenerationTelemetry {
    return {
      ...this.generationTelemetry,
      scopes: [...this.generationTelemetry.scopes],
      worldInfoItems: [...this.generationTelemetry.worldInfoItems],
      ragItems: [...this.generationTelemetry.ragItems],
      inlineDirectiveItems: [...this.generationTelemetry.inlineDirectiveItems],
      continuityPlotThreads: [...this.generationTelemetry.continuityPlotThreads],
      continuityOpenLoops: [...this.generationTelemetry.continuityOpenLoops],
      continuityCanonDeltas: [...this.generationTelemetry.continuityCanonDeltas],
      layerUsage: [...this.generationTelemetry.layerUsage.map(layer => ({ ...layer }))],
      overflowTrace: [...this.generationTelemetry.overflowTrace],
      contextLayerTrace: [...this.generationTelemetry.contextLayerTrace]
    };
  }

  private scheduleManagerRefresh(): void {
    if (this.managerRefreshTimer !== null) {
      return;
    }
    if (this.app.workspace.getLeavesOfType(LOREVAULT_MANAGER_VIEW_TYPE).length === 0) {
      return;
    }

    this.managerRefreshTimer = window.setTimeout(() => {
      this.managerRefreshTimer = null;
      this.refreshManagerViews();
    }, 600);
  }

  private updateGenerationTelemetry(update: Partial<GenerationTelemetry>): void {
    const next: GenerationTelemetry = {
      ...this.generationTelemetry,
      ...update,
      updatedAt: Date.now()
    };
    if (update.scopes) {
      next.scopes = [...update.scopes];
    }
    if (update.worldInfoItems) {
      next.worldInfoItems = [...update.worldInfoItems];
    }
    if (update.ragItems) {
      next.ragItems = [...update.ragItems];
    }
    if (update.inlineDirectiveItems) {
      next.inlineDirectiveItems = [...update.inlineDirectiveItems];
    }
    if (update.continuityPlotThreads) {
      next.continuityPlotThreads = [...update.continuityPlotThreads];
    }
    if (update.continuityOpenLoops) {
      next.continuityOpenLoops = [...update.continuityOpenLoops];
    }
    if (update.continuityCanonDeltas) {
      next.continuityCanonDeltas = [...update.continuityCanonDeltas];
    }
    if (update.layerUsage) {
      next.layerUsage = [...update.layerUsage.map(layer => ({ ...layer }))];
    }
    if (update.overflowTrace) {
      next.overflowTrace = [...update.overflowTrace];
    }
    if (update.contextLayerTrace) {
      next.contextLayerTrace = [...update.contextLayerTrace];
    }
    this.generationTelemetry = next;
    this.scheduleManagerRefresh();
  }

  private setGenerationStatus(
    message: string,
    level: 'idle' | 'busy' | 'error' = 'busy'
  ): void {
    this.generationStatusLevel = level;
    if (!this.generationStatusEl) {
      return;
    }
    this.generationStatusEl.setText(`LoreVault ${message}`);
  }

  private syncIdleGenerationTelemetryToSettings(): void {
    if (this.generationInFlight) {
      return;
    }

    const baseCompletion = this.cloneCompletionConfig(this.settings.completion);
    const devicePreset = this.getCompletionPresetById(this.deviceProfileState.activeCompletionPresetId);
    const completion = devicePreset
      ? this.applyCompletionPresetToConfig(baseCompletion, devicePreset)
      : baseCompletion;
    const maxInputTokens = Math.max(512, completion.contextWindowTokens - completion.maxOutputTokens);
    this.updateGenerationTelemetry({
      state: 'idle',
      statusText: 'idle',
      provider: completion.provider,
      model: completion.model,
      contextWindowTokens: completion.contextWindowTokens,
      maxInputTokens,
      promptReserveTokens: completion.promptReserveTokens,
      maxOutputTokens: completion.maxOutputTokens,
      contextUsedTokens: 0,
      contextRemainingTokens: Math.max(0, maxInputTokens - completion.promptReserveTokens),
      generatedTokens: 0,
      worldInfoCount: 0,
      ragCount: 0,
      worldInfoItems: [],
      ragItems: [],
      inlineDirectiveItems: [],
      continuityPlotThreads: [],
      continuityOpenLoops: [],
      continuityCanonDeltas: [],
      layerUsage: [],
      overflowTrace: [],
      contextLayerTrace: []
    });
    this.setGenerationStatus('idle', 'idle');
  }

  private mapEntriesByUid(entries: LoreBookEntry[]): {[key: number]: LoreBookEntry} {
    const map: {[key: number]: LoreBookEntry} = {};
    for (const entry of entries) {
      map[entry.uid] = entry;
    }
    return map;
  }

  private refreshManagerViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(LOREVAULT_MANAGER_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof LorebooksManagerView) {
        leaf.view.refresh();
      }
    }
  }

  private refreshRoutingDebugViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(LOREVAULT_ROUTING_DEBUG_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof LorebooksRoutingDebugView) {
        leaf.view.refresh();
      }
    }
  }

  private refreshQuerySimulationViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(LOREVAULT_QUERY_SIMULATION_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof LorebooksQuerySimulationView) {
        leaf.view.refresh();
      }
    }
  }

  private refreshStoryChatViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(LOREVAULT_STORY_CHAT_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof StoryChatView) {
        leaf.view.refresh();
      }
    }
  }

  private refreshStoryStarterViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(LOREVAULT_STORY_STARTER_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof LorevaultStoryStarterView) {
        leaf.view.refresh();
      }
    }
  }

  private refreshStorySteeringViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(LOREVAULT_STORY_STEERING_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof StorySteeringView) {
        leaf.view.refresh();
      }
    }
  }

  private refreshHelpViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(LOREVAULT_HELP_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof LorevaultHelpView) {
        leaf.view.refresh();
      }
    }
  }

  private refreshOperationLogViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(LOREVAULT_OPERATION_LOG_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof LorevaultOperationLogView) {
        leaf.view.refresh();
      }
    }
  }

  private refreshCostAnalyzerViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(LOREVAULT_COST_ANALYZER_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof LorevaultCostAnalyzerView) {
        leaf.view.refresh();
      }
    }
  }

  private invalidateKnownCostProfilesCache(): void {
    this.knownCostProfilesCache = null;
  }

  private queueOperationLogViewRefresh(): void {
    if (this.operationLogViewRefreshTimer !== null) {
      return;
    }
    this.operationLogViewRefreshTimer = window.setTimeout(() => {
      this.operationLogViewRefreshTimer = null;
      this.refreshOperationLogViews();
    }, 220);
  }

  async openLorebooksManagerView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LOREVAULT_MANAGER_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: LOREVAULT_MANAGER_VIEW_TYPE,
        active: true
      });
    }

    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof LorebooksManagerView) {
      leaf.view.refresh();
    }
  }

  async openRoutingDebugView(scope?: string): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LOREVAULT_ROUTING_DEBUG_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: LOREVAULT_ROUTING_DEBUG_VIEW_TYPE,
        active: true
      });
    }

    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof LorebooksRoutingDebugView) {
      leaf.view.setScope(scope ?? null);
      leaf.view.refresh();
    }
  }

  async openLorebookAuditorView(scope?: string): Promise<void> {
    await this.openRoutingDebugView(scope);
  }

  async openQuerySimulationView(scopes?: string[]): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LOREVAULT_QUERY_SIMULATION_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: LOREVAULT_QUERY_SIMULATION_VIEW_TYPE,
        active: true
      });
    }

    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof LorebooksQuerySimulationView) {
      if (scopes && scopes.length > 0) {
        leaf.view.setScopes(scopes);
      }
      leaf.view.refresh();
    }
  }

  async openStoryChatView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LOREVAULT_STORY_CHAT_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: LOREVAULT_STORY_CHAT_VIEW_TYPE,
        active: true
      });
    }

    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof StoryChatView) {
      leaf.view.refresh();
    }
  }

  async openStoryStarterView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LOREVAULT_STORY_STARTER_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: LOREVAULT_STORY_STARTER_VIEW_TYPE,
        active: true
      });
    }

    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof LorevaultStoryStarterView) {
      leaf.view.refresh();
    }
  }

  async openStorySteeringView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LOREVAULT_STORY_STEERING_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: LOREVAULT_STORY_STEERING_VIEW_TYPE,
        active: true
      });
    }

    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof StorySteeringView) {
      leaf.view.refresh();
    }
  }

  async openHelpView(): Promise<void> {
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: LOREVAULT_HELP_VIEW_TYPE,
      active: true
    });

    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof LorevaultHelpView) {
      leaf.view.refresh();
    }
  }

  async openOperationLogView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LOREVAULT_OPERATION_LOG_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: LOREVAULT_OPERATION_LOG_VIEW_TYPE,
        active: true
      });
    }

    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof LorevaultOperationLogView) {
      leaf.view.refresh();
    }
  }

  async openCostAnalyzerView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LOREVAULT_COST_ANALYZER_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: LOREVAULT_COST_ANALYZER_VIEW_TYPE,
        active: true
      });
    }

    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof LorevaultCostAnalyzerView) {
      leaf.view.refresh();
    }
  }

  async openImportLorebookView(mode: 'lorebook_json' | 'character_card' = 'lorebook_json'): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LOREVAULT_IMPORT_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: LOREVAULT_IMPORT_VIEW_TYPE,
        active: true
      });
    }

    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof LorevaultImportView) {
      leaf.view.setImportMode(mode);
      leaf.view.refresh();
    }
  }

  async openStoryExtractionView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LOREVAULT_STORY_EXTRACT_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: LOREVAULT_STORY_EXTRACT_VIEW_TYPE,
        active: true
      });
    }

    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof LorevaultStoryExtractView) {
      leaf.view.refresh();
    }
  }

  async openEbookImportView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LOREVAULT_EBOOK_IMPORT_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: LOREVAULT_EBOOK_IMPORT_VIEW_TYPE,
        active: true
      });
    }
    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof LorevaultEbookImportView) {
      leaf.view.refresh();
    }
  }

  async openStoryDeltaView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LOREVAULT_STORY_DELTA_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: LOREVAULT_STORY_DELTA_VIEW_TYPE,
        active: true
      });
    }

    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof LorevaultStoryDeltaView) {
      leaf.view.refresh();
    }
  }

  async openLoreDeltaView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LOREVAULT_LORE_DELTA_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: LOREVAULT_LORE_DELTA_VIEW_TYPE,
        active: true
      });
    }

    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof LorevaultLoreDeltaView) {
      leaf.view.refresh();
    }
  }

  private buildCharacterCardMetaFilePath(
    metaFolder: string,
    sourceFile: TFile,
    parsedCard: ParsedCharacterCard | null,
    usedPaths: Set<string>
  ): string {
    const titleStem = slugifyIdentifier(parsedCard?.name || sourceFile.basename || 'character-card');
    const sourceStem = slugifyIdentifier(sourceFile.basename || 'card');
    const baseStem = titleStem === sourceStem ? `${titleStem}-card` : `${titleStem}-${sourceStem}-card`;
    for (let attempt = 1; attempt <= 9999; attempt += 1) {
      const suffix = attempt === 1 ? '' : `-${attempt}`;
      const candidatePath = normalizeVaultPath(`${metaFolder}/${baseStem}${suffix}.md`);
      const key = candidatePath.toLowerCase();
      if (!usedPaths.has(key)) {
        usedPaths.add(key);
        return candidatePath;
      }
    }
    throw new Error(`Failed to allocate character-card meta note path for ${sourceFile.path}.`);
  }

  private buildCharacterCardMetaSkeleton(sourceFile: TFile, parsedCard: ParsedCharacterCard | null): string {
    const title = parsedCard?.name || sourceFile.basename || 'Character Card';
    return [
      '---',
      `lvDocType: "${CHARACTER_CARD_META_DOC_TYPE}"`,
      `title: ${JSON.stringify(title)}`,
      '---',
      '',
      `# ${title} Card`,
      '',
      `Source: [[${normalizeLinkTarget(sourceFile.path)}]]`,
      '',
      'Managed by `Sync Character Card Library`.',
      ''
    ].join('\n');
  }

  private normalizeMarkdownSectionText(value: string): string {
    return value
      .replace(/\r\n?/g, '\n')
      .trim();
  }

  private pushCharacterCardTextSection(lines: string[], heading: string, value: string): void {
    const normalized = this.normalizeMarkdownSectionText(value);
    if (!normalized) {
      return;
    }
    lines.push(`### ${heading}`);
    lines.push('');
    lines.push(normalized);
    lines.push('');
  }

  private pushCharacterCardListSection(lines: string[], heading: string, values: string[]): void {
    const normalized = uniqueStrings(
      values
        .map(value => this.normalizeMarkdownSectionText(value))
        .filter(Boolean)
    );
    if (normalized.length === 0) {
      return;
    }
    lines.push(`### ${heading}`);
    lines.push('');
    for (const value of normalized) {
      lines.push(`- ${value}`);
    }
    lines.push('');
  }

  private pushCharacterCardGroupedTextSection(
    lines: string[],
    heading: string,
    itemHeadingPrefix: string,
    values: string[]
  ): void {
    const normalized = uniqueStrings(
      values
        .map(value => this.normalizeMarkdownSectionText(value))
        .filter(Boolean)
    );
    if (normalized.length === 0) {
      return;
    }
    lines.push(`### ${heading}`);
    lines.push('');
    for (let index = 0; index < normalized.length; index += 1) {
      lines.push(`#### ${itemHeadingPrefix} ${index + 1}`);
      lines.push('');
      lines.push(normalized[index]);
      lines.push('');
    }
  }

  private buildCharacterCardAvatarEmbedMarkdown(avatarRaw: string, sourcePath: string): string {
    const normalizedAvatar = avatarRaw.trim();
    if (normalizedAvatar) {
      if (normalizedAvatar.startsWith('![[') || /^!\[[^\]]*]\([^)]+\)$/.test(normalizedAvatar)) {
        return normalizedAvatar;
      }
      if (normalizedAvatar.startsWith('[[') && normalizedAvatar.endsWith(']]')) {
        return `!${normalizedAvatar}`;
      }
      if (/^https?:\/\//i.test(normalizedAvatar)) {
        return `![](${normalizedAvatar})`;
      }
      const avatarExt = getVaultExtname(normalizedAvatar).toLowerCase();
      if (avatarExt && ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.avif'].includes(avatarExt)) {
        const normalizedAvatarPath = normalizeVaultPath(normalizedAvatar);
        if (normalizedAvatarPath) {
          return `![[${normalizeLinkTarget(normalizedAvatarPath)}]]`;
        }
      }
    }

    const sourceExt = getVaultExtname(sourcePath).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.avif'].includes(sourceExt)) {
      return `![[${normalizeLinkTarget(sourcePath)}]]`;
    }
    return '';
  }

  private extractImageTargetFromEmbed(markdown: string): string {
    const value = markdown.trim();
    if (!value) {
      return '';
    }

    const wikiEmbedMatch = value.match(/^!\[\[([\s\S]+?)\]\]$/);
    if (wikiEmbedMatch) {
      const normalized = wikiEmbedMatch[1].trim();
      const pipeIndex = normalized.indexOf('|');
      return pipeIndex >= 0 ? normalized.slice(0, pipeIndex).trim() : normalized;
    }

    const markdownStart = value.indexOf('](');
    if (value.startsWith('![') && markdownStart > 1 && value.endsWith(')')) {
      let body = value.slice(markdownStart + 2, -1).trim();
      if (body.startsWith('<') && body.endsWith('>')) {
        body = body.slice(1, -1).trim();
      }
      // Handle optional markdown image title: ![](path "title")
      const titleMatch = body.match(/^(.+?)\s+"[^"]*"$/);
      if (titleMatch) {
        body = titleMatch[1].trim();
      }
      return body;
    }

    return '';
  }

  private isExternalImageTarget(target: string): boolean {
    const normalized = target.trim().toLowerCase();
    return normalized.startsWith('http://')
      || normalized.startsWith('https://')
      || normalized.startsWith('data:image/');
  }

  private isLocalAvatarEmbed(markdown: string): boolean {
    const target = this.extractImageTargetFromEmbed(markdown);
    if (!target) {
      return false;
    }
    return !this.isExternalImageTarget(target);
  }

  private resolveCharacterCardAvatarEmbedForSync(defaultAvatarEmbed: string, existingAvatarEmbed: string): string {
    const normalizedDefault = defaultAvatarEmbed.trim();
    const normalizedExisting = existingAvatarEmbed.trim();
    if (!normalizedExisting) {
      return normalizedDefault;
    }
    if (!normalizedDefault) {
      return normalizedExisting;
    }
    if (normalizedExisting === normalizedDefault) {
      return normalizedDefault;
    }
    // Respect any explicit avatar embed already in the managed details block.
    const existingTarget = this.extractImageTargetFromEmbed(normalizedExisting);
    if (existingTarget) {
      return normalizedExisting;
    }
    if (this.isLocalAvatarEmbed(normalizedExisting)) {
      return normalizedExisting;
    }
    return normalizedDefault;
  }

  private buildCharacterCardDetailsBlock(params: {
    sourcePath: string;
    avatarEmbedMarkdown: string;
    creatorNotes: string;
    cardSummary: string;
    cardSummaryScenarioFocus: string;
    cardSummaryHook: string;
    cardSummaryTone: string[];
    cardSummaryThemes: string[];
    cardDescription: string;
    cardPersonality: string;
    cardScenario: string;
    cardFirstMessage: string;
    cardMessageExample: string;
    cardSystemPrompt: string;
    cardPostHistoryInstructions: string;
    cardAlternateGreetings: string[];
    cardGroupOnlyGreetings: string[];
  }): string {
    const lines: string[] = [];
    lines.push('## Character Card Details');
    lines.push('');
    if (params.avatarEmbedMarkdown) {
      lines.push(params.avatarEmbedMarkdown);
      lines.push('');
    }
    lines.push(`Source Card: [[${normalizeLinkTarget(params.sourcePath)}]]`);
    lines.push('');

    this.pushCharacterCardTextSection(lines, 'Card Summary', params.cardSummary);
    this.pushCharacterCardTextSection(lines, 'Summary Scenario Focus', params.cardSummaryScenarioFocus);
    this.pushCharacterCardTextSection(lines, 'Summary Hook', params.cardSummaryHook);
    this.pushCharacterCardListSection(lines, 'Summary Tone', params.cardSummaryTone);
    this.pushCharacterCardListSection(lines, 'Summary Themes', params.cardSummaryThemes);
    this.pushCharacterCardTextSection(lines, 'Creator Notes', params.creatorNotes);
    this.pushCharacterCardTextSection(lines, 'Personality', params.cardPersonality);
    this.pushCharacterCardTextSection(lines, 'Description', params.cardDescription);
    this.pushCharacterCardTextSection(lines, 'Scenario', params.cardScenario);
    this.pushCharacterCardTextSection(lines, 'First Message', params.cardFirstMessage);
    this.pushCharacterCardTextSection(lines, 'Message Example', params.cardMessageExample);
    this.pushCharacterCardTextSection(lines, 'System Prompt', params.cardSystemPrompt);
    this.pushCharacterCardTextSection(lines, 'Post History Instructions', params.cardPostHistoryInstructions);
    this.pushCharacterCardGroupedTextSection(lines, 'Alternate Greetings', 'Alternate Greeting', params.cardAlternateGreetings);
    this.pushCharacterCardGroupedTextSection(lines, 'Group-Only Greetings', 'Group-Only Greeting', params.cardGroupOnlyGreetings);

    return lines.join('\n').trimEnd();
  }

  private upsertCharacterCardDetailsBlockInMarkdown(markdown: string, detailsBlock: string): string {
    const normalized = markdown.replace(/\r\n?/g, '\n');
    const versionLine = `${CHARACTER_CARD_DETAILS_BLOCK_VERSION_PREFIX} ${CHARACTER_CARD_DETAILS_BLOCK_VERSION} -->`;
    const payload = [
      CHARACTER_CARD_DETAILS_BLOCK_BEGIN,
      versionLine,
      detailsBlock.trimEnd(),
      CHARACTER_CARD_DETAILS_BLOCK_END
    ].join('\n');

    const beginIndex = normalized.indexOf(CHARACTER_CARD_DETAILS_BLOCK_BEGIN);
    const endIndex = normalized.indexOf(CHARACTER_CARD_DETAILS_BLOCK_END);
    if (beginIndex >= 0 && endIndex > beginIndex) {
      const endOffset = endIndex + CHARACTER_CARD_DETAILS_BLOCK_END.length;
      const before = normalized.slice(0, beginIndex).replace(/\s*$/g, '');
      const after = normalized.slice(endOffset).replace(/^\s*/g, '');
      if (before && after) {
        return `${before}\n\n${payload}\n\n${after}\n`;
      }
      if (before) {
        return `${before}\n\n${payload}\n`;
      }
      if (after) {
        return `${payload}\n\n${after}\n`;
      }
      return `${payload}\n`;
    }

    const base = normalized.trimEnd();
    if (!base) {
      return `${payload}\n`;
    }
    return `${base}\n\n${payload}\n`;
  }

  private async parseCharacterCardSourceFile(sourceFile: TFile): Promise<{
    parsedCard: ParsedCharacterCard | null;
    parseError: string;
    warnings: string[];
    cardHash: string;
    avatarLink: string;
  }> {
    const extension = sourceFile.extension.toLowerCase();
    const avatarLink = extension === 'png'
      ? `[[${normalizeLinkTarget(sourceFile.path)}]]`
      : '';
    try {
      if (extension === 'json') {
        const raw = await this.app.vault.read(sourceFile);
        const parsedCard = parseSillyTavernCharacterCardJson(raw);
        return {
          parsedCard,
          parseError: '',
          warnings: parsedCard.warnings,
          cardHash: `sha256:${stableJsonHash(parsedCard.rawPayload)}`,
          avatarLink
        };
      }
      if (extension === 'png') {
        const bytes = await readVaultBinary(this.app, sourceFile.path);
        const parsedCard = parseSillyTavernCharacterCardPngBytes(bytes);
        return {
          parsedCard,
          parseError: '',
          warnings: parsedCard.warnings,
          cardHash: `sha256:${stableJsonHash(parsedCard.rawPayload)}`,
          avatarLink
        };
      }

      return {
        parsedCard: null,
        parseError: `Unsupported file extension: .${extension}`,
        warnings: [],
        cardHash: `sha256:${sha256Hex(`${sourceFile.path}:${sourceFile.stat.mtime}:${sourceFile.stat.size}`)}`,
        avatarLink
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        parsedCard: null,
        parseError: message,
        warnings: [],
        cardHash: `sha256:${sha256Hex(`${sourceFile.path}:${sourceFile.stat.mtime}:${sourceFile.stat.size}`)}`,
        avatarLink
      };
    }
  }

  private resolveCharacterCardSummaryCompletion(): {
    completion: ConverterSettings['completion'];
    source: string;
    presetId: string;
    presetName: string;
    error: string;
  } {
    const configuredPresetId = (this.settings.characterCards.summaryCompletionPresetId ?? '').trim();
    if (configuredPresetId && !this.getCompletionPresetById(configuredPresetId)) {
      return {
        completion: this.cloneCompletionConfig(this.settings.completion),
        source: 'base',
        presetId: '',
        presetName: '',
        error: `Configured card summary completion profile is missing: ${configuredPresetId}`
      };
    }

    const resolution = this.resolveEffectiveCompletionForStoryChat(configuredPresetId);
    const completion = resolution.completion;
    if (!completion.enabled) {
      return {
        completion,
        source: resolution.source,
        presetId: resolution.presetId,
        presetName: resolution.presetName,
        error: 'Writing completion is disabled.'
      };
    }
    if (completion.provider !== 'ollama' && !completion.apiKey) {
      return {
        completion,
        source: resolution.source,
        presetId: resolution.presetId,
        presetName: resolution.presetName,
        error: 'Missing completion API key.'
      };
    }

    return {
      completion,
      source: resolution.source,
      presetId: resolution.presetId,
      presetName: resolution.presetName,
      error: ''
    };
  }

  private async generateCharacterCardSummary(
    sourceFile: TFile,
    parsedCard: ParsedCharacterCard,
    completionResolution: {
      completion: ConverterSettings['completion'];
      source: string;
      presetId: string;
      presetName: string;
    }
  ): Promise<CharacterCardSummaryPayload> {
    const completion = completionResolution.completion;
    let usageReport: CompletionUsageReport | null = null;
    const rawResponse = await requestStoryContinuation(completion, {
      systemPrompt: buildCharacterCardSummarySystemPrompt(),
      userPrompt: buildCharacterCardSummaryUserPrompt(parsedCard),
      operationName: 'character_card_summary',
      onOperationLog: record => this.appendCompletionOperationLog(record, {
        costProfile: this.resolveEffectiveCostProfileLabel(completion.apiKey)
      }),
      onUsage: usage => {
        usageReport = usage;
      }
    });

    if (usageReport) {
      await this.recordCompletionUsage('character_card_summary', usageReport, {
        notePath: sourceFile.path,
        completionProfileSource: completionResolution.source,
        completionProfileId: completionResolution.presetId,
        completionProfileName: completionResolution.presetName,
        autoCostProfile: this.buildAutoCostProfileLabel(completion.apiKey)
      });
    }

    return parseCharacterCardSummaryResponse(rawResponse);
  }

  public async syncCharacterCardLibrary(): Promise<void> {
    const progressNotice = new Notice('Character-card sync starting...', 0);
    const progressStartedAt = Date.now();
    let lastProgressUpdateAt = 0;
    const updateProgressNotice = (
      phase: string,
      completed: number,
      total: number,
      details = '',
      force = false
    ): void => {
      const now = Date.now();
      if (!force && now - lastProgressUpdateAt < 180) {
        return;
      }
      lastProgressUpdateAt = now;
      const safeTotal = Math.max(0, total);
      const safeCompleted = Math.max(0, Math.min(completed, safeTotal));
      const pct = safeTotal > 0 ? Math.floor((safeCompleted / safeTotal) * 100) : 100;
      const elapsedSeconds = Math.max(0, Math.floor((now - progressStartedAt) / 1000));
      const base = `Character-card sync ${phase} ${safeCompleted}/${safeTotal} (${pct}%)`;
      const suffix = details ? ` | ${details}` : '';
      progressNotice.setMessage(`${base}${suffix} | ${elapsedSeconds}s`);
    };

    const metaFolder = this.getCharacterCardMetaFolderPath();
    const sourceFiles = this.getCharacterCardSourceFiles();
    const metaFiles = this.app.vault.getMarkdownFiles()
      .filter(file => this.isPathInVaultFolder(file.path, metaFolder));

    const existingByCardPath = new Map<string, TFile>();
    const usedMetaPaths = new Set<string>();
    for (const metaFile of metaFiles) {
      usedMetaPaths.add(metaFile.path.toLowerCase());
      const cache = this.app.metadataCache.getFileCache(metaFile);
      const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
      const docType = (asString(getFrontmatterValue(frontmatter, 'lvDocType')) ?? '').toLowerCase();
      if (docType !== CHARACTER_CARD_META_DOC_TYPE.toLowerCase()) {
        continue;
      }
      const cardPath = normalizeVaultPath(asString(getFrontmatterValue(frontmatter, 'cardPath', 'characterCardPath')) ?? '');
      if (cardPath && !existingByCardPath.has(cardPath.toLowerCase())) {
        existingByCardPath.set(cardPath.toLowerCase(), metaFile);
      }
    }

    let created = 0;
    let updated = 0;
    let markedMissing = 0;
    let parseErrors = 0;
    let failures = 0;
    let summaryGenerated = 0;
    let summaryFailed = 0;
    let summaryStale = 0;
    let summarySkipped = 0;
    let summaryConfigErrorCount = 0;
    const nowIso = new Date().toISOString();
    const seenCardPaths = new Set<string>();
    const autoSummaryEnabled = Boolean(this.settings.characterCards.autoSummaryEnabled);
    const autoSummaryRegenerate = Boolean(this.settings.characterCards.summaryRegenerateOnHashChange);
    const totalProgressItems = sourceFiles.length + existingByCardPath.size;
    let progressCompleted = 0;
    updateProgressNotice(
      'initializing',
      progressCompleted,
      totalProgressItems,
      `${sourceFiles.length} source card(s), ${existingByCardPath.size} existing meta note(s)`,
      true
    );
    const summaryCompletionResolution = autoSummaryEnabled
      ? this.resolveCharacterCardSummaryCompletion()
      : null;
    if (autoSummaryEnabled && summaryCompletionResolution?.error) {
      summaryConfigErrorCount += 1;
      new Notice(`Card summary generation disabled: ${summaryCompletionResolution.error}`);
    }

    try {
      for (let sourceIndex = 0; sourceIndex < sourceFiles.length; sourceIndex += 1) {
        const sourceFile = sourceFiles[sourceIndex];
        updateProgressNotice(
          'processing cards',
          progressCompleted,
          totalProgressItems,
          `${sourceIndex + 1}/${sourceFiles.length}: ${sourceFile.basename}`
        );
        const normalizedSourcePath = normalizeVaultPath(sourceFile.path);
        if (!normalizedSourcePath) {
          progressCompleted += 1;
          continue;
        }
        const sourceKey = normalizedSourcePath.toLowerCase();
        seenCardPaths.add(sourceKey);

        try {
          const parsed = await this.parseCharacterCardSourceFile(sourceFile);
          if (parsed.parseError) {
            parseErrors += 1;
          }
          let metaFile = existingByCardPath.get(sourceKey) ?? null;
          if (!metaFile) {
            const metaPath = this.buildCharacterCardMetaFilePath(metaFolder, sourceFile, parsed.parsedCard, usedMetaPaths);
            await ensureParentVaultFolderForFile(this.app, metaPath);
            const skeleton = this.buildCharacterCardMetaSkeleton(sourceFile, parsed.parsedCard);
            const createdFile = await this.app.vault.create(metaPath, skeleton);
            if (!(createdFile instanceof TFile)) {
              throw new Error(`Failed to create meta note for ${sourceFile.path}.`);
            }
            metaFile = createdFile;
            existingByCardPath.set(sourceKey, metaFile);
            created += 1;
          } else {
            updated += 1;
          }

          const parsedCard = parsed.parsedCard;
          const docTitle = parsedCard?.name || sourceFile.basename || 'Character Card';
          const existingCache = this.app.metadataCache.getFileCache(metaFile);
          const existingFrontmatter = normalizeFrontmatter((existingCache?.frontmatter ?? {}) as FrontmatterData);
          const currentMetaMarkdown = await this.app.vault.cachedRead(metaFile);
          const existingDetails = parseCharacterCardDetailsContentFromMarkdown(currentMetaMarkdown);
          const existingStatus = (asString(getFrontmatterValue(existingFrontmatter, 'status')) ?? '').toLowerCase();
          const existingLorebooks = asStringArray(getFrontmatterValue(existingFrontmatter, 'lorebooks'));
          const existingCompletionProfile = asString(getFrontmatterValue(existingFrontmatter, 'completionProfile'));
          const existingCardSummary = (
            asString(getFrontmatterValue(existingFrontmatter, 'cardSummary'))
            ?? existingDetails.cardSummary
          );
          const existingCardSummaryScenarioFocus = (
            asString(getFrontmatterValue(existingFrontmatter, 'cardSummaryScenarioFocus'))
            ?? existingDetails.cardSummaryScenarioFocus
          );
          const existingCardSummaryHook = (
            asString(getFrontmatterValue(existingFrontmatter, 'cardSummaryHook'))
            ?? existingDetails.cardSummaryHook
          );
          const existingCardSummaryTone = asStringArray(getFrontmatterValue(existingFrontmatter, 'cardSummaryTone'));
          const existingCardSummaryThemes = asStringArray(getFrontmatterValue(existingFrontmatter, 'cardSummaryThemes'));
          const existingCardSummaryForHash = asString(getFrontmatterValue(existingFrontmatter, 'cardSummaryForHash')) ?? '';
          const existingCardSummarySource = (asString(getFrontmatterValue(existingFrontmatter, 'cardSummarySource')) ?? '').trim().toLowerCase();
          const existingCardSummaryHasContent = Boolean(existingCardSummary.trim());
          const existingCardSummaryHashMismatch = Boolean(existingCardSummaryForHash) && existingCardSummaryForHash !== parsed.cardHash;

          let generatedSummary: CharacterCardSummaryPayload | null = null;
          let summarySyncError = '';
          const shouldGenerateSummary = Boolean(
            autoSummaryEnabled
            && parsedCard
            && summaryCompletionResolution
            && !summaryCompletionResolution.error
            && (
              !existingCardSummaryHasContent
              || (
                autoSummaryRegenerate
                && existingCardSummaryHashMismatch
                && existingCardSummarySource === 'llm_auto'
              )
            )
          );

          if (shouldGenerateSummary && parsedCard && summaryCompletionResolution && !summaryCompletionResolution.error) {
            updateProgressNotice(
              'processing cards',
              progressCompleted,
              totalProgressItems,
              `${sourceIndex + 1}/${sourceFiles.length}: generating summary for ${sourceFile.basename}`,
              true
            );
            try {
              generatedSummary = await this.generateCharacterCardSummary(sourceFile, parsedCard, summaryCompletionResolution);
              summaryGenerated += 1;
            } catch (error) {
              summaryFailed += 1;
              summarySyncError = error instanceof Error ? error.message : String(error);
            }
          } else if (autoSummaryEnabled && parsedCard) {
            summarySkipped += 1;
          }

          if (!generatedSummary && existingCardSummaryHasContent && existingCardSummaryHashMismatch) {
            summaryStale += 1;
          }

          const effectiveSummary = generatedSummary?.summary
            ?? existingCardSummary
            ?? '';
          const effectiveSummaryScenarioFocus = generatedSummary?.scenarioFocus
            ?? existingCardSummaryScenarioFocus;
          const effectiveSummaryHook = generatedSummary?.hook
            ?? existingCardSummaryHook;
          const effectiveSummaryTone = generatedSummary?.tone
            ?? existingCardSummaryTone
            ?? existingDetails.cardSummaryTone;
          const effectiveSummaryThemes = generatedSummary?.themes
            ?? existingCardSummaryThemes
            ?? existingDetails.cardSummaryThemes;

          await this.app.fileManager.processFrontMatter(metaFile, frontmatter => {
            frontmatter.lvDocType = CHARACTER_CARD_META_DOC_TYPE;
            frontmatter.title = docTitle;
            frontmatter.characterName = docTitle;
            frontmatter.cardPath = sourceFile.path;
            frontmatter.cardFile = `[[${normalizeLinkTarget(sourceFile.path)}]]`;
            frontmatter.cardFormat = sourceFile.extension.toLowerCase();
            frontmatter.cardHash = parsed.cardHash;
            frontmatter.cardSpec = parsedCard?.spec ?? '';
            frontmatter.cardSpecVersion = parsedCard?.specVersion ?? '';
            frontmatter.creator = parsedCard?.creator ?? '';
            frontmatter.cardTags = parsedCard?.tags ?? [];
            frontmatter.embeddedLorebookName = parsedCard?.embeddedLorebookName ?? '';
            frontmatter.embeddedLorebookEntryCount = parsedCard?.embeddedLorebookEntries.length ?? 0;
            frontmatter.cardMtime = new Date(sourceFile.stat.mtime).toISOString();
            frontmatter.cardSizeBytes = sourceFile.stat.size;
            frontmatter.sourceType = 'sillytavern_character_card_library';
            frontmatter.characterCardDetailsVersion = CHARACTER_CARD_DETAILS_BLOCK_VERSION;
            frontmatter.lastSynced = nowIso;
            if (existingLorebooks.length > 0) {
              frontmatter.lorebooks = existingLorebooks;
            } else if (!Array.isArray(frontmatter.lorebooks)) {
              frontmatter.lorebooks = [];
            }
            if (existingCompletionProfile) {
              frontmatter.completionProfile = existingCompletionProfile;
            } else if (typeof frontmatter.completionProfile === 'string' && !frontmatter.completionProfile.trim()) {
              delete frontmatter.completionProfile;
            }
            frontmatter.status = existingStatus && existingStatus !== 'missing_source'
              ? existingStatus
              : 'inbox';
            if (parsed.avatarLink) {
              frontmatter.avatar = parsed.avatarLink;
            } else {
              delete frontmatter.avatar;
            }
            if (parsed.parseError) {
              frontmatter.parseError = parsed.parseError;
            } else {
              delete frontmatter.parseError;
            }
            if (parsed.warnings.length > 0) {
              frontmatter.syncWarnings = parsed.warnings;
            } else {
              delete frontmatter.syncWarnings;
            }
            if (generatedSummary) {
              frontmatter.cardSummary = generatedSummary.summary;
              frontmatter.cardSummaryThemes = generatedSummary.themes;
              frontmatter.cardSummaryTone = generatedSummary.tone;
              frontmatter.cardSummaryScenarioFocus = generatedSummary.scenarioFocus;
              frontmatter.cardSummaryHook = generatedSummary.hook;
              frontmatter.cardSummaryForHash = parsed.cardHash;
              frontmatter.cardSummaryUpdatedAt = nowIso;
              frontmatter.cardSummarySource = 'llm_auto';
              frontmatter.cardSummaryStale = false;
              delete frontmatter.cardSummarySyncError;
            } else if (existingCardSummaryHasContent) {
              frontmatter.cardSummary = effectiveSummary;
              frontmatter.cardSummaryThemes = effectiveSummaryThemes;
              frontmatter.cardSummaryTone = effectiveSummaryTone;
              frontmatter.cardSummaryScenarioFocus = effectiveSummaryScenarioFocus;
              frontmatter.cardSummaryHook = effectiveSummaryHook;
              frontmatter.cardSummaryStale = existingCardSummaryHashMismatch;
              if (summarySyncError) {
                frontmatter.cardSummarySyncError = summarySyncError;
              } else {
                delete frontmatter.cardSummarySyncError;
              }
            } else if (summarySyncError) {
              frontmatter.cardSummarySyncError = summarySyncError;
            } else {
              delete frontmatter.cardSummarySyncError;
              delete frontmatter.cardSummaryStale;
            }
            delete frontmatter.creatorNotes;
            delete frontmatter.cardDescription;
            delete frontmatter.cardPersonality;
            delete frontmatter.cardScenario;
            delete frontmatter.cardFirstMessage;
            delete frontmatter.cardMessageExample;
            delete frontmatter.cardAlternateGreetings;
            delete frontmatter.cardGroupOnlyGreetings;
            delete frontmatter.cardSystemPrompt;
            delete frontmatter.cardPostHistoryInstructions;
            delete frontmatter.missingSourceSince;
          });

          const detailsBlock = this.buildCharacterCardDetailsBlock({
            sourcePath: sourceFile.path,
            avatarEmbedMarkdown: this.resolveCharacterCardAvatarEmbedForSync(
              this.buildCharacterCardAvatarEmbedMarkdown(
                parsed.avatarLink || (asString(getFrontmatterValue(existingFrontmatter, 'avatar', 'characterCardAvatar')) ?? ''),
                sourceFile.path
              ),
              existingDetails.avatarEmbedMarkdown
            ),
            creatorNotes: parsedCard?.creatorNotes ?? existingDetails.creatorNotes,
            cardSummary: effectiveSummary,
            cardSummaryScenarioFocus: effectiveSummaryScenarioFocus,
            cardSummaryHook: effectiveSummaryHook,
            cardSummaryTone: effectiveSummaryTone,
            cardSummaryThemes: effectiveSummaryThemes,
            cardDescription: parsedCard?.description ?? existingDetails.cardDescription,
            cardPersonality: parsedCard?.personality ?? existingDetails.cardPersonality,
            cardScenario: parsedCard?.scenario ?? existingDetails.cardScenario,
            cardFirstMessage: parsedCard?.firstMessage ?? existingDetails.cardFirstMessage,
            cardMessageExample: parsedCard?.messageExample ?? existingDetails.cardMessageExample,
            cardSystemPrompt: parsedCard?.systemPrompt ?? existingDetails.cardSystemPrompt,
            cardPostHistoryInstructions: parsedCard?.postHistoryInstructions ?? existingDetails.cardPostHistoryInstructions,
            cardAlternateGreetings: parsedCard?.alternateGreetings ?? existingDetails.cardAlternateGreetings,
            cardGroupOnlyGreetings: parsedCard?.groupOnlyGreetings ?? existingDetails.cardGroupOnlyGreetings
          });
          const latestMetaMarkdown = await this.app.vault.cachedRead(metaFile);
          const withDetailsBlock = this.upsertCharacterCardDetailsBlockInMarkdown(latestMetaMarkdown, detailsBlock);
          if (withDetailsBlock !== latestMetaMarkdown) {
            await this.app.vault.modify(metaFile, withDetailsBlock);
          }
        } catch (error) {
          failures += 1;
          console.warn('LoreVault: Failed syncing character-card meta note:', sourceFile.path, error);
        } finally {
          progressCompleted += 1;
          updateProgressNotice(
            'processing cards',
            progressCompleted,
            totalProgressItems,
            `${sourceIndex + 1}/${sourceFiles.length}: ${sourceFile.basename}`
          );
        }
      }

      const existingEntries = [...existingByCardPath.entries()];
      for (let missingIndex = 0; missingIndex < existingEntries.length; missingIndex += 1) {
        const [cardPathKey, metaFile] = existingEntries[missingIndex];
        updateProgressNotice(
          'marking missing',
          progressCompleted,
          totalProgressItems,
          `${missingIndex + 1}/${existingEntries.length}: ${metaFile.basename}`
        );
        if (seenCardPaths.has(cardPathKey)) {
          progressCompleted += 1;
          continue;
        }
        try {
          await this.app.fileManager.processFrontMatter(metaFile, frontmatter => {
            frontmatter.status = 'missing_source';
            if (!asString(frontmatter.missingSourceSince)) {
              frontmatter.missingSourceSince = nowIso;
            }
            frontmatter.lastSynced = nowIso;
          });
          markedMissing += 1;
        } catch (error) {
          failures += 1;
          console.warn('LoreVault: Failed marking missing source card meta note:', metaFile.path, error);
        } finally {
          progressCompleted += 1;
          updateProgressNotice(
            'marking missing',
            progressCompleted,
            totalProgressItems,
            `${missingIndex + 1}/${existingEntries.length}: ${metaFile.basename}`
          );
        }
      }

      updateProgressNotice('finalizing', totalProgressItems, totalProgressItems, 'done', true);

      const summary = [
        `Character-card sync complete (${sourceFiles.length} source files).`,
        `${created} created`,
        `${updated} updated`,
        `${markedMissing} missing-source`,
        `${parseErrors} parse errors`,
        `${summaryGenerated} summaries`,
        `${summaryStale} stale summaries`,
        `${summaryFailed} summary failures`,
        `${summarySkipped} summary skipped`,
        `${summaryConfigErrorCount} summary config errors`,
        `${failures} failures`
      ].join(' | ');
      new Notice(summary);
    } finally {
      progressNotice.hide();
    }
  }

  private discoverAllScopes(files: TFile[]): string[] {
    const scopes = new Set<string>();

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) {
        continue;
      }
      const tags = getAllTags(cache) ?? [];
      const fileScopes = extractLorebookScopesFromTags(tags, this.settings.tagScoping.tagPrefix);

      for (const scope of fileScopes) {
        if (scope) {
          scopes.add(scope);
        }
      }
    }

    return [...scopes].sort((a, b) => a.localeCompare(b));
  }

  private invalidateLorebookScopeCache(): void {
    this.lorebookScopeCache?.invalidate();
  }

  public getCachedLorebookMetadata(): LorebookNoteMetadata[] {
    return this.lorebookScopeCache.getNotes();
  }

  public getCachedLorebookScopes(): string[] {
    return this.lorebookScopeCache.getScopes();
  }

  private normalizeExportScopeList(scopes: string[]): string[] {
    const normalized = scopes
      .map(scope => normalizeScope(scope))
      .filter(Boolean);
    return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
  }

  private getScopeTimestampKey(scope: string): string {
    const normalized = normalizeScope(scope);
    return normalized || '__all__';
  }

  public getScopeLastCanonicalExportTimestamp(scope: string): number {
    const key = this.getScopeTimestampKey(scope);
    return Math.max(0, Number(this.settings.sqlite.lastCanonicalExportByScope?.[key] ?? 0));
  }

  private recordScopeCanonicalExport(scope: string, timestamp: number): boolean {
    if (!this.settings.sqlite.lastCanonicalExportByScope) {
      this.settings.sqlite.lastCanonicalExportByScope = {};
    }
    const key = this.getScopeTimestampKey(scope);
    const nextTimestamp = Math.max(0, Math.floor(timestamp));
    const current = Math.max(0, Number(this.settings.sqlite.lastCanonicalExportByScope[key] ?? 0));
    if (current === nextTimestamp) {
      return false;
    }
    this.settings.sqlite.lastCanonicalExportByScope[key] = nextTimestamp;
    return true;
  }

  private getExportFreshnessPolicy(): 'manual' | 'on_build' | 'background_debounced' {
    const value = this.settings.sqlite.exportFreshnessPolicy;
    if (value === 'manual' || value === 'background_debounced') {
      return value;
    }
    return 'on_build';
  }

  private getBackgroundExportDebounceMs(): number {
    const configured = Math.floor(Number(
      this.settings.sqlite.backgroundDebounceMs ?? DEFAULT_SETTINGS.sqlite.backgroundDebounceMs ?? 1800
    ));
    if (!Number.isFinite(configured)) {
      return 1800;
    }
    return Math.max(400, Math.min(30000, configured));
  }

  private getLorebookScopesForFile(file: TFile | null): string[] {
    if (!(file instanceof TFile) || !file.path.toLowerCase().endsWith('.md')) {
      return [];
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const tags = cache ? (getAllTags(cache) ?? []) : [];
    return this.normalizeExportScopeList(
      extractLorebookScopesFromTags(tags, this.settings.tagScoping.tagPrefix)
    );
  }

  private ensureExportScopeIndex(): void {
    if (this.exportScopeIndexByPath.size > 0) {
      return;
    }
    const metadata = this.getCachedLorebookMetadata();
    this.exportScopeIndexByPath = new Map(
      metadata.map(item => [item.path, this.normalizeExportScopeList(item.scopes)])
    );
  }

  private collectImpactedScopesForChange(
    file: TAbstractFile | null,
    oldPath?: string
  ): string[] {
    this.ensureExportScopeIndex();

    const currentPath = file?.path ?? '';
    const normalizedOldPath = (oldPath ?? '').trim();
    const oldIsMarkdown = normalizedOldPath.toLowerCase().endsWith('.md');
    const currentIsMarkdown = currentPath.toLowerCase().endsWith('.md');

    if (!oldIsMarkdown && !currentIsMarkdown) {
      return [];
    }

    const previousScopes = oldIsMarkdown
      ? (this.exportScopeIndexByPath.get(normalizedOldPath) ?? [])
      : (currentIsMarkdown ? (this.exportScopeIndexByPath.get(currentPath) ?? []) : []);
    const nextScopes = this.getLorebookScopesForFile(file instanceof TFile ? file : null);

    if (oldIsMarkdown && normalizedOldPath !== currentPath) {
      this.exportScopeIndexByPath.delete(normalizedOldPath);
    }
    if (currentIsMarkdown) {
      if (nextScopes.length > 0) {
        this.exportScopeIndexByPath.set(currentPath, nextScopes);
      } else {
        this.exportScopeIndexByPath.delete(currentPath);
      }
    }

    const impacted = new Set<string>();
    for (const scope of [...previousScopes, ...nextScopes]) {
      const normalized = normalizeScope(scope);
      if (!normalized) {
        continue;
      }
      impacted.add(normalized);
      if (this.settings.tagScoping.membershipMode === 'cascade') {
        const parts = normalized.split('/');
        for (let index = parts.length - 1; index >= 1; index -= 1) {
          impacted.add(parts.slice(0, index).join('/'));
        }
      }
    }

    const activeScope = normalizeScope(this.settings.tagScoping.activeScope);
    if (activeScope) {
      const couldImpactActive = (
        shouldIncludeInScope(
          previousScopes,
          activeScope,
          this.settings.tagScoping.membershipMode,
          this.settings.tagScoping.includeUntagged
        ) ||
        shouldIncludeInScope(
          nextScopes,
          activeScope,
          this.settings.tagScoping.membershipMode,
          this.settings.tagScoping.includeUntagged
        )
      );
      if (couldImpactActive) {
        impacted.add(activeScope);
      }
    }

    return [...impacted].sort((left, right) => left.localeCompare(right));
  }

  private queueBackgroundScopeRebuild(scopes: string[]): void {
    if (this.getExportFreshnessPolicy() !== 'background_debounced') {
      return;
    }
    const normalized = this.normalizeExportScopeList(scopes);
    if (normalized.length === 0) {
      return;
    }
    for (const scope of normalized) {
      this.pendingExportScopes.add(scope);
    }
    if (this.exportRebuildTimer !== null) {
      window.clearTimeout(this.exportRebuildTimer);
    }
    this.exportRebuildTimer = window.setTimeout(() => {
      this.exportRebuildTimer = null;
      void this.flushBackgroundScopeRebuilds();
    }, this.getBackgroundExportDebounceMs());
  }

  private async flushBackgroundScopeRebuilds(): Promise<void> {
    if (this.exportRebuildInFlight) {
      return;
    }
    const scopes = [...this.pendingExportScopes].sort((left, right) => left.localeCompare(right));
    this.pendingExportScopes.clear();
    if (scopes.length === 0) {
      return;
    }

    this.exportRebuildInFlight = true;
    try {
      for (const scope of scopes) {
        await this.convertToLorebook(scope, {
          silentSuccessNotice: true,
          suppressErrorNotice: true,
          deferViewRefresh: true,
          quietProgress: true
        });
      }
    } finally {
      this.exportRebuildInFlight = false;
      this.refreshManagerViews();
      this.refreshRoutingDebugViews();
      this.refreshQuerySimulationViews();
      this.refreshStoryChatViews();
      if (this.pendingExportScopes.size > 0) {
        void this.flushBackgroundScopeRebuilds();
      }
    }
  }

  private createMessageId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  public getAvailableScopes(): string[] {
    const fromIndex = this.liveContextIndex?.getScopes() ?? [];
    if (fromIndex.length > 0) {
      return [...fromIndex].sort((a, b) => a.localeCompare(b));
    }
    return this.getCachedLorebookScopes();
  }

  private mergeSteeringText(...values: string[]): string {
    return values
      .map(value => value.trim())
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index)
      .join('\n\n');
  }

  private mergeSteeringList(...values: string[][]): string[] {
    const merged = values.flatMap(items => items.map(item => item.trim()).filter(Boolean));
    return uniqueStrings(merged);
  }

  public getStorySteeringFolderPath(): string {
    const normalized = (this.settings.storySteering.folder ?? '').toString().trim().replace(/\\/g, '/');
    return normalized || DEFAULT_SETTINGS.storySteering.folder;
  }

  public async loadStorySteeringScope(scope: StorySteeringScope): Promise<StorySteeringState> {
    return this.storySteeringStore.loadScope(scope);
  }

  public async saveStorySteeringScope(scope: StorySteeringScope, state: StorySteeringState): Promise<string> {
    return this.storySteeringStore.saveScope(scope, state);
  }

  public async openStorySteeringScopeNote(scope: StorySteeringScope): Promise<void> {
    const path = this.storySteeringStore.resolveScopePath(scope);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`Unable to open steering note at ${path}`);
      return;
    }
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  public async resolveEffectiveStorySteeringForActiveNote(): Promise<StorySteeringEffectiveState> {
    const activeFile = this.app.workspace.getActiveFile();
    return this.storySteeringStore.resolveEffectiveStateForFile(activeFile);
  }

  public async resolveAuthorNoteWorkspaceContext(file?: TFile | null): Promise<{
    mode: 'story' | 'author_note' | 'none';
    activeFilePath: string;
    authorNotePath: string;
    linkedStoryPaths: string[];
    missingAuthorNoteRef: string;
  }> {
    const activeFile = file ?? this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile)) {
      return {
        mode: 'none',
        activeFilePath: '',
        authorNotePath: '',
        linkedStoryPaths: [],
        missingAuthorNoteRef: ''
      };
    }

    const linkedAuthorNote = await this.storySteeringStore.resolveAuthorNoteFileForStory(activeFile);
    const storyRef = this.storySteeringStore.getAuthorNoteRefForStory(activeFile);
    if (linkedAuthorNote || storyRef) {
      const linkedStories = linkedAuthorNote
        ? await this.storySteeringStore.getLinkedStoryFilesForAuthorNote(linkedAuthorNote)
        : [];
      const linkedStoryPaths = uniqueStrings(
        [...linkedStories.map(item => item.path), activeFile.path]
      ).sort((a, b) => a.localeCompare(b));
      return {
        mode: 'story',
        activeFilePath: activeFile.path,
        authorNotePath: linkedAuthorNote?.path ?? '',
        linkedStoryPaths,
        missingAuthorNoteRef: linkedAuthorNote ? '' : storyRef
      };
    }

    if (await this.storySteeringStore.isAuthorNoteFile(activeFile)) {
      const linkedStories = await this.storySteeringStore.getLinkedStoryFilesForAuthorNote(activeFile);
      return {
        mode: 'author_note',
        activeFilePath: activeFile.path,
        authorNotePath: activeFile.path,
        linkedStoryPaths: linkedStories.map(item => item.path),
        missingAuthorNoteRef: ''
      };
    }

    return {
      mode: 'none',
      activeFilePath: activeFile.path,
      authorNotePath: '',
      linkedStoryPaths: [],
      missingAuthorNoteRef: ''
    };
  }

  public async openOrCreateLinkedAuthorNoteForActiveNote(file?: TFile | null): Promise<TFile | null> {
    const activeFile = file ?? this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile)) {
      new Notice('No active markdown note.');
      return null;
    }

    let authorNoteFile = await this.storySteeringStore.resolveAuthorNoteFileForStory(activeFile);
    if (!(authorNoteFile instanceof TFile)) {
      if (await this.storySteeringStore.isAuthorNoteFile(activeFile)) {
        authorNoteFile = activeFile;
      } else {
        authorNoteFile = await this.storySteeringStore.ensureAuthorNoteForStory(activeFile);
      }
    }

    await this.app.workspace.getLeaf(true).openFile(authorNoteFile);
    this.refreshStorySteeringViews();
    return authorNoteFile;
  }

  public async resolveLinkedStoryDisplayForAuthorNote(authorNotePath: string): Promise<LinkedStoryDisplayItem[]> {
    const normalizedPath = normalizeVaultPath(authorNotePath);
    if (!normalizedPath) {
      return [];
    }

    const authorNote = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!(authorNote instanceof TFile)) {
      return [];
    }

    const linkedStories = await this.storySteeringStore.getLinkedStoryFilesForAuthorNote(authorNote);
    const items: LinkedStoryDisplayItem[] = linkedStories.map(file => {
      const node = this.getStoryThreadNodeForFile(file);
      return {
        path: file.path,
        chapter: typeof node?.chapter === 'number' ? node.chapter : null,
        chapterTitle: (node?.chapterTitle ?? '').trim()
      };
    });
    items.sort((left, right) => {
      const leftHasChapter = typeof left.chapter === 'number';
      const rightHasChapter = typeof right.chapter === 'number';
      if (leftHasChapter && rightHasChapter && left.chapter !== right.chapter) {
        return (left.chapter as number) - (right.chapter as number);
      }
      if (leftHasChapter !== rightHasChapter) {
        return leftHasChapter ? -1 : 1;
      }
      return left.path.localeCompare(right.path);
    });
    return items;
  }

  private async promptForAuthorNoteLinkSelection(activeFile: TFile): Promise<TFile | null> {
    const files = this.app.vault
      .getMarkdownFiles()
      .filter(file => file.path !== activeFile.path)
      .sort((a, b) => a.path.localeCompare(b.path));
    if (files.length === 0) {
      new Notice('No markdown notes available to link as Author Note.');
      return null;
    }
    const modal = new AuthorNoteLinkModal(this.app, files);
    const resultPromise = modal.waitForSelection();
    modal.open();
    return resultPromise;
  }

  public async linkExistingAuthorNoteForActiveNote(file?: TFile | null): Promise<TFile | null> {
    const activeFile = file ?? this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile)) {
      new Notice('No active markdown note.');
      return null;
    }
    if (await this.storySteeringStore.isAuthorNoteFile(activeFile)) {
      new Notice('Active note is an Author Note. Open a story note to link it.');
      return null;
    }

    const selected = await this.promptForAuthorNoteLinkSelection(activeFile);
    if (!selected) {
      return null;
    }

    await this.storySteeringStore.linkStoryToAuthorNote(activeFile, selected);
    this.refreshStorySteeringViews();
    new Notice(`Linked author note: ${selected.path}`);
    return selected;
  }

  private async promptForAuthorNoteRewriteInstruction(): Promise<string | null> {
    const modal = new AuthorNoteRewriteModal(this.app);
    const resultPromise = modal.waitForResult();
    modal.open();
    const result = await resultPromise;
    if (result.action !== 'rewrite') {
      return null;
    }
    return result.updateInstruction.trim();
  }

  private async promptForInlineDirectiveInstruction(initialInstruction = ''): Promise<string | null> {
    const modal = new InlineDirectiveInsertModal(this.app, initialInstruction);
    const resultPromise = modal.waitForResult();
    modal.open();
    const result = await resultPromise;
    if (result.action !== 'insert') {
      return null;
    }
    const instruction = result.instruction.trim().replace(/\s+/g, ' ');
    if (!instruction) {
      return null;
    }
    return instruction;
  }

  public async insertInlineDirectiveAtCursor(
    editorOverride?: Editor,
    infoOverride?: MarkdownView | MarkdownFileInfo
  ): Promise<void> {
    const targetFile = infoOverride instanceof MarkdownView
      ? (infoOverride.file ?? this.app.workspace.getActiveFile())
      : (infoOverride?.file ?? this.app.workspace.getActiveFile());
    const markdownView = infoOverride instanceof MarkdownView
      ? infoOverride
      : await this.resolveEditableMarkdownViewForFile(targetFile);
    const editor = editorOverride ?? markdownView?.editor;
    if (!editor) {
      new Notice('No active markdown editor found.');
      return;
    }

    const selectedText = editor.somethingSelected()
      ? editor.getSelection().trim()
      : '';
    const instruction = await this.promptForInlineDirectiveInstruction(selectedText);
    if (!instruction) {
      return;
    }

    const directive = `<!-- LV: ${instruction} -->`;
    if (editor.somethingSelected()) {
      editor.replaceSelection(directive);
    } else {
      editor.replaceRange(directive, editor.getCursor());
    }
  }

  private resolveMarkdownEditorScroller(markdownView: MarkdownView): HTMLElement | null {
    const containerScroller = markdownView.containerEl.querySelector('.cm-scroller');
    if (containerScroller instanceof HTMLElement) {
      return containerScroller;
    }
    const contentScroller = markdownView.contentEl.querySelector('.cm-scroller');
    if (contentScroller instanceof HTMLElement) {
      return contentScroller;
    }
    return null;
  }

  private replaceRangePreservingViewport(
    editor: Editor,
    markdownView: MarkdownView,
    text: string,
    pos: { line: number; ch: number },
    options?: {
      preserveViewport?: boolean;
    }
  ): boolean {
    const preserveViewport = options?.preserveViewport !== false;
    const scroller = preserveViewport ? this.resolveMarkdownEditorScroller(markdownView) : null;
    const scrollInfo = preserveViewport
      ? (scroller
        ? {
          left: scroller.scrollLeft,
          top: scroller.scrollTop
        }
        : editor.getScrollInfo())
      : null;
    const selections = editor.listSelections().map(selection => ({
      from: selection.anchor,
      to: selection.head
    }));
    try {
      editor.transaction({
        changes: [{
          from: pos,
          to: pos,
          text
        }],
        selections
      }, 'lorevault-stream-insert');
    } catch (error) {
      try {
        editor.replaceRange(text, pos);
      } catch {
        console.error('LoreVault: Failed to apply editor insertion:', error);
        return false;
      }
    }
    if (preserveViewport && scrollInfo) {
      if (scroller) {
        scroller.scrollTop = scrollInfo.top;
        scroller.scrollLeft = scrollInfo.left;
      } else {
        editor.scrollTo(scrollInfo.left, scrollInfo.top);
      }
    }
    return true;
  }

  private async resolveAuthorNoteRewriteTarget(file: TFile | null): Promise<{
    authorNoteFile: TFile;
    linkedStoryFiles: TFile[];
  } | null> {
    if (!(file instanceof TFile)) {
      return null;
    }

    const directAuthorNote = await this.storySteeringStore.resolveAuthorNoteFileForStory(file);
    if (directAuthorNote) {
      const linked = await this.storySteeringStore.getLinkedStoryFilesForAuthorNote(directAuthorNote);
      const linkedMap = new Map<string, TFile>(linked.map(item => [item.path, item]));
      linkedMap.set(file.path, file);
      return {
        authorNoteFile: directAuthorNote,
        linkedStoryFiles: [...linkedMap.values()].sort((a, b) => a.path.localeCompare(b.path))
      };
    }

    if (await this.storySteeringStore.isAuthorNoteFile(file)) {
      const linked = await this.storySteeringStore.getLinkedStoryFilesForAuthorNote(file);
      return {
        authorNoteFile: file,
        linkedStoryFiles: linked
      };
    }

    const created = await this.storySteeringStore.ensureAuthorNoteForStory(file);
    return {
      authorNoteFile: created,
      linkedStoryFiles: [file]
    };
  }

  private async buildAuthorNoteRewriteStoryContext(linkedStoryFiles: TFile[], tokenBudget: number): Promise<{
    markdown: string;
    querySeed: string;
  }> {
    if (linkedStoryFiles.length === 0 || tokenBudget <= 0) {
      return {
        markdown: '',
        querySeed: ''
      };
    }

    const sections: string[] = [];
    const queryParts: string[] = [];
    let usedTokens = 0;
    const maxPerStory = Math.max(220, Math.floor(tokenBudget / Math.max(1, linkedStoryFiles.length)));

    for (const storyFile of linkedStoryFiles) {
      const remaining = Math.max(0, tokenBudget - usedTokens);
      if (remaining < 120) {
        break;
      }
      const allowed = Math.max(120, Math.min(maxPerStory, remaining));
      const raw = await this.app.vault.cachedRead(storyFile);
      const body = this.stripMarkdownForLlm(stripFrontmatter(raw));
      if (!body) {
        continue;
      }
      const snippet = this.trimTextHeadToTokenBudget(body, allowed);
      usedTokens += this.estimateTokens(snippet);
      sections.push([
        `### Story Source: ${storyFile.path}`,
        snippet
      ].join('\n'));
      queryParts.push(snippet);
    }

    const querySeed = this.trimTextToTokenBudget(queryParts.join('\n\n'), Math.max(256, Math.floor(tokenBudget * 0.35)));
    return {
      markdown: sections.join('\n\n'),
      querySeed
    };
  }

  private async buildAuthorNoteRewriteLoreContext(scopes: string[], querySeed: string, tokenBudget: number): Promise<string> {
    if (scopes.length === 0 || tokenBudget <= 0) {
      return '';
    }

    const perScopeBudget = Math.max(120, Math.floor(tokenBudget / Math.max(1, scopes.length)));
    const parts: string[] = [];
    for (const scope of scopes) {
      const context = await this.liveContextIndex.query({
        queryText: querySeed || scope,
        tokenBudget: perScopeBudget,
        maxWorldInfoEntries: 12,
        maxRagDocuments: 8
      }, scope);
      if (context.markdown.trim()) {
        parts.push(context.markdown);
      }
    }

    return parts.join('\n\n---\n\n');
  }

  public async rewriteAuthorNoteFromActiveNote(file?: TFile | null): Promise<void> {
    const activeFile = file ?? this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile)) {
      throw new Error('No active markdown note.');
    }

    const completionResolution = await this.resolveEffectiveCompletionForFile(activeFile);
    const completion = completionResolution.completion;
    if (!completion.enabled) {
      throw new Error('Writing completion is disabled. Enable it under LoreVault Settings -> Writing Completion.');
    }
    if (completion.provider !== 'ollama' && !completion.apiKey) {
      throw new Error('Missing completion API key. Configure it under LoreVault Settings -> Writing Completion.');
    }

    const target = await this.resolveAuthorNoteRewriteTarget(activeFile);
    if (!target) {
      throw new Error('No rewrite target could be resolved for the active note.');
    }

    const updateInstruction = await this.promptForAuthorNoteRewriteInstruction();
    if (updateInstruction === null) {
      return;
    }

    const maxInputTokens = Math.max(512, completion.contextWindowTokens - completion.maxOutputTokens);
    const sourceTokenBudget = Math.max(800, Math.min(64000, Math.floor(maxInputTokens * 0.42)));
    const loreContextBudget = Math.max(256, Math.min(32000, Math.floor(maxInputTokens * 0.28)));

    const authorNoteMarkdown = await this.app.vault.cachedRead(target.authorNoteFile);
    const normalizedCurrent = parseStorySteeringMarkdown(authorNoteMarkdown);
    const linkedStoryFiles = target.linkedStoryFiles;
    const storyContext = await this.buildAuthorNoteRewriteStoryContext(linkedStoryFiles, sourceTokenBudget);
    const selectedScopes = new Set<string>();
    for (const storyFile of linkedStoryFiles) {
      const selection = await this.resolveStoryScopeSelection(storyFile);
      for (const scope of selection.scopes) {
        selectedScopes.add(scope);
      }
    }
    const loreContextMarkdown = await this.buildAuthorNoteRewriteLoreContext(
      [...selectedScopes].sort((a, b) => a.localeCompare(b)),
      storyContext.querySeed,
      loreContextBudget
    );

    const normalizedUpdateInstruction = updateInstruction;
    const systemPrompt = [
      'You are a writing assistant updating a single markdown Author Note for story generation.',
      'Return JSON only. No markdown, no prose, no reasoning.',
      'Output exactly one object with key `authorNote`.',
      'The value must be markdown text.',
      'Treat existing author-note markdown as baseline and update it to reflect current story state.',
      'Keep content concise and actionable for story generation guidance.',
      'Do not restate encyclopedic lore that belongs in lorebook entries.',
      'Only keep writer-control guidance, active plot pressure, unresolved questions, canon deltas, and near-term plan guidance.',
      'If optional update instructions are provided, prioritize them while preserving valid existing constraints.',
      'If the source does not provide evidence for updates, preserve the existing value.'
    ].join('\n');
    const userPrompt = [
      `Active note: ${activeFile.path}`,
      `Author note: ${target.authorNoteFile.path}`,
      `Linked story count: ${linkedStoryFiles.length}`,
      normalizedUpdateInstruction
        ? [
          '',
          '<update_request>',
          normalizedUpdateInstruction,
          '</update_request>'
        ].join('\n')
        : '',
      '',
      '<existing_author_note_markdown>',
      normalizedCurrent.authorNote || '[Empty author note]',
      '</existing_author_note_markdown>',
      '',
      '<story_sources>',
      storyContext.markdown || '[No linked story content found.]',
      '</story_sources>',
      '',
      '<lorebook_context>',
      loreContextMarkdown || '[No lorebook context available.]',
      '</lorebook_context>',
      '',
      'Return JSON with the required key only.'
    ].join('\n');

    let usageReport: CompletionUsageReport | null = null;
    const rawResponse = await requestStoryContinuation(completion, {
      systemPrompt,
      userPrompt,
      operationName: 'author_note_rewrite',
      onOperationLog: record => this.appendCompletionOperationLog(record, {
        costProfile: this.resolveEffectiveCostProfileLabel(completion.apiKey)
      }),
      onUsage: usage => {
        usageReport = usage;
      }
    });

    if (usageReport) {
      await this.recordCompletionUsage('author_note_rewrite', usageReport, {
        notePath: target.authorNoteFile.path,
        linkedStoryPaths: linkedStoryFiles.map(item => item.path),
        completionProfileSource: completionResolution.source,
        completionProfileId: completionResolution.presetId,
        completionProfileName: completionResolution.presetName,
        autoCostProfile: this.buildAutoCostProfileLabel(completionResolution.completion.apiKey)
      });
    }

    const parsed = parseStorySteeringExtractionResponse(rawResponse);
    const proposal = this.settings.storySteering.extractionSanitization === 'off'
      ? normalizeStorySteeringState(parsed)
      : sanitizeStorySteeringExtractionState(parsed);
    const reviewModal = new TextCommandReviewModal(
      this.app,
      normalizedCurrent.authorNote,
      proposal.authorNote,
      'Rewrite Author Note',
      {
        title: 'Review Author Note Rewrite',
        promptLabel: null,
        showOriginalText: false,
        editedTextLabel: 'Edited Author Note (will be saved)',
        applyButtonText: 'Save Author Note',
        compactDiffStats: true
      }
    );
    const reviewPromise = reviewModal.waitForResult();
    reviewModal.open();
    const review = await reviewPromise;
    if (review.action !== 'apply') {
      return;
    }

    const scope: StorySteeringScope = {
      type: 'note',
      key: target.authorNoteFile.path
    };
    await this.saveStorySteeringScope(scope, {
      authorNote: review.revisedText.trim()
    });
    this.refreshStorySteeringViews();
    new Notice(`Updated author note: ${target.authorNoteFile.path}`);
  }

  public getStoryChatMessages(): StoryChatMessage[] {
    return this.settings.storyChat.messages.map(message => ({
      ...message,
      contextMeta: message.contextMeta ? {
        ...message.contextMeta,
        scopes: [...message.contextMeta.scopes],
        steeringSourceRefs: [...(message.contextMeta.steeringSourceRefs ?? [])],
        steeringSourceScopes: [...(message.contextMeta.steeringSourceScopes ?? [])],
        unresolvedSteeringSourceRefs: [...(message.contextMeta.unresolvedSteeringSourceRefs ?? [])],
        specificNotePaths: [...message.contextMeta.specificNotePaths],
        unresolvedNoteRefs: [...message.contextMeta.unresolvedNoteRefs],
        chapterMemoryItems: [...(message.contextMeta.chapterMemoryItems ?? [])],
        inlineDirectiveItems: [...(message.contextMeta.inlineDirectiveItems ?? [])],
        continuityPlotThreads: [...(message.contextMeta.continuityPlotThreads ?? [])],
        continuityOpenLoops: [...(message.contextMeta.continuityOpenLoops ?? [])],
        continuityCanonDeltas: [...(message.contextMeta.continuityCanonDeltas ?? [])],
        continuitySelection: message.contextMeta.continuitySelection
          ? { ...message.contextMeta.continuitySelection }
          : undefined,
        layerTrace: [...(message.contextMeta.layerTrace ?? [])],
        layerUsage: [...(message.contextMeta.layerUsage ?? []).map(layer => ({ ...layer }))],
        overflowTrace: [...(message.contextMeta.overflowTrace ?? [])],
        chatToolTrace: [...(message.contextMeta.chatToolTrace ?? [])],
        chatToolCalls: [...(message.contextMeta.chatToolCalls ?? [])],
        chatToolWrites: [...(message.contextMeta.chatToolWrites ?? [])],
        worldInfoItems: [...message.contextMeta.worldInfoItems],
        ragItems: [...message.contextMeta.ragItems]
      } : undefined
    }));
  }

  public getStoryChatForkSnapshots(): StoryChatForkSnapshot[] {
    return this.settings.storyChat.forkSnapshots.map(snapshot => ({
      ...snapshot,
      selectedScopes: [...snapshot.selectedScopes],
      steeringScopeRefs: normalizeStoryChatSteeringRefs(snapshot.steeringScopeRefs ?? []),
      continuityPlotThreads: [...(snapshot.continuityPlotThreads ?? [])],
      continuityOpenLoops: [...(snapshot.continuityOpenLoops ?? [])],
      continuityCanonDeltas: [...(snapshot.continuityCanonDeltas ?? [])],
      continuitySelection: snapshot.continuitySelection
        ? { ...snapshot.continuitySelection }
        : {
          includePlotThreads: true,
          includeOpenLoops: true,
          includeCanonDeltas: true
        },
      noteContextRefs: [...snapshot.noteContextRefs],
      messages: snapshot.messages.map(message => ({
        ...message,
        contextMeta: message.contextMeta ? {
          ...message.contextMeta,
          scopes: [...message.contextMeta.scopes],
          steeringSourceRefs: [...(message.contextMeta.steeringSourceRefs ?? [])],
          steeringSourceScopes: [...(message.contextMeta.steeringSourceScopes ?? [])],
          unresolvedSteeringSourceRefs: [...(message.contextMeta.unresolvedSteeringSourceRefs ?? [])],
          specificNotePaths: [...message.contextMeta.specificNotePaths],
          unresolvedNoteRefs: [...message.contextMeta.unresolvedNoteRefs],
          chapterMemoryItems: [...(message.contextMeta.chapterMemoryItems ?? [])],
          inlineDirectiveItems: [...(message.contextMeta.inlineDirectiveItems ?? [])],
          continuityPlotThreads: [...(message.contextMeta.continuityPlotThreads ?? [])],
          continuityOpenLoops: [...(message.contextMeta.continuityOpenLoops ?? [])],
          continuityCanonDeltas: [...(message.contextMeta.continuityCanonDeltas ?? [])],
          continuitySelection: message.contextMeta.continuitySelection
            ? { ...message.contextMeta.continuitySelection }
            : undefined,
          layerTrace: [...(message.contextMeta.layerTrace ?? [])],
          layerUsage: [...(message.contextMeta.layerUsage ?? []).map(layer => ({ ...layer }))],
          overflowTrace: [...(message.contextMeta.overflowTrace ?? [])],
          chatToolTrace: [...(message.contextMeta.chatToolTrace ?? [])],
          chatToolCalls: [...(message.contextMeta.chatToolCalls ?? [])],
          chatToolWrites: [...(message.contextMeta.chatToolWrites ?? [])],
          worldInfoItems: [...message.contextMeta.worldInfoItems],
          ragItems: [...message.contextMeta.ragItems]
        } : undefined
      }))
    }));
  }

  public getStoryChatConfig(): ConverterSettings['storyChat'] {
    return {
      ...this.settings.storyChat,
      selectedScopes: [...this.settings.storyChat.selectedScopes],
      steeringScopeRefs: normalizeStoryChatSteeringRefs(this.settings.storyChat.steeringScopeRefs ?? []),
      noteContextRefs: [...this.settings.storyChat.noteContextRefs],
      messages: this.getStoryChatMessages(),
      forkSnapshots: this.getStoryChatForkSnapshots()
    };
  }

  public async updateStoryChatConfig(update: Partial<ConverterSettings['storyChat']>): Promise<void> {
    const merged: ConverterSettings = this.mergeSettings({
      ...this.settings,
      storyChat: {
        ...this.settings.storyChat,
        ...update
      }
    });
    this.settings = merged;
    await this.persistSettingsSnapshot(false);
    this.refreshStoryChatViews();
  }

  public async setStoryChatMessages(messages: StoryChatMessage[]): Promise<void> {
    const trimmed = messages.slice(-this.settings.storyChat.maxMessages);
    await this.updateStoryChatConfig({ messages: trimmed });
  }

  public async clearStoryChatMessages(): Promise<void> {
    await this.setStoryChatMessages([]);
  }

  public async getScopeContextPack(scope?: string): Promise<ScopeContextPack> {
    return this.liveContextIndex.getScopePack(scope);
  }

  public stopActiveGeneration(): void {
    if (!this.generationAbortController) {
      return;
    }
    this.generationAbortController.abort();
  }

  private isAbortLikeError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const normalized = error.message.toLowerCase();
    return normalized.includes('aborted') || normalized.includes('cancelled');
  }

  private buildChatHistorySnippet(
    history: StoryChatMessage[],
    tokenBudget = 900,
    maxMessages = 8
  ): string {
    if (history.length === 0) {
      return '';
    }

    const boundedMessageCount = Math.max(1, Math.floor(maxMessages));
    const recent = history.slice(-boundedMessageCount);
    const rendered = recent.map(message => {
      const label = message.role === 'assistant' ? 'Assistant' : 'User';
      const body = message.content.trim();
      return `${label}: ${body}`;
    }).join('\n\n');

    const normalizedBudget = Math.max(128, Math.floor(tokenBudget));
    return this.trimTextToTokenBudget(rendered, normalizedBudget);
  }

  private normalizeLinkLikeContextRef(rawRef: string): string {
    let normalized = rawRef.trim();
    if (!normalized) {
      return '';
    }

    const wikilinkMatch = normalized.match(/^\[\[([\s\S]+)\]\]$/);
    if (wikilinkMatch) {
      normalized = wikilinkMatch[1].trim();
      const pipeIndex = normalized.indexOf('|');
      if (pipeIndex >= 0) {
        normalized = normalized.slice(0, pipeIndex);
      }
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

  private normalizeNoteContextRef(rawRef: string): string {
    return this.normalizeLinkLikeContextRef(rawRef);
  }

  private resolveNoteContextFileFromRef(ref: string, sourcePath = ''): TFile | null {
    const normalizedRef = this.normalizeLinkLikeContextRef(ref);
    if (!normalizedRef) {
      return null;
    }

    const resolvedFromLink = this.app.metadataCache.getFirstLinkpathDest(normalizedRef, sourcePath);
    if (resolvedFromLink instanceof TFile) {
      return resolvedFromLink;
    }

    const directCandidates = [normalizedRef, `${normalizedRef}.md`];
    for (const candidate of directCandidates) {
      const found = this.app.vault.getAbstractFileByPath(candidate);
      if (found instanceof TFile) {
        return found;
      }
    }

    const basename = getVaultBasename(normalizedRef);
    const byBasename = this.app.vault
      .getMarkdownFiles()
      .filter(file => file.basename.localeCompare(basename, undefined, { sensitivity: 'accent' }) === 0);
    if (byBasename.length === 1) {
      return byBasename[0];
    }

    return null;
  }

  private resolveNoteContextFile(ref: string): TFile | null {
    const activePath = this.app.workspace.getActiveFile()?.path ?? '';
    return this.resolveNoteContextFileFromRef(ref, activePath);
  }

  public previewNoteContextRefs(refs: string[]): {
    resolvedPaths: string[];
    unresolvedRefs: string[];
  } {
    const normalizedRefs = refs
      .map(ref => this.normalizeNoteContextRef(ref))
      .filter((ref, index, array): ref is string => Boolean(ref) && array.indexOf(ref) === index);

    const resolvedPaths: string[] = [];
    const unresolvedRefs: string[] = [];
    const seenPaths = new Set<string>();

    for (const ref of normalizedRefs) {
      const file = this.resolveNoteContextFile(ref);
      if (!file) {
        unresolvedRefs.push(ref);
        continue;
      }

      if (!seenPaths.has(file.path)) {
        seenPaths.add(file.path);
        resolvedPaths.push(file.path);
      }
    }

    return {
      resolvedPaths,
      unresolvedRefs
    };
  }

  private formatStorySteeringScopeLabel(scope: StorySteeringScope): string {
    const key = scope.key.trim();
    return `note:${key || '(default)'}`;
  }

  private async resolveStoryChatSteeringSources(
    refs: string[]
  ): Promise<{
    mergedState: StorySteeringState;
    resolvedRefs: string[];
    unresolvedRefs: string[];
    resolvedScopeLabels: string[];
  }> {
    const normalizedRefs = normalizeStoryChatSteeringRefs(refs);
    if (normalizedRefs.length === 0) {
      return {
        mergedState: createEmptyStorySteeringState(),
        resolvedRefs: [],
        unresolvedRefs: [],
        resolvedScopeLabels: []
      };
    }

    const mergedStates: StorySteeringState[] = [];
    const resolvedRefs: string[] = [];
    const unresolvedRefs: string[] = [];
    const resolvedScopeLabels: string[] = [];

    for (const rawRef of normalizedRefs) {
      const parsed = parseStoryChatSteeringRef(rawRef);
      if (!parsed) {
        continue;
      }

      if (parsed.type === 'note') {
        const file = this.resolveNoteContextFile(parsed.key);
        if (!file) {
          if (!unresolvedRefs.includes(rawRef)) {
            unresolvedRefs.push(rawRef);
          }
          continue;
        }

        const effective = await this.storySteeringStore.resolveEffectiveStateForFile(file);
        if (effective.layers.length === 0) {
          if (!unresolvedRefs.includes(rawRef)) {
            unresolvedRefs.push(rawRef);
          }
          continue;
        }
        mergedStates.push(effective.merged);

        const canonicalRef = stringifyStoryChatSteeringRef({
          type: 'note',
          key: file.path
        });
        if (!resolvedRefs.includes(canonicalRef)) {
          resolvedRefs.push(canonicalRef);
        }
        for (const layer of effective.layers) {
          const label = this.formatStorySteeringScopeLabel(layer.scope);
          if (!resolvedScopeLabels.includes(label)) {
            resolvedScopeLabels.push(label);
          }
        }
        continue;
      }

      if (!unresolvedRefs.includes(rawRef)) {
        unresolvedRefs.push(rawRef);
      }
    }

    return {
      mergedState: mergedStates.length > 0
        ? mergeStorySteeringStates(mergedStates)
        : createEmptyStorySteeringState(),
      resolvedRefs,
      unresolvedRefs,
      resolvedScopeLabels
    };
  }

  private async buildSpecificNotesContext(
    refs: string[],
    tokenBudget: number
  ): Promise<{
    markdown: string;
    usedTokens: number;
    includedPaths: string[];
    unresolvedRefs: string[];
  }> {
    const normalizedRefs = refs
      .map(ref => this.normalizeNoteContextRef(ref))
      .filter((ref, index, array): ref is string => Boolean(ref) && array.indexOf(ref) === index);
    if (normalizedRefs.length === 0 || tokenBudget <= 0) {
      return {
        markdown: '',
        usedTokens: 0,
        includedPaths: [],
        unresolvedRefs: []
      };
    }

    let usedTokens = 0;
    const sections: string[] = [];
    const includedPaths: string[] = [];
    const unresolvedRefs: string[] = [];
    const usedFilePaths = new Set<string>();

    for (const ref of normalizedRefs) {
      const file = this.resolveNoteContextFile(ref);
      if (!file) {
        unresolvedRefs.push(ref);
        continue;
      }
      if (usedFilePaths.has(file.path)) {
        continue;
      }

      const remaining = tokenBudget - usedTokens;
      if (remaining < 32) {
        break;
      }

      const raw = await this.app.vault.cachedRead(file);
      const body = this.stripMarkdownForLlm(stripFrontmatter(raw));
      if (!body) {
        continue;
      }

      // Reserve some structural overhead for headers/source labels.
      const bodyBudget = Math.max(64, remaining - 32);
      const snippet = this.trimTextHeadToTokenBudget(body, bodyBudget);
      const section = [
        `### ${file.basename}`,
        `Source: \`${file.path}\``,
        '',
        snippet
      ].join('\n');
      const sectionTokens = this.estimateTokens(section);
      if (usedTokens + sectionTokens > tokenBudget) {
        continue;
      }

      usedTokens += sectionTokens;
      usedFilePaths.add(file.path);
      includedPaths.push(file.path);
      sections.push(section);
    }

    return {
      markdown: sections.join('\n\n---\n\n'),
      usedTokens,
      includedPaths,
      unresolvedRefs
    };
  }

  private async buildToolHooksContext(
    queryText: string,
    scopes: string[],
    tokenBudget: number,
    completion: ConverterSettings['completion'],
    abortSignal?: AbortSignal
  ): Promise<{
    markdown: string;
    usedTokens: number;
    selectedItems: string[];
    layerTrace: string[];
  }> {
    if (!this.settings.retrieval.toolCalls.enabled || tokenBudget <= 0) {
      return {
        markdown: '',
        usedTokens: 0,
        selectedItems: [],
        layerTrace: []
      };
    }

    const planner = createCompletionRetrievalToolPlanner(completion, {
      operationName: 'retrieval_tool_hooks',
      onOperationLog: record => this.appendCompletionOperationLog(record, {
        costProfile: this.resolveEffectiveCostProfileLabel(completion.apiKey)
      })
    });
    if (!planner) {
      return {
        markdown: '',
        usedTokens: 0,
        selectedItems: [],
        layerTrace: ['tool_hooks: provider does not support tool calls']
      };
    }

    const requestedScopes = scopes.length > 0
      ? scopes.map(scope => normalizeScope(scope)).filter((scope, index, array) => Boolean(scope) && array.indexOf(scope) === index)
      : [''];
    const catalogInputs: Array<{ scope: string; entries: LoreBookEntry[] }> = [];
    for (const requestedScope of requestedScopes) {
      const pack = await this.liveContextIndex.getScopePack(requestedScope);
      catalogInputs.push({
        scope: pack.scope,
        entries: pack.worldInfoEntries
      });
    }

    const catalog = createRetrievalToolCatalog(catalogInputs);
    const result = await runModelDrivenRetrievalHooks({
      queryText,
      selectedScopes: requestedScopes,
      contextTokenBudget: tokenBudget,
      catalog,
      planner,
      limits: {
        maxCalls: this.settings.retrieval.toolCalls.maxCallsPerTurn,
        maxResultTokens: this.settings.retrieval.toolCalls.maxResultTokensPerTurn,
        maxPlanningTimeMs: this.settings.retrieval.toolCalls.maxPlanningTimeMs,
        maxInjectedEntries: 8
      },
      abortSignal
    });

    return {
      markdown: result.markdown,
      usedTokens: result.usedTokens,
      selectedItems: result.selectedItems,
      layerTrace: result.trace
    };
  }

  private parseToolJsonObject(raw: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch (_error) {
      return {};
    }
  }

  private parseToolStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return uniqueStrings(
        value
          .map(item => (typeof item === 'string' ? item : String(item ?? '')))
          .map(item => item.trim())
          .filter(Boolean)
      );
    }
    if (typeof value === 'string') {
      return uniqueStrings(
        value
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .map(item => item.trim())
          .filter(Boolean)
      );
    }
    return [];
  }

  private normalizeToolLimit(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, parsed));
  }

  private tokenizeStoryChatToolQuery(value: string): string[] {
    const tokens = value.trim().toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu);
    if (!tokens) {
      return [];
    }
    return [...new Set(tokens)];
  }

  private scoreLorebookEntryForStoryChatTool(entry: LoreBookEntry, queryTokens: string[]): number {
    if (queryTokens.length === 0) {
      return 0;
    }
    const title = (entry.comment || '').toLowerCase();
    const keywordText = uniqueStrings([...entry.key, ...entry.keysecondary])
      .join(' ')
      .toLowerCase();
    const content = (entry.content || '').toLowerCase();
    let score = 0;
    for (const token of queryTokens) {
      if (title.includes(token)) {
        score += 8;
      }
      if (keywordText.includes(token)) {
        score += 6;
      }
      if (content.includes(token)) {
        score += 2;
      }
    }
    return score;
  }

  private sanitizeStoryChatToolFileStem(value: string): string {
    const trimmed = value.trim().toLowerCase();
    const collapsed = trimmed.replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return collapsed || 'entry';
  }

  private hasExplicitStoryChatWriteIntent(userMessage: string): boolean {
    const normalized = userMessage.toLowerCase();
    const action = /\b(update|edit|revise|rewrite|modify|change|set|save|write|create|add|append|patch|adjust)\b/.test(normalized);
    const target = /\b(steering|note|entry|lorebook|scope|plot thread|open loop|canon delta|fact)\b/.test(normalized);
    return action && target;
  }

  private buildStoryChatAgentToolDefinitions(args: {
    allowLorebook: boolean;
    allowStoryNotes: boolean;
    allowSteering: boolean;
    allowWriteActions: boolean;
  }): CompletionToolDefinition[] {
    const definitions: CompletionToolDefinition[] = [];
    if (args.allowLorebook) {
      definitions.push({
        type: 'function',
        function: {
          name: 'search_lorebook_entries',
          description: 'Search selected lorebook entries by query text.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              scope: { type: 'string' },
              limit: { type: 'integer', minimum: 1, maximum: 20 }
            },
            required: ['query']
          }
        }
      });
      definitions.push({
        type: 'function',
        function: {
          name: 'get_lorebook_entry',
          description: 'Read one lorebook entry by uid and optional lorebook.',
          parameters: {
            type: 'object',
            properties: {
              uid: { type: 'integer' },
              scope: { type: 'string' },
              contentChars: { type: 'integer', minimum: 120, maximum: 5000 }
            },
            required: ['uid']
          }
        }
      });
    }

    if (args.allowStoryNotes) {
      definitions.push({
        type: 'function',
        function: {
          name: 'search_story_notes',
          description: 'Search linked story/manual-selected notes by query text.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              limit: { type: 'integer', minimum: 1, maximum: 20 }
            },
            required: ['query']
          }
        }
      });
      definitions.push({
        type: 'function',
        function: {
          name: 'read_story_note',
          description: 'Read one linked story/manual-selected note by exact vault path.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              maxChars: { type: 'integer', minimum: 200, maximum: 6000 }
            },
            required: ['path']
          }
        }
      });
    }

    if (args.allowSteering) {
      definitions.push({
        type: 'function',
        function: {
          name: 'get_steering_scope',
          description: 'Read the active note-level author note.',
          parameters: {
            type: 'object',
            properties: {}
          }
        }
      });
    }

    if (args.allowWriteActions) {
      definitions.push({
        type: 'function',
        function: {
          name: 'update_steering_scope',
          description: 'Update the active note-level author note.',
          parameters: {
            type: 'object',
            properties: {
              state: {
                type: 'object',
                properties: {
                  authorNote: { type: 'string' }
                }
              }
            },
            required: ['state']
          }
        }
      });

      if (args.allowLorebook) {
        definitions.push({
          type: 'function',
          function: {
            name: 'create_lorebook_entry_note',
            description: 'Create a new lorebook-tagged note in one of the selected lorebooks.',
            parameters: {
              type: 'object',
              properties: {
                scope: { type: 'string' },
                title: { type: 'string' },
                content: { type: 'string' },
                keywords: {
                  oneOf: [
                    { type: 'array', items: { type: 'string' } },
                    { type: 'string' }
                  ]
                },
                aliases: {
                  oneOf: [
                    { type: 'array', items: { type: 'string' } },
                    { type: 'string' }
                  ]
                },
                summary: { type: 'string' },
                retrieval: { type: 'string' }
              },
              required: ['scope', 'title', 'content']
            }
          }
        });
      }
    }

    return definitions;
  }

  private async runStoryChatAgentTools(args: {
    userMessage: string;
    historySnippet: string;
    selectedScopes: string[];
    useLorebookContext: boolean;
    specificNotePaths: string[];
    activeStoryFile: TFile | null;
    tokenBudget: number;
    completion: ConverterSettings['completion'];
    abortSignal?: AbortSignal;
  }): Promise<StoryChatAgentToolRunResult> {
    if (!this.settings.storyChat.toolCalls.enabled || args.tokenBudget <= 0) {
      return {
        markdown: '',
        usedTokens: 0,
        trace: [],
        callSummaries: [],
        writeSummaries: []
      };
    }

    const planner = createCompletionToolPlanner(args.completion, {
      operationName: 'story_chat_agent_tools',
      onOperationLog: record => this.appendCompletionOperationLog(record, {
        costProfile: this.resolveEffectiveCostProfileLabel(args.completion.apiKey)
      })
    });
    if (!planner) {
      return {
        markdown: '',
        usedTokens: 0,
        trace: ['story_chat_tools: provider does not support tool calls'],
        callSummaries: [],
        writeSummaries: []
      };
    }

    const lorebookScopes = args.useLorebookContext
      ? args.selectedScopes
        .map(scope => normalizeScope(scope))
        .filter((scope, index, array): scope is string => Boolean(scope) && array.indexOf(scope) === index)
      : [];
    const lorebookScopeSet = new Set<string>(lorebookScopes);
    const allowLorebook = lorebookScopes.length > 0;

    const lorebookEntriesByScope = new Map<string, LoreBookEntry[]>();
    for (const scope of lorebookScopes) {
      const pack = await this.liveContextIndex.getScopePack(scope);
      lorebookEntriesByScope.set(
        pack.scope,
        [...pack.worldInfoEntries].sort((left, right) => right.order - left.order || left.uid - right.uid)
      );
    }

    const allowedStoryPaths = new Set<string>();
    for (const path of args.specificNotePaths) {
      const normalized = normalizeVaultPath(path);
      if (normalized) {
        allowedStoryPaths.add(normalized);
      }
    }
    if (args.activeStoryFile) {
      allowedStoryPaths.add(normalizeVaultPath(args.activeStoryFile.path));
      const nodes = this.collectStoryThreadNodes();
      const resolution = resolveStoryThreadLineage(nodes, args.activeStoryFile.path);
      if (resolution) {
        for (const path of resolution.orderedPaths) {
          const normalized = normalizeVaultPath(path);
          if (normalized) {
            allowedStoryPaths.add(normalized);
          }
        }
      }
    }

    const allowedStoryFiles = [...allowedStoryPaths]
      .map(path => this.app.vault.getAbstractFileByPath(path))
      .filter((file): file is TFile => file instanceof TFile)
      .sort((left, right) => left.path.localeCompare(right.path));
    const allowedStoryFileMap = new Map<string, TFile>(
      allowedStoryFiles.map(file => [normalizeVaultPath(file.path), file])
    );
    const allowStoryNotes = allowedStoryFiles.length > 0;

    const activeSteeringScope = await this.storySteeringStore.getScopeForFile(args.activeStoryFile);
    const allowSteering = Boolean(activeSteeringScope?.key?.trim());

    const writeIntent = this.hasExplicitStoryChatWriteIntent(args.userMessage);
    const allowWriteActions = this.settings.storyChat.toolCalls.allowWriteActions && writeIntent;

    const toolDefinitions = this.buildStoryChatAgentToolDefinitions({
      allowLorebook,
      allowStoryNotes,
      allowSteering,
      allowWriteActions
    });

    if (toolDefinitions.length === 0) {
      return {
        markdown: '',
        usedTokens: 0,
        trace: ['story_chat_tools: no accessible tool surfaces for this turn'],
        callSummaries: [],
        writeSummaries: []
      };
    }

    const storyBodyCache = new Map<string, string>();
    const readStoryBody = async (file: TFile): Promise<string> => {
      const key = normalizeVaultPath(file.path);
      const cached = storyBodyCache.get(key);
      if (typeof cached === 'string') {
        return cached;
      }
      const raw = await this.app.vault.cachedRead(file);
      const body = this.stripMarkdownForLlm(stripFrontmatter(raw));
      storyBodyCache.set(key, body);
      return body;
    };

    const resolveToolSteeringScope = (): StorySteeringScope | null => {
      if (!allowSteering || !activeSteeringScope) {
        return null;
      }
      return activeSteeringScope;
    };

    const buildErrorResult = (toolName: StoryChatAgentToolName, reason: string): StoryChatAgentToolExecutionResult => {
      const payload = {
        ok: false,
        error: reason
      };
      return {
        ok: false,
        payload,
        estimatedTokens: this.estimateTokens(JSON.stringify(payload)),
        trace: `${toolName}: error (${reason})`,
        isWrite: false,
        callSummary: `${toolName}: error`
      };
    };

    const executeToolCall = async (call: StoryChatAgentToolCall): Promise<StoryChatAgentToolExecutionResult> => {
      const payload = this.parseToolJsonObject(call.argumentsJson);
      const toolName = call.name;

      if (toolName === 'search_lorebook_entries') {
        if (!allowLorebook) {
          return buildErrorResult(toolName, 'Lorebook tools are unavailable because no lorebooks are selected.');
        }
        const query = typeof payload.query === 'string' ? payload.query.trim() : '';
        if (!query) {
          return buildErrorResult(toolName, 'query is required');
        }
        const queryTokens = this.tokenizeStoryChatToolQuery(query);
        const requestedScopeRaw = typeof payload.scope === 'string' ? normalizeScope(payload.scope) : '';
        const requestedScope = requestedScopeRaw && lorebookScopeSet.has(requestedScopeRaw) ? requestedScopeRaw : '';
        const limit = this.normalizeToolLimit(payload.limit, 6, 1, 20);
        const rows: Array<{uid: number; scope: string; title: string; score: number}> = [];
        const scopes = requestedScope ? [requestedScope] : [...lorebookEntriesByScope.keys()];
        for (const scope of scopes) {
          const entries = lorebookEntriesByScope.get(scope) ?? [];
          for (const entry of entries) {
            const score = this.scoreLorebookEntryForStoryChatTool(entry, queryTokens);
            if (score <= 0) {
              continue;
            }
            rows.push({
              uid: entry.uid,
              scope,
              title: entry.comment,
              score
            });
          }
        }
        rows.sort((left, right) => right.score - left.score || left.scope.localeCompare(right.scope) || left.uid - right.uid);
        const results = rows.slice(0, limit).map(item => ({
          uid: item.uid,
          scope: item.scope,
          title: item.title,
          score: item.score
        }));
        const resultPayload: Record<string, unknown> = {
          ok: true,
          results
        };
        const contextSnippet = results.length > 0
          ? [
            '### Agent Tool: Lorebook Search',
            ...results.map(item => `- [${item.scope}] uid ${item.uid}: ${item.title}`)
          ].join('\n')
          : '### Agent Tool: Lorebook Search\n- No matching entries found.';
        return {
          ok: true,
          payload: resultPayload,
          estimatedTokens: this.estimateTokens(JSON.stringify(resultPayload)),
          trace: `${toolName}: query="${query}" -> ${results.length} hit(s)`,
          isWrite: false,
          callSummary: `${toolName}: ${results.length} hit(s)`,
          contextSnippet
        };
      }

      if (toolName === 'get_lorebook_entry') {
        if (!allowLorebook) {
          return buildErrorResult(toolName, 'Lorebook tools are unavailable because no lorebooks are selected.');
        }
        const uid = Math.floor(Number(payload.uid));
        if (!Number.isFinite(uid)) {
          return buildErrorResult(toolName, 'uid is required');
        }
        const requestedScopeRaw = typeof payload.scope === 'string' ? normalizeScope(payload.scope) : '';
        const requestedScope = requestedScopeRaw && lorebookScopeSet.has(requestedScopeRaw) ? requestedScopeRaw : '';
        const contentChars = this.normalizeToolLimit(payload.contentChars, 1400, 120, 5000);
        const candidates: Array<{scope: string; entry: LoreBookEntry}> = [];
        const scopes = requestedScope ? [requestedScope] : [...lorebookEntriesByScope.keys()];
        for (const scope of scopes) {
          const entries = lorebookEntriesByScope.get(scope) ?? [];
          for (const entry of entries) {
            if (entry.uid === uid) {
              candidates.push({ scope, entry });
            }
          }
        }
        if (candidates.length === 0) {
          return buildErrorResult(toolName, `Entry uid ${uid} was not found in allowed lorebooks.`);
        }
        if (candidates.length > 1 && !requestedScope) {
          const scopes = uniqueStrings(candidates.map(item => item.scope));
          return buildErrorResult(toolName, `Entry uid ${uid} is ambiguous across lorebooks: ${scopes.join(', ')}. Specify lorebook.`);
        }
        const selected = candidates.sort((left, right) => left.scope.localeCompare(right.scope))[0];
        const snippet = selected.entry.content.length > contentChars
          ? `${selected.entry.content.slice(0, contentChars)}...`
          : selected.entry.content;
        const resultPayload: Record<string, unknown> = {
          ok: true,
          entry: {
            uid: selected.entry.uid,
            scope: selected.scope,
            title: selected.entry.comment,
            keywords: selected.entry.key,
            aliases: selected.entry.keysecondary,
            content: snippet
          }
        };
        const contextSnippet = [
          `### Agent Tool: Lorebook Entry [${selected.scope}]`,
          `Title: ${selected.entry.comment} (uid ${selected.entry.uid})`,
          `Keywords: ${selected.entry.key.join(', ') || '(none)'}`,
          '',
          snippet
        ].join('\n');
        return {
          ok: true,
          payload: resultPayload,
          estimatedTokens: this.estimateTokens(JSON.stringify(resultPayload)),
          trace: `${toolName}: uid ${selected.entry.uid} from ${selected.scope}`,
          isWrite: false,
          callSummary: `${toolName}: ${selected.entry.comment}`,
          contextSnippet
        };
      }

      if (toolName === 'search_story_notes') {
        if (!allowStoryNotes) {
          return buildErrorResult(toolName, 'No linked story/manual-selected notes are available for this chat turn.');
        }
        const query = typeof payload.query === 'string' ? payload.query.trim() : '';
        if (!query) {
          return buildErrorResult(toolName, 'query is required');
        }
        const tokens = this.tokenizeStoryChatToolQuery(query);
        const limit = this.normalizeToolLimit(payload.limit, 5, 1, 20);
        const rows: Array<{path: string; title: string; score: number; snippet: string}> = [];
        for (const file of allowedStoryFiles) {
          const body = await readStoryBody(file);
          const lowerBody = body.toLowerCase();
          const lowerTitle = file.basename.toLowerCase();
          let score = 0;
          for (const token of tokens) {
            if (lowerTitle.includes(token)) {
              score += 8;
            }
            if (lowerBody.includes(token)) {
              score += 2;
            }
          }
          if (score <= 0) {
            continue;
          }
          const snippet = body.slice(0, 240).trim();
          rows.push({
            path: normalizeVaultPath(file.path),
            title: file.basename,
            score,
            snippet
          });
        }
        rows.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
        const results = rows.slice(0, limit);
        const resultPayload: Record<string, unknown> = {
          ok: true,
          results: results.map(item => ({
            path: item.path,
            title: item.title,
            score: item.score
          }))
        };
        const contextSnippet = results.length > 0
          ? [
            '### Agent Tool: Story Note Search',
            ...results.map(item => `- ${item.title} (\`${item.path}\`)`),
            '',
            results[0].snippet
          ].join('\n')
          : '### Agent Tool: Story Note Search\n- No matching linked story notes found.';
        return {
          ok: true,
          payload: resultPayload,
          estimatedTokens: this.estimateTokens(JSON.stringify(resultPayload)),
          trace: `${toolName}: query="${query}" -> ${results.length} hit(s)`,
          isWrite: false,
          callSummary: `${toolName}: ${results.length} hit(s)`,
          contextSnippet
        };
      }

      if (toolName === 'read_story_note') {
        if (!allowStoryNotes) {
          return buildErrorResult(toolName, 'No linked story/manual-selected notes are available for this chat turn.');
        }
        const path = typeof payload.path === 'string' ? normalizeVaultPath(payload.path) : '';
        if (!path) {
          return buildErrorResult(toolName, 'path is required');
        }
        const file = allowedStoryFileMap.get(path);
        if (!file) {
          return buildErrorResult(toolName, `Path "${path}" is outside linked-story/manual-selected note access.`);
        }
        const maxChars = this.normalizeToolLimit(payload.maxChars, 1800, 200, 6000);
        const body = await readStoryBody(file);
        const content = body.length > maxChars ? `${body.slice(0, maxChars)}...` : body;
        const resultPayload: Record<string, unknown> = {
          ok: true,
          note: {
            path,
            title: file.basename,
            content
          }
        };
        const contextSnippet = [
          `### Agent Tool: Story Note \`${path}\``,
          '',
          content
        ].join('\n');
        return {
          ok: true,
          payload: resultPayload,
          estimatedTokens: this.estimateTokens(JSON.stringify(resultPayload)),
          trace: `${toolName}: read ${path}`,
          isWrite: false,
          callSummary: `${toolName}: ${file.basename}`,
          contextSnippet
        };
      }

      if (toolName === 'get_steering_scope') {
        const scope = resolveToolSteeringScope();
        if (!scope) {
          return buildErrorResult(
            toolName,
            'No active note-level author note is available for this turn.'
          );
        }
        const state = await this.loadStorySteeringScope(scope);
        const resultPayload: Record<string, unknown> = {
          ok: true,
          scope,
          state
        };
        const contextSnippet = [
          `### Agent Tool: Steering Scope ${scope.type}:${scope.key}`,
          '```json',
          JSON.stringify(state, null, 2),
          '```'
        ].join('\n');
        return {
          ok: true,
          payload: resultPayload,
          estimatedTokens: this.estimateTokens(JSON.stringify(resultPayload)),
          trace: `${toolName}: ${scope.type}:${scope.key}`,
          isWrite: false,
          callSummary: `${toolName}: ${scope.type}:${scope.key}`,
          contextSnippet
        };
      }

      if (toolName === 'update_steering_scope') {
        if (!allowWriteActions) {
          return buildErrorResult(toolName, 'Write tools are disabled for this turn.');
        }
        const scope = resolveToolSteeringScope();
        if (!scope) {
          return buildErrorResult(
            toolName,
            'No active note-level author note is available for this turn.'
          );
        }
        const rawState = payload.state && typeof payload.state === 'object' && !Array.isArray(payload.state)
          ? payload.state as Record<string, unknown>
          : null;
        if (!rawState) {
          return buildErrorResult(toolName, 'state object is required');
        }
        if (typeof rawState.authorNote !== 'string') {
          return buildErrorResult(toolName, 'state.authorNote must be a string');
        }
        const updated = normalizeStorySteeringState({
          authorNote: rawState.authorNote.trim()
        });
        const path = await this.saveStorySteeringScope(scope, updated);
        const resultPayload: Record<string, unknown> = {
          ok: true,
          scope,
          path,
          state: updated
        };
        return {
          ok: true,
          payload: resultPayload,
          estimatedTokens: this.estimateTokens(JSON.stringify(resultPayload)),
          trace: `${toolName}: updated ${scope.type}:${scope.key}`,
          isWrite: true,
          callSummary: `${toolName}: ${scope.type}:${scope.key}`,
          writeSummary: `updated steering ${scope.type}:${scope.key}`
        };
      }

      if (toolName === 'create_lorebook_entry_note') {
        if (!allowWriteActions) {
          return buildErrorResult(toolName, 'Write tools are disabled for this turn.');
        }
        if (!allowLorebook) {
          return buildErrorResult(toolName, 'No lorebooks are selected for this chat turn.');
        }
        const scope = typeof payload.scope === 'string' ? normalizeScope(payload.scope) : '';
        if (!scope || !lorebookScopeSet.has(scope)) {
          return buildErrorResult(toolName, `lorebook must be one of selected lorebooks: ${[...lorebookScopeSet].join(', ')}`);
        }
        const title = typeof payload.title === 'string' ? payload.title.trim() : '';
        const content = typeof payload.content === 'string' ? payload.content.trim() : '';
        if (!title || !content) {
          return buildErrorResult(toolName, 'title and content are required');
        }
        const keywords = this.parseToolStringArray(payload.keywords);
        const aliases = this.parseToolStringArray(payload.aliases);
        const summary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
        const retrieval = typeof payload.retrieval === 'string' ? payload.retrieval.trim().toLowerCase() : 'auto';
        const retrievalMode = (
          retrieval === 'world_info' ||
          retrieval === 'rag' ||
          retrieval === 'both' ||
          retrieval === 'none'
        ) ? retrieval : 'auto';
        const scopeFolder = scope
          .split('/')
          .map(part => this.sanitizeStoryChatToolFileStem(part))
          .join('/');
        const baseFolder = joinVaultPath('LoreVault', 'agentic-lorebook-notes', scopeFolder);
        const stem = this.sanitizeStoryChatToolFileStem(title);
        let filePath = joinVaultPath(baseFolder, `${stem}.md`);
        let suffix = 2;
        while (await this.app.vault.adapter.exists(filePath)) {
          filePath = joinVaultPath(baseFolder, `${stem}-${suffix}.md`);
          suffix += 1;
        }
        const escapeYaml = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const tagValue = `${this.settings.tagScoping.tagPrefix}/${scope}`;
        const lines: string[] = [
          '---',
          `title: "${escapeYaml(title)}"`,
          'tags:',
          `  - ${tagValue}`,
          `retrieval: ${retrievalMode}`
        ];
        if (keywords.length > 0) {
          lines.push('keywords:');
          for (const keyword of keywords) {
            lines.push(`  - "${escapeYaml(keyword)}"`);
          }
        }
        if (aliases.length > 0) {
          lines.push('aliases:');
          for (const alias of aliases) {
            lines.push(`  - "${escapeYaml(alias)}"`);
          }
        }
        if (summary) {
          lines.push(`summary: "${escapeYaml(summary)}"`);
        }
        lines.push('---', `# ${title}`, '', content, '');
        const markdown = lines.join('\n');
        await ensureParentVaultFolderForFile(this.app, filePath);
        await this.app.vault.adapter.write(filePath, markdown);
        const resultPayload: Record<string, unknown> = {
          ok: true,
          created: {
            path: filePath,
            scope,
            title
          }
        };
        return {
          ok: true,
          payload: resultPayload,
          estimatedTokens: this.estimateTokens(JSON.stringify(resultPayload)),
          trace: `${toolName}: created ${filePath}`,
          isWrite: true,
          callSummary: `${toolName}: ${title}`,
          writeSummary: `created lorebook note ${filePath}`
        };
      }

      return buildErrorResult(toolName, 'Unsupported tool name.');
    };

    const supportedNames = new Set<StoryChatAgentToolName>([
      'search_lorebook_entries',
      'get_lorebook_entry',
      'search_story_notes',
      'read_story_note',
      'get_steering_scope',
      'update_steering_scope',
      'create_lorebook_entry_note'
    ]);
    const messages: CompletionToolPlannerMessage[] = [
      {
        role: 'system',
        content: [
          'You are LoreVault Story Chat tool planner.',
          'Use tools to gather exact facts or update state only when needed.',
          'Respect hard boundaries:',
          '- lorebook tools: selected lorebooks only',
          '- story note tools: linked story/manual-selected note paths only',
          '- steering tools: active note-level author note only',
          'Never call write tools unless the user explicitly asks for updates/creation in this turn.',
          'When enough tool data is available, stop issuing tool calls.'
        ].join('\n')
      },
      {
        role: 'user',
        content: [
          `Latest user message:\n${args.userMessage.trim() || '(empty)'}`,
          '',
          `Recent chat history snippet:\n${args.historySnippet.trim() || '(none)'}`,
          '',
          `Selected lorebooks: ${lorebookScopes.length > 0 ? lorebookScopes.join(', ') : '(none)'}`,
          `Linked/manual note paths (${allowedStoryFiles.length}): ${
            allowedStoryFiles.slice(0, 8).map(file => file.path).join(', ') || '(none)'
          }`,
          `Active author note: ${allowSteering && activeSteeringScope ? `${activeSteeringScope.type}:${activeSteeringScope.key}` : '(none)'}`,
          `Write tools enabled for this turn: ${allowWriteActions ? 'yes' : 'no'}`
        ].join('\n')
      }
    ];

    const maxCalls = this.normalizeToolLimit(this.settings.storyChat.toolCalls.maxCallsPerTurn, 6, 1, 16);
    const maxResultTokens = this.normalizeToolLimit(this.settings.storyChat.toolCalls.maxResultTokensPerTurn, 2400, 128, 12000);
    const maxPlanningTimeMs = this.normalizeToolLimit(this.settings.storyChat.toolCalls.maxPlanningTimeMs, 10000, 500, 120000);
    const maxContextTokens = Math.max(64, Math.floor(args.tokenBudget));
    const startedAt = Date.now();
    let usedResultTokens = 0;
    let executedCalls = 0;
    let stopReason = 'completed';
    const trace: string[] = [];
    const callSummaries: string[] = [];
    const writeSummaries: string[] = [];
    const contextSections: string[] = [];

    while (executedCalls < maxCalls) {
      if (args.abortSignal?.aborted) {
        stopReason = 'aborted';
        break;
      }
      const elapsed = Date.now() - startedAt;
      const timeLeft = maxPlanningTimeMs - elapsed;
      if (timeLeft <= 0) {
        stopReason = 'time_limit';
        break;
      }

      let plannerResponse: { assistantText: string; toolCalls: Array<{id: string; name: string; argumentsJson: string}>; finishReason: string };
      try {
        plannerResponse = await planner({
          messages,
          toolDefinitions,
          timeoutMs: timeLeft,
          abortSignal: args.abortSignal
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        trace.push(`story_chat_tools: planner error (${message})`);
        stopReason = 'planner_error';
        break;
      }

      const toolCalls = plannerResponse.toolCalls
        .map(call => ({
          id: call.id,
          name: call.name as StoryChatAgentToolName,
          argumentsJson: call.argumentsJson
        }))
        .filter(call => supportedNames.has(call.name));
      if (toolCalls.length === 0) {
        trace.push(`story_chat_tools: planner stop (${plannerResponse.finishReason || 'no_tool_calls'})`);
        break;
      }

      messages.push({
        role: 'assistant',
        content: plannerResponse.assistantText || '',
        toolCalls: toolCalls.map(call => ({
          id: call.id,
          name: call.name,
          argumentsJson: call.argumentsJson
        }))
      });

      for (const call of toolCalls) {
        if (executedCalls >= maxCalls) {
          stopReason = 'call_limit';
          break;
        }
        const execution = await executeToolCall(call);
        const serializedPayload = JSON.stringify(execution.payload);
        const resultTokens = Math.max(execution.estimatedTokens, this.estimateTokens(serializedPayload));
        if (usedResultTokens + resultTokens > maxResultTokens) {
          stopReason = 'result_token_limit';
          break;
        }

        usedResultTokens += resultTokens;
        executedCalls += 1;
        trace.push(`${execution.trace} (~${resultTokens} tokens)`);
        callSummaries.push(execution.callSummary);
        if (execution.writeSummary) {
          writeSummaries.push(execution.writeSummary);
        }
        if (execution.contextSnippet) {
          contextSections.push(execution.contextSnippet);
        }

        messages.push({
          role: 'tool',
          content: serializedPayload,
          toolCallId: call.id,
          toolName: call.name
        });
      }

      if (stopReason === 'call_limit' || stopReason === 'result_token_limit') {
        break;
      }
    }

    let usedTokens = 0;
    const finalSections: string[] = [];
    for (const section of contextSections) {
      const sectionTokens = this.estimateTokens(section);
      if (usedTokens + sectionTokens > maxContextTokens) {
        break;
      }
      usedTokens += sectionTokens;
      finalSections.push(section);
    }

    const markdown = finalSections.join('\n\n---\n\n');
    trace.unshift(`story_chat_tools: ${executedCalls} call(s), stop=${stopReason}, write_tools=${allowWriteActions ? 'on' : 'off'}`);
    if (!writeIntent && this.settings.storyChat.toolCalls.allowWriteActions) {
      trace.push('story_chat_tools: write tools disabled (no explicit user write intent detected)');
    }

    return {
      markdown,
      usedTokens,
      trace,
      callSummaries,
      writeSummaries
    };
  }

  private buildKeywordGenerationPrompt(
    title: string,
    existingKeywords: string[],
    summaryText: string,
    bodyText: string
  ): {
    systemPrompt: string;
    userPrompt: string;
  } {
    const bodyLimit = Math.max(1200, Math.min(12000, this.settings.summaries.maxInputChars));
    const bodyExcerpt = bodyText.length > bodyLimit ? bodyText.slice(0, bodyLimit) : bodyText;
    return {
      systemPrompt: [
        'You generate retrieval keywords for lore wiki notes.',
        'Return JSON only: {"keywords":["..."]}.',
        'Generate 6-12 concise keywords or short phrases.',
        'Prioritize character names, places, factions, artifacts, events, and unique terminology.',
        'Avoid generic words.',
        'Do not include explanations or markdown.'
      ].join('\n'),
      userPrompt: [
        `<title>${title}</title>`,
        `<existing_keywords>${existingKeywords.join(', ') || '(none)'}</existing_keywords>`,
        '<summary>',
        summaryText || '(none)',
        '</summary>',
        '<body_excerpt>',
        bodyExcerpt,
        '</body_excerpt>'
      ].join('\n')
    };
  }

  private async generateKeywordCandidatesForFile(file: TFile): Promise<{
    keywords: string[];
    existingKeywords: string[];
  }> {
    const completionResolution = await this.resolveEffectiveCompletionForFile(file);
    const completion = completionResolution.completion;
    if (!completion.enabled) {
      throw new Error('Writing completion is disabled. Enable it under LoreVault Settings → Writing Completion.');
    }
    if (completion.provider !== 'ollama' && !completion.apiKey) {
      throw new Error('Missing completion API key. Configure it under LoreVault Settings → Writing Completion.');
    }

    const raw = await this.app.vault.cachedRead(file);
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    const existingKeywords = uniqueStrings(
      asStringArray(getFrontmatterValue(frontmatter, 'keywords', 'key'))
    );
    const frontmatterSummary = asString(getFrontmatterValue(frontmatter, 'summary')) ?? '';
    const bodyWithSummary = this.stripMarkdownForLlm(stripFrontmatter(raw));
    const resolvedSummary = resolveNoteSummary(bodyWithSummary, frontmatterSummary)?.text ?? '';
    const bodyText = stripSummarySectionFromBody(bodyWithSummary).trim();
    if (!bodyText) {
      throw new Error('Note body is empty.');
    }

    const prompt = this.buildKeywordGenerationPrompt(
      file.basename,
      existingKeywords,
      resolvedSummary,
      bodyText
    );
    let usageReport: CompletionUsageReport | null = null;
    const responseText = await requestStoryContinuation(completion, {
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      operationName: 'keywords_generate',
      onOperationLog: record => this.appendCompletionOperationLog(record, {
        costProfile: this.resolveEffectiveCostProfileLabel(completion.apiKey)
      }),
      onUsage: usage => {
        usageReport = usage;
      }
    });

    if (usageReport) {
      await this.recordCompletionUsage('keywords_generate', usageReport, {
        notePath: file.path,
        completionProfileSource: completionResolution.source,
        completionProfileId: completionResolution.presetId,
        completionProfileName: completionResolution.presetName,
        autoCostProfile: this.buildAutoCostProfileLabel(completionResolution.completion.apiKey)
      });
    }

    const suggested = parseGeneratedKeywords(responseText);
    const merged = uniqueStrings([...existingKeywords, ...suggested]);
    if (merged.length === 0) {
      throw new Error('Keyword generation returned no usable values.');
    }

    return {
      keywords: merged,
      existingKeywords
    };
  }

  private async applyKeywordsToNoteFrontmatter(file: TFile, keywords: string[]): Promise<void> {
    const raw = await this.app.vault.cachedRead(file);
    const next = upsertKeywordsFrontmatter(raw, keywords);
    if (next === raw) {
      return;
    }
    await this.app.vault.modify(file, next);
  }

  private async reviewKeywordCandidates(
    file: TFile,
    existingKeywords: string[],
    proposedKeywords: string[]
  ): Promise<KeywordReviewResult> {
    return new Promise(resolve => {
      const modal = new KeywordReviewModal(
        this.app,
        file.path,
        existingKeywords,
        proposedKeywords,
        resolve
      );
      modal.open();
    });
  }

  private async runKeywordGenerationForFiles(
    files: TFile[],
    missingPaths: string[]
  ): Promise<void> {
    if (this.generationInFlight) {
      throw new Error('Generation is already running. Wait for the current run to finish.');
    }

    const totalCount = files.length + missingPaths.length;
    if (totalCount === 0) {
      throw new Error('No notes selected for keyword generation.');
    }

    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount = missingPaths.length;
    let totalAddedKeywords = 0;
    const failureNotes: string[] = missingPaths.map(path => `not found: ${path}`);

    try {
      this.generationInFlight = true;
      this.generationAbortController = new AbortController();

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const progress = `${index + 1}/${totalCount}`;
        this.setGenerationStatus(`generating keywords ${progress}`, 'busy');

        try {
          const result = await this.generateKeywordCandidatesForFile(file);
          const review = await this.reviewKeywordCandidates(file, result.existingKeywords, result.keywords);
          if (review.action !== 'apply') {
            skippedCount += 1;
            continue;
          }

          await this.applyKeywordsToNoteFrontmatter(file, review.keywords);
          updatedCount += 1;
          totalAddedKeywords += Math.max(0, review.keywords.length - result.existingKeywords.length);
        } catch (error) {
          failedCount += 1;
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Keyword generation failed for ${file.path}:`, error);
          failureNotes.push(`${file.path}: ${message}`);
        }
      }
    } finally {
      this.generationInFlight = false;
      this.generationAbortController = null;
      this.setGenerationStatus('idle', 'idle');
    }

    if (updatedCount > 0) {
      this.liveContextIndex.requestFullRefresh();
      this.refreshManagerViews();
      this.refreshRoutingDebugViews();
      this.refreshQuerySimulationViews();
      this.refreshStoryChatViews();
    }

    if (totalCount === 1 && updatedCount === 1 && failedCount === 0 && skippedCount === 0) {
      const file = files[0];
      new Notice(`Updated keywords for ${file.basename} (+${totalAddedKeywords} added).`);
      return;
    }

    const summary = `Keyword generation finished: ${updatedCount} updated, ${skippedCount} skipped, ${failedCount} failed.`;
    if (failureNotes.length > 0) {
      const details = failureNotes.slice(0, 3).join('\n');
      new Notice(`${summary}\n${details}`);
    } else {
      new Notice(summary);
    }
  }

  public async generateKeywordsForNotePaths(notePaths: string[]): Promise<void> {
    const normalizedPaths = uniqueStrings(
      notePaths
        .map(path => (path ?? '').toString().trim())
        .filter(Boolean)
    );

    const files: TFile[] = [];
    const missingPaths: string[] = [];
    for (const notePath of normalizedPaths) {
      const abstract = this.app.vault.getAbstractFileByPath(notePath);
      if (abstract instanceof TFile) {
        files.push(abstract);
      } else {
        missingPaths.push(notePath);
      }
    }

    await this.runKeywordGenerationForFiles(files, missingPaths);
  }

  public async generateKeywordsForNotePath(notePath: string): Promise<void> {
    await this.generateKeywordsForNotePaths([notePath]);
  }

  private async generateKeywordsForNote(file: TFile): Promise<void> {
    await this.runKeywordGenerationForFiles([file], []);
  }

  private async generateKeywordsForActiveNote(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile)) {
      new Notice('No active markdown note.');
      return;
    }

    try {
      await this.generateKeywordsForNote(activeFile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Keyword generation failed:', error);
      new Notice(`Keyword generation failed: ${message}`);
    }
  }

  private buildSummaryPrompt(mode: GeneratedSummaryMode, title: string, bodyText: string): {
    systemPrompt: string;
    userPrompt: string;
  } {
    const maxChars = this.settings.summaries.maxInputChars;
    const summaryCap = Math.max(0, Math.floor(this.settings.summaries.maxSummaryChars));
    const truncated = bodyText.length > maxChars ? bodyText.slice(0, maxChars) : bodyText;
    const systemPrompt = mode === 'chapter'
      ? [
        'You write chapter continuity summaries for a fiction writing assistant.',
        'Focus on durable facts, state changes, consequences, unresolved tensions, and near-term setup.',
        'Do not include headings or bullet points.',
        'Avoid reasoning preambles, analysis narration, and numbered planning.',
        'Start directly with summary content.',
        'Multiple paragraphs are allowed and encouraged when useful.'
      ].join('\n')
      : [
        'You write concise canonical summaries for a fiction writing assistant.',
        'Output one plain-text paragraph only.',
        ...(summaryCap > 0 ? [`Keep summary under ${summaryCap} characters.`] : []),
        'Focus on durable facts, names, states, and consequences.',
        'Do not include headings, markdown, or bullet points.',
        'Do not include reasoning, analysis, or preambles like "I need to..." or numbered planning.',
        'Start directly with the factual summary content.',
        'Bad output example: "I need to create a summary. 1. ... 2. ..."',
        'Good output example: "Baalthasar is a dark elven Archmage whose unmatched mind magic and arcana priorities define his strategic role."',
        'Summarize this lore entry for compact world_info retrieval.'
      ].join('\n');

    const userPrompt = [
      `Title: ${title}`,
      '',
      '<source_content>',
      truncated,
      '</source_content>'
    ].join('\n');

    return {
      systemPrompt,
      userPrompt
    };
  }

  private async generateSummaryCandidate(
    file: TFile,
    mode: GeneratedSummaryMode
  ): Promise<{
    normalizedSummary: string;
    existingSummary: string;
  }> {
    const completionResolution = await this.resolveEffectiveCompletionForFile(file);
    const completion = completionResolution.completion;
    if (!completion.enabled) {
      throw new Error('Writing completion is disabled. Enable it under LoreVault Settings → Writing Completion.');
    }
    if (completion.provider !== 'ollama' && !completion.apiKey) {
      throw new Error('Missing completion API key. Configure it under LoreVault Settings → Writing Completion.');
    }

    const raw = await this.app.vault.cachedRead(file);
    const bodyWithSummary = this.stripMarkdownForLlm(stripFrontmatter(raw));
    const bodyText = stripSummarySectionFromBody(bodyWithSummary);
    if (!bodyText) {
      throw new Error('Note body is empty.');
    }

    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    const frontmatterSummary = asString(getFrontmatterValue(frontmatter, 'summary')) ?? '';
    const existingSummary = resolveNoteSummary(bodyWithSummary, frontmatterSummary);

    const prompt = this.buildSummaryPrompt(mode, file.basename, bodyText);
    let usageReport: CompletionUsageReport | null = null;
    const rawSummary = await requestStoryContinuation(completion, {
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      operationName: mode === 'chapter' ? 'summary_chapter' : 'summary_world_info',
      onOperationLog: record => this.appendCompletionOperationLog(record, {
        costProfile: this.resolveEffectiveCostProfileLabel(completion.apiKey)
      }),
      onUsage: usage => {
        usageReport = usage;
      }
    });
    if (usageReport) {
      await this.recordCompletionUsage(
        mode === 'chapter' ? 'summary_chapter' : 'summary_world_info',
        usageReport,
        {
          notePath: file.path,
          completionProfileSource: completionResolution.source,
          completionProfileId: completionResolution.presetId,
          completionProfileName: completionResolution.presetName,
          autoCostProfile: this.buildAutoCostProfileLabel(completionResolution.completion.apiKey)
        }
      );
    }

    const normalizedSummary = normalizeGeneratedSummaryText(
      rawSummary,
      mode === 'chapter' ? undefined : this.settings.summaries.maxSummaryChars,
      { allowParagraphs: mode === 'chapter' }
    );
    if (!normalizedSummary) {
      throw new Error('Summary model returned empty text.');
    }

    return {
      normalizedSummary,
      existingSummary: existingSummary?.text ?? ''
    };
  }

  private async reviewSummary(
    mode: GeneratedSummaryMode,
    file: TFile,
    proposedSummary: string,
    existingSummary: string
  ): Promise<SummaryReviewResult> {
    return new Promise(resolve => {
      const modal = new SummaryReviewModal(
        this.app,
        mode,
        file.path,
        proposedSummary,
        existingSummary,
        result => resolve(result)
      );
      modal.open();
    });
  }

  private async applySummaryToNoteSection(file: TFile, summary: string, mode: GeneratedSummaryMode): Promise<void> {
    const raw = await this.app.vault.cachedRead(file);
    const next = upsertSummarySectionInMarkdown(raw, summary, {
      allowMultiParagraph: mode === 'chapter'
    });
    await this.app.vault.modify(file, next);
  }

  private async generateSummaryForFile(
    file: TFile,
    mode: GeneratedSummaryMode
  ): Promise<'saved' | 'cancelled'> {
    const candidate = await this.generateSummaryCandidate(file, mode);
    const review = await this.reviewSummary(
      mode,
      file,
      candidate.normalizedSummary,
      candidate.existingSummary
    );
    if (review.action === 'cancel') {
      return 'cancelled';
    }

    await this.applySummaryToNoteSection(file, review.summaryText, mode);

    this.liveContextIndex.requestFullRefresh();
    this.chapterSummaryStore.invalidatePath(file.path);
    this.refreshManagerViews();
    this.refreshRoutingDebugViews();
    this.refreshQuerySimulationViews();
    this.refreshStoryChatViews();

    return 'saved';
  }

  private async generateSummaryForNote(file: TFile, mode: GeneratedSummaryMode): Promise<void> {
    try {
      const result = await this.generateSummaryForFile(file, mode);
      if (result !== 'saved') {
        return;
      }
      const label = mode === 'chapter' ? 'chapter' : 'world_info';
      new Notice(`Saved ${label} summary for ${file.basename}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Summary generation failed:', error);
      new Notice(`Summary generation failed: ${message}`);
    }
  }

  public async generateSummaryForActiveNote(mode: GeneratedSummaryMode, file?: TFile | null): Promise<void> {
    const activeFile = file ?? this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile)) {
      new Notice('No active markdown note.');
      return;
    }

    await this.generateSummaryForNote(activeFile, mode);
  }

  private async hasPersistedSummary(file: TFile): Promise<boolean> {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    const frontmatterSummary = asString(getFrontmatterValue(frontmatter, 'summary'));
    const raw = await this.app.vault.cachedRead(file);
    const bodyWithSummary = this.stripMarkdownForLlm(stripFrontmatter(raw));
    return Boolean(resolveNoteSummary(bodyWithSummary, frontmatterSummary));
  }

  private async generateWorldInfoSummariesForActiveScope(): Promise<void> {
    const scope = this.resolveBuildScopeFromContext();
    if (!scope) {
      new Notice('No active lorebook found for world_info summary generation.');
      return;
    }

    const notes = this.getCachedLorebookMetadata();
    const summaries = buildScopeSummaries(notes, this.settings, scope);
    const summary = summaries[0];
    if (!summary) {
      new Notice('No lorebook summary available.');
      return;
    }

    const candidateFiles = summary.notes
      .filter(note => note.reason === 'included' && note.includeWorldInfo)
      .map(note => this.app.vault.getAbstractFileByPath(note.path))
      .filter((file): file is TFile => file instanceof TFile)
      .sort((left, right) => left.path.localeCompare(right.path));

    const targets: TFile[] = [];
    for (const file of candidateFiles) {
      const hasSummary = await this.hasPersistedSummary(file);
      if (!hasSummary) {
        targets.push(file);
      }
    }

    if (targets.length === 0) {
      new Notice('No world_info notes without summary found in the active lorebook.');
      return;
    }

    let savedCount = 0;
    for (const file of targets) {
      try {
        const result = await this.generateSummaryForFile(file, 'world_info');
        if (result === 'cancelled') {
          break;
        }
        savedCount += 1;
      } catch (error) {
        console.error(`World info summary generation failed for ${file.path}:`, error);
      }
    }

    new Notice(`World_info summary run complete: saved ${savedCount}/${targets.length}.`);
  }

  private async generateChapterSummariesForCurrentStory(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile)) {
      new Notice('No active markdown note.');
      return;
    }

    const nodes = this.collectStoryThreadNodes();
    const resolution = resolveStoryThreadLineage(nodes, activeFile.path);
    if (!resolution) {
      new Notice('Active note is not in a resolvable story thread.');
      return;
    }

    const candidateFiles = resolution.orderedPaths
      .map(pathValue => this.app.vault.getAbstractFileByPath(pathValue))
      .filter((file): file is TFile => file instanceof TFile)
      .sort((left, right) => left.path.localeCompare(right.path));

    const targets: TFile[] = [];
    for (const file of candidateFiles) {
      const hasSummary = await this.hasPersistedSummary(file);
      if (!hasSummary) {
        targets.push(file);
      }
    }

    if (targets.length === 0) {
      new Notice('No chapter notes without summary found for this story thread.');
      return;
    }

    let savedCount = 0;
    for (const file of targets) {
      try {
        const result = await this.generateSummaryForFile(file, 'chapter');
        if (result === 'cancelled') {
          break;
        }
        savedCount += 1;
      } catch (error) {
        console.error(`Chapter summary generation failed for ${file.path}:`, error);
      }
    }

    new Notice(`Chapter summary run complete: saved ${savedCount}/${targets.length}.`);
  }

  public async runStoryChatTurn(request: StoryChatTurnRequest): Promise<StoryChatTurnResult> {
    if (this.generationInFlight) {
      throw new Error('LoreVault generation is already running.');
    }

    const activeStoryFile = this.app.workspace.getActiveFile();
    const completionResolution = this.resolveEffectiveCompletionForStoryChat(request.completionPresetId ?? '');
    const completion = completionResolution.completion;
    if (!completion.enabled) {
      throw new Error('Writing completion is disabled. Enable it under LoreVault Settings → Writing Completion.');
    }
    if (completion.provider !== 'ollama' && !completion.apiKey) {
      throw new Error('Missing completion API key. Configure it under LoreVault Settings → Writing Completion.');
    }

    const requestedScopes = request.selectedScopes.length > 0
      ? request.selectedScopes.map(scope => normalizeScope(scope)).filter(Boolean)
      : [];
    const steeringScopeRefs = normalizeStoryChatSteeringRefs(request.steeringScopeRefs ?? []);
    const noteContextRefs = request.noteContextRefs
      .map(ref => this.normalizeNoteContextRef(ref))
      .filter((ref, index, array): ref is string => Boolean(ref) && array.indexOf(ref) === index);
    const scopedSteering = await this.storySteeringStore.resolveEffectiveStateForFile(activeStoryFile);
    const steeringSourceResolution = await this.resolveStoryChatSteeringSources(steeringScopeRefs);
    const mergedScopedSteering = mergeStorySteeringStates([
      scopedSteering.merged,
      steeringSourceResolution.mergedState
    ]);
    const selectedScopes = requestedScopes.length > 0
      ? requestedScopes
      : (await this.resolveStoryScopeSelection(activeStoryFile)).scopes;
    const scopeLabels = selectedScopes.length > 0 ? selectedScopes : ['(none)'];
    const continuityPlotThreads = this.mergeSteeringList(
      this.normalizeContinuityItems(request.continuityPlotThreads ?? [])
    );
    const continuityOpenLoops = this.mergeSteeringList(
      this.normalizeContinuityItems(request.continuityOpenLoops ?? [])
    );
    const continuityCanonDeltas = this.mergeSteeringList(
      this.normalizeContinuityItems(request.continuityCanonDeltas ?? [])
    );
    const continuitySelection: ContinuitySelection = {
      includePlotThreads: request.continuitySelection?.includePlotThreads !== false,
      includeOpenLoops: request.continuitySelection?.includeOpenLoops !== false,
      includeCanonDeltas: request.continuitySelection?.includeCanonDeltas !== false
    };
    const continuityMarkdown = this.buildContinuityMarkdown({
      plotThreads: continuityPlotThreads,
      openLoops: continuityOpenLoops,
      canonDeltas: continuityCanonDeltas,
      selection: continuitySelection
    });
    const maxInputTokens = Math.max(512, completion.contextWindowTokens - completion.maxOutputTokens);
    const continuityAggressiveness = this.resolveContinuityAggressiveness();
    const steeringSections = this.createSteeringSections({
      maxInputTokens,
      authorNote: mergedScopedSteering.authorNote
    });
    const systemSteeringMarkdown = this.renderSteeringPlacement(steeringSections, 'system');
    const preHistorySteeringMarkdown = this.renderSteeringPlacement(steeringSections, 'pre_history');
    const preResponseSteeringMarkdown = this.renderSteeringPlacement(steeringSections, 'pre_response');
    const effectiveSystemPrompt = systemSteeringMarkdown
      ? [
        completion.systemPrompt,
        '',
        STEERING_GUIDANCE_SYSTEM_PROMPT,
        '',
        '<lorevault_steering_system>',
        systemSteeringMarkdown,
        '</lorevault_steering_system>'
      ].join('\n')
      : [completion.systemPrompt, '', STEERING_GUIDANCE_SYSTEM_PROMPT].join('\n');
    const instructionOverhead = this.estimateTokens(effectiveSystemPrompt) + 180;
    const steeringSystemTokens = steeringSections
      .filter(section => section.placement === 'system')
      .reduce((sum, section) => sum + section.usedTokens, 0);
    const steeringPreHistoryTokens = steeringSections
      .filter(section => section.placement === 'pre_history')
      .reduce((sum, section) => sum + section.usedTokens, 0);
    const steeringPreResponseTokens = steeringSections
      .filter(section => section.placement === 'pre_response')
      .reduce((sum, section) => sum + section.usedTokens, 0);
    const steeringNonSystemTokens = steeringPreHistoryTokens + steeringPreResponseTokens;
    const historyTokenBudget = Math.max(900, Math.min(24000, Math.floor(maxInputTokens * 0.22)));
    const historyMessageCap = Math.max(8, Math.min(this.settings.storyChat.maxMessages, Math.floor(maxInputTokens / 1800)));
    const chatHistory = this.buildChatHistorySnippet(request.history, historyTokenBudget, historyMessageCap);
    const chatHistoryTokens = chatHistory ? this.estimateTokens(chatHistory) : 0;
    const querySeed = [request.userMessage, chatHistory].filter(Boolean).join('\n');
    const manualShare = request.useLorebookContext && selectedScopes.length > 0 ? 0.35 : 0.7;
    const manualContextBudget = Math.max(128, Math.min(64000, Math.floor(maxInputTokens * manualShare)));
    const manualContext = this.trimTextToTokenBudget(request.manualContext.trim(), manualContextBudget);
    const manualContextTokens = manualContext ? this.estimateTokens(manualContext) : 0;
    const remainingAfterPrompt = Math.max(
      64,
      maxInputTokens - completion.promptReserveTokens - instructionOverhead - steeringNonSystemTokens - manualContextTokens - chatHistoryTokens
    );

    const useSpecificNotesContext = noteContextRefs.length > 0;
    const useLorebookContext = request.useLorebookContext && selectedScopes.length > 0;
    let noteContextBudget = 0;
    if (useSpecificNotesContext) {
      noteContextBudget = useLorebookContext
        ? Math.max(96, Math.floor(remainingAfterPrompt * 0.4))
        : remainingAfterPrompt;
      noteContextBudget = Math.min(noteContextBudget, remainingAfterPrompt);
    }

    const noteContextResult = await this.buildSpecificNotesContext(noteContextRefs, noteContextBudget);
    const specificNotesContextMarkdown = noteContextResult.markdown;
    const specificNotesTokens = noteContextResult.usedTokens;
    const specificNotePaths = noteContextResult.includedPaths;
    const unresolvedNoteRefs = noteContextResult.unresolvedRefs;

    let chapterMemoryMarkdown = '';
    let chapterMemoryTokens = 0;
    let chapterMemoryBudget = 0;
    let chapterMemoryItems: string[] = [];
    let chapterMemoryLayerTrace: string[] = [];
    if (activeStoryFile) {
      const remainingAfterSpecificNotes = Math.max(0, remainingAfterPrompt - specificNotesTokens);
      if (remainingAfterSpecificNotes > 96) {
        const chapterMemoryCapTokens = continuityAggressiveness === 'aggressive'
          ? Math.max(
            1200,
            Math.min(18000, Math.floor(maxInputTokens * 0.24))
          )
          : Math.max(
            900,
            Math.min(7000, Math.floor(maxInputTokens * 0.20))
          );
        const chapterMemoryShare = continuityAggressiveness === 'aggressive'
          ? (useLorebookContext
            ? (maxInputTokens >= 120000 ? 0.45 : 0.38)
            : (maxInputTokens >= 120000 ? 0.72 : 0.62))
          : (useLorebookContext
            ? (maxInputTokens >= 120000 ? 0.30 : 0.25)
            : (maxInputTokens >= 120000 ? 0.55 : 0.45));
        const minChapterMemoryBudget = continuityAggressiveness === 'aggressive' ? 128 : 96;
        chapterMemoryBudget = Math.min(
          chapterMemoryCapTokens,
          Math.max(minChapterMemoryBudget, Math.floor(remainingAfterSpecificNotes * chapterMemoryShare))
        );
        const chapterMemory = await this.buildChapterMemoryContext(
          activeStoryFile,
          chapterMemoryBudget,
          continuityAggressiveness,
          querySeed || request.userMessage
        );
        chapterMemoryMarkdown = chapterMemory.markdown;
        chapterMemoryTokens = chapterMemory.usedTokens;
        chapterMemoryItems = chapterMemory.items;
        chapterMemoryLayerTrace = chapterMemory.layerTrace;
      }
    }

    let availableForLorebookContext = remainingAfterPrompt - specificNotesTokens - chapterMemoryTokens;
    if (availableForLorebookContext < 64) {
      availableForLorebookContext = 64;
    }

    let contexts: AssembledContext[] = [];
    let usedContextTokens = 0;
    let lorebookContextBudget = 0;
    if (useLorebookContext) {
      const sharedQueryEmbedding = await this.liveContextIndex.computeQueryEmbedding(querySeed || request.userMessage);
      let contextBudget = Math.max(
        64,
        Math.min(
          availableForLorebookContext,
          Math.max(this.settings.defaultLoreBook.tokenBudget, Math.floor(availableForLorebookContext * 0.9))
        )
      );
      lorebookContextBudget = contextBudget;

      for (let attempt = 0; attempt < 4; attempt += 1) {
        contexts = [];
        const perScopeBudget = Math.max(64, Math.floor(contextBudget / selectedScopes.length));
        const perScopeWorldInfoLimit = Math.max(8, Math.min(80, Math.floor(perScopeBudget / 900)));
        const perScopeRagLimit = Math.max(6, Math.min(48, Math.floor(perScopeBudget / 1800)));
        contexts = await Promise.all(selectedScopes.map(scope => this.liveContextIndex.query({
          queryText: querySeed || request.userMessage,
          queryEmbedding: sharedQueryEmbedding,
          tokenBudget: perScopeBudget,
          maxWorldInfoEntries: perScopeWorldInfoLimit,
          maxRagDocuments: perScopeRagLimit
        }, scope)));

        usedContextTokens = contexts.reduce((sum, item) => sum + item.usedTokens, 0);
        const remaining = availableForLorebookContext - usedContextTokens;
        if (remaining >= 0 || contextBudget <= 64) {
          break;
        }
        const nextBudget = Math.max(64, contextBudget + remaining - 48);
        if (nextBudget === contextBudget) {
          break;
        }
        contextBudget = nextBudget;
        lorebookContextBudget = contextBudget;
      }
    }

    const contextMarkdown = contexts.map(context => context.markdown).join('\n\n---\n\n');
    let toolContextMarkdown = '';
    let toolContextBudget = 0;
    let toolContextItems: string[] = [];
    let toolContextLayerTrace: string[] = [];
    let toolContextTokens = 0;
    if (useLorebookContext) {
      const remainingAfterLorebook = Math.max(0, availableForLorebookContext - usedContextTokens);
      if (remainingAfterLorebook > 96) {
        toolContextBudget = Math.min(700, Math.max(96, Math.floor(remainingAfterLorebook * 0.5)));
        const toolContext = await this.buildToolHooksContext(
          querySeed || request.userMessage,
          selectedScopes,
          toolContextBudget,
          completion
        );
        toolContextMarkdown = toolContext.markdown;
        toolContextTokens = toolContext.usedTokens;
        toolContextItems = toolContext.selectedItems;
        toolContextLayerTrace = toolContext.layerTrace;
      }
    }
    let chatAgentToolContextMarkdown = '';
    let chatAgentToolContextBudget = 0;
    let chatAgentToolContextTrace: string[] = [];
    let chatAgentToolCallSummaries: string[] = [];
    let chatAgentToolWriteSummaries: string[] = [];
    const remainingAfterToolRetrieval = Math.max(
      0,
      availableForLorebookContext - usedContextTokens - toolContextTokens
    );
    if (remainingAfterToolRetrieval > 96) {
      chatAgentToolContextBudget = Math.min(
        900,
        Math.max(96, Math.floor(remainingAfterToolRetrieval * 0.55))
      );
      const chatAgentTools = await this.runStoryChatAgentTools({
        userMessage: request.userMessage,
        historySnippet: chatHistory,
        selectedScopes,
        useLorebookContext,
        specificNotePaths,
        activeStoryFile,
        tokenBudget: chatAgentToolContextBudget,
        completion
      });
      chatAgentToolContextMarkdown = chatAgentTools.markdown;
      chatAgentToolContextTrace = chatAgentTools.trace;
      chatAgentToolCallSummaries = chatAgentTools.callSummaries;
      chatAgentToolWriteSummaries = chatAgentTools.writeSummaries;
    }
    const worldInfoItems = contexts
      .flatMap(context => context.worldInfo.slice(0, 6).map(item => item.entry.comment))
      .slice(0, 12);
    const ragItems = contexts
      .flatMap(context => context.rag.slice(0, 6).map(item => item.document.title))
      .slice(0, 12);
    const totalWorldInfoCount = contexts.reduce((sum, context) => sum + context.worldInfo.length, 0);
    const totalRagCount = contexts.reduce((sum, context) => sum + context.rag.length, 0);
    const ragPolicies = [...new Set(contexts.map(context => context.explainability.rag.policy))];
    const ragEnabledScopes = contexts.filter(context => context.explainability.rag.enabled).length;
    const renderedChatHistory = this.renderInlineLoreDirectivesForLlm(chatHistory);
    const renderedManualContext = this.renderInlineLoreDirectivesForLlm(manualContext);
    const renderedSpecificNotes = this.renderInlineLoreDirectivesForLlm(specificNotesContextMarkdown);
    const renderedChapterMemory = this.renderInlineLoreDirectivesForLlm(chapterMemoryMarkdown);
    const renderedAgentToolContext = this.renderInlineLoreDirectivesForLlm(chatAgentToolContextMarkdown);
    const renderedToolContext = this.renderInlineLoreDirectivesForLlm(toolContextMarkdown);
    const renderedLoreContext = this.renderInlineLoreDirectivesForLlm(contextMarkdown);
    const resolvedInlineDirectiveItems = uniqueStrings([
      ...renderedChatHistory.directives,
      ...renderedManualContext.directives,
      ...renderedSpecificNotes.directives,
      ...renderedChapterMemory.directives,
      ...renderedAgentToolContext.directives,
      ...renderedToolContext.directives,
      ...renderedLoreContext.directives
    ]).slice(0, 40);
    const inlineDirectiveTokens = resolvedInlineDirectiveItems.reduce((sum, directive) => (
      sum + this.estimateTokens(directive)
    ), 0);
    const reservedByPlacement = (placement: PromptLayerPlacement): number => steeringSections
      .filter(section => section.placement === placement)
      .reduce((sum, section) => sum + section.reservedTokens, 0);
    const trimmedByPlacement = (placement: PromptLayerPlacement): boolean => steeringSections
      .some(section => section.placement === placement && section.trimmed);
    const preHistorySteeringReserved = reservedByPlacement('pre_history');
    const preResponseSteeringReserved = reservedByPlacement('pre_response');
    const inlineDirectiveDiagnostics = resolvedInlineDirectiveItems.length > 0
      ? [`${resolvedInlineDirectiveItems.length} inlined`, `~${inlineDirectiveTokens} tokens`]
      : ['none'];
    const continuityBudget = Math.max(96, Math.min(12000, Math.floor(maxInputTokens * 0.12)));

    const promptSegments: PromptSegment[] = [
      {
        key: 'pre_history_steering',
        label: 'Steering (pre-history)',
        content: preHistorySteeringMarkdown,
        reservedTokens: preHistorySteeringReserved,
        placement: 'pre_history',
        trimMode: 'head',
        minTokens: 0
      },
      {
        key: 'chat_history',
        label: 'Chat History',
        content: renderedChatHistory.text,
        reservedTokens: historyTokenBudget,
        placement: 'pre_history',
        trimMode: 'tail',
        minTokens: 0
      },
      {
        key: 'manual_context',
        label: 'Manual Context',
        content: renderedManualContext.text,
        reservedTokens: manualContextBudget,
        placement: 'pre_response',
        trimMode: 'tail',
        minTokens: 0
      },
      {
        key: 'continuity_state',
        label: 'Continuity State',
        content: continuityMarkdown,
        reservedTokens: continuityBudget,
        placement: 'pre_response',
        trimMode: 'head',
        minTokens: 0
      },
      {
        key: 'specific_notes_context',
        label: 'Specific Notes',
        content: renderedSpecificNotes.text,
        reservedTokens: Math.max(0, noteContextBudget),
        placement: 'pre_response',
        trimMode: 'head',
        minTokens: 0
      },
      {
        key: 'chapter_memory_context',
        label: 'Chapter Memory',
        content: renderedChapterMemory.text,
        reservedTokens: Math.max(0, chapterMemoryBudget),
        placement: 'pre_response',
        trimMode: 'head',
        minTokens: 0
      },
      {
        key: 'agent_tool_context',
        label: 'Agent Tool Context',
        content: renderedAgentToolContext.text,
        reservedTokens: Math.max(0, chatAgentToolContextBudget),
        placement: 'pre_response',
        trimMode: 'head',
        minTokens: 0
      },
      {
        key: 'tool_retrieval_context',
        label: 'Tool Retrieval',
        content: renderedToolContext.text,
        reservedTokens: Math.max(0, toolContextBudget),
        placement: 'pre_response',
        trimMode: 'head',
        minTokens: 0
      },
      {
        key: 'lorebook_context',
        label: 'Lorebook Context',
        content: renderedLoreContext.text,
        reservedTokens: Math.max(0, lorebookContextBudget),
        placement: 'pre_response',
        trimMode: 'head',
        minTokens: 0
      },
      {
        key: 'pre_response_steering',
        label: 'Steering (pre-response)',
        content: preResponseSteeringMarkdown,
        reservedTokens: preResponseSteeringReserved,
        placement: 'pre_response',
        trimMode: 'head',
        minTokens: 0
      },
      {
        key: 'user_message',
        label: 'User Message',
        content: request.userMessage.trim(),
        reservedTokens: Math.max(32, this.estimateTokens(request.userMessage.trim())),
        placement: 'pre_response',
        trimMode: 'head',
        minTokens: Math.max(16, Math.floor(this.estimateTokens(request.userMessage.trim()) * 0.55)),
        locked: true
      }
    ];
    const userPromptBudget = Math.max(
      256,
      maxInputTokens - completion.promptReserveTokens - instructionOverhead
    );
    const overflowResult = applyDeterministicOverflow(
      promptSegments,
      userPromptBudget,
      [
        'agent_tool_context',
        'tool_retrieval_context',
        'lorebook_context',
        'chapter_memory_context',
        'specific_notes_context',
        'manual_context',
        'continuity_state',
        'chat_history',
        'pre_response_steering',
        'pre_history_steering'
      ]
    );
    const promptSegmentsByKey = new Map(overflowResult.segments.map(segment => [segment.key, segment]));
    const chatHistoryForPrompt = promptSegmentsByKey.get('chat_history')?.content ?? '';
    const manualContextForPrompt = promptSegmentsByKey.get('manual_context')?.content ?? '';
    const continuityForPrompt = promptSegmentsByKey.get('continuity_state')?.content ?? '';
    const specificNotesForPrompt = promptSegmentsByKey.get('specific_notes_context')?.content ?? '';
    const chapterMemoryForPrompt = promptSegmentsByKey.get('chapter_memory_context')?.content ?? '';
    const chatAgentToolContextForPrompt = promptSegmentsByKey.get('agent_tool_context')?.content ?? '';
    const toolContextForPrompt = promptSegmentsByKey.get('tool_retrieval_context')?.content ?? '';
    const loreContextForPrompt = promptSegmentsByKey.get('lorebook_context')?.content ?? '';
    const preHistorySteeringForPrompt = promptSegmentsByKey.get('pre_history_steering')?.content ?? '';
    const preResponseSteeringForPrompt = promptSegmentsByKey.get('pre_response_steering')?.content ?? '';
    const userMessageForPrompt = promptSegmentsByKey.get('user_message')?.content ?? request.userMessage.trim();
    const chatHistoryPromptTokens = estimateTextTokens(chatHistoryForPrompt);
    const manualContextPromptTokens = estimateTextTokens(manualContextForPrompt);
    const continuityPromptTokens = estimateTextTokens(continuityForPrompt);
    const specificNotesPromptTokens = estimateTextTokens(specificNotesForPrompt);
    const chapterMemoryPromptTokens = estimateTextTokens(chapterMemoryForPrompt);
    const chatAgentToolContextPromptTokens = estimateTextTokens(chatAgentToolContextForPrompt);
    const toolContextPromptTokens = estimateTextTokens(toolContextForPrompt);
    const loreContextPromptTokens = estimateTextTokens(loreContextForPrompt);
    const steeringPreHistoryPromptTokens = estimateTextTokens(preHistorySteeringForPrompt);
    const steeringPreResponsePromptTokens = estimateTextTokens(preResponseSteeringForPrompt);
    const steeringNonSystemPromptTokens = steeringPreHistoryPromptTokens + steeringPreResponsePromptTokens;
    const combinedLoreContextMarkdown = [loreContextForPrompt, chatAgentToolContextForPrompt, toolContextForPrompt]
      .filter(section => section.trim().length > 0)
      .join('\n\n---\n\n');
    const contextTokensUsed = loreContextPromptTokens
      + chatAgentToolContextPromptTokens
      + toolContextPromptTokens
      + manualContextPromptTokens
      + continuityPromptTokens
      + specificNotesPromptTokens
      + chapterMemoryPromptTokens
      + chatHistoryPromptTokens
      + steeringNonSystemPromptTokens;
    const contextRemainingTokens = Math.max(
      0,
      maxInputTokens - completion.promptReserveTokens - instructionOverhead - contextTokensUsed
    );

    const layerTrace: string[] = [];
    layerTrace.push(`steering(system): ~${steeringSystemTokens} tokens`);
    layerTrace.push(`steering(pre_history): ~${steeringPreHistoryPromptTokens} tokens`);
    layerTrace.push(`steering(pre_response): ~${steeringPreResponsePromptTokens} tokens`);
    layerTrace.push(`inline_directives: ${inlineDirectiveDiagnostics.join(', ')}`);
    layerTrace.push(`local_window: chat_history ~${chatHistoryPromptTokens} tokens`);
    if (manualContextPromptTokens > 0) {
      layerTrace.push(`manual_context: ~${manualContextPromptTokens} tokens`);
    }
    if (continuityPromptTokens > 0) {
      layerTrace.push(`continuity_state: threads ${continuitySelection.includePlotThreads ? continuityPlotThreads.length : 0}, open_loops ${continuitySelection.includeOpenLoops ? continuityOpenLoops.length : 0}, canon_deltas ${continuitySelection.includeCanonDeltas ? continuityCanonDeltas.length : 0}, ~${continuityPromptTokens} tokens`);
    }
    if (specificNotesPromptTokens > 0) {
      layerTrace.push(`specific_notes: ${specificNotePaths.length} notes, ~${specificNotesPromptTokens} tokens`);
    }
    if (chapterMemoryPromptTokens > 0) {
      layerTrace.push(`chapter_memory: ${chapterMemoryItems.length} chapter memory sections, ~${chapterMemoryPromptTokens} tokens`);
      layerTrace.push(...chapterMemoryLayerTrace);
    }
    if (chatAgentToolContextPromptTokens > 0 || chatAgentToolContextTrace.length > 0 || chatAgentToolCallSummaries.length > 0) {
      layerTrace.push(`agent_tools: ${chatAgentToolCallSummaries.length} call(s), writes ${chatAgentToolWriteSummaries.length}, ~${chatAgentToolContextPromptTokens} tokens`);
      if (chatAgentToolCallSummaries.length > 0) {
        layerTrace.push(`agent_tools_calls: ${chatAgentToolCallSummaries.join(' | ')}`);
      }
      if (chatAgentToolWriteSummaries.length > 0) {
        layerTrace.push(`agent_tools_writes: ${chatAgentToolWriteSummaries.join(' | ')}`);
      }
      layerTrace.push(...chatAgentToolContextTrace);
    }
    if (useLorebookContext) {
      layerTrace.push(`graph_memory(world_info): ${totalWorldInfoCount} entries from ${selectedScopes.length} lorebook(s), ~${loreContextPromptTokens} tokens`);
      layerTrace.push(`fallback_entries: ${totalRagCount} entries, policy ${ragPolicies.join('/')} (${ragEnabledScopes}/${selectedScopes.length} lorebooks enabled)`);
      if (toolContextPromptTokens > 0 || toolContextLayerTrace.length > 0) {
        layerTrace.push(`tool_hooks: ${toolContextItems.length} entries, ~${toolContextPromptTokens} tokens`);
        layerTrace.push(...toolContextLayerTrace);
      }
    }
    if (trimmedByPlacement('pre_history')) {
      layerTrace.push('steering(pre_history): trimmed to reservation');
    }
    if (trimmedByPlacement('pre_response')) {
      layerTrace.push('steering(pre_response): trimmed to reservation');
    }
    if (steeringScopeRefs.length > 0) {
      layerTrace.push(
        `chat_steering_refs: ${steeringSourceResolution.resolvedRefs.length}/${steeringScopeRefs.length} resolved`
      );
      if (steeringSourceResolution.unresolvedRefs.length > 0) {
        layerTrace.push(`chat_steering_refs_unresolved: ${steeringSourceResolution.unresolvedRefs.join(', ')}`);
      }
    }
    const scopedSteeringLabels = [...new Set([
      ...scopedSteering.layers.map(layer => `${layer.scope.type}:${layer.scope.key || 'global'}`),
      ...steeringSourceResolution.resolvedScopeLabels
    ])];
    if (scopedSteeringLabels.length > 0) {
      layerTrace.push(`scoped_steering_layers: ${scopedSteeringLabels.join(' -> ')}`);
    }
    if (overflowResult.trace.length > 0) {
      layerTrace.push(...overflowResult.trace.map(trace => `overflow_policy: ${trace}`));
    }
    const layerUsage = toPromptLayerUsage([
      {
        key: 'system_steering',
        label: 'Steering (system)',
        content: systemSteeringMarkdown,
        reservedTokens: reservedByPlacement('system'),
        placement: 'system',
        trimMode: 'head',
        minTokens: 0,
        locked: true,
        trimmed: trimmedByPlacement('system')
      },
      ...overflowResult.segments.filter(segment => segment.key !== 'user_message'),
      {
        key: 'output_reserve',
        label: 'Output Reserve',
        content: '',
        reservedTokens: completion.maxOutputTokens,
        placement: 'pre_response',
        trimMode: 'head',
        minTokens: 0,
        locked: true
      }
    ]);
    const overflowTrace = [...overflowResult.trace];
    const contextMeta: StoryChatContextMeta = {
      usedLorebookContext: useLorebookContext,
      usedManualContext: manualContextForPrompt.length > 0,
      usedContinuityState: continuityForPrompt.length > 0,
      usedSpecificNotesContext: specificNotePaths.length > 0,
      usedChapterMemoryContext: chapterMemoryItems.length > 0,
      usedInlineDirectives: resolvedInlineDirectiveItems.length > 0,
      completionProfileSource: completionResolution.source,
      completionProfileId: completionResolution.presetId,
      completionProfileName: completionResolution.presetName,
      completionProvider: completion.provider,
      completionModel: completion.model,
      scopes: selectedScopes,
      steeringSourceRefs: steeringSourceResolution.resolvedRefs,
      steeringSourceScopes: steeringSourceResolution.resolvedScopeLabels,
      unresolvedSteeringSourceRefs: steeringSourceResolution.unresolvedRefs,
      specificNotePaths,
      unresolvedNoteRefs,
      chapterMemoryItems,
      inlineDirectiveItems: resolvedInlineDirectiveItems,
      continuityPlotThreads: continuitySelection.includePlotThreads ? continuityPlotThreads : [],
      continuityOpenLoops: continuitySelection.includeOpenLoops ? continuityOpenLoops : [],
      continuityCanonDeltas: continuitySelection.includeCanonDeltas ? continuityCanonDeltas : [],
      continuitySelection,
      layerTrace,
      layerUsage,
      overflowTrace,
      chatToolTrace: chatAgentToolContextTrace,
      chatToolCalls: chatAgentToolCallSummaries,
      chatToolWrites: chatAgentToolWriteSummaries,
      contextTokens: contextTokensUsed,
      worldInfoCount: totalWorldInfoCount,
      ragCount: totalRagCount,
      worldInfoItems,
      ragItems
    };

    const userPrompt = [
      'You are assisting with story development in a chat workflow.',
      'Answer naturally as a writing partner.',
      'Respect lore context as canon constraints when provided.',
      preHistorySteeringForPrompt
        ? [
          '',
          '<story_steering_pre_history>',
          preHistorySteeringForPrompt,
          '</story_steering_pre_history>'
        ].join('\n')
        : '',
      '',
      '<chat_history>',
      chatHistoryForPrompt || '[No prior chat history.]',
      '</chat_history>',
      '',
      '<manual_context>',
      manualContextForPrompt || '[No manual context provided.]',
      '</manual_context>',
      '',
      '<continuity_state>',
      continuityForPrompt || '[No continuity state provided.]',
      '</continuity_state>',
      '',
      '<specific_notes_context>',
      specificNotesForPrompt || '[No specific notes selected.]',
      '</specific_notes_context>',
      '',
      '<chapter_memory_context>',
      chapterMemoryForPrompt || '[No chapter memory available.]',
      '</chapter_memory_context>',
      '',
      '<agent_tool_context>',
      chatAgentToolContextForPrompt || '[No chat agent tool context.]',
      '</agent_tool_context>',
      '',
      '<lorevault_scopes>',
      scopeLabels.join(', '),
      '</lorevault_scopes>',
      '',
      '<tool_retrieval_context>',
      toolContextForPrompt || '[No tool-retrieved context.]',
      '</tool_retrieval_context>',
      '',
      '<lorevault_context>',
      combinedLoreContextMarkdown || '[No lorebook context selected.]',
      '</lorevault_context>',
      preResponseSteeringForPrompt
        ? [
          '',
          '<story_steering_pre_response>',
          preResponseSteeringForPrompt,
          '</story_steering_pre_response>'
        ].join('\n')
        : '',
      '',
      '<user_message>',
      userMessageForPrompt,
      '</user_message>'
    ].join('\n');

    this.generationInFlight = true;
    this.generationAbortController = new AbortController();
    this.updateGenerationTelemetry({
      ...this.createDefaultGenerationTelemetry(),
      state: 'generating',
      statusText: 'chat generating',
      startedAt: Date.now(),
      provider: completion.provider,
      model: completion.model,
      scopes: scopeLabels,
      contextWindowTokens: completion.contextWindowTokens,
      maxInputTokens,
      promptReserveTokens: completion.promptReserveTokens,
      contextUsedTokens: contextTokensUsed,
      contextRemainingTokens,
      maxOutputTokens: completion.maxOutputTokens,
      worldInfoCount: contextMeta.worldInfoCount,
      ragCount: contextMeta.ragCount,
      worldInfoItems,
      ragItems,
      inlineDirectiveItems: resolvedInlineDirectiveItems,
      continuityPlotThreads: contextMeta.continuityPlotThreads ?? [],
      continuityOpenLoops: contextMeta.continuityOpenLoops ?? [],
      continuityCanonDeltas: contextMeta.continuityCanonDeltas ?? [],
      layerUsage: contextMeta.layerUsage ?? [],
      overflowTrace: contextMeta.overflowTrace ?? [],
      contextLayerTrace: contextMeta.layerTrace ?? [],
      lastError: ''
    });
    this.setGenerationStatus('chat generating', 'busy');

    let assistantText = '';
    let reasoningText = '';
    let streamFailure: Error | null = null;
    let completionUsage: CompletionUsageReport | null = null;
    try {
      await requestStoryContinuationStream(completion, {
        systemPrompt: effectiveSystemPrompt,
        userPrompt,
        operationName: 'story_chat_turn',
        onOperationLog: record => this.appendCompletionOperationLog(record, {
          costProfile: this.resolveEffectiveCostProfileLabel(completion.apiKey)
        }),
        onDelta: (delta: string) => {
          if (!delta) {
            return;
          }
          assistantText += delta;
          request.onDelta(delta);
          this.updateGenerationTelemetry({
            generatedTokens: this.estimateTokens(assistantText),
            statusText: 'chat generating'
          });
        },
        onReasoning: (delta: string) => {
          reasoningText += delta;
          request.onReasoning?.(delta);
        },
        onUsage: usage => {
          completionUsage = usage;
        },
        abortSignal: this.generationAbortController.signal
      });
    } catch (error) {
      if (!this.isAbortLikeError(error)) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        const normalizedMessage = normalizedError.message.toLowerCase();
        if (normalizedMessage.includes('401') || normalizedMessage.includes('unauthorized')) {
          const profileLabel = completionResolution.presetName
            || (completionResolution.source === 'device' ? 'device profile' : 'default profile');
          const profileSecret = completionResolution.presetId
            ? (this.getCompletionPresetById(completionResolution.presetId)?.apiKeySecretName ?? '').trim()
            : completion.apiKeySecretName.trim();
          const secretHint = profileSecret ? ` Check secret "${profileSecret}" for this profile.` : '';
          streamFailure = new Error(
            `Chat completion authentication failed for ${profileLabel}.${secretHint} ${normalizedError.message}`.trim()
          );
        } else {
          streamFailure = normalizedError;
        }
      }
    } finally {
      this.generationInFlight = false;
      this.generationAbortController = null;
      this.setGenerationStatus('idle', 'idle');
    }

    if (completionUsage) {
      await this.recordCompletionUsage('story_chat_turn', completionUsage, {
        scopeCount: selectedScopes.length,
        scopes: selectedScopes,
        usedLorebookContext: useLorebookContext,
        usedManualContext: manualContextForPrompt.length > 0,
        usedContinuityState: continuityForPrompt.length > 0,
        usedSpecificNotesContext: specificNotePaths.length > 0,
        usedChapterMemoryContext: chapterMemoryItems.length > 0,
        inlineDirectiveCount: resolvedInlineDirectiveItems.length,
        continuityItemCount: (
          (continuitySelection.includePlotThreads ? continuityPlotThreads.length : 0)
          + (continuitySelection.includeOpenLoops ? continuityOpenLoops.length : 0)
          + (continuitySelection.includeCanonDeltas ? continuityCanonDeltas.length : 0)
        ),
        completionProfileSource: completionResolution.source,
        completionProfileId: completionResolution.presetId,
        completionProfileName: completionResolution.presetName,
        autoCostProfile: this.buildAutoCostProfileLabel(completionResolution.completion.apiKey)
      });
    }

    if (streamFailure) {
      this.updateGenerationTelemetry({
        state: 'error',
        statusText: 'error',
        lastError: streamFailure.message
      });
      throw streamFailure;
    }

    const normalizedAssistantText = assistantText.trim();
    if (!normalizedAssistantText) {
      this.updateGenerationTelemetry({
        state: 'idle',
        statusText: 'idle',
        lastError: 'Completion provider returned empty output.'
      });
      throw new Error('Completion provider returned empty output.');
    }

    this.updateGenerationTelemetry({
      state: 'idle',
      statusText: 'idle',
      generatedTokens: this.estimateTokens(normalizedAssistantText),
      contextUsedTokens: contextMeta.contextTokens,
      contextRemainingTokens: Math.max(0, maxInputTokens - completion.promptReserveTokens - instructionOverhead - contextMeta.contextTokens),
      worldInfoCount: contextMeta.worldInfoCount,
      ragCount: contextMeta.ragCount,
      worldInfoItems: contextMeta.worldInfoItems,
      ragItems: contextMeta.ragItems,
      inlineDirectiveItems: resolvedInlineDirectiveItems,
      continuityPlotThreads: contextMeta.continuityPlotThreads ?? [],
      continuityOpenLoops: contextMeta.continuityOpenLoops ?? [],
      continuityCanonDeltas: contextMeta.continuityCanonDeltas ?? [],
      layerUsage: contextMeta.layerUsage ?? [],
      overflowTrace: contextMeta.overflowTrace ?? [],
      contextLayerTrace: contextMeta.layerTrace ?? [],
      lastError: ''
    });

    return {
      assistantText: normalizedAssistantText,
      contextMeta,
      reasoning: reasoningText || undefined
    };
  }

  private mergeSettings(data: Partial<ConverterSettings> | null | undefined): ConverterSettings {
    const normalizeSecretIdentifier = (value: unknown, fallback: string, maxLength = 64): string => {
      const normalize = (input: unknown): string => String(input ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, maxLength);
      return normalize(value) || normalize(fallback);
    };

    const merged: ConverterSettings = {
      ...DEFAULT_SETTINGS,
      ...data,
      tagScoping: {
        ...DEFAULT_SETTINGS.tagScoping,
        ...(data?.tagScoping ?? {})
      },
      weights: {
        ...DEFAULT_SETTINGS.weights,
        ...(data?.weights ?? {})
      },
      defaultLoreBook: {
        ...DEFAULT_SETTINGS.defaultLoreBook,
        ...(data?.defaultLoreBook ?? {})
      },
      defaultEntry: {
        ...DEFAULT_SETTINGS.defaultEntry,
        ...(data?.defaultEntry ?? {})
      },
      sqlite: {
        ...DEFAULT_SETTINGS.sqlite,
        ...(data?.sqlite ?? {})
      },
      embeddings: {
        ...DEFAULT_SETTINGS.embeddings,
        ...(data?.embeddings ?? {})
      },
      retrieval: {
        ...DEFAULT_SETTINGS.retrieval,
        ...(data?.retrieval ?? {}),
        toolCalls: {
          ...DEFAULT_SETTINGS.retrieval.toolCalls,
          ...(data?.retrieval?.toolCalls ?? {})
        }
      },
      summaries: {
        ...DEFAULT_SETTINGS.summaries,
        ...(data?.summaries ?? {})
      },
      costTracking: {
        ...DEFAULT_SETTINGS.costTracking,
        ...(data?.costTracking ?? {})
      },
      operationLog: {
        ...DEFAULT_SETTINGS.operationLog,
        ...(data?.operationLog ?? {})
      },
      completion: {
        ...DEFAULT_SETTINGS.completion,
        ...(data?.completion ?? {}),
        semanticChapterRecall: {
          ...DEFAULT_SETTINGS.completion.semanticChapterRecall,
          ...(data?.completion?.semanticChapterRecall ?? {})
        }
      },
      storyChat: {
        ...DEFAULT_SETTINGS.storyChat,
        ...(data?.storyChat ?? {}),
        toolCalls: {
          ...DEFAULT_SETTINGS.storyChat.toolCalls,
          ...(data?.storyChat?.toolCalls ?? {})
        }
      },
      storySteering: {
        ...DEFAULT_SETTINGS.storySteering,
        ...(data?.storySteering ?? {})
      },
      characterCards: {
        ...DEFAULT_SETTINGS.characterCards,
        ...(data?.characterCards ?? {})
      },
      textCommands: {
        ...DEFAULT_SETTINGS.textCommands,
        ...(data?.textCommands ?? {})
      }
    };

    merged.tagScoping.tagPrefix = normalizeTagPrefix(merged.tagScoping.tagPrefix) || DEFAULT_SETTINGS.tagScoping.tagPrefix;
    merged.tagScoping.activeScope = normalizeScope(merged.tagScoping.activeScope);
    merged.tagScoping.membershipMode = merged.tagScoping.membershipMode === 'cascade' ? 'cascade' : 'exact';
    merged.tagScoping.includeUntagged = Boolean(merged.tagScoping.includeUntagged);
    const mergedOutputPath = (merged.outputPath ?? '').trim().replace(/\\/g, '/');
    try {
      merged.outputPath = normalizeVaultRelativePath(mergedOutputPath || DEFAULT_SETTINGS.outputPath);
    } catch {
      console.warn(`Invalid downstream output path "${merged.outputPath}". Falling back to default.`);
      merged.outputPath = DEFAULT_SETTINGS.outputPath;
    }
    const mergedDefaultImportLocation = (merged.defaultLorebookImportLocation ?? '').toString().trim().replace(/\\/g, '/');
    try {
      merged.defaultLorebookImportLocation = normalizeVaultRelativePath(
        mergedDefaultImportLocation || DEFAULT_SETTINGS.defaultLorebookImportLocation
      );
    } catch {
      console.warn(
        `Invalid default lorebook import location "${merged.defaultLorebookImportLocation}". Falling back to default.`
      );
      merged.defaultLorebookImportLocation = DEFAULT_SETTINGS.defaultLorebookImportLocation;
    }

    // Keep settings valid even when older config files contain incomplete trigger config.
    if (merged.defaultEntry.constant) {
      merged.defaultEntry.vectorized = false;
      merged.defaultEntry.selective = false;
    } else if (merged.defaultEntry.vectorized) {
      merged.defaultEntry.constant = false;
      merged.defaultEntry.selective = false;
    } else if (merged.defaultEntry.selective) {
      merged.defaultEntry.constant = false;
      merged.defaultEntry.vectorized = false;
    } else {
      merged.defaultEntry.selective = true;
    }

    merged.defaultEntry.selectiveLogic = Math.max(
      0,
      Math.min(3, Math.floor(merged.defaultEntry.selectiveLogic))
    );

    merged.sqlite.enabled = Boolean(merged.sqlite.enabled);
    const mergedSqlitePath = (merged.sqlite.outputPath ?? '').trim().replace(/\\/g, '/');
    try {
      merged.sqlite.outputPath = normalizeVaultRelativePath(mergedSqlitePath || DEFAULT_SETTINGS.sqlite.outputPath);
    } catch {
      console.warn(`Invalid sqlite output path "${merged.sqlite.outputPath}". Falling back to default.`);
      merged.sqlite.outputPath = DEFAULT_SETTINGS.sqlite.outputPath;
    }
    merged.sqlite.exportFreshnessPolicy = (
      merged.sqlite.exportFreshnessPolicy === 'manual' ||
      merged.sqlite.exportFreshnessPolicy === 'background_debounced'
    )
      ? merged.sqlite.exportFreshnessPolicy
      : 'on_build';
    merged.sqlite.backgroundDebounceMs = Math.max(
      400,
      Math.min(
        30000,
        Math.floor(Number(merged.sqlite.backgroundDebounceMs ?? DEFAULT_SETTINGS.sqlite.backgroundDebounceMs ?? 1800))
      )
    );
    const exportMap = merged.sqlite.lastCanonicalExportByScope && typeof merged.sqlite.lastCanonicalExportByScope === 'object'
      ? merged.sqlite.lastCanonicalExportByScope
      : {};
    const normalizedExportMap: {[scope: string]: number} = {};
    for (const [scopeKey, rawValue] of Object.entries(exportMap)) {
      const key = scopeKey === '__all__' ? '__all__' : (normalizeScope(scopeKey) || '');
      if (!key) {
        continue;
      }
      const timestamp = Math.max(0, Math.floor(Number(rawValue)));
      if (!Number.isFinite(timestamp) || timestamp <= 0) {
        continue;
      }
      normalizedExportMap[key] = timestamp;
    }
    merged.sqlite.lastCanonicalExportByScope = normalizedExportMap;

    merged.embeddings.enabled = Boolean(merged.embeddings.enabled);
    merged.embeddings.provider = (
      merged.embeddings.provider === 'ollama' ||
      merged.embeddings.provider === 'openai_compatible'
    ) ? merged.embeddings.provider : 'openrouter';
    merged.embeddings.endpoint = merged.embeddings.endpoint.trim();
    merged.embeddings.apiKey = merged.embeddings.apiKey.trim();
    merged.embeddings.apiKeySecretName = normalizeSecretIdentifier(
      merged.embeddings.apiKeySecretName,
      DEFAULT_SETTINGS.embeddings.apiKeySecretName
    );
    merged.embeddings.model = merged.embeddings.model.trim() || DEFAULT_SETTINGS.embeddings.model;
    merged.embeddings.instruction = merged.embeddings.instruction.trim();
    merged.embeddings.batchSize = Math.max(1, Math.floor(merged.embeddings.batchSize));
    merged.embeddings.timeoutMs = Math.max(1000, Math.floor(merged.embeddings.timeoutMs));
    const mergedEmbeddingCacheDir = (merged.embeddings.cacheDir ?? '').trim().replace(/\\/g, '/');
    try {
      merged.embeddings.cacheDir = normalizeVaultRelativePath(
        mergedEmbeddingCacheDir || DEFAULT_SETTINGS.embeddings.cacheDir
      );
    } catch {
      console.warn(`Invalid embeddings cache path "${merged.embeddings.cacheDir}". Falling back to default.`);
      merged.embeddings.cacheDir = DEFAULT_SETTINGS.embeddings.cacheDir;
    }
    merged.embeddings.chunkingMode = (
      merged.embeddings.chunkingMode === 'note' ||
      merged.embeddings.chunkingMode === 'section'
    ) ? merged.embeddings.chunkingMode : 'auto';
    merged.embeddings.minChunkChars = Math.max(100, Math.floor(merged.embeddings.minChunkChars));
    merged.embeddings.maxChunkChars = Math.max(
      merged.embeddings.minChunkChars,
      Math.floor(merged.embeddings.maxChunkChars)
    );
    merged.embeddings.overlapChars = Math.max(0, Math.floor(merged.embeddings.overlapChars));

    merged.retrieval.maxGraphHops = Math.max(0, Math.min(3, Math.floor(merged.retrieval.maxGraphHops)));
    merged.retrieval.graphHopDecay = Math.max(0.2, Math.min(0.9, Number(merged.retrieval.graphHopDecay)));
    merged.retrieval.includeBacklinksInGraphExpansion = Boolean(merged.retrieval.includeBacklinksInGraphExpansion);
    merged.retrieval.ragFallbackPolicy = (
      merged.retrieval.ragFallbackPolicy === 'off' ||
      merged.retrieval.ragFallbackPolicy === 'always'
    ) ? merged.retrieval.ragFallbackPolicy : 'auto';
    merged.retrieval.ragFallbackSeedScoreThreshold = Math.max(
      1,
      Math.floor(Number(merged.retrieval.ragFallbackSeedScoreThreshold))
    );
    merged.retrieval.toolCalls.enabled = Boolean(merged.retrieval.toolCalls.enabled);
    merged.retrieval.toolCalls.maxCallsPerTurn = Math.max(
      1,
      Math.min(16, Math.floor(Number(merged.retrieval.toolCalls.maxCallsPerTurn)))
    );
    merged.retrieval.toolCalls.maxResultTokensPerTurn = Math.max(
      128,
      Math.min(12000, Math.floor(Number(merged.retrieval.toolCalls.maxResultTokensPerTurn)))
    );
    merged.retrieval.toolCalls.maxPlanningTimeMs = Math.max(
      500,
      Math.min(120000, Math.floor(Number(merged.retrieval.toolCalls.maxPlanningTimeMs)))
    );

    merged.summaries.promptVersion = Math.max(1, Math.floor(Number(merged.summaries.promptVersion)));
    merged.summaries.maxInputChars = Math.max(
      500,
      Math.min(60000, Math.floor(Number(merged.summaries.maxInputChars)))
    );
    merged.summaries.maxSummaryChars = Math.max(
      0,
      Math.min(20000, Math.floor(Number(merged.summaries.maxSummaryChars)))
    );

    merged.costTracking.enabled = Boolean(merged.costTracking.enabled);
    merged.costTracking.ledgerPath = (merged.costTracking.ledgerPath ?? '')
      .toString()
      .trim()
      .replace(/\\/g, '/');
    if (!merged.costTracking.ledgerPath) {
      merged.costTracking.ledgerPath = DEFAULT_SETTINGS.costTracking.ledgerPath;
    }
    merged.costTracking.reportOutputDir = (merged.costTracking.reportOutputDir ?? '')
      .toString()
      .trim()
      .replace(/\\/g, '/');
    if (!merged.costTracking.reportOutputDir) {
      merged.costTracking.reportOutputDir = DEFAULT_SETTINGS.costTracking.reportOutputDir;
    }
    const inputRate = Number(merged.costTracking.defaultInputCostPerMillionUsd);
    const outputRate = Number(merged.costTracking.defaultOutputCostPerMillionUsd);
    merged.costTracking.defaultInputCostPerMillionUsd = Number.isFinite(inputRate) && inputRate >= 0
      ? inputRate
      : DEFAULT_SETTINGS.costTracking.defaultInputCostPerMillionUsd;
    merged.costTracking.defaultOutputCostPerMillionUsd = Number.isFinite(outputRate) && outputRate >= 0
      ? outputRate
      : DEFAULT_SETTINGS.costTracking.defaultOutputCostPerMillionUsd;
    const dailyBudget = Number(merged.costTracking.dailyBudgetUsd);
    const sessionBudget = Number(merged.costTracking.sessionBudgetUsd);
    merged.costTracking.dailyBudgetUsd = Number.isFinite(dailyBudget) && dailyBudget >= 0
      ? dailyBudget
      : DEFAULT_SETTINGS.costTracking.dailyBudgetUsd;
    merged.costTracking.sessionBudgetUsd = Number.isFinite(sessionBudget) && sessionBudget >= 0
      ? sessionBudget
      : DEFAULT_SETTINGS.costTracking.sessionBudgetUsd;
    const rawPricingOverrides = Array.isArray(merged.costTracking.modelPricingOverrides)
      ? merged.costTracking.modelPricingOverrides
      : [];
    const normalizedPricingOverrides: ConverterSettings['costTracking']['modelPricingOverrides'] = [];
    for (const rawOverride of rawPricingOverrides) {
      if (!rawOverride || typeof rawOverride !== 'object') {
        continue;
      }
      const provider = (rawOverride.provider ?? '*').toString().trim().toLowerCase() || '*';
      const modelPattern = (rawOverride.modelPattern ?? '').toString().trim();
      if (!modelPattern) {
        continue;
      }
      const inputOverride = Number(rawOverride.inputCostPerMillionUsd);
      const outputOverride = Number(rawOverride.outputCostPerMillionUsd);
      const inputCostPerMillionUsd = Number.isFinite(inputOverride) && inputOverride >= 0 ? inputOverride : 0;
      const outputCostPerMillionUsd = Number.isFinite(outputOverride) && outputOverride >= 0 ? outputOverride : 0;
      const updatedAt = Math.max(0, Math.floor(Number(rawOverride.updatedAt ?? 0)));
      normalizedPricingOverrides.push({
        provider,
        modelPattern,
        inputCostPerMillionUsd,
        outputCostPerMillionUsd,
        updatedAt,
        source: rawOverride.source === 'provider_sync' ? 'provider_sync' : 'manual'
      });
    }
    merged.costTracking.modelPricingOverrides = normalizedPricingOverrides
      .sort((left, right) => (
        left.provider.localeCompare(right.provider) ||
        left.modelPattern.localeCompare(right.modelPattern)
      ));

    const normalizeBudgetObject = (
      rawMap: unknown,
      keyTransform?: (key: string) => string
    ): {[key: string]: number} => {
      if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
        return {};
      }
      const normalized: {[key: string]: number} = {};
      for (const [rawKey, rawValue] of Object.entries(rawMap as {[key: string]: unknown})) {
        const transformed = keyTransform ? keyTransform(rawKey) : rawKey.trim();
        if (!transformed) {
          continue;
        }
        const parsed = Number(rawValue);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          continue;
        }
        normalized[transformed] = parsed;
      }
      return normalized;
    };

    merged.costTracking.budgetByOperationUsd = normalizeBudgetObject(merged.costTracking.budgetByOperationUsd);
    merged.costTracking.budgetByModelUsd = normalizeBudgetObject(
      merged.costTracking.budgetByModelUsd,
      key => key.trim().toLowerCase()
    );
    merged.costTracking.budgetByScopeUsd = normalizeBudgetObject(
      merged.costTracking.budgetByScopeUsd,
      key => {
        const trimmed = key.trim();
        if (trimmed === '(none)') {
          return '(none)';
        }
        return normalizeScope(trimmed) || '';
      }
    );
    const normalizedBudgetByCostProfile: {[costProfile: string]: CostProfileBudgetSettings} = {};
    const rawBudgetByCostProfile = merged.costTracking.budgetByCostProfileUsd;
    if (rawBudgetByCostProfile && typeof rawBudgetByCostProfile === 'object' && !Array.isArray(rawBudgetByCostProfile)) {
      for (const [rawProfileKey, rawProfileBudget] of Object.entries(rawBudgetByCostProfile as {[key: string]: unknown})) {
        const profileKey = rawProfileKey.trim();
        if (!profileKey || !rawProfileBudget || typeof rawProfileBudget !== 'object' || Array.isArray(rawProfileBudget)) {
          continue;
        }
        const budgetSource = rawProfileBudget as Partial<CostProfileBudgetSettings>;
        const dailyCandidate = Number(budgetSource.dailyBudgetUsd);
        const sessionCandidate = Number(budgetSource.sessionBudgetUsd);
        normalizedBudgetByCostProfile[profileKey] = {
          dailyBudgetUsd: Number.isFinite(dailyCandidate) && dailyCandidate >= 0 ? dailyCandidate : 0,
          sessionBudgetUsd: Number.isFinite(sessionCandidate) && sessionCandidate >= 0 ? sessionCandidate : 0,
          budgetByOperationUsd: normalizeBudgetObject(budgetSource.budgetByOperationUsd),
          budgetByModelUsd: normalizeBudgetObject(
            budgetSource.budgetByModelUsd,
            key => key.trim().toLowerCase()
          ),
          budgetByScopeUsd: normalizeBudgetObject(
            budgetSource.budgetByScopeUsd,
            key => {
              const trimmed = key.trim();
              if (trimmed === '(none)') {
                return '(none)';
              }
              return normalizeScope(trimmed) || '';
            }
          )
        };
      }
    }
    const hasLegacyBudgetConfig = (
      merged.costTracking.dailyBudgetUsd > 0 ||
      merged.costTracking.sessionBudgetUsd > 0 ||
      Object.keys(merged.costTracking.budgetByOperationUsd).length > 0 ||
      Object.keys(merged.costTracking.budgetByModelUsd).length > 0 ||
      Object.keys(merged.costTracking.budgetByScopeUsd).length > 0
    );
    if (Object.keys(normalizedBudgetByCostProfile).length === 0 && hasLegacyBudgetConfig) {
      normalizedBudgetByCostProfile.__default__ = {
        dailyBudgetUsd: merged.costTracking.dailyBudgetUsd,
        sessionBudgetUsd: merged.costTracking.sessionBudgetUsd,
        budgetByOperationUsd: { ...merged.costTracking.budgetByOperationUsd },
        budgetByModelUsd: { ...merged.costTracking.budgetByModelUsd },
        budgetByScopeUsd: { ...merged.costTracking.budgetByScopeUsd }
      };
    }
    merged.costTracking.budgetByCostProfileUsd = normalizedBudgetByCostProfile;

    merged.operationLog.enabled = Boolean(merged.operationLog.enabled);
    const operationLogPath = (merged.operationLog.path ?? '')
      .toString()
      .trim()
      .replace(/\\/g, '/');
    try {
      merged.operationLog.path = normalizeVaultRelativePath(operationLogPath || DEFAULT_SETTINGS.operationLog.path);
    } catch {
      console.warn(`Invalid operation log path "${merged.operationLog.path}". Falling back to default.`);
      merged.operationLog.path = DEFAULT_SETTINGS.operationLog.path;
    }
    merged.operationLog.maxEntries = Math.max(
      20,
      Math.min(20000, Math.floor(Number(merged.operationLog.maxEntries ?? DEFAULT_SETTINGS.operationLog.maxEntries)))
    );
    merged.operationLog.includeEmbeddings = Boolean(
      merged.operationLog.includeEmbeddings
      ?? DEFAULT_SETTINGS.operationLog.includeEmbeddings
    );

    merged.completion.enabled = Boolean(merged.completion.enabled);
    merged.completion.provider = (
      merged.completion.provider === 'ollama' ||
      merged.completion.provider === 'openai_compatible'
    ) ? merged.completion.provider : 'openrouter';
    merged.completion.endpoint = merged.completion.endpoint.trim() || DEFAULT_SETTINGS.completion.endpoint;
    merged.completion.apiKey = merged.completion.apiKey.trim();
    merged.completion.apiKeySecretName = normalizeSecretIdentifier(
      merged.completion.apiKeySecretName,
      DEFAULT_SETTINGS.completion.apiKeySecretName
    );
    merged.completion.model = merged.completion.model.trim() || DEFAULT_SETTINGS.completion.model;
    merged.completion.systemPrompt = merged.completion.systemPrompt.trim() || DEFAULT_SETTINGS.completion.systemPrompt;
    merged.completion.temperature = Math.max(0, Math.min(2, Number(merged.completion.temperature)));
    merged.completion.maxOutputTokens = Math.max(64, Math.floor(merged.completion.maxOutputTokens));
    merged.completion.contextWindowTokens = Math.max(
      merged.completion.maxOutputTokens + 512,
      Math.floor(merged.completion.contextWindowTokens)
    );
    merged.completion.promptReserveTokens = Math.max(0, Math.floor(merged.completion.promptReserveTokens));
    merged.completion.timeoutMs = Math.max(1000, Math.floor(merged.completion.timeoutMs));
    merged.completion.promptCachingEnabled = Boolean(
      merged.completion.promptCachingEnabled
      ?? DEFAULT_SETTINGS.completion.promptCachingEnabled
    );
    merged.completion.providerRouting = (merged.completion.providerRouting ?? '')
      .toString()
      .trim();
    merged.completion.reasoning = normalizeReasoningConfig(merged.completion.reasoning);
    merged.completion.ignoredCalloutTypes = normalizeIgnoredCalloutTypes(merged.completion.ignoredCalloutTypes);
    merged.completion.continuityAggressiveness = normalizeChapterMemoryAggressiveness(
      merged.completion.continuityAggressiveness
    );
    const semanticRecallSettings = merged.completion.semanticChapterRecall ?? DEFAULT_SETTINGS.completion.semanticChapterRecall;
    merged.completion.semanticChapterRecall = {
      enabled: Boolean(semanticRecallSettings.enabled),
      maxSourceChapters: Math.max(2, Math.min(120, Math.floor(Number(
        semanticRecallSettings.maxSourceChapters
        ?? DEFAULT_SETTINGS.completion.semanticChapterRecall.maxSourceChapters
      )))),
      maxChunks: Math.max(1, Math.min(24, Math.floor(Number(
        semanticRecallSettings.maxChunks
        ?? DEFAULT_SETTINGS.completion.semanticChapterRecall.maxChunks
      )))),
      maxChunksPerChapter: Math.max(1, Math.min(6, Math.floor(Number(
        semanticRecallSettings.maxChunksPerChapter
        ?? DEFAULT_SETTINGS.completion.semanticChapterRecall.maxChunksPerChapter
      )))),
      chunkMaxChars: Math.max(300, Math.min(6000, Math.floor(Number(
        semanticRecallSettings.chunkMaxChars
        ?? DEFAULT_SETTINGS.completion.semanticChapterRecall.chunkMaxChars
      )))),
      chunkOverlapChars: Math.max(0, Math.min(1500, Math.floor(Number(
        semanticRecallSettings.chunkOverlapChars
        ?? DEFAULT_SETTINGS.completion.semanticChapterRecall.chunkOverlapChars
      )))),
      minSimilarity: Math.max(0, Math.min(1, Number(
        semanticRecallSettings.minSimilarity
        ?? DEFAULT_SETTINGS.completion.semanticChapterRecall.minSimilarity
      ))),
      recencyBlend: Math.max(0, Math.min(1, Number(
        semanticRecallSettings.recencyBlend
        ?? DEFAULT_SETTINGS.completion.semanticChapterRecall.recencyBlend
      ))),
      budgetShare: Math.max(0.05, Math.min(0.8, Number(
        semanticRecallSettings.budgetShare
        ?? DEFAULT_SETTINGS.completion.semanticChapterRecall.budgetShare
      )))
    };
    if (merged.completion.semanticChapterRecall.chunkOverlapChars >= merged.completion.semanticChapterRecall.chunkMaxChars) {
      merged.completion.semanticChapterRecall.chunkOverlapChars = Math.max(
        0,
        Math.floor(merged.completion.semanticChapterRecall.chunkMaxChars * 0.25)
      );
    }
    const completionLayerPlacement = merged.completion.layerPlacement ?? DEFAULT_SETTINGS.completion.layerPlacement;
    merged.completion.layerPlacement = {
      storyNotes: this.resolvePromptLayerPlacement(
        completionLayerPlacement.storyNotes,
        DEFAULT_SETTINGS.completion.layerPlacement.storyNotes
      )
    };
    const rawPresets = Array.isArray(merged.completion.presets) ? merged.completion.presets : [];
    const normalizedPresets: CompletionPreset[] = [];
    for (const rawPreset of rawPresets) {
      const normalizedPreset = normalizeCompletionPreset(rawPreset, {
        buildDefaultSecretName: id => this.buildDefaultCompletionPresetSecretName(id),
        normalizeSecretIdentifier: (value, fallback) => normalizeSecretIdentifier(value, fallback),
        fallbackId: () => `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      });
      if (normalizedPreset) {
        normalizedPresets.push(normalizedPreset);
      }
    }
    merged.completion.presets = normalizedPresets
      .filter((preset, index, array) => array.findIndex(item => item.id === preset.id) === index)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const activePresetId = (merged.completion.activePresetId ?? '').toString().trim();
    merged.completion.activePresetId = merged.completion.presets.some(preset => preset.id === activePresetId)
      ? activePresetId
      : '';

    const selectedScopes = Array.isArray(merged.storyChat.selectedScopes)
      ? merged.storyChat.selectedScopes
      : [];
    merged.storyChat.chatFolder = ((merged.storyChat.chatFolder ?? '').toString().trim() || DEFAULT_SETTINGS.storyChat.chatFolder).replace(/\\/g, '/');
    merged.storyChat.activeConversationPath = (merged.storyChat.activeConversationPath ?? '').toString().trim().replace(/\\/g, '/');
    merged.storyChat.selectedScopes = selectedScopes
      .map(scope => normalizeScope(scope))
      .filter((scope, index, array): scope is string => Boolean(scope) && array.indexOf(scope) === index);
    merged.storyChat.useLorebookContext = Boolean(merged.storyChat.useLorebookContext);
    merged.storyChat.manualContext = (merged.storyChat.manualContext ?? '').toString();
    const steeringScopeRefs = Array.isArray(merged.storyChat.steeringScopeRefs)
      ? merged.storyChat.steeringScopeRefs
      : [];
    merged.storyChat.steeringScopeRefs = normalizeStoryChatSteeringRefs(
      steeringScopeRefs.map(ref => String(ref ?? ''))
    );
    const continuityPlotThreads = Array.isArray(merged.storyChat.continuityPlotThreads)
      ? merged.storyChat.continuityPlotThreads
      : [];
    const continuityOpenLoops = Array.isArray(merged.storyChat.continuityOpenLoops)
      ? merged.storyChat.continuityOpenLoops
      : [];
    const continuityCanonDeltas = Array.isArray(merged.storyChat.continuityCanonDeltas)
      ? merged.storyChat.continuityCanonDeltas
      : [];
    merged.storyChat.continuityPlotThreads = this.normalizeContinuityItems(
      continuityPlotThreads.map(item => String(item ?? ''))
    );
    merged.storyChat.continuityOpenLoops = this.normalizeContinuityItems(
      continuityOpenLoops.map(item => String(item ?? ''))
    );
    merged.storyChat.continuityCanonDeltas = this.normalizeContinuityItems(
      continuityCanonDeltas.map(item => String(item ?? ''))
    );
    const continuitySelectionRaw = merged.storyChat.continuitySelection ?? DEFAULT_SETTINGS.storyChat.continuitySelection;
    merged.storyChat.continuitySelection = {
      includePlotThreads: continuitySelectionRaw.includePlotThreads !== false,
      includeOpenLoops: continuitySelectionRaw.includeOpenLoops !== false,
      includeCanonDeltas: continuitySelectionRaw.includeCanonDeltas !== false
    };
    const noteContextRefs = Array.isArray(merged.storyChat.noteContextRefs)
      ? merged.storyChat.noteContextRefs
      : [];
    merged.storyChat.noteContextRefs = noteContextRefs
      .map(ref => normalizeLinkTarget(String(ref ?? '')))
      .filter((ref, index, array): ref is string => Boolean(ref) && array.indexOf(ref) === index);
    merged.storyChat.maxMessages = Math.max(10, Math.floor(merged.storyChat.maxMessages || DEFAULT_SETTINGS.storyChat.maxMessages));
    merged.storyChat.toolCalls.enabled = Boolean(merged.storyChat.toolCalls.enabled);
    merged.storyChat.toolCalls.maxCallsPerTurn = Math.max(
      1,
      Math.min(16, Math.floor(Number(merged.storyChat.toolCalls.maxCallsPerTurn)))
    );
    merged.storyChat.toolCalls.maxResultTokensPerTurn = Math.max(
      128,
      Math.min(12000, Math.floor(Number(merged.storyChat.toolCalls.maxResultTokensPerTurn)))
    );
    merged.storyChat.toolCalls.maxPlanningTimeMs = Math.max(
      500,
      Math.min(120000, Math.floor(Number(merged.storyChat.toolCalls.maxPlanningTimeMs)))
    );
    merged.storyChat.toolCalls.allowWriteActions = Boolean(merged.storyChat.toolCalls.allowWriteActions);

    const mergedSteeringFolder = (merged.storySteering.folder ?? '').toString().trim().replace(/\\/g, '/');
    try {
      merged.storySteering.folder = normalizeVaultRelativePath(
        mergedSteeringFolder || DEFAULT_SETTINGS.storySteering.folder
      );
    } catch {
      console.warn(`Invalid story steering folder "${merged.storySteering.folder}". Falling back to default.`);
      merged.storySteering.folder = DEFAULT_SETTINGS.storySteering.folder;
    }
    const extractionSanitization = (merged.storySteering.extractionSanitization ?? '').toString().trim().toLowerCase();
    merged.storySteering.extractionSanitization = extractionSanitization === 'off'
      ? 'off'
      : DEFAULT_SETTINGS.storySteering.extractionSanitization;

    const mergedCharacterCardSourceFolder = (merged.characterCards.sourceFolder ?? '').toString().trim().replace(/\\/g, '/');
    try {
      merged.characterCards.sourceFolder = normalizeVaultRelativePath(
        mergedCharacterCardSourceFolder || DEFAULT_SETTINGS.characterCards.sourceFolder
      );
    } catch {
      console.warn(`Invalid character card source folder "${merged.characterCards.sourceFolder}". Falling back to default.`);
      merged.characterCards.sourceFolder = DEFAULT_SETTINGS.characterCards.sourceFolder;
    }
    const mergedCharacterCardMetaFolder = (merged.characterCards.metaFolder ?? '').toString().trim().replace(/\\/g, '/');
    try {
      merged.characterCards.metaFolder = normalizeVaultRelativePath(
        mergedCharacterCardMetaFolder || DEFAULT_SETTINGS.characterCards.metaFolder
      );
    } catch {
      console.warn(`Invalid character card meta folder "${merged.characterCards.metaFolder}". Falling back to default.`);
      merged.characterCards.metaFolder = DEFAULT_SETTINGS.characterCards.metaFolder;
    }
    merged.characterCards.autoSummaryEnabled = Boolean(merged.characterCards.autoSummaryEnabled);
    merged.characterCards.summaryRegenerateOnHashChange = Boolean(merged.characterCards.summaryRegenerateOnHashChange);
    merged.characterCards.summaryCompletionPresetId = (merged.characterCards.summaryCompletionPresetId ?? '')
      .toString()
      .trim();

    merged.textCommands.autoAcceptEdits = Boolean(merged.textCommands.autoAcceptEdits);
    merged.textCommands.defaultIncludeLorebookContext = Boolean(merged.textCommands.defaultIncludeLorebookContext);
    merged.textCommands.maxContextTokens = Math.max(
      128,
      Math.min(12000, Math.floor(Number(merged.textCommands.maxContextTokens)))
    );
    merged.textCommands.promptsFolder = ((merged.textCommands.promptsFolder ?? '')
      .toString()
      .trim()
      .replace(/\\/g, '/')) || DEFAULT_SETTINGS.textCommands.promptsFolder;
    merged.textCommands.systemPrompt = (merged.textCommands.systemPrompt ?? '')
      .toString()
      .trim() || DEFAULT_SETTINGS.textCommands.systemPrompt;

    const messages = Array.isArray(merged.storyChat.messages) ? merged.storyChat.messages : [];
    merged.storyChat.messages = messages
      .filter(message => message && (message.role === 'user' || message.role === 'assistant'))
      .map((message: any): StoryChatMessage => {
        const role: StoryChatMessage['role'] = message.role === 'assistant' ? 'assistant' : 'user';
        return {
          id: typeof message.id === 'string' && message.id ? message.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role,
          content: (message.content ?? '').toString(),
          createdAt: Number.isFinite(message.createdAt) ? Math.floor(message.createdAt) : Date.now(),
          contextMeta: message.contextMeta ? {
            usedLorebookContext: Boolean(message.contextMeta.usedLorebookContext),
            usedManualContext: Boolean(message.contextMeta.usedManualContext),
            usedSpecificNotesContext: Boolean(message.contextMeta.usedSpecificNotesContext),
            usedChapterMemoryContext: Boolean(message.contextMeta.usedChapterMemoryContext),
            usedInlineDirectives: Boolean(message.contextMeta.usedInlineDirectives),
            usedContinuityState: Boolean(message.contextMeta.usedContinuityState),
            scopes: Array.isArray(message.contextMeta.scopes)
              ? message.contextMeta.scopes
                .map((scope: string) => normalizeScope(scope))
                .filter((scope: string | null): scope is string => Boolean(scope))
              : [],
            steeringSourceRefs: Array.isArray(message.contextMeta.steeringSourceRefs)
              ? message.contextMeta.steeringSourceRefs.map((item: unknown) => String(item))
              : [],
            steeringSourceScopes: Array.isArray(message.contextMeta.steeringSourceScopes)
              ? message.contextMeta.steeringSourceScopes.map((item: unknown) => String(item))
              : [],
            unresolvedSteeringSourceRefs: Array.isArray(message.contextMeta.unresolvedSteeringSourceRefs)
              ? message.contextMeta.unresolvedSteeringSourceRefs.map((item: unknown) => String(item))
              : [],
            specificNotePaths: Array.isArray(message.contextMeta.specificNotePaths)
              ? message.contextMeta.specificNotePaths.map((item: unknown) => String(item))
              : [],
            unresolvedNoteRefs: Array.isArray(message.contextMeta.unresolvedNoteRefs)
              ? message.contextMeta.unresolvedNoteRefs.map((item: unknown) => String(item))
              : [],
            chapterMemoryItems: Array.isArray(message.contextMeta.chapterMemoryItems)
              ? message.contextMeta.chapterMemoryItems.map((item: unknown) => String(item))
              : [],
            inlineDirectiveItems: Array.isArray(message.contextMeta.inlineDirectiveItems)
              ? message.contextMeta.inlineDirectiveItems.map((item: unknown) => String(item))
              : [],
            continuityPlotThreads: Array.isArray(message.contextMeta.continuityPlotThreads)
              ? message.contextMeta.continuityPlotThreads.map((item: unknown) => String(item))
              : [],
            continuityOpenLoops: Array.isArray(message.contextMeta.continuityOpenLoops)
              ? message.contextMeta.continuityOpenLoops.map((item: unknown) => String(item))
              : [],
            continuityCanonDeltas: Array.isArray(message.contextMeta.continuityCanonDeltas)
              ? message.contextMeta.continuityCanonDeltas.map((item: unknown) => String(item))
              : [],
            continuitySelection: message.contextMeta.continuitySelection
              ? {
                includePlotThreads: message.contextMeta.continuitySelection.includePlotThreads !== false,
                includeOpenLoops: message.contextMeta.continuitySelection.includeOpenLoops !== false,
                includeCanonDeltas: message.contextMeta.continuitySelection.includeCanonDeltas !== false
              }
              : undefined,
            layerTrace: Array.isArray(message.contextMeta.layerTrace)
              ? message.contextMeta.layerTrace.map((item: unknown) => String(item))
              : [],
            layerUsage: Array.isArray(message.contextMeta.layerUsage)
              ? message.contextMeta.layerUsage
                .filter((item: unknown) => Boolean(item) && typeof item === 'object')
                .map((item: any) => ({
                  layer: String(item.layer ?? ''),
                  placement: this.resolvePromptLayerPlacement(item.placement, 'pre_response'),
                  reservedTokens: Math.max(0, Math.floor(Number(item.reservedTokens ?? 0))),
                  usedTokens: Math.max(0, Math.floor(Number(item.usedTokens ?? 0))),
                  headroomTokens: Math.max(0, Math.floor(Number(item.headroomTokens ?? 0))),
                  trimmed: Boolean(item.trimmed),
                  ...(typeof item.trimReason === 'string' && item.trimReason
                    ? { trimReason: item.trimReason }
                    : {})
                }))
              : [],
            overflowTrace: Array.isArray(message.contextMeta.overflowTrace)
              ? message.contextMeta.overflowTrace.map((item: unknown) => String(item))
              : [],
            chatToolTrace: Array.isArray(message.contextMeta.chatToolTrace)
              ? message.contextMeta.chatToolTrace.map((item: unknown) => String(item))
              : [],
            chatToolCalls: Array.isArray(message.contextMeta.chatToolCalls)
              ? message.contextMeta.chatToolCalls.map((item: unknown) => String(item))
              : [],
            chatToolWrites: Array.isArray(message.contextMeta.chatToolWrites)
              ? message.contextMeta.chatToolWrites.map((item: unknown) => String(item))
              : [],
            contextTokens: Math.max(0, Math.floor(message.contextMeta.contextTokens ?? 0)),
            worldInfoCount: Math.max(0, Math.floor(message.contextMeta.worldInfoCount ?? 0)),
            ragCount: Math.max(0, Math.floor(message.contextMeta.ragCount ?? 0)),
            worldInfoItems: Array.isArray(message.contextMeta.worldInfoItems)
              ? message.contextMeta.worldInfoItems.map((item: unknown) => String(item))
              : [],
            ragItems: Array.isArray(message.contextMeta.ragItems)
              ? message.contextMeta.ragItems.map((item: unknown) => String(item))
              : []
          } : undefined
        };
      })
      .slice(-merged.storyChat.maxMessages);

    const forkSnapshots = Array.isArray(merged.storyChat.forkSnapshots) ? merged.storyChat.forkSnapshots : [];
    merged.storyChat.forkSnapshots = forkSnapshots
      .map((snapshot: any): StoryChatForkSnapshot | null => {
        if (!snapshot) {
          return null;
        }
        const snapshotMessages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
        const normalizedMessages: StoryChatMessage[] = snapshotMessages
          .filter((message: any) => message && (message.role === 'user' || message.role === 'assistant'))
          .map((message: any): StoryChatMessage => ({
            id: typeof message.id === 'string' && message.id ? message.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: (message.content ?? '').toString(),
            createdAt: Number.isFinite(message.createdAt) ? Math.floor(message.createdAt) : Date.now(),
            contextMeta: message.contextMeta ? {
              usedLorebookContext: Boolean(message.contextMeta.usedLorebookContext),
              usedManualContext: Boolean(message.contextMeta.usedManualContext),
              usedSpecificNotesContext: Boolean(message.contextMeta.usedSpecificNotesContext),
              usedChapterMemoryContext: Boolean(message.contextMeta.usedChapterMemoryContext),
              usedInlineDirectives: Boolean(message.contextMeta.usedInlineDirectives),
              usedContinuityState: Boolean(message.contextMeta.usedContinuityState),
              scopes: Array.isArray(message.contextMeta.scopes)
                ? message.contextMeta.scopes
                  .map((scope: string) => normalizeScope(scope))
                  .filter((scope: string | null): scope is string => Boolean(scope))
                : [],
              steeringSourceRefs: Array.isArray(message.contextMeta.steeringSourceRefs)
                ? message.contextMeta.steeringSourceRefs.map((item: unknown) => String(item))
                : [],
              steeringSourceScopes: Array.isArray(message.contextMeta.steeringSourceScopes)
                ? message.contextMeta.steeringSourceScopes.map((item: unknown) => String(item))
                : [],
              unresolvedSteeringSourceRefs: Array.isArray(message.contextMeta.unresolvedSteeringSourceRefs)
                ? message.contextMeta.unresolvedSteeringSourceRefs.map((item: unknown) => String(item))
                : [],
              specificNotePaths: Array.isArray(message.contextMeta.specificNotePaths)
                ? message.contextMeta.specificNotePaths.map((item: unknown) => String(item))
                : [],
              unresolvedNoteRefs: Array.isArray(message.contextMeta.unresolvedNoteRefs)
                ? message.contextMeta.unresolvedNoteRefs.map((item: unknown) => String(item))
                : [],
              chapterMemoryItems: Array.isArray(message.contextMeta.chapterMemoryItems)
                ? message.contextMeta.chapterMemoryItems.map((item: unknown) => String(item))
                : [],
              inlineDirectiveItems: Array.isArray(message.contextMeta.inlineDirectiveItems)
                ? message.contextMeta.inlineDirectiveItems.map((item: unknown) => String(item))
                : [],
              continuityPlotThreads: Array.isArray(message.contextMeta.continuityPlotThreads)
                ? message.contextMeta.continuityPlotThreads.map((item: unknown) => String(item))
                : [],
              continuityOpenLoops: Array.isArray(message.contextMeta.continuityOpenLoops)
                ? message.contextMeta.continuityOpenLoops.map((item: unknown) => String(item))
                : [],
              continuityCanonDeltas: Array.isArray(message.contextMeta.continuityCanonDeltas)
                ? message.contextMeta.continuityCanonDeltas.map((item: unknown) => String(item))
                : [],
              continuitySelection: message.contextMeta.continuitySelection
                ? {
                  includePlotThreads: message.contextMeta.continuitySelection.includePlotThreads !== false,
                  includeOpenLoops: message.contextMeta.continuitySelection.includeOpenLoops !== false,
                  includeCanonDeltas: message.contextMeta.continuitySelection.includeCanonDeltas !== false
                }
                : undefined,
              layerTrace: Array.isArray(message.contextMeta.layerTrace)
                ? message.contextMeta.layerTrace.map((item: unknown) => String(item))
                : [],
              layerUsage: Array.isArray(message.contextMeta.layerUsage)
                ? message.contextMeta.layerUsage
                  .filter((item: unknown) => Boolean(item) && typeof item === 'object')
                  .map((item: any) => ({
                    layer: String(item.layer ?? ''),
                    placement: this.resolvePromptLayerPlacement(item.placement, 'pre_response'),
                    reservedTokens: Math.max(0, Math.floor(Number(item.reservedTokens ?? 0))),
                    usedTokens: Math.max(0, Math.floor(Number(item.usedTokens ?? 0))),
                    headroomTokens: Math.max(0, Math.floor(Number(item.headroomTokens ?? 0))),
                    trimmed: Boolean(item.trimmed),
                    ...(typeof item.trimReason === 'string' && item.trimReason
                      ? { trimReason: item.trimReason }
                      : {})
                  }))
                : [],
              overflowTrace: Array.isArray(message.contextMeta.overflowTrace)
                ? message.contextMeta.overflowTrace.map((item: unknown) => String(item))
                : [],
              chatToolTrace: Array.isArray(message.contextMeta.chatToolTrace)
                ? message.contextMeta.chatToolTrace.map((item: unknown) => String(item))
                : [],
              chatToolCalls: Array.isArray(message.contextMeta.chatToolCalls)
                ? message.contextMeta.chatToolCalls.map((item: unknown) => String(item))
                : [],
              chatToolWrites: Array.isArray(message.contextMeta.chatToolWrites)
                ? message.contextMeta.chatToolWrites.map((item: unknown) => String(item))
                : [],
              contextTokens: Math.max(0, Math.floor(message.contextMeta.contextTokens ?? 0)),
              worldInfoCount: Math.max(0, Math.floor(message.contextMeta.worldInfoCount ?? 0)),
              ragCount: Math.max(0, Math.floor(message.contextMeta.ragCount ?? 0)),
              worldInfoItems: Array.isArray(message.contextMeta.worldInfoItems)
                ? message.contextMeta.worldInfoItems.map((item: unknown) => String(item))
                : [],
              ragItems: Array.isArray(message.contextMeta.ragItems)
                ? message.contextMeta.ragItems.map((item: unknown) => String(item))
                : []
            } : undefined
          }))
          .slice(-merged.storyChat.maxMessages);

        const selectedSnapshotScopes = Array.isArray(snapshot.selectedScopes) ? snapshot.selectedScopes : [];
        const selectedScopes = selectedSnapshotScopes
          .map((scope: unknown) => normalizeScope(String(scope ?? '')))
          .filter((scope: string | null, index: number, array: Array<string | null>): scope is string => Boolean(scope) && array.indexOf(scope) === index);
        const steeringScopeRefs = normalizeStoryChatSteeringRefs(
          Array.isArray(snapshot.steeringScopeRefs)
            ? snapshot.steeringScopeRefs.map((ref: unknown) => String(ref ?? ''))
            : []
        );
        const noteRefs = Array.isArray(snapshot.noteContextRefs) ? snapshot.noteContextRefs : [];
        const noteContextRefs = noteRefs
          .map((ref: unknown) => normalizeLinkTarget(String(ref ?? '')))
          .filter((ref: string | null, index: number, array: Array<string | null>): ref is string => Boolean(ref) && array.indexOf(ref) === index);

        return {
          id: typeof snapshot.id === 'string' && snapshot.id ? snapshot.id : `fork-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title: typeof snapshot.title === 'string' && snapshot.title.trim() ? snapshot.title.trim() : 'Fork Snapshot',
          createdAt: Number.isFinite(snapshot.createdAt) ? Math.floor(snapshot.createdAt) : Date.now(),
          messages: normalizedMessages,
          selectedScopes,
          useLorebookContext: Boolean(snapshot.useLorebookContext),
          manualContext: (snapshot.manualContext ?? '').toString(),
          steeringScopeRefs,
          continuityPlotThreads: this.normalizeContinuityItems(
            Array.isArray(snapshot.continuityPlotThreads)
              ? snapshot.continuityPlotThreads.map((item: unknown) => String(item ?? ''))
              : []
          ),
          continuityOpenLoops: this.normalizeContinuityItems(
            Array.isArray(snapshot.continuityOpenLoops)
              ? snapshot.continuityOpenLoops.map((item: unknown) => String(item ?? ''))
              : []
          ),
          continuityCanonDeltas: this.normalizeContinuityItems(
            Array.isArray(snapshot.continuityCanonDeltas)
              ? snapshot.continuityCanonDeltas.map((item: unknown) => String(item ?? ''))
              : []
          ),
          continuitySelection: snapshot.continuitySelection
            ? {
              includePlotThreads: snapshot.continuitySelection.includePlotThreads !== false,
              includeOpenLoops: snapshot.continuitySelection.includeOpenLoops !== false,
              includeCanonDeltas: snapshot.continuitySelection.includeCanonDeltas !== false
            }
            : {
              includePlotThreads: true,
              includeOpenLoops: true,
              includeCanonDeltas: true
            },
          noteContextRefs
        };
      })
      .filter((snapshot): snapshot is StoryChatForkSnapshot => Boolean(snapshot))
      .slice(-20);

    return merged;
  }

  async onload() {
    // Load the settings
    const loadedSettings = await this.loadData() as Partial<ConverterSettings> | null | undefined;
    this.settings = this.mergeSettings(loadedSettings);
    await this.loadDeviceProfileState();
    const hadInlineApiKeys = this.hasInlineApiKeys(this.settings);
    try {
      await this.syncSettingsApiKeysToSecretStorage();
      await this.hydrateSettingsApiKeysFromSecretStorage();
      if (hadInlineApiKeys) {
        await this.persistSettingsSnapshot();
      }
    } catch (error) {
      console.error('LoreVault: Secret storage initialization failed. Continuing without secret hydration.', error);
    }
    this.storagePersisted = await this.requestPersistentBrowserStorage();
    const internalDbWorkerUrl = this.createInternalDbWorkerUrl();
    this.internalDbClient = internalDbWorkerUrl
      ? new InternalDbClient(internalDbWorkerUrl, this.storagePersisted)
      : null;
    if (this.internalDbClient) {
      this.operationLogStore = new OperationLogStore({
        internalDbClient: this.internalDbClient,
        getDeviceCostProfileLabel: () => this.getDeviceEffectiveCostProfileLabel(),
        getLegacyPath: costProfile => this.getOperationLogPath(costProfile),
        getMaxEntries: () => this.getOperationLogMaxEntries()
      });
      await this.operationLogStore.initialize();
    }
    this.usageLedgerStore = new UsageLedgerStore(this.app, this.resolveUsageLedgerPath(), {
      internalDbClient: this.internalDbClient,
      storagePersisted: this.storagePersisted
    });
    this.storySteeringStore = new StorySteeringStore(
      this.app,
      () => this.getStorySteeringFolderPath()
    );
    this.liveContextIndex = new LiveContextIndex(
      this.app,
      () => this.settings,
      () => this.getCachedLorebookMetadata(),
      record => this.appendEmbeddingOperationLog(record, {
        costProfile: this.resolveEffectiveCostProfileLabel(this.settings.embeddings.apiKey)
      }),
      (operationName, usage, metadata) => {
        this.recordEmbeddingUsage(operationName, usage, this.settings.embeddings.apiKey, {
          source: 'live_context_index',
          ...metadata
        });
      }
    );
    this.chapterSummaryStore = new ChapterSummaryStore(this.app, () => this.getIgnoredLlmCalloutTypes());
    this.lorebookScopeCache = new LorebookScopeCache({
      computeNotes: () => collectLorebookNoteMetadata(this.app, this.settings),
      computeNote: path => collectLorebookNoteMetadataForFile(this.app, this.settings, path),
      getActiveScope: () => this.settings.tagScoping.activeScope
    });
    this.exportScopeIndexByPath = new Map(
      this.getCachedLorebookMetadata()
        .map(item => [item.path, this.normalizeExportScopeList(item.scopes)])
    );
    this.registerView(LOREVAULT_MANAGER_VIEW_TYPE, leaf => new LorebooksManagerView(leaf, this));
    this.registerView(LOREVAULT_ROUTING_DEBUG_VIEW_TYPE, leaf => new LorebooksRoutingDebugView(leaf, this));
    this.registerView(LOREVAULT_QUERY_SIMULATION_VIEW_TYPE, leaf => new LorebooksQuerySimulationView(leaf, this));
    this.registerView(LOREVAULT_STORY_CHAT_VIEW_TYPE, leaf => new StoryChatView(leaf, this));
    this.registerView(LOREVAULT_STORY_STARTER_VIEW_TYPE, leaf => new LorevaultStoryStarterView(leaf, this));
    this.registerView(LOREVAULT_STORY_STEERING_VIEW_TYPE, leaf => new StorySteeringView(leaf, this));
    this.registerView(LOREVAULT_HELP_VIEW_TYPE, leaf => new LorevaultHelpView(leaf, this));
    this.registerView(LOREVAULT_OPERATION_LOG_VIEW_TYPE, leaf => new LorevaultOperationLogView(leaf, this));
    this.registerView(LOREVAULT_COST_ANALYZER_VIEW_TYPE, leaf => new LorevaultCostAnalyzerView(leaf, this));
    this.registerView(LOREVAULT_IMPORT_VIEW_TYPE, leaf => new LorevaultImportView(leaf, this));
    this.registerView(LOREVAULT_STORY_EXTRACT_VIEW_TYPE, leaf => new LorevaultStoryExtractView(leaf, this));
    this.registerView(LOREVAULT_EBOOK_IMPORT_VIEW_TYPE, leaf => new LorevaultEbookImportView(leaf, this));
    this.registerView(LOREVAULT_STORY_DELTA_VIEW_TYPE, leaf => new LorevaultStoryDeltaView(leaf, this));
    this.registerView(LOREVAULT_LORE_DELTA_VIEW_TYPE, leaf => new LorevaultLoreDeltaView(leaf, this));
    const basesViewRegistered = this.registerBasesView(
      LOREVAULT_CHARACTER_BASES_VIEW_ID,
      createLorevaultCharacterBasesViewRegistration()
    );
    if (!basesViewRegistered) {
      console.info('LoreVault: Bases are disabled in this vault; custom character Bases view was not registered.');
    }

    // Add custom ribbon icons with clearer intent.
    addIcon('lorevault-manager', `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="12" y="16" width="76" height="68" rx="10" ry="10" fill="none" stroke="currentColor" stroke-width="8"/>
      <path fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" d="M28 36h24M28 52h24M28 68h24"/>
      <circle cx="68" cy="36" r="5" fill="currentColor"/>
      <circle cx="76" cy="52" r="5" fill="currentColor"/>
      <circle cx="64" cy="68" r="5" fill="currentColor"/>
    </svg>`);
    addIcon('lorevault-chat', `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round" d="M14 18h72a8 8 0 0 1 8 8v40a8 8 0 0 1-8 8H44l-20 16v-16H14a8 8 0 0 1-8-8V26a8 8 0 0 1 8-8z"/>
      <path fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" d="M26 38h46M26 52h34"/>
    </svg>`);
    addIcon('lorevault-steering', `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="32" fill="none" stroke="currentColor" stroke-width="8"/>
      <path fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" d="M50 18v10M50 72v10M18 50h10M72 50h10"/>
      <path fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" d="M50 50l18-14"/>
      <circle cx="50" cy="50" r="6" fill="currentColor"/>
    </svg>`);

    // Add settings tab
    this.addSettingTab(new LoreBookConverterSettingTab(this.app, this));
    this.generationStatusEl = this.addStatusBarItem();
    this.pendingTextCommandReviewEl = this.addStatusBarItem();
    this.pendingTextCommandReviewEl.addClass('lorevault-text-command-pending-status');
    this.pendingTextCommandReviewEl.style.display = 'none';
    this.registerDomEvent(this.pendingTextCommandReviewEl, 'click', () => {
      void this.reviewPendingTextCommandEdit();
    });
    this.updatePendingTextCommandReviewIndicator();
    this.syncIdleGenerationTelemetryToSettings();

    // Add ribbon icon
    this.addRibbonIcon('lorevault-manager', 'Open LoreVault Manager', () => {
      void this.openLorebooksManagerView();
    });

    this.addRibbonIcon('lorevault-chat', 'Open Story Chat', () => {
      void this.openStoryChatView();
    });

    this.addRibbonIcon('lorevault-steering', 'Open Story Writing Panel', () => {
      void this.openStorySteeringView();
    });

    this.addRibbonIcon('help-circle', 'Open LoreVault Help', () => {
      void this.openHelpView();
    });

    // Add command
    this.addCommand({
      id: 'convert-to-lorebook',
      name: 'Build Active Lorebook',
      callback: () => {
        void this.buildActiveScopeExport();
      }
    });

    this.addCommand({
      id: 'open-lorebooks-manager',
      name: 'Open LoreVault Manager',
      callback: () => {
        void this.openLorebooksManagerView();
      }
    });

    this.addCommand({
      id: 'open-routing-debug',
      name: 'Open LoreVault Lorebook Auditor',
      callback: () => {
        void this.openLorebookAuditorView();
      }
    });

    this.addCommand({
      id: 'open-query-simulation',
      name: 'Open LoreVault Query Simulation',
      callback: () => {
        void this.openQuerySimulationView();
      }
    });

    this.addCommand({
      id: 'open-story-chat',
      name: 'Open Story Chat',
      callback: () => {
        void this.openStoryChatView();
      }
    });

    this.addCommand({
      id: 'open-story-starter',
      name: 'Open Story Starter',
      callback: () => {
        void this.openStoryStarterView();
      }
    });

    this.addCommand({
      id: 'open-story-steering',
      name: 'Open Story Writing Panel',
      callback: () => {
        void this.openStorySteeringView();
      }
    });

    this.addCommand({
      id: 'open-or-create-linked-author-note',
      name: 'Open or Create Linked Author Note',
      callback: () => {
        void this.openOrCreateLinkedAuthorNoteForActiveNote();
      }
    });

    this.addCommand({
      id: 'link-existing-author-note',
      name: 'Link Existing Author Note',
      callback: () => {
        void this.linkExistingAuthorNoteForActiveNote().catch(error => {
          console.error('LoreVault: Failed to link existing author note:', error);
          new Notice(`Failed to link existing author note: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    });

    this.addCommand({
      id: 'rewrite-author-note',
      name: 'Rewrite Author Note',
      callback: () => {
        void this.rewriteAuthorNoteFromActiveNote().catch(error => {
          console.error('LoreVault: Failed to rewrite author note:', error);
          new Notice(`Failed to rewrite author note: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    });

    this.addCommand({
      id: 'set-author-note-completion-profile',
      name: 'Set Author Note Completion Profile',
      callback: () => {
        void this.promptAndSetAuthorNoteCompletionPresetForActiveNote().catch(error => {
          console.error('LoreVault: Failed to set author note completion profile:', error);
          new Notice(`Failed to set author note completion profile: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    });

    this.addCommand({
      id: 'insert-inline-directive',
      name: 'Insert Inline Directive at Cursor',
      editorCallback: (editor, info) => {
        void this.insertInlineDirectiveAtCursor(editor, info);
      },
      callback: () => {
        void this.insertInlineDirectiveAtCursor();
      }
    });

    this.addCommand({
      id: 'open-lorevault-help',
      name: 'Open LoreVault Help',
      callback: () => {
        void this.openHelpView();
      }
    });

    this.addCommand({
      id: 'open-llm-operation-log-explorer',
      name: 'Open LLM Operation Log Explorer',
      callback: () => {
        void this.openOperationLogView();
      }
    });

    this.addCommand({
      id: 'open-cost-analyzer',
      name: 'Open Cost Analyzer',
      callback: () => {
        void this.openCostAnalyzerView();
      }
    });

    this.addCommand({
      id: 'rebuild-local-indexes',
      name: 'Rebuild Local Indexes',
      callback: () => {
        void this.rebuildLocalIndexes().then(() => {
          new Notice('Rebuilt local usage-ledger indexes.');
        }).catch(error => {
          console.error('LoreVault: Failed to rebuild local indexes:', error);
          new Notice(`Failed to rebuild local indexes: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    });

    this.addCommand({
      id: 'reset-local-db',
      name: 'Reset Local DB',
      callback: () => {
        if (!window.confirm('Reset the local DB? This clears local operation logs and rebuilds the current usage-ledger index from vault records.')) {
          return;
        }
        void this.resetLocalDb().then(() => {
          new Notice('Reset the local DB and rebuilt the current usage-ledger index.');
        }).catch(error => {
          console.error('LoreVault: Failed to reset local DB:', error);
          new Notice(`Failed to reset local DB: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    });

    this.addCommand({
      id: 'import-legacy-usage-ledger-now',
      name: 'Import Legacy Usage Ledger Now',
      callback: () => {
        void this.importLegacyUsageLedgerNow().then(imported => {
          new Notice(imported > 0
            ? `Imported ${imported} legacy usage-ledger entr${imported === 1 ? 'y' : 'ies'}.`
            : 'No legacy usage-ledger updates were found.');
        }).catch(error => {
          console.error('LoreVault: Failed to import legacy usage ledger:', error);
          new Notice(`Failed to import legacy usage ledger: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    });

    this.addCommand({
      id: 'show-canonical-usage-ledger-folder',
      name: 'Show Canonical Usage Ledger Folder',
      callback: () => {
        void this.revealCanonicalUsageLedgerFolder().then(path => {
          if (path) {
            new Notice(`Canonical usage-ledger folder: ${path}`);
          }
        }).catch(error => {
          console.error('LoreVault: Failed to show canonical usage-ledger folder:', error);
          new Notice(`Failed to show canonical usage-ledger folder: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    });

    this.addCommand({
      id: 'import-sillytavern-lorebook',
      name: 'Import SillyTavern Lorebook',
      callback: () => {
        void this.openImportLorebookView('lorebook_json');
      }
    });

    this.addCommand({
      id: 'import-sillytavern-character-card',
      name: 'Import SillyTavern Character Card',
      callback: () => {
        void this.openImportLorebookView('character_card');
      }
    });

    this.addCommand({
      id: 'inject-character-card-event',
      name: 'Inject Character Card Event',
      callback: () => {
        void this.injectCharacterCardEventFromActiveNote().catch(error => {
          console.error('LoreVault: Failed to inject character-card event:', error);
          new Notice(`Failed to inject character-card event: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    });

    this.addCommand({
      id: 'sync-character-card-library',
      name: 'Sync Character Card Library',
      callback: () => {
        void this.syncCharacterCardLibrary();
      }
    });

    this.addCommand({
      id: 'write-back-character-card-source',
      name: 'Write Back Character Card Source',
      callback: () => {
        void this.writeBackCharacterCardSourceFromActiveNote().catch(error => {
          console.error('LoreVault: Failed to write back character card source:', error);
          new Notice(`Failed to write back character card source: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    });

    this.addCommand({
      id: 'extract-wiki-pages-from-story',
      name: 'Extract Wiki Pages from Story',
      callback: () => {
        void this.openStoryExtractionView();
      }
    });

    this.addCommand({
      id: 'import-ebook',
      name: 'Import Ebook',
      callback: () => {
        void this.openEbookImportView();
      }
    });

    this.addCommand({
      id: 'apply-story-delta-to-existing-wiki',
      name: 'Apply Story Delta to Existing Wiki',
      callback: () => {
        void this.openStoryDeltaView();
      }
    });

    this.addCommand({
      id: 'open-lorebook-update',
      name: 'Open Lorebook Update',
      callback: () => {
        void this.openStoryDeltaView();
      }
    });

    this.addCommand({
      id: 'apply-lore-delta-to-existing-wiki',
      name: 'Apply Lore Delta to Existing Wiki',
      callback: () => {
        void this.openLoreDeltaView();
      }
    });

    this.addCommand({
      id: 'open-lore-delta',
      name: 'Open Lore Delta',
      callback: () => {
        void this.openLoreDeltaView();
      }
    });

    this.addCommand({
      id: 'continue-story-with-context',
      name: 'Continue Story with Context',
      callback: async () => {
        await this.continueStoryWithContext();
      },
      editorCheckCallback: (checking: boolean) => {
        const hasActiveMarkdown = Boolean(this.app.workspace.getActiveViewOfType(MarkdownView));
        if (!hasActiveMarkdown) {
          return false;
        }
        if (!checking) {
          void this.continueStoryWithContext();
        }
        return true;
      }
    });

    this.addCommand({
      id: 'stop-active-generation',
      name: 'Stop Active Generation',
      callback: () => {
        if (!this.generationInFlight) {
          new Notice('No active LoreVault generation to stop.');
          return;
        }
        this.stopActiveGeneration();
        this.setGenerationStatus('stopping generation...', 'busy');
        new Notice('Stopping active generation...');
      }
    });

    this.addCommand({
      id: 'run-text-command-on-selection',
      name: 'Run Text Command on Selection',
      editorCallback: (editor, info) => {
        void this.runTextCommandOnSelection(editor, info);
      }
    });

    this.addCommand({
      id: 'review-pending-text-command-edit',
      name: 'Review Pending Text Command Edit',
      checkCallback: (checking: boolean) => {
        if (this.pendingTextCommandReviews.length === 0) {
          return false;
        }
        if (!checking) {
          void this.reviewPendingTextCommandEdit();
        }
        return true;
      }
    });

    this.addCommand({
      id: 'generate-world-info-summary-active-note',
      name: 'Generate World Info Summary (Active Note)',
      callback: () => {
        void this.generateSummaryForActiveNote('world_info');
      }
    });

    this.addCommand({
      id: 'generate-keywords-active-note',
      name: 'Generate Keywords (Active Note)',
      callback: () => {
        void this.generateKeywordsForActiveNote();
      }
    });

    this.addCommand({
      id: 'split-active-story-note-into-chapters',
      name: 'Split Active Story Note into Chapter Notes',
      callback: () => {
        void this.splitActiveStoryNoteIntoChaptersCurrentFolder().catch(error => {
          console.error('LoreVault: Failed to split story note into chapter notes:', error);
          new Notice(`Failed to split story note: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    });

    this.addCommand({
      id: 'split-active-story-note-into-chapters-pick-folder',
      name: 'Split Active Story Note into Chapter Notes (Pick Folder)',
      callback: () => {
        this.splitActiveStoryNoteIntoChaptersPickFolder();
      }
    });

    this.addCommand({
      id: 'create-next-story-chapter',
      name: 'Create Next Story Chapter',
      callback: () => {
        void this.createNextStoryChapterForActiveNote().catch(error => {
          console.error('LoreVault: Failed to create next story chapter:', error);
          new Notice(`Failed to create next chapter: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    });

    this.addCommand({
      id: 'fork-story-from-active-note',
      name: 'Fork Story from Active Note',
      callback: () => {
        void this.forkStoryFromActiveNote().catch(error => {
          console.error('LoreVault: Failed to fork story:', error);
          new Notice(`Failed to fork story: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    });

    this.addCommand({
      id: 'fork-active-lorebook-scope',
      name: 'Fork Active Lorebook',
      callback: () => {
        void this.forkActiveLorebookScope().catch(error => {
          console.error('LoreVault: Failed to fork lorebook:', error);
          new Notice(`Failed to fork lorebook: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    });

    this.addCommand({
      id: 'generate-chapter-summary-active-note',
      name: 'Generate Chapter Summary (Active Note)',
      callback: () => {
        void this.generateSummaryForActiveNote('chapter');
      }
    });

    this.addCommand({
      id: 'generate-world-info-summaries-active-scope',
      name: 'Generate World Info Summaries (Active Lorebook)',
      callback: () => {
        void this.generateWorldInfoSummariesForActiveScope();
      }
    });

    this.addCommand({
      id: 'generate-chapter-summaries-current-story',
      name: 'Generate Chapter Summaries (Current Story)',
      callback: () => {
        void this.generateChapterSummariesForCurrentStory();
      }
    });

    this.addCommand({
      id: 'export-usage-report-json',
      name: 'Export Usage Report (JSON)',
      callback: () => {
        void this.exportUsageReport('json');
      }
    });

    this.addCommand({
      id: 'export-usage-report-csv',
      name: 'Export Usage Report (CSV)',
      callback: () => {
        void this.exportUsageReport('csv');
      }
    });

    this.registerEvent(this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
      const targetFile = this.resolveFileFromEditorMenuInfo(info);
      const isLorebookNote = targetFile ? this.noteBelongsToLorebookScope(targetFile) : false;
      const isAuthorNote = targetFile ? this.noteIsAuthorNote(targetFile) : false;
      const isCharacterCardMeta = targetFile ? this.noteIsCharacterCardMeta(targetFile) : false;
      const hasSelection = editor.somethingSelected() && Boolean(editor.getSelection().trim());

      menu.addSeparator();

      if (targetFile && isLorebookNote) {
        menu.addItem(item => {
          item
            .setTitle('LoreVault: Generate World Info Summary')
            .setIcon('file-text')
            .onClick(() => {
              void this.generateSummaryForNote(targetFile, 'world_info');
            });
        });

        menu.addItem(item => {
          item
            .setTitle('LoreVault: Generate Keywords')
            .setIcon('tags')
            .onClick(() => {
              void this.generateKeywordsForNote(targetFile);
            });
        });
      }

      if (this.generationInFlight) {
        menu.addItem(item => {
          item
            .setTitle('LoreVault: Stop Active Generation')
            .setIcon('square')
            .onClick(() => {
              this.stopActiveGeneration();
              this.setGenerationStatus('stopping generation...', 'busy');
              new Notice('Stopping active generation...');
            });
        });
      } else if (!isAuthorNote) {
        menu.addItem(item => {
          item
            .setTitle('LoreVault: Continue Story with Context')
            .setIcon('book-open-text')
            .onClick(() => {
              void this.continueStoryWithContext();
            });
        });
      }

      const shouldShowStoryActions = shouldShowInsertInlineDirectiveContextAction({
        isAuthorNote
      });
      if (shouldShowStoryActions) {
        menu.addItem(item => {
          item
            .setTitle('LoreVault: Insert Inline Directive')
            .setIcon('message-square-plus')
            .onClick(() => {
              void this.insertInlineDirectiveAtCursor(editor, info);
            });
        });
      }

      if (targetFile && !isAuthorNote && this.noteHasCharacterCardLink(targetFile)) {
        menu.addItem(item => {
          item
            .setTitle('LoreVault: Inject Character Card Event')
            .setIcon('wand')
            .onClick(() => {
              void this.injectCharacterCardEventFromActiveNote().catch(error => {
                console.error('LoreVault: Failed to inject character-card event:', error);
                new Notice(`Failed to inject character-card event: ${error instanceof Error ? error.message : String(error)}`);
              });
            });
        });
      }

      if (targetFile && isAuthorNote) {
        menu.addItem(item => {
          item
            .setTitle('LoreVault: Rewrite Author Note')
            .setIcon('wand')
            .onClick(() => {
              void this.rewriteAuthorNoteFromActiveNote().catch(error => {
                console.error('LoreVault: Failed to rewrite author note:', error);
                new Notice(`Failed to rewrite author note: ${error instanceof Error ? error.message : String(error)}`);
              });
            });
        });
      }

      if (targetFile && isCharacterCardMeta) {
        menu.addItem(item => {
          item
            .setTitle('LoreVault: Write Back Character Card Source')
            .setIcon('upload')
            .onClick(() => {
              void this.writeBackCharacterCardSourceFromActiveNote().catch(error => {
                console.error('LoreVault: Failed to write back character card source:', error);
                new Notice(`Failed to write back character card source: ${error instanceof Error ? error.message : String(error)}`);
              });
            });
        });
      }

      if (hasSelection) {
        menu.addItem(item => {
          item
            .setTitle('LoreVault: Run Text Command on Selection')
            .setIcon('wand')
            .onClick(() => {
              void this.runTextCommandOnSelection(editor, info);
            });
        });
      }
    }));
    
    // Add template creation command
    this.addCommand({
      id: 'create-lorebook-template',
      name: 'Create LoreVault Entry Template',
      callback: async () => {
        try {
          const template = await createTemplate(this.app, this.settings);
          
          // Check if there's an active file
          const activeFile = this.app.workspace.getActiveFile();
          
          if (activeFile) {
            // If there's an active file, replace its content
            await this.app.vault.modify(activeFile, template);
            new Notice(`Template applied to ${activeFile.name}`);
          } else {
            // Otherwise create a new file
            const fileName = `LoreVault_Entry_${Date.now()}.md`;
            await this.app.vault.create(fileName, template);
            new Notice(`Created new template: ${fileName}`);
          }
        } catch (error) {
          console.error('Template creation cancelled', error);
        }
      }
    });

    this.registerEvent(this.app.vault.on('create', file => {
      const usageLedgerChanged = this.usageLedgerStore.handleVaultCreate(file.path);
      this.liveContextIndex.markFileChanged(file);
      this.chapterSummaryStore.invalidatePath(file.path);
      this.invalidateCardMetaPathCache();
      this.handleVaultMutationForExports(file);
      this.refreshManagerViews();
      this.refreshRoutingDebugViews();
      this.refreshQuerySimulationViews();
      this.refreshStoryChatViews();
      this.refreshStorySteeringViews();
      if (usageLedgerChanged) {
        this.invalidateKnownCostProfilesCache();
        this.refreshOperationLogViews();
        this.refreshCostAnalyzerViews();
      }
    }));

    this.registerEvent(this.app.vault.on('modify', file => {
      const usageLedgerChanged = this.usageLedgerStore.handleVaultModify(file.path);
      this.liveContextIndex.markFileChanged(file);
      this.chapterSummaryStore.invalidatePath(file.path);
      this.invalidateCardMetaPathCache();
      this.handleVaultMutationForExports(file);
      this.refreshManagerViews();
      this.refreshRoutingDebugViews();
      this.refreshQuerySimulationViews();
      this.refreshStoryChatViews();
      this.refreshStorySteeringViews();
      if (usageLedgerChanged) {
        this.invalidateKnownCostProfilesCache();
        this.refreshOperationLogViews();
        this.refreshCostAnalyzerViews();
      }
    }));

    this.registerEvent(this.app.vault.on('delete', file => {
      const usageLedgerChanged = this.usageLedgerStore.handleVaultDelete(file.path);
      this.liveContextIndex.markFileChanged(file);
      this.chapterSummaryStore.invalidatePath(file.path);
      this.invalidateCardMetaPathCache();
      this.handleVaultMutationForExports(file, file.path);
      this.refreshManagerViews();
      this.refreshRoutingDebugViews();
      this.refreshQuerySimulationViews();
      this.refreshStoryChatViews();
      this.refreshStorySteeringViews();
      if (usageLedgerChanged) {
        this.invalidateKnownCostProfilesCache();
        this.refreshOperationLogViews();
        this.refreshCostAnalyzerViews();
      }
    }));

    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      const usageLedgerChanged = this.usageLedgerStore.handleVaultRename(file.path, oldPath);
      this.liveContextIndex.markRenamed(file, oldPath);
      this.chapterSummaryStore.invalidatePath(oldPath);
      this.chapterSummaryStore.invalidatePath(file.path);
      this.invalidateCardMetaPathCache();
      this.handleVaultMutationForExports(file, oldPath);
      this.refreshManagerViews();
      this.refreshRoutingDebugViews();
      this.refreshQuerySimulationViews();
      this.refreshStoryChatViews();
      this.refreshStorySteeringViews();
      if (usageLedgerChanged) {
        this.invalidateKnownCostProfilesCache();
        this.refreshOperationLogViews();
        this.refreshCostAnalyzerViews();
      }
    }));

    void this.usageLedgerStore.initialize().catch(error => {
      console.error('Failed to initialize usage ledger store:', error);
    });

    void this.liveContextIndex.initialize().catch(error => {
      console.error('Failed to initialize live context index:', error);
    });
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(LOREVAULT_MANAGER_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_ROUTING_DEBUG_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_QUERY_SIMULATION_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_STORY_CHAT_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_STORY_STARTER_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_STORY_STEERING_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_HELP_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_OPERATION_LOG_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_COST_ANALYZER_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_IMPORT_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_STORY_EXTRACT_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_EBOOK_IMPORT_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_STORY_DELTA_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_LORE_DELTA_VIEW_TYPE);
    if (this.managerRefreshTimer !== null) {
      window.clearTimeout(this.managerRefreshTimer);
      this.managerRefreshTimer = null;
    }
    if (this.exportRebuildTimer !== null) {
      window.clearTimeout(this.exportRebuildTimer);
      this.exportRebuildTimer = null;
    }
    if (this.operationLogViewRefreshTimer !== null) {
      window.clearTimeout(this.operationLogViewRefreshTimer);
      this.operationLogViewRefreshTimer = null;
    }
    // Destroy the live context index so its internal debounce timer is cancelled
    // before any async awaits below.
    this.liveContextIndex?.destroy();
    // Flush any pending operation-log writes so entries are not silently dropped.
    await this.operationLogWriteQueue;
    await this.operationLogStore?.close();
    await this.usageLedgerStore?.close();
    await this.internalDbClient?.close();
    this.internalDbClient = null;
    if (this.internalDbWorkerObjectUrl) {
      URL.revokeObjectURL(this.internalDbWorkerObjectUrl);
      this.internalDbWorkerObjectUrl = null;
    }
    this.generationStatusEl = null;
    this.pendingTextCommandReviewEl = null;
  }

  /**
   * Persist updated settings and trigger all dependent side-effects
   * (index rebuild, view refresh, etc.).
   *
   * This is intentionally named saveSettings rather than saveData so it does
   * not shadow Plugin.saveData(), which is the Obsidian API for writing
   * arbitrary JSON to disk.  Actual disk persistence is delegated to
   * persistSettingsSnapshot() which calls super.saveData() internally.
   */
  async saveSettings(settings: Partial<ConverterSettings>): Promise<void> {
    this.settings = this.mergeSettings(settings);
    let localStateUpdated = false;
    const activeDevicePresetId = this.deviceProfileState.activeCompletionPresetId;
    if (activeDevicePresetId && !this.settings.completion.presets.some(preset => preset.id === activeDevicePresetId)) {
      this.deviceProfileState.activeCompletionPresetId = '';
      localStateUpdated = true;
    }
    const activeStoryChatPresetId = this.deviceProfileState.activeStoryChatPresetId;
    if (
      activeStoryChatPresetId
      && !this.settings.completion.presets.some(preset => preset.id === activeStoryChatPresetId)
    ) {
      this.deviceProfileState.activeStoryChatPresetId = '';
      localStateUpdated = true;
    }
    if (localStateUpdated) {
      await this.persistDeviceProfileState();
    }
    await this.persistSettingsSnapshot();
    this.syncUsageLedgerStorePath();
    this.invalidateKnownCostProfilesCache();
    this.invalidateLorebookScopeCache();
    this.exportScopeIndexByPath = new Map(
      this.getCachedLorebookMetadata()
        .map(item => [item.path, this.normalizeExportScopeList(item.scopes)])
    );
    void this.usageLedgerStore.initialize().catch(error => {
      console.error('Failed to initialize usage ledger store:', error);
    });
    this.liveContextIndex?.requestFullRefresh();
    this.syncIdleGenerationTelemetryToSettings();
    this.refreshManagerViews();
    this.refreshRoutingDebugViews();
    this.refreshQuerySimulationViews();
    this.refreshStoryChatViews();
    this.refreshStorySteeringViews();
    this.refreshHelpViews();
    this.refreshOperationLogViews();
    this.refreshCostAnalyzerViews();
  }

  private resolveScopeFromActiveFile(activeFile: TFile | null): string | undefined {
    if (!activeFile) {
      return undefined;
    }

    const cache = this.app.metadataCache.getFileCache(activeFile);
    if (!cache) {
      return undefined;
    }

    const tags = getAllTags(cache) ?? [];
    const scopes = extractLorebookScopesFromTags(tags, this.settings.tagScoping.tagPrefix);
    if (scopes.length === 0) {
      return undefined;
    }
    return scopes[0];
  }

  private resolveFileFromEditorMenuInfo(info: MarkdownView | MarkdownFileInfo): TFile | null {
    if (info instanceof MarkdownView) {
      return info.file ?? this.app.workspace.getActiveFile();
    }
    return info.file ?? this.app.workspace.getActiveFile();
  }

  private handleVaultMutationForExports(file: TAbstractFile | null, oldPath?: string): void {
    if (oldPath) {
      this.lorebookScopeCache?.removePath(oldPath);
    }
    if (file instanceof TFile && file.path.toLowerCase().endsWith('.md')) {
      this.lorebookScopeCache?.invalidatePath(file.path);
    }
    const impactedScopes = this.collectImpactedScopesForChange(file, oldPath);
    this.queueBackgroundScopeRebuild(impactedScopes);
  }

  private noteBelongsToLorebookScope(file: TFile): boolean {
    return Boolean(this.resolveScopeFromActiveFile(file));
  }

  private noteHasChapterFrontmatter(file: TFile): boolean {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    return Boolean(
      parseStoryThreadNodeFromFrontmatter(file.path, file.basename, frontmatter)
    );
  }

  private noteHasAuthorNoteLink(file: TFile): boolean {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    return asStringArray(getFrontmatterValue(frontmatter, 'authorNote')).length > 0;
  }

  private noteHasCharacterCardLink(file: TFile): boolean {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    const sourcePath = normalizeVaultPath(
      asString(getFrontmatterValue(frontmatter, 'characterCardPath', 'cardPath')) ?? ''
    );
    const metaRef = asString(getFrontmatterValue(frontmatter, 'characterCardMeta', 'cardMeta')) ?? '';
    return Boolean(sourcePath || metaRef.trim());
  }

  private noteIsAuthorNote(file: TFile): boolean {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    const rawDocType = asString(getFrontmatterValue(frontmatter, 'lvDocType')) ?? '';
    const normalizedDocType = rawDocType
      .trim()
      .toLowerCase()
      .replace(/[\s_-]/g, '');
    return normalizedDocType === 'authornote';
  }

  private noteIsCharacterCardMeta(file: TFile): boolean {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    const rawDocType = asString(getFrontmatterValue(frontmatter, 'lvDocType')) ?? '';
    const normalizedDocType = rawDocType
      .trim()
      .toLowerCase()
      .replace(/[\s_-]/g, '');
    return normalizedDocType === CHARACTER_CARD_META_DOC_TYPE.toLowerCase();
  }

  private normalizeLinkLikeTarget(raw: string): string {
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

  private resolveFileFromLinkLikeTarget(raw: string, sourcePath: string): TFile | null {
    const normalizedTarget = this.normalizeLinkLikeTarget(raw);
    if (!normalizedTarget) {
      return null;
    }

    const resolved = this.app.metadataCache.getFirstLinkpathDest(normalizedTarget, sourcePath);
    if (resolved instanceof TFile) {
      return resolved;
    }

    const directCandidates = [normalizedTarget, `${normalizedTarget}.md`];
    for (const candidate of directCandidates) {
      const found = this.app.vault.getAbstractFileByPath(candidate);
      if (found instanceof TFile) {
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

  private buildCharacterCardEventOptions(
    firstMessage: string,
    alternateGreetings: string[],
    groupOnlyGreetings: string[]
  ): CharacterCardEventOption[] {
    const options: CharacterCardEventOption[] = [];
    const seenText = new Set<string>();
    const push = (label: string, text: string, category: CharacterCardEventOption['category']) => {
      const normalizedText = text.trim();
      if (!normalizedText) {
        return;
      }
      const key = normalizedText.toLowerCase();
      if (seenText.has(key)) {
        return;
      }
      seenText.add(key);
      options.push({
        label,
        text: normalizedText,
        category
      });
    };

    push('First Message', firstMessage, 'first');
    for (let index = 0; index < alternateGreetings.length; index += 1) {
      push(`Alternate ${index + 1}`, alternateGreetings[index], 'alternate');
    }
    for (let index = 0; index < groupOnlyGreetings.length; index += 1) {
      push(`Group-Only ${index + 1}`, groupOnlyGreetings[index], 'group');
    }
    return options;
  }

  private mergeCharacterCardEventOptions(...lists: CharacterCardEventOption[][]): CharacterCardEventOption[] {
    const merged: CharacterCardEventOption[] = [];
    const seenText = new Set<string>();
    for (const list of lists) {
      for (const option of list) {
        const normalizedText = option.text.trim();
        if (!normalizedText) {
          continue;
        }
        const key = normalizedText.toLowerCase();
        if (seenText.has(key)) {
          continue;
        }
        seenText.add(key);
        merged.push({
          ...option,
          text: normalizedText
        });
      }
    }
    return merged;
  }

  private async parseCharacterCardFromSourcePath(sourcePath: string): Promise<ParsedCharacterCard | null> {
    const normalizedPath = normalizeVaultPath(sourcePath.trim());
    if (!normalizedPath) {
      return null;
    }
    const abstract = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!(abstract instanceof TFile)) {
      return null;
    }
    const extension = abstract.extension.toLowerCase();
    try {
      if (extension === 'json') {
        return parseSillyTavernCharacterCardJson(await this.app.vault.read(abstract));
      }
      if (extension === 'png') {
        return parseSillyTavernCharacterCardPngBytes(await readVaultBinary(this.app, abstract.path));
      }
    } catch (error) {
      console.warn(`LoreVault: Failed to parse linked character card source "${normalizedPath}".`, error);
      return null;
    }
    return null;
  }

  private buildCharacterCardEventContextFromParsedCard(
    card: ParsedCharacterCard,
    sourceLabel: string
  ): CharacterCardEventInjectionContext {
    return {
      sourceFormat: card.sourceFormat,
      sourceLabel: sourceLabel.trim(),
      name: card.name.trim(),
      description: card.description.trim(),
      personality: card.personality.trim(),
      scenario: card.scenario.trim(),
      firstMessage: card.firstMessage.trim(),
      messageExample: card.messageExample.trim(),
      alternateGreetings: [...card.alternateGreetings],
      groupOnlyGreetings: [...card.groupOnlyGreetings],
      systemPrompt: card.systemPrompt.trim(),
      postHistoryInstructions: card.postHistoryInstructions.trim()
    };
  }

  private buildCharacterCardEventContextFromMeta(
    frontmatter: FrontmatterData,
    details: CharacterCardDetailsContent,
    sourceLabel: string
  ): CharacterCardEventInjectionContext {
    const name = asString(getFrontmatterValue(frontmatter, 'characterName', 'characterCardName', 'title')) ?? '';
    return {
      sourceFormat: 'meta',
      sourceLabel: sourceLabel.trim(),
      name: (name || 'Character').trim(),
      description: (details.cardDescription || (asString(getFrontmatterValue(frontmatter, 'cardDescription')) ?? '')).trim(),
      personality: (details.cardPersonality || (asString(getFrontmatterValue(frontmatter, 'cardPersonality')) ?? '')).trim(),
      scenario: (details.cardScenario || (asString(getFrontmatterValue(frontmatter, 'cardScenario')) ?? '')).trim(),
      firstMessage: (details.cardFirstMessage || (asString(getFrontmatterValue(frontmatter, 'cardFirstMessage')) ?? '')).trim(),
      messageExample: (details.cardMessageExample || (asString(getFrontmatterValue(frontmatter, 'cardMessageExample')) ?? '')).trim(),
      alternateGreetings: details.cardAlternateGreetings.length > 0
        ? [...details.cardAlternateGreetings]
        : asStringArray(getFrontmatterValue(frontmatter, 'cardAlternateGreetings')),
      groupOnlyGreetings: details.cardGroupOnlyGreetings.length > 0
        ? [...details.cardGroupOnlyGreetings]
        : asStringArray(getFrontmatterValue(frontmatter, 'cardGroupOnlyGreetings')),
      systemPrompt: (details.cardSystemPrompt || (asString(getFrontmatterValue(frontmatter, 'cardSystemPrompt')) ?? '')).trim(),
      postHistoryInstructions: (
        details.cardPostHistoryInstructions
        || (asString(getFrontmatterValue(frontmatter, 'cardPostHistoryInstructions')) ?? '')
      ).trim()
    };
  }

  private trimCharacterCardEventContext(
    context: CharacterCardEventInjectionContext,
    tokenBudget: number
  ): CharacterCardEventInjectionContext {
    const fieldBudget = Math.max(96, Math.floor(tokenBudget / 8));
    const listItemBudget = Math.max(40, Math.floor(fieldBudget / 2));
    const trimList = (values: string[]) => values
      .slice(0, 32)
      .map(value => this.trimTextHeadToTokenBudget(value, listItemBudget))
      .map(value => value.trim())
      .filter(Boolean);

    return {
      ...context,
      sourceLabel: this.trimTextHeadToTokenBudget(context.sourceLabel, Math.max(32, Math.floor(fieldBudget / 2))),
      name: this.trimTextHeadToTokenBudget(context.name, Math.max(32, Math.floor(fieldBudget / 2))),
      description: this.trimTextHeadToTokenBudget(context.description, fieldBudget),
      personality: this.trimTextHeadToTokenBudget(context.personality, fieldBudget),
      scenario: this.trimTextHeadToTokenBudget(context.scenario, fieldBudget),
      firstMessage: this.trimTextHeadToTokenBudget(context.firstMessage, fieldBudget),
      messageExample: this.trimTextHeadToTokenBudget(context.messageExample, fieldBudget),
      alternateGreetings: trimList(context.alternateGreetings),
      groupOnlyGreetings: trimList(context.groupOnlyGreetings),
      systemPrompt: this.trimTextHeadToTokenBudget(context.systemPrompt, fieldBudget),
      postHistoryInstructions: this.trimTextHeadToTokenBudget(context.postHistoryInstructions, fieldBudget)
    };
  }

  private async resolveCharacterCardContextForStory(storyFile: TFile): Promise<{
    cardContext: CharacterCardEventInjectionContext;
    options: CharacterCardEventOption[];
    sourceCardPath: string;
    metaPath: string;
  }> {
    const cache = this.app.metadataCache.getFileCache(storyFile);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);

    let sourceCardPath = normalizeVaultPath(
      asString(getFrontmatterValue(frontmatter, 'characterCardPath', 'cardPath')) ?? ''
    );
    const metaRef = asString(getFrontmatterValue(frontmatter, 'characterCardMeta', 'cardMeta')) ?? '';
    let metaFile = this.resolveFileFromLinkLikeTarget(metaRef, storyFile.path);

    if (!metaFile && sourceCardPath) {
      const metaPathBySource = this.findCharacterCardMetaPathBySourcePath(sourceCardPath);
      const candidate = this.app.vault.getAbstractFileByPath(metaPathBySource);
      if (candidate instanceof TFile) {
        metaFile = candidate;
      }
    }

    let parsedCard: ParsedCharacterCard | null = null;
    if (sourceCardPath) {
      parsedCard = await this.parseCharacterCardFromSourcePath(sourceCardPath);
    }

    let metaContext: CharacterCardEventInjectionContext | null = null;
    let metaOptions: CharacterCardEventOption[] = [];
    if (metaFile instanceof TFile) {
      const metaCache = this.app.metadataCache.getFileCache(metaFile);
      const metaFrontmatter = normalizeFrontmatter((metaCache?.frontmatter ?? {}) as FrontmatterData);
      if (!sourceCardPath) {
        sourceCardPath = normalizeVaultPath(
          asString(getFrontmatterValue(metaFrontmatter, 'cardPath', 'characterCardPath')) ?? ''
        );
      }
      const markdown = await this.app.vault.cachedRead(metaFile);
      const details = parseCharacterCardDetailsContentFromMarkdown(markdown);
      metaContext = this.buildCharacterCardEventContextFromMeta(metaFrontmatter, details, metaFile.path);
      metaOptions = this.buildCharacterCardEventOptions(
        metaContext.firstMessage,
        metaContext.alternateGreetings,
        metaContext.groupOnlyGreetings
      );
    }

    if (!parsedCard && sourceCardPath) {
      parsedCard = await this.parseCharacterCardFromSourcePath(sourceCardPath);
    }

    const sourceOptions = parsedCard
      ? this.buildCharacterCardEventOptions(parsedCard.firstMessage, parsedCard.alternateGreetings, parsedCard.groupOnlyGreetings)
      : [];
    const mergedOptions = this.mergeCharacterCardEventOptions(sourceOptions, metaOptions);

    const cardContext = parsedCard
      ? this.buildCharacterCardEventContextFromParsedCard(parsedCard, sourceCardPath || storyFile.path)
      : metaContext;
    if (!cardContext) {
      throw new Error('No linked character-card source or meta note was found in this story note.');
    }
    if (mergedOptions.length === 0) {
      throw new Error('No first/alternate/group greetings are available for this linked character card.');
    }

    return {
      cardContext,
      options: mergedOptions,
      sourceCardPath,
      metaPath: metaFile?.path ?? ''
    };
  }

  private async promptForCharacterCardEventSelection(options: CharacterCardEventOption[]): Promise<CharacterCardEventOption | null> {
    if (options.length === 0) {
      return null;
    }
    if (options.length === 1) {
      return options[0];
    }

    const modal = new GreetingSelectorModal(this.app, options, {
      title: 'Inject Character Card Event',
      description: 'Select an event/greeting to inject into the current story and guidance.',
      confirmLabel: 'Inject Selected'
    });
    const resultPromise = modal.waitForResult();
    modal.open();
    const result = await resultPromise;
    if (result.action !== 'use') {
      return null;
    }
    return options[result.selectedIndex] ?? null;
  }

  public async injectCharacterCardEventFromActiveNote(): Promise<void> {
    if (this.generationInFlight) {
      throw new Error('Generation is already running. Wait for the current run to finish.');
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile)) {
      throw new Error('Open a story note before injecting a character-card event.');
    }
    if (this.noteIsAuthorNote(activeFile)) {
      throw new Error('Character-card event injection is only available for story notes.');
    }

    const completionResolution = await this.resolveEffectiveCompletionForFile(activeFile);
    const completion = completionResolution.completion;
    if (!completion.enabled) {
      throw new Error('Writing completion is disabled. Enable it under LoreVault Settings -> Writing Completion.');
    }
    if (completion.provider !== 'ollama' && !completion.apiKey) {
      throw new Error('Missing completion API key. Configure it under LoreVault Settings -> Writing Completion.');
    }

    const eventContext = await this.resolveCharacterCardContextForStory(activeFile);
    const selectedEvent = await this.promptForCharacterCardEventSelection(eventContext.options);
    if (!selectedEvent) {
      return;
    }

    const originalStoryMarkdown = await this.app.vault.cachedRead(activeFile);
    const currentStoryBody = this.stripIgnoredCalloutsForLlm(stripFrontmatter(originalStoryMarkdown));
    if (!currentStoryBody) {
      throw new Error('Active story note has no markdown body to rewrite.');
    }

    const authorNoteFile = await this.storySteeringStore.resolveAuthorNoteFileForStory(activeFile);
    let originalAuthorNoteMarkdown = '';
    let currentAuthorNote = '';
    if (authorNoteFile) {
      originalAuthorNoteMarkdown = await this.app.vault.cachedRead(authorNoteFile);
      currentAuthorNote = this.stripIgnoredCalloutsForLlm(parseStorySteeringMarkdown(originalAuthorNoteMarkdown).authorNote);
    }

    const maxInputTokens = Math.max(768, completion.contextWindowTokens - completion.maxOutputTokens);
    const storyTokenBudget = Math.max(900, Math.min(120000, Math.floor(maxInputTokens * 0.62)));
    const authorNoteTokenBudget = Math.max(240, Math.min(24000, Math.floor(maxInputTokens * 0.2)));
    const cardTokenBudget = Math.max(240, Math.min(18000, Math.floor(maxInputTokens * 0.18)));
    const boundedStory = this.trimTextHeadTailToTokenBudget(currentStoryBody, storyTokenBudget);
    const boundedAuthorNote = this.trimTextHeadToTokenBudget(currentAuthorNote, authorNoteTokenBudget);
    const boundedCardContext = this.trimCharacterCardEventContext(eventContext.cardContext, cardTokenBudget);

    let usageReport: CompletionUsageReport | null = null;
    let rawResponse = '';
    try {
      this.generationInFlight = true;
      this.generationAbortController = new AbortController();
      this.setGenerationStatus('injecting character-card event', 'busy');
      rawResponse = await requestStoryContinuation(completion, {
        systemPrompt: buildCharacterCardEventInjectionSystemPrompt(),
        userPrompt: buildCharacterCardEventInjectionUserPrompt({
          card: boundedCardContext,
          selectedEventLabel: selectedEvent.label,
          selectedEventText: selectedEvent.text,
          availableEvents: eventContext.options
            .slice(0, 48)
            .map(option => ({
              label: option.label,
              text: this.trimTextHeadToTokenBudget(option.text, 96)
            })),
          storyMarkdown: boundedStory,
          authorNoteMarkdown: boundedAuthorNote
        }),
        operationName: 'character_card_event_injection',
        abortSignal: this.generationAbortController.signal,
        onOperationLog: record => this.appendCompletionOperationLog(record, {
          costProfile: this.resolveEffectiveCostProfileLabel(completion.apiKey)
        }),
        onUsage: usage => {
          usageReport = usage;
        }
      });
    } finally {
      this.generationInFlight = false;
      this.generationAbortController = null;
      this.setGenerationStatus('idle', 'idle');
    }

    if (usageReport) {
      await this.recordCompletionUsage('character_card_event_injection', usageReport, {
        notePath: activeFile.path,
        sourceCardPath: eventContext.sourceCardPath,
        sourceMetaPath: eventContext.metaPath,
        selectedEventLabel: selectedEvent.label,
        availableEventCount: eventContext.options.length,
        completionProfileSource: completionResolution.source,
        completionProfileId: completionResolution.presetId,
        completionProfileName: completionResolution.presetName,
        autoCostProfile: this.buildAutoCostProfileLabel(completion.apiKey)
      });
    }

    const parsed = parseCharacterCardEventInjectionResponse(rawResponse);
    const storyProposal = parsed.storyMarkdown.trim();
    if (!storyProposal) {
      throw new Error('Model returned empty story markdown.');
    }

    const storyReviewModal = new TextCommandReviewModal(
      this.app,
      currentStoryBody,
      storyProposal,
      'Inject Character Card Event',
      {
        title: 'Review Story Event Injection',
        promptLabel: null,
        editedTextLabel: 'Edited Story (will be saved)',
        applyButtonText: 'Save Story',
        compactDiffStats: true
      }
    );
    const storyReviewPromise = storyReviewModal.waitForResult();
    storyReviewModal.open();
    const storyReview = await storyReviewPromise;
    if (storyReview.action !== 'apply') {
      return;
    }

    let authorNoteRewrite: string | null = null;
    if (authorNoteFile && parsed.authorNoteMarkdown.trim()) {
      const authorNoteReviewModal = new TextCommandReviewModal(
        this.app,
        currentAuthorNote,
        parsed.authorNoteMarkdown.trim(),
        'Inject Character Card Event (Author Note)',
        {
          title: 'Review Author Note Update',
          promptLabel: null,
          showOriginalText: false,
          editedTextLabel: 'Edited Author Note (will be saved)',
          applyButtonText: 'Save Author Note',
          compactDiffStats: true
        }
      );
      const authorNoteReviewPromise = authorNoteReviewModal.waitForResult();
      authorNoteReviewModal.open();
      const authorNoteReview = await authorNoteReviewPromise;
      if (authorNoteReview.action === 'apply') {
        authorNoteRewrite = authorNoteReview.revisedText.trim();
      }
    }

    const latestStoryMarkdown = await this.app.vault.cachedRead(activeFile);
    if (latestStoryMarkdown !== originalStoryMarkdown) {
      throw new Error('Story note changed while generating. Re-run event injection on the latest version.');
    }
    await this.app.vault.modify(activeFile, this.preserveFrontmatterWithBody(originalStoryMarkdown, storyReview.revisedText));

    if (authorNoteFile && authorNoteRewrite !== null) {
      const latestAuthorNoteMarkdown = await this.app.vault.cachedRead(authorNoteFile);
      if (latestAuthorNoteMarkdown !== originalAuthorNoteMarkdown) {
        throw new Error('Author note changed while generating. Re-run event injection on the latest version.');
      }
      const scope: StorySteeringScope = {
        type: 'note',
        key: authorNoteFile.path
      };
      await this.saveStorySteeringScope(scope, {
        authorNote: authorNoteRewrite
      });
      this.refreshStorySteeringViews();
      new Notice(`Injected "${selectedEvent.label}" and updated story + author note.`);
      return;
    }

    new Notice(`Injected "${selectedEvent.label}" into story.`);
  }

  private buildCharacterCardWriteBackFields(
    frontmatter: FrontmatterData,
    details: CharacterCardDetailsContent
  ): CharacterCardWriteBackFields {
    const name = asString(getFrontmatterValue(frontmatter, 'characterName', 'characterCardName', 'title')) ?? '';
    return {
      name: name || 'Character',
      tags: asStringArray(getFrontmatterValue(frontmatter, 'cardTags')),
      creator: asString(getFrontmatterValue(frontmatter, 'creator', 'characterCardCreator')) ?? '',
      creatorNotes: details.creatorNotes || (asString(getFrontmatterValue(frontmatter, 'creatorNotes')) ?? ''),
      description: details.cardDescription || (asString(getFrontmatterValue(frontmatter, 'cardDescription')) ?? ''),
      personality: details.cardPersonality || (asString(getFrontmatterValue(frontmatter, 'cardPersonality')) ?? ''),
      scenario: details.cardScenario || (asString(getFrontmatterValue(frontmatter, 'cardScenario')) ?? ''),
      firstMessage: details.cardFirstMessage || (asString(getFrontmatterValue(frontmatter, 'cardFirstMessage')) ?? ''),
      messageExample: details.cardMessageExample || (asString(getFrontmatterValue(frontmatter, 'cardMessageExample')) ?? ''),
      alternateGreetings: details.cardAlternateGreetings.length > 0
        ? details.cardAlternateGreetings
        : asStringArray(getFrontmatterValue(frontmatter, 'cardAlternateGreetings')),
      groupOnlyGreetings: details.cardGroupOnlyGreetings.length > 0
        ? details.cardGroupOnlyGreetings
        : asStringArray(getFrontmatterValue(frontmatter, 'cardGroupOnlyGreetings')),
      systemPrompt: details.cardSystemPrompt || (asString(getFrontmatterValue(frontmatter, 'cardSystemPrompt')) ?? ''),
      postHistoryInstructions: details.cardPostHistoryInstructions || (asString(getFrontmatterValue(frontmatter, 'cardPostHistoryInstructions')) ?? '')
    };
  }

  public async writeBackCharacterCardSourceFromActiveNote(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile)) {
      new Notice('Open a character-card meta note before writing back.');
      return;
    }
    if (!this.noteIsCharacterCardMeta(activeFile)) {
      new Notice('Active note is not a character-card meta note.');
      return;
    }

    const cache = this.app.metadataCache.getFileCache(activeFile);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    const sourcePathRaw = asString(getFrontmatterValue(frontmatter, 'cardPath', 'characterCardPath')) ?? '';
    const sourcePath = normalizeVaultPath(sourcePathRaw);
    if (!sourcePath) {
      new Notice('This meta note does not define `cardPath`.');
      return;
    }

    const sourceAbstract = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(sourceAbstract instanceof TFile)) {
      new Notice(`Character card source file not found: ${sourcePath}`);
      return;
    }

    const extension = sourceAbstract.extension.toLowerCase();
    if (extension !== 'json' && extension !== 'png') {
      new Notice(`Unsupported character-card source extension: .${extension}`);
      return;
    }

    const expectedHash = (asString(getFrontmatterValue(frontmatter, 'cardHash')) ?? '').trim();
    let sourcePayload: unknown;
    let sourcePngBytes: Uint8Array | null = null;
    if (extension === 'json') {
      sourcePayload = JSON.parse(await this.app.vault.read(sourceAbstract));
    } else {
      sourcePngBytes = await readVaultBinary(this.app, sourceAbstract.path);
      sourcePayload = parseSillyTavernCharacterCardPngBytes(sourcePngBytes).rawPayload;
    }

    const currentHash = `sha256:${stableJsonHash(sourcePayload)}`;
    if (expectedHash && expectedHash !== currentHash) {
      new Notice('Source card changed since last sync. Run Sync Character Card Library before write-back.');
      return;
    }

    const activeMarkdown = await this.app.vault.cachedRead(activeFile);
    const details = parseCharacterCardDetailsContentFromMarkdown(activeMarkdown);
    const writeBackFields = this.buildCharacterCardWriteBackFields(frontmatter, details);
    const updatedPayload = applyCharacterCardWriteBackToPayload(sourcePayload, writeBackFields);
    const updatedHash = `sha256:${stableJsonHash(updatedPayload)}`;
    if (updatedHash === currentHash) {
      new Notice('No source-card changes detected in the meta note.');
      return;
    }

    if (extension === 'json') {
      await this.app.vault.adapter.write(sourceAbstract.path, serializeCharacterCardJsonPayload(updatedPayload));
    } else {
      if (!sourcePngBytes) {
        throw new Error('Missing source PNG bytes for write-back.');
      }
      const updatedPngBytes = upsertSillyTavernCharacterCardPngPayload(sourcePngBytes, updatedPayload);
      await writeVaultBinary(this.app, sourceAbstract.path, updatedPngBytes);
    }

    const nowIso = new Date().toISOString();
    const refreshedSource = this.app.vault.getAbstractFileByPath(sourceAbstract.path);
    await this.app.fileManager.processFrontMatter(activeFile, mutableFrontmatter => {
      mutableFrontmatter.cardHash = updatedHash;
      mutableFrontmatter.lastSynced = nowIso;
      if (refreshedSource instanceof TFile) {
        mutableFrontmatter.cardMtime = new Date(refreshedSource.stat.mtime).toISOString();
        mutableFrontmatter.cardSizeBytes = refreshedSource.stat.size;
      }
      delete mutableFrontmatter.parseError;
      delete mutableFrontmatter.syncWarnings;
    });

    new Notice(`Character card source updated from meta note: ${sourceAbstract.path}`);
  }

  public canCreateNextStoryChapterForActiveNote(file?: TFile | null): boolean {
    const activeFile = file ?? this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile)) {
      return false;
    }
    return this.noteHasChapterFrontmatter(activeFile);
  }

  public canForkStoryForActiveNote(file?: TFile | null): boolean {
    const activeFile = file ?? this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile)) {
      return false;
    }
    if (this.noteIsAuthorNote(activeFile)) {
      return false;
    }
    return this.noteHasChapterFrontmatter(activeFile) || this.noteHasAuthorNoteLink(activeFile);
  }

  private sanitizeForkNoteName(value: string): string {
    const trimmed = value.trim().replace(/\.md$/i, '');
    return trimmed;
  }

  private async promptForForkStoryName(activeFile: TFile): Promise<string | null> {
    const modal = new StoryForkNameModal(this.app, activeFile.basename, activeFile.basename);
    const resultPromise = modal.waitForResult();
    modal.open();
    return resultPromise;
  }

  private resolveForkStoryPath(activeFile: TFile, forkName: string): string {
    const normalizedName = this.sanitizeForkNoteName(forkName);
    if (!normalizedName) {
      throw new Error('Fork note name cannot be empty.');
    }
    if (normalizedName.includes('/') || normalizedName.includes('\\')) {
      throw new Error('Fork note name must not include path separators.');
    }

    const sourcePathNoExt = activeFile.path.replace(/\.md$/i, '');
    const targetPathNoExt = joinVaultPath(getVaultDirname(activeFile.path), normalizedName);
    if (normalizeVaultPath(sourcePathNoExt).toLowerCase() === normalizeVaultPath(targetPathNoExt).toLowerCase()) {
      throw new Error('Fork note name must be different from the source note.');
    }
    return `${normalizeVaultPath(targetPathNoExt)}.md`;
  }

  private buildForkedStoryMarkdown(sourceMarkdown: string): string {
    return sourceMarkdown;
  }

  private async resolveForkedAuthorNotePath(forkStoryFile: TFile): Promise<string> {
    const folder = normalizeVaultRelativePath(this.getStorySteeringFolderPath());
    const stem = slugifyIdentifier(`${forkStoryFile.basename}-author-note`) || 'author-note';
    const basePath = joinVaultPath(folder, `${stem}.md`);
    let candidatePath = basePath;
    let suffix = 2;
    while (await this.app.vault.adapter.exists(candidatePath)) {
      candidatePath = basePath.replace(/\.md$/i, `-${suffix}.md`);
      suffix += 1;
    }
    return normalizeVaultPath(candidatePath);
  }

  private async setForkStoryAuthorNoteLink(storyFile: TFile, authorNoteFile: TFile): Promise<void> {
    const linkedPath = normalizeLinkTarget(authorNoteFile.path);
    const normalizeFrontmatterKey = (value: string): string => value
      .trim()
      .toLowerCase()
      .replace(/[\s_-]/g, '');
    await this.app.fileManager.processFrontMatter(storyFile, frontmatter => {
      frontmatter.authorNote = `[[${linkedPath}]]`;
      for (const key of Object.keys(frontmatter)) {
        const normalizedKey = normalizeFrontmatterKey(key);
        if (normalizedKey === 'nextchapter' || normalizedKey === 'next') {
          delete frontmatter[key];
        }
      }
    });
  }

  private async ensureForkedAuthorNote(
    sourceStoryFile: TFile,
    forkStoryFile: TFile
  ): Promise<TFile> {
    const sourceAuthorNote = await this.storySteeringStore.resolveAuthorNoteFileForStory(sourceStoryFile);
    if (!(sourceAuthorNote instanceof TFile)) {
      return this.storySteeringStore.ensureAuthorNoteForStory(forkStoryFile);
    }

    const forkAuthorNotePath = await this.resolveForkedAuthorNotePath(forkStoryFile);
    await ensureParentVaultFolderForFile(this.app, forkAuthorNotePath);
    const sourceMarkdown = await this.app.vault.cachedRead(sourceAuthorNote);
    await this.app.vault.create(forkAuthorNotePath, sourceMarkdown);
    const forkAuthorNote = this.app.vault.getAbstractFileByPath(forkAuthorNotePath);
    if (!(forkAuthorNote instanceof TFile)) {
      throw new Error(`Failed to create forked author note at ${forkAuthorNotePath}`);
    }
    await this.setForkStoryAuthorNoteLink(forkStoryFile, forkAuthorNote);
    return forkAuthorNote;
  }

  public async forkStoryFromActiveNote(file?: TFile | null): Promise<void> {
    const activeFile = file ?? this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile)) {
      new Notice('Open a story note before forking.');
      return;
    }
    if (this.noteIsAuthorNote(activeFile)) {
      new Notice('Forking is only available from story notes, not author notes.');
      return;
    }
    if (!this.noteHasChapterFrontmatter(activeFile) && !this.noteHasAuthorNoteLink(activeFile)) {
      new Notice('Active note is not recognized as a story note (requires chapter metadata or an authorNote link).');
      return;
    }

    const requestedName = await this.promptForForkStoryName(activeFile);
    if (!requestedName) {
      return;
    }

    const targetPath = this.resolveForkStoryPath(activeFile, requestedName);
    if (await this.app.vault.adapter.exists(targetPath)) {
      throw new Error(`A note already exists at ${targetPath}. Choose a different name.`);
    }

    const sourceMarkdown = await this.app.vault.cachedRead(activeFile);
    const forkMarkdown = this.buildForkedStoryMarkdown(sourceMarkdown);
    await ensureParentVaultFolderForFile(this.app, targetPath);
    await this.app.vault.create(targetPath, forkMarkdown);

    const forkStoryFile = this.app.vault.getAbstractFileByPath(targetPath);
    if (!(forkStoryFile instanceof TFile)) {
      throw new Error(`Failed to create forked story note at ${targetPath}`);
    }

    const forkAuthorNote = await this.ensureForkedAuthorNote(activeFile, forkStoryFile);
    await this.app.workspace.getLeaf(true).openFile(forkStoryFile);
    new Notice(`Fork created: ${forkStoryFile.path} (author note: ${forkAuthorNote.path})`);
  }

  private normalizeLorebookScopeForFork(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/\\/g, '/')
      .replace(/[^a-z0-9/_\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/\/+/g, '/')
      .replace(/-+/g, '-')
      .replace(/^[-/]+|[-/]+$/g, '');
  }

  private buildDefaultLorebookForkFolder(targetScope: string): string {
    const base = this.getDefaultLorebookImportLocation();
    if (!targetScope) {
      return base;
    }
    return normalizeVaultPath(joinVaultPath(base, targetScope));
  }

  private async promptForLorebookForkRequest(sourceScope: string): Promise<LorebookForkRequest | null> {
    const suggestedScope = `${sourceScope}-fork`;
    const modal = new LorebookForkModal(
      this.app,
      sourceScope,
      this.buildDefaultLorebookForkFolder(suggestedScope)
    );
    const resultPromise = modal.waitForResult();
    modal.open();
    return resultPromise;
  }

  private collectLorebookFilesForFork(sourceScope: string): TFile[] {
    const normalizedSourceScope = normalizeScope(sourceScope);
    const branchPrefix = `${normalizedSourceScope}/`;
    return this.app.vault
      .getMarkdownFiles()
      .filter(file => {
        const scopes = this.getLorebookScopesForFile(file);
        return scopes.some(scope => scope === normalizedSourceScope || scope.startsWith(branchPrefix));
      })
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  private resolveCommonDirectory(paths: string[]): string {
    if (paths.length === 0) {
      return '';
    }
    const splitPaths = paths.map(path => normalizeVaultPath(path).split('/').filter(Boolean));
    const first = splitPaths[0];
    let commonLength = first.length;
    for (let index = 1; index < splitPaths.length; index += 1) {
      const current = splitPaths[index];
      let shared = 0;
      while (
        shared < commonLength &&
        shared < current.length &&
        first[shared].localeCompare(current[shared], undefined, { sensitivity: 'accent' }) === 0
      ) {
        shared += 1;
      }
      commonLength = shared;
      if (commonLength === 0) {
        break;
      }
    }
    return first.slice(0, commonLength).join('/');
  }

  private allocateUniqueMarkdownPath(candidatePath: string, usedPaths: Set<string>): string {
    const normalized = normalizeVaultPath(candidatePath).replace(/^\/+/, '');
    const withExt = normalized.toLowerCase().endsWith('.md')
      ? normalized
      : `${normalized}.md`;
    const folder = getVaultDirname(withExt);
    const baseName = getVaultBasename(withExt);
    const stem = baseName.replace(/\.md$/i, '') || 'entry';
    for (let attempt = 1; attempt <= 5000; attempt += 1) {
      const suffix = attempt === 1 ? '' : `-${attempt}`;
      const fileName = `${stem}${suffix}.md`;
      const candidate = folder ? `${folder}/${fileName}` : fileName;
      const normalizedCandidate = normalizeVaultPath(candidate);
      const key = normalizedCandidate.toLowerCase();
      if (usedPaths.has(key)) {
        continue;
      }
      usedPaths.add(key);
      return normalizedCandidate;
    }
    throw new Error(`Unable to allocate target path for forked lorebook file "${candidatePath}".`);
  }

  private buildRelativeVaultLinkPath(fromPath: string, toPath: string): string {
    const fromDirSegments = getVaultDirname(normalizeVaultPath(fromPath))
      .split('/')
      .filter(Boolean);
    const toSegments = normalizeVaultPath(toPath)
      .split('/')
      .filter(Boolean);
    let shared = 0;
    while (
      shared < fromDirSegments.length &&
      shared < toSegments.length &&
      fromDirSegments[shared].localeCompare(toSegments[shared], undefined, { sensitivity: 'accent' }) === 0
    ) {
      shared += 1;
    }
    const up = fromDirSegments.length - shared;
    const down = toSegments.slice(shared);
    const relativeSegments = [
      ...new Array(up).fill('..'),
      ...down
    ];
    const joined = relativeSegments.join('/');
    return joined || getVaultBasename(toPath);
  }

  private isExternalLinkTarget(target: string): boolean {
    const normalized = target.trim();
    return /^[a-z][a-z0-9+.-]*:/i.test(normalized) || normalized.startsWith('//');
  }

  private rewriteForkedWikilinks(
    markdown: string,
    sourceFile: TFile,
    sourceToTargetPath: Map<string, string>
  ): string {
    return markdown.replace(/\[\[([^\]]+)\]\]/g, (fullMatch, rawInner: string) => {
      const inner = rawInner.trim();
      if (!inner) {
        return fullMatch;
      }

      const pipeIndex = inner.indexOf('|');
      const targetAndAnchor = pipeIndex >= 0 ? inner.slice(0, pipeIndex).trim() : inner;
      const alias = pipeIndex >= 0 ? inner.slice(pipeIndex + 1) : '';
      const hashIndex = targetAndAnchor.indexOf('#');
      const targetPathRaw = (hashIndex >= 0 ? targetAndAnchor.slice(0, hashIndex) : targetAndAnchor).trim();
      const hashSuffix = hashIndex >= 0 ? targetAndAnchor.slice(hashIndex) : '';
      if (!targetPathRaw) {
        return fullMatch;
      }

      const resolved = this.app.metadataCache.getFirstLinkpathDest(targetPathRaw, sourceFile.path);
      if (!(resolved instanceof TFile)) {
        return fullMatch;
      }
      const mapped = sourceToTargetPath.get(normalizeVaultPath(resolved.path).toLowerCase());
      if (!mapped) {
        return fullMatch;
      }

      const mappedTarget = mapped.replace(/\.md$/i, '');
      const rewrittenTarget = `${mappedTarget}${hashSuffix}`;
      return alias ? `[[${rewrittenTarget}|${alias}]]` : `[[${rewrittenTarget}]]`;
    });
  }

  private rewriteForkedMarkdownLinks(
    markdown: string,
    sourceFile: TFile,
    targetFilePath: string,
    sourceToTargetPath: Map<string, string>
  ): string {
    return markdown.replace(/(!?)\[([^\]]*)\]\(([^)]+)\)/g, (fullMatch, bang: string, label: string, rawHref: string) => {
      if (bang) {
        return fullMatch;
      }

      const href = rawHref.trim();
      if (!href) {
        return fullMatch;
      }
      const firstWhitespace = href.search(/\s/);
      const hrefPathPart = firstWhitespace >= 0 ? href.slice(0, firstWhitespace) : href;
      const hrefSuffix = firstWhitespace >= 0 ? href.slice(firstWhitespace) : '';
      const hadAngleBrackets = hrefPathPart.startsWith('<') && hrefPathPart.endsWith('>');
      const hrefCore = hadAngleBrackets ? hrefPathPart.slice(1, -1) : hrefPathPart;
      if (!hrefCore || hrefCore.startsWith('#') || this.isExternalLinkTarget(hrefCore)) {
        return fullMatch;
      }

      const hashIndex = hrefCore.indexOf('#');
      const targetPathRaw = hashIndex >= 0 ? hrefCore.slice(0, hashIndex) : hrefCore;
      const hashSuffix = hashIndex >= 0 ? hrefCore.slice(hashIndex) : '';
      if (!targetPathRaw) {
        return fullMatch;
      }

      const resolved = this.app.metadataCache.getFirstLinkpathDest(targetPathRaw, sourceFile.path);
      if (!(resolved instanceof TFile)) {
        return fullMatch;
      }

      const mapped = sourceToTargetPath.get(normalizeVaultPath(resolved.path).toLowerCase());
      const resolvedTargetPath = mapped
        ? this.buildRelativeVaultLinkPath(targetFilePath, mapped)
        : this.buildRelativeVaultLinkPath(targetFilePath, resolved.path);
      const rewrittenHrefCore = `${resolvedTargetPath}${hashSuffix}`;
      const rewrittenHref = hadAngleBrackets ? `<${rewrittenHrefCore}>` : rewrittenHrefCore;
      return `[${label}](${rewrittenHref}${hrefSuffix})`;
    });
  }

  private stripLorebookTagsFromBody(markdown: string): string {
    const normalizedPrefix = normalizeTagPrefix(this.settings.tagScoping.tagPrefix);
    if (!normalizedPrefix) {
      return markdown;
    }
    const escapedPrefix = normalizedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const frontmatterMatch = markdown.match(/^---\s*\r?\n[\s\S]*?\r?\n---(?:\s*\r?\n)?/);
    const frontmatterBlock = frontmatterMatch?.[0] ?? '';
    const body = frontmatterMatch ? markdown.slice(frontmatterMatch[0].length) : markdown;
    const tagPattern = new RegExp(
      `(^|[\\s(])#${escapedPrefix}(?:\\/[A-Za-z0-9_/-]+)?(?=$|[\\s).,;:!?])`,
      'gm'
    );
    const cleanedBody = body.replace(tagPattern, (_full, prefixChar: string) => prefixChar);
    return `${frontmatterBlock}${cleanedBody}`;
  }

  private normalizeTagValue(tag: string): string {
    return tag
      .trim()
      .replace(/^#+/, '')
      .replace(/^\/+|\/+$/g, '')
      .toLowerCase();
  }

  private isLorebookTag(tag: string): boolean {
    const normalizedPrefix = normalizeTagPrefix(this.settings.tagScoping.tagPrefix);
    const normalizedTag = this.normalizeTagValue(tag);
    return normalizedTag === normalizedPrefix || normalizedTag.startsWith(`${normalizedPrefix}/`);
  }

  private uniqueCaseInsensitive(values: string[]): string[] {
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const normalized = value.trim();
      if (!normalized) {
        continue;
      }
      const key = normalized.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(normalized);
    }
    return deduped;
  }

  private async retagForkedLorebookFile(file: TFile, targetScope: string): Promise<void> {
    const normalizedPrefix = normalizeTagPrefix(this.settings.tagScoping.tagPrefix) || DEFAULT_SETTINGS.tagScoping.tagPrefix;
    const targetTag = `${normalizedPrefix}/${targetScope}`;
    await this.app.fileManager.processFrontMatter(file, frontmatter => {
      const existingTags = asStringArray(frontmatter.tags);
      const retainedTags = existingTags.filter(tag => !this.isLorebookTag(tag));
      frontmatter.tags = this.uniqueCaseInsensitive([...retainedTags, targetTag]);
    });
  }

  public async forkActiveLorebookScope(): Promise<void> {
    const sourceScope = this.resolveBuildScopeFromContext();
    if (!sourceScope) {
      new Notice('No lorebook found for forking. Open a lorebook note or set Active Lorebook.');
      return;
    }

    const sourceFiles = this.collectLorebookFilesForFork(sourceScope);
    if (sourceFiles.length === 0) {
      new Notice(`No notes found for lorebook "${sourceScope}".`);
      return;
    }

    const requested = await this.promptForLorebookForkRequest(sourceScope);
    if (!requested) {
      return;
    }

    const targetScope = this.normalizeLorebookScopeForFork(requested.targetScope);
    if (!targetScope) {
      throw new Error('New lorebook is invalid.');
    }
    const normalizedSourceScope = normalizeScope(sourceScope);
    if (targetScope === normalizedSourceScope) {
      throw new Error('New lorebook must be different from the source lorebook.');
    }
    const targetFolderRaw = normalizeVaultPath(requested.targetFolder).replace(/^\/+|\/+$/g, '');
    const targetFolder = targetFolderRaw || this.buildDefaultLorebookForkFolder(targetScope);
    let normalizedTargetFolder = '';
    try {
      normalizedTargetFolder = normalizeVaultRelativePath(targetFolder);
    } catch {
      throw new Error('Target folder must be a vault-relative path.');
    }
    if (!normalizedTargetFolder) {
      throw new Error('Target folder cannot be empty.');
    }

    const usedPaths = new Set(
      this.app.vault.getMarkdownFiles().map(file => normalizeVaultPath(file.path).toLowerCase())
    );
    const sourceDirectories = sourceFiles.map(file => getVaultDirname(file.path));
    const commonDirectory = this.resolveCommonDirectory(sourceDirectories);
    const sourceToTargetPath = new Map<string, string>();
    for (const sourceFile of sourceFiles) {
      const normalizedSourcePath = normalizeVaultPath(sourceFile.path);
      const relativeSourcePath = commonDirectory && normalizedSourcePath.startsWith(`${commonDirectory}/`)
        ? normalizedSourcePath.slice(commonDirectory.length + 1)
        : getVaultBasename(normalizedSourcePath);
      const candidatePath = normalizeVaultPath(joinVaultPath(normalizedTargetFolder, relativeSourcePath));
      const targetPath = this.allocateUniqueMarkdownPath(candidatePath, usedPaths);
      sourceToTargetPath.set(normalizedSourcePath.toLowerCase(), targetPath);
    }

    for (const sourceFile of sourceFiles) {
      const sourcePathKey = normalizeVaultPath(sourceFile.path).toLowerCase();
      const targetPath = sourceToTargetPath.get(sourcePathKey);
      if (!targetPath) {
        continue;
      }
      const sourceMarkdown = await this.app.vault.cachedRead(sourceFile);
      const rewrittenWikilinks = this.rewriteForkedWikilinks(
        sourceMarkdown,
        sourceFile,
        sourceToTargetPath
      );
      const rewrittenLinks = this.rewriteForkedMarkdownLinks(
        rewrittenWikilinks,
        sourceFile,
        targetPath,
        sourceToTargetPath
      );
      const retaggedBody = this.stripLorebookTagsFromBody(rewrittenLinks);
      await ensureParentVaultFolderForFile(this.app, targetPath);
      await this.app.vault.create(targetPath, retaggedBody);
      const createdFile = this.app.vault.getAbstractFileByPath(targetPath);
      if (createdFile instanceof TFile) {
        await this.retagForkedLorebookFile(createdFile, targetScope);
      }
    }

    this.invalidateLorebookScopeCache();
    this.refreshManagerViews();
    new Notice(
      `Forked lorebook "${sourceScope}" -> "${targetScope}" (${sourceFiles.length} note${sourceFiles.length === 1 ? '' : 's'})`
    );
  }

  private getStoryThreadNodeForFile(file: TFile): StoryThreadNode | null {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    return parseStoryThreadNodeFromFrontmatter(file.path, file.basename, frontmatter);
  }

  private allocateUniqueChapterPath(targetFolder: string, stem: string, usedPaths: Set<string>): string {
    const normalizedFolder = normalizeVaultPath(targetFolder).replace(/^\/+|\/+$/g, '');
    for (let attempt = 1; attempt <= 5000; attempt += 1) {
      const suffix = attempt === 1 ? '' : `-${attempt}`;
      const fileName = `${stem}${suffix}.md`;
      const candidate = normalizedFolder
        ? `${normalizedFolder}/${fileName}`
        : fileName;
      const normalizedCandidate = normalizeVaultPath(candidate);
      const key = normalizedCandidate.toLowerCase();
      if (usedPaths.has(key)) {
        continue;
      }
      usedPaths.add(key);
      return normalizedCandidate;
    }
    throw new Error(`Unable to allocate chapter file path for stem "${stem}".`);
  }

  private async splitStoryNoteIntoChapterNotes(activeFile: TFile, targetFolderInput: string): Promise<void> {
    const raw = await this.app.vault.cachedRead(activeFile);
    const chapterSections = splitStoryMarkdownIntoChapterSections(raw);
    if (chapterSections.length === 0) {
      new Notice('No chapter sections found. Add `##` chapter headings before splitting.');
      return;
    }

    let authorNoteFile = await this.storySteeringStore.resolveAuthorNoteFileForStory(activeFile);
    if (!(authorNoteFile instanceof TFile)) {
      authorNoteFile = await this.storySteeringStore.ensureAuthorNoteForStory(activeFile);
    }

    const cache = this.app.metadataCache.getFileCache(activeFile);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    const explicitStoryId = (asString(getFrontmatterValue(frontmatter, 'storyId', 'story')) ?? '').trim();
    const chapterStemAnchor = explicitStoryId || authorNoteFile.basename || activeFile.basename;
    const targetFolder = normalizeVaultPath(targetFolderInput).replace(/^\/+|\/+$/g, '');
    const usedPaths = new Set(
      this.app.vault.getMarkdownFiles().map(file => normalizeVaultPath(file.path).toLowerCase())
    );

    const plannedPaths = chapterSections.map(section => this.allocateUniqueChapterPath(
      targetFolder,
      buildChapterFileStem(chapterStemAnchor, section.chapterNumber, section.chapterTitle),
      usedPaths
    ));

    const createdPaths: string[] = [];
    for (let index = 0; index < chapterSections.length; index += 1) {
      const section = chapterSections[index];
      const chapterPath = plannedPaths[index];
      const previousChapterRef = index > 0 ? formatStoryChapterRef(plannedPaths[index - 1]) : '';
      const nextChapterRef = index + 1 < plannedPaths.length ? formatStoryChapterRef(plannedPaths[index + 1]) : '';
      const chapterMarkdown = buildStoryChapterNoteMarkdown(
        raw,
        {
          storyId: explicitStoryId,
          chapter: section.chapterNumber,
          chapterTitle: section.chapterTitle,
          previousChapterRefs: previousChapterRef ? [previousChapterRef] : [],
          nextChapterRefs: nextChapterRef ? [nextChapterRef] : []
        },
        section.chapterTitle,
        section.chapterBody
      );
      await ensureParentVaultFolderForFile(this.app, chapterPath);
      await this.app.vault.create(chapterPath, chapterMarkdown);
      const createdFile = this.app.vault.getAbstractFileByPath(chapterPath);
      if (createdFile instanceof TFile) {
        await this.storySteeringStore.linkStoryToAuthorNote(createdFile, authorNoteFile);
      }
      createdPaths.push(chapterPath);
    }

    if (createdPaths.length > 0) {
      const firstFile = this.app.vault.getAbstractFileByPath(createdPaths[0]);
      if (firstFile instanceof TFile) {
        void this.app.workspace.getLeaf(true).openFile(firstFile);
      }
    }

    const folderLabel = targetFolder || '(vault root)';
    new Notice(`Created ${createdPaths.length} chapter notes in ${folderLabel}.`);
  }

  private async splitActiveStoryNoteIntoChaptersCurrentFolder(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice('Open a story note before splitting chapters.');
      return;
    }

    const targetFolder = getVaultDirname(activeFile.path);
    await this.splitStoryNoteIntoChapterNotes(activeFile, targetFolder);
  }

  private splitActiveStoryNoteIntoChaptersPickFolder(): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice('Open a story note before splitting chapters.');
      return;
    }

    openVaultFolderPicker(this.app, folderPath => {
      void this.splitStoryNoteIntoChapterNotes(activeFile, folderPath).catch(error => {
        console.error('LoreVault: Failed to split story note into chapter notes:', error);
        new Notice(`Failed to split story note: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
  }

  private async createNextStoryChapterForFile(activeFile: TFile): Promise<void> {
    let authorNoteFile = await this.storySteeringStore.resolveAuthorNoteFileForStory(activeFile);
    if (!(authorNoteFile instanceof TFile)) {
      authorNoteFile = await this.storySteeringStore.ensureAuthorNoteForStory(activeFile);
    }

    const cache = this.app.metadataCache.getFileCache(activeFile);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    const explicitStoryId = (asString(getFrontmatterValue(frontmatter, 'storyId', 'story')) ?? '').trim();
    const node = this.getStoryThreadNodeForFile(activeFile);
    if (!node) {
      new Notice('Unable to resolve chapter metadata for active note.');
      return;
    }
    if (node.nextChapterRefs.length > 0) {
      new Notice('This chapter already has `nextChapter` references. Skipping new chapter creation.');
      return;
    }

    const storyNodes = this.collectStoryThreadNodes()
      .filter(item => item.storyId === node.storyId);
    const usedChapterNumbers = new Set<number>(
      storyNodes
        .map(item => item.chapter)
        .filter((value): value is number => typeof value === 'number')
    );
    const maxKnownChapter = storyNodes.reduce((maxValue, item) => {
      if (typeof item.chapter !== 'number') {
        return maxValue;
      }
      return Math.max(maxValue, item.chapter);
    }, 0);
    let nextChapterNumber = typeof node.chapter === 'number'
      ? node.chapter + 1
      : (maxKnownChapter + 1);
    while (usedChapterNumbers.has(nextChapterNumber)) {
      nextChapterNumber += 1;
    }

    const nextChapterTitle = `Chapter ${nextChapterNumber}`;
    const chapterFolder = getVaultDirname(activeFile.path);
    const usedPaths = new Set(
      this.app.vault.getMarkdownFiles().map(file => normalizeVaultPath(file.path).toLowerCase())
    );
    const chapterPath = this.allocateUniqueChapterPath(
      chapterFolder,
      buildChapterFileStem(
        explicitStoryId || authorNoteFile.basename || activeFile.basename,
        nextChapterNumber,
        nextChapterTitle
      ),
      usedPaths
    );

    const rawActive = await this.app.vault.cachedRead(activeFile);
    const newChapterMarkdown = buildStoryChapterNoteMarkdown(
      rawActive,
      {
        storyId: explicitStoryId,
        chapter: nextChapterNumber,
        chapterTitle: nextChapterTitle,
        previousChapterRefs: [formatStoryChapterRef(activeFile.path)],
        nextChapterRefs: []
      },
      nextChapterTitle,
      ''
    );
    await ensureParentVaultFolderForFile(this.app, chapterPath);
    await this.app.vault.create(chapterPath, newChapterMarkdown);
    const createdChapterFile = this.app.vault.getAbstractFileByPath(chapterPath);
    if (createdChapterFile instanceof TFile) {
      await this.storySteeringStore.linkStoryToAuthorNote(createdChapterFile, authorNoteFile);
    }

    const updatedCurrent = upsertStoryChapterFrontmatter(rawActive, {
      storyId: explicitStoryId,
      chapter: node.chapter,
      chapterTitle: node.chapterTitle || node.title || activeFile.basename,
      previousChapterRefs: node.previousChapterRefs,
      nextChapterRefs: [formatStoryChapterRef(chapterPath)]
    });
    await this.app.vault.modify(activeFile, updatedCurrent);

    const createdFile = this.app.vault.getAbstractFileByPath(chapterPath);
    if (createdFile instanceof TFile) {
      void this.app.workspace.getLeaf(true).openFile(createdFile);
    }

    new Notice(`Created next chapter: ${chapterPath}`);
  }

  public async createNextStoryChapterForActiveNote(file?: TFile | null): Promise<void> {
    const activeFile = file ?? this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice('Open a chapter note before creating the next chapter.');
      return;
    }
    await this.createNextStoryChapterForFile(activeFile);
  }

  private resolveStoryScopesFromFrontmatter(activeFile: TFile | null): string[] {
    if (!activeFile) {
      return [];
    }

    const cache = this.app.metadataCache.getFileCache(activeFile);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    return parseStoryScopesFromFrontmatter(frontmatter, this.settings.tagScoping.tagPrefix);
  }

  private async resolveStoryScopesFromAuthorNoteFrontmatter(activeFile: TFile | null): Promise<string[]> {
    if (!activeFile) {
      return [];
    }

    const authorNoteFile = await this.storySteeringStore.resolveAuthorNoteFileForStory(activeFile);
    if (!(authorNoteFile instanceof TFile)) {
      return [];
    }

    const cache = this.app.metadataCache.getFileCache(authorNoteFile);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    return parseStoryScopesFromFrontmatter(frontmatter, this.settings.tagScoping.tagPrefix);
  }

  public async resolveStoryScopeSelection(
    activeFile: TFile | null
  ): Promise<{ scopes: string[]; source: 'frontmatter' | 'author_note_frontmatter' | 'none' }> {
    const authorNoteFrontmatterScopes = await this.resolveStoryScopesFromAuthorNoteFrontmatter(activeFile);
    if (authorNoteFrontmatterScopes.length > 0) {
      return {
        scopes: authorNoteFrontmatterScopes,
        source: 'author_note_frontmatter'
      };
    }

    const frontmatterScopes = this.resolveStoryScopesFromFrontmatter(activeFile);
    if (frontmatterScopes.length > 0) {
      return {
        scopes: frontmatterScopes,
        source: 'frontmatter'
      };
    }

    return {
      scopes: [],
      source: 'none'
    };
  }

  public async updateStoryNoteLorebookScopes(filePath: string, scopes: string[]): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(normalizeVaultPath(filePath));
    if (!(file instanceof TFile)) {
      throw new Error(`Story note not found: ${filePath}`);
    }

    const normalizedScopes = parseStoryScopesFromRawValues(scopes, this.settings.tagScoping.tagPrefix);
    await this.app.fileManager.processFrontMatter(file, frontmatter => {
      if (normalizedScopes.length > 0) {
        frontmatter.lorebooks = [...normalizedScopes];
      } else {
        delete frontmatter.lorebooks;
      }
      delete frontmatter.lorebookScopes;
      delete frontmatter.lorevaultScopes;
      delete frontmatter.activeLorebooks;
    });

    this.refreshStorySteeringViews();
  }

  private collectStoryThreadNodes(): StoryThreadNode[] {
    const nodes: StoryThreadNode[] = [];
    const files = [...this.app.vault.getMarkdownFiles()].sort((a, b) => a.path.localeCompare(b.path));
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
      const node = parseStoryThreadNodeFromFrontmatter(file.path, file.basename, frontmatter);
      if (node) {
        nodes.push(node);
      }
    }
    return nodes;
  }

  private async buildChapterMemoryContext(
    activeFile: TFile | null,
    tokenBudget: number,
    aggressiveness: ChapterMemoryAggressiveness,
    queryText: string
  ): Promise<{
    markdown: string;
    usedTokens: number;
    items: string[];
    layerTrace: string[];
  }> {
    if (!activeFile || tokenBudget <= 0) {
      return { markdown: '', usedTokens: 0, items: [], layerTrace: [] };
    }

    const nodes = this.collectStoryThreadNodes();
    const resolution = resolveStoryThreadLineage(nodes, activeFile.path);
    if (!resolution || resolution.currentIndex <= 0) {
      return { markdown: '', usedTokens: 0, items: [], layerTrace: [] };
    }

    const normalizedBudget = Math.max(96, Math.floor(tokenBudget));
    const semanticSettings = this.resolveSemanticChapterRecallSettings();
    const semanticReserveBudget = semanticSettings.enabled
      ? Math.max(96, Math.min(
        Math.floor(normalizedBudget * semanticSettings.budgetShare),
        Math.floor(normalizedBudget * 0.65)
      ))
      : 0;
    const excerptReserveBudget = estimateChapterMemoryExcerptReserveTokens(
      normalizedBudget,
      aggressiveness
    );
    const summaryBudgetCap = Math.max(
      160,
      normalizedBudget - excerptReserveBudget - semanticReserveBudget
    );
    const maxExcerptChapters = estimateChapterMemoryExcerptChapterWindow(
      normalizedBudget,
      aggressiveness
    );
    const excerptRange = resolveChapterMemoryExcerptSectionTokenRange(aggressiveness);
    const nodeByPath = new Map(nodes.map(node => [node.path, node]));
    const maxPriorChapters = estimateChapterMemoryPriorChapterWindow(
      normalizedBudget,
      aggressiveness
    );
    const priorPaths = resolution.orderedPaths
      .slice(0, resolution.currentIndex)
      .slice(-maxPriorChapters);
    if (priorPaths.length === 0) {
      return { markdown: '', usedTokens: 0, items: [], layerTrace: [] };
    }

    const perSummaryTokenBudget = estimateChapterMemorySummaryTokenBudget(
      summaryBudgetCap,
      priorPaths.length,
      aggressiveness
    );
    const priorOrderByPath = new Map(priorPaths.map((path, index) => [path, index]));
    const includedSections: Array<{
      path: string;
      order: number;
      chapterTitle: string;
      heading: string;
      summaryText: string;
      summarySource: string;
      summaryTokens: number;
      excerptText?: string;
      excerptTokens?: number;
    }> = [];
    let usedTokens = 0;

    // Prioritize recent chapters when budget is constrained, then render chronologically.
    for (const priorPath of [...priorPaths].reverse()) {
      const remainingBudget = summaryBudgetCap - usedTokens;
      if (remainingBudget < 48) {
        break;
      }

      const file = this.app.vault.getAbstractFileByPath(priorPath);
      if (!(file instanceof TFile)) {
        continue;
      }

      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
      const summary = await this.chapterSummaryStore.resolveSummary(
        file,
        frontmatter,
        body => this.trimTextHeadToTokenBudget(body, perSummaryTokenBudget)
      );
      const rawSummaryText = summary?.text.trim() ?? '';
      const summarySource = summary?.source ?? 'excerpt';
      if (!rawSummaryText) {
        continue;
      }

      const node = nodeByPath.get(priorPath);
      const chapterPrefix = typeof node?.chapter === 'number'
        ? `Chapter ${node.chapter}`
        : 'Chapter';
      const chapterTitle = node?.chapterTitle || node?.title || file.basename;
      const heading = `${chapterPrefix}: ${chapterTitle}`;
      const buildSummarySection = (summaryText: string): string => [
        `### ${heading}`,
        `Source: \`${priorPath}\``,
        '',
        summaryText
      ].join('\n');

      let summaryText = this.trimTextHeadToTokenBudget(
        rawSummaryText,
        Math.max(48, Math.min(perSummaryTokenBudget, remainingBudget - 24))
      ).trim();
      if (!summaryText) {
        continue;
      }

      let section = buildSummarySection(summaryText);
      let sectionTokens = this.estimateTokens(section);
      if (sectionTokens > remainingBudget) {
        summaryText = this.trimTextHeadToTokenBudget(rawSummaryText, Math.max(48, remainingBudget - 24)).trim();
        if (!summaryText) {
          continue;
        }
        section = buildSummarySection(summaryText);
        sectionTokens = this.estimateTokens(section);
        if (sectionTokens > remainingBudget) {
          continue;
        }
      }

      usedTokens += sectionTokens;
      includedSections.push({
        path: priorPath,
        order: priorOrderByPath.get(priorPath) ?? Number.MAX_SAFE_INTEGER,
        chapterTitle,
        heading,
        summaryText,
        summarySource,
        summaryTokens: sectionTokens
      });
    }

    if (includedSections.length === 0) {
      return { markdown: '', usedTokens: 0, items: [], layerTrace: [] };
    }

    let semanticRecallMarkdown = '';
    let semanticRecallItems: string[] = [];
    let semanticRecallTrace: string[] = [];
    let remainingExcerptBudget = normalizedBudget - usedTokens;
    if (maxExcerptChapters > 0 && remainingExcerptBudget >= excerptRange.activationTokens) {
      const excerptCandidates = [...includedSections]
        .sort((left, right) => right.order - left.order)
        .slice(0, maxExcerptChapters);

      for (let index = 0; index < excerptCandidates.length; index += 1) {
        if (remainingExcerptBudget < excerptRange.activationTokens) {
          break;
        }
        const entry = excerptCandidates[index];
        const remainingCandidates = Math.max(1, excerptCandidates.length - index);
        const excerptBudget = Math.max(
          excerptRange.minTokens,
          Math.min(excerptRange.maxTokens, Math.floor(remainingExcerptBudget / remainingCandidates))
        );

        const file = this.app.vault.getAbstractFileByPath(entry.path);
        if (!(file instanceof TFile)) {
          continue;
        }

        const raw = await this.app.vault.cachedRead(file);
        const bodyWithSummary = this.stripMarkdownForLlm(stripFrontmatter(raw));
        const bodyWithoutSummary = stripSummarySectionFromBody(bodyWithSummary).trim();
        if (!bodyWithoutSummary) {
          continue;
        }

        const buildExcerptSection = (text: string): string => [
          '#### Style Excerpt',
          '',
          text
        ].join('\n');

        let excerptText = this.extractStoryWindow(bodyWithoutSummary, excerptBudget).trim();
        if (!excerptText) {
          continue;
        }
        let excerptSection = buildExcerptSection(excerptText);
        let excerptTokens = this.estimateTokens(excerptSection);
        if (excerptTokens > remainingExcerptBudget) {
          excerptText = this.extractStoryWindow(
            bodyWithoutSummary,
            Math.max(Math.floor(excerptRange.minTokens * 0.5), remainingExcerptBudget - 16)
          ).trim();
          if (!excerptText) {
            continue;
          }
          excerptSection = buildExcerptSection(excerptText);
          excerptTokens = this.estimateTokens(excerptSection);
          if (excerptTokens > remainingExcerptBudget) {
            continue;
          }
        }

        entry.excerptText = excerptText;
        entry.excerptTokens = excerptTokens;
        usedTokens += excerptTokens;
        remainingExcerptBudget -= excerptTokens;
      }
    }

    if (semanticSettings.enabled) {
      const semanticBudget = Math.max(
        0,
        Math.min(
          Math.max(0, normalizedBudget - usedTokens),
          semanticReserveBudget > 0
            ? semanticReserveBudget
            : Math.floor(normalizedBudget * semanticSettings.budgetShare)
        )
      );
      if (semanticBudget >= 72) {
        const semanticRecall = await this.buildSemanticChapterRecallContext(
          priorPaths,
          priorOrderByPath,
          nodeByPath,
          queryText,
          semanticBudget,
          semanticSettings
        );
        semanticRecallMarkdown = semanticRecall.markdown;
        semanticRecallItems = semanticRecall.items;
        semanticRecallTrace = semanticRecall.layerTrace;
        usedTokens += semanticRecall.usedTokens;
      }
    }

    includedSections.sort((left, right) => left.order - right.order);
    const chronologicalSections = includedSections.map(item => {
      const lines = [
        `### ${item.heading}`,
        `Source: \`${item.path}\``,
        '',
        item.summaryText
      ];
      if (item.excerptText) {
        lines.push('', '#### Style Excerpt', '', item.excerptText);
      }
      return lines.join('\n');
    });
    const sections = [
      chronologicalSections.join('\n\n---\n\n'),
      semanticRecallMarkdown
    ].filter(Boolean);
    const items = [
      ...includedSections.map(item => item.chapterTitle),
      ...semanticRecallItems
    ];
    const excerptCount = includedSections.filter(item => Boolean(item.excerptText)).length;
    const layerTrace = [
      `chapter_memory_window: ${includedSections.length}/${priorPaths.length} chapters (mode ${aggressiveness}, excerpts ${excerptCount}, budget ~${normalizedBudget} tokens, summary_budget ~${summaryBudgetCap} tokens)`,
      ...includedSections.map(item => [
        `chapter_memory:${item.chapterTitle}`,
        `(${item.summarySource}, summary ~${item.summaryTokens} tokens`,
        item.excerptTokens ? `, excerpt ~${item.excerptTokens} tokens` : '',
        ')'
      ].join('')),
      ...semanticRecallTrace
    ];
    const markdown = sections.join('\n\n---\n\n');

    return {
      markdown,
      usedTokens: Math.max(usedTokens, this.estimateTokens(markdown)),
      items,
      layerTrace
    };
  }

  private resolveBuildScopeFromContext(): string | null {
    const fromActiveFile = this.resolveScopeFromActiveFile(this.app.workspace.getActiveFile());
    if (fromActiveFile) {
      return fromActiveFile;
    }

    const configuredScope = normalizeScope(this.settings.tagScoping.activeScope);
    return configuredScope || null;
  }

  private async buildActiveScopeExport(): Promise<void> {
    const scope = this.resolveBuildScopeFromContext();
    if (!scope) {
      new Notice('No lorebook found for active file. Tag the note or set Active Lorebook.');
      return;
    }
    await this.convertToLorebook(scope);
  }

  private extractQueryWindow(text: string, tokenBudget: number): string {
    return extractAdaptiveQueryWindow(text, tokenBudget);
  }

  private extractStoryWindow(text: string, tokenBudget: number): string {
    return extractAdaptiveStoryWindow(text, tokenBudget);
  }

  private resolveContinuityAggressiveness(): ChapterMemoryAggressiveness {
    return normalizeChapterMemoryAggressiveness(
      this.settings.completion.continuityAggressiveness
    );
  }

  private resolveSemanticChapterRecallSettings(): CompletionSemanticChapterRecallSettings {
    const configured = this.settings.completion.semanticChapterRecall
      ?? DEFAULT_SETTINGS.completion.semanticChapterRecall;
    return {
      enabled: Boolean(configured.enabled),
      maxSourceChapters: Math.max(2, Math.floor(Number(configured.maxSourceChapters))),
      maxChunks: Math.max(1, Math.floor(Number(configured.maxChunks))),
      maxChunksPerChapter: Math.max(1, Math.floor(Number(configured.maxChunksPerChapter))),
      chunkMaxChars: Math.max(300, Math.floor(Number(configured.chunkMaxChars))),
      chunkOverlapChars: Math.max(0, Math.floor(Number(configured.chunkOverlapChars))),
      minSimilarity: Math.max(0, Math.min(1, Number(configured.minSimilarity))),
      recencyBlend: Math.max(0, Math.min(1, Number(configured.recencyBlend))),
      budgetShare: Math.max(0.05, Math.min(0.8, Number(configured.budgetShare)))
    };
  }

  private getChapterMemoryEmbeddingSignature(): string {
    const emb = this.settings.embeddings;
    return JSON.stringify({
      enabled: emb.enabled,
      provider: emb.provider,
      endpoint: emb.endpoint,
      model: emb.model,
      instruction: emb.instruction,
      batchSize: emb.batchSize,
      timeoutMs: emb.timeoutMs,
      cacheDir: emb.cacheDir,
      chunkingMode: emb.chunkingMode,
      minChunkChars: emb.minChunkChars,
      maxChunkChars: emb.maxChunkChars,
      overlapChars: emb.overlapChars
    });
  }

  private getChapterMemoryEmbeddingService(): EmbeddingService | null {
    const semanticSettings = this.resolveSemanticChapterRecallSettings();
    if (!semanticSettings.enabled) {
      this.chapterMemoryEmbeddingService = null;
      this.chapterMemoryEmbeddingSignature = '';
      return null;
    }

    const embeddings = this.settings.embeddings;
    if (!embeddings.enabled) {
      this.chapterMemoryEmbeddingService = null;
      this.chapterMemoryEmbeddingSignature = '';
      return null;
    }
    if (embeddings.provider !== 'ollama' && !embeddings.apiKey.trim()) {
      this.chapterMemoryEmbeddingService = null;
      this.chapterMemoryEmbeddingSignature = '';
      return null;
    }

    const signature = this.getChapterMemoryEmbeddingSignature();
    if (!this.chapterMemoryEmbeddingService || this.chapterMemoryEmbeddingSignature !== signature) {
      this.chapterMemoryEmbeddingService = new EmbeddingService(this.app, embeddings, {
        onOperationLog: record => this.appendEmbeddingOperationLog(record, {
          costProfile: this.resolveEffectiveCostProfileLabel(embeddings.apiKey)
        }),
        onUsage: (operationName, usage, metadata) => {
          this.recordEmbeddingUsage(operationName, usage, embeddings.apiKey, {
            source: 'chapter_memory',
            ...metadata
          });
        }
      });
      this.chapterMemoryEmbeddingSignature = signature;
    }
    return this.chapterMemoryEmbeddingService;
  }

  private splitChapterRecallSections(markdown: string): Array<{
    heading: string;
    text: string;
  }> {
    const normalized = markdown.replace(/\r\n?/g, '\n').trim();
    if (!normalized) {
      return [];
    }
    const lines = normalized.split('\n');
    const sections: Array<{ heading: string; text: string }> = [];
    let currentHeading = 'Scene';
    let currentLines: string[] = [];
    let seenAnyHeading = false;

    for (const line of lines) {
      const headingMatch = line.trim().match(/^#{1,6}\s+(.+)$/);
      if (headingMatch) {
        if (currentLines.length > 0) {
          sections.push({
            heading: currentHeading,
            text: currentLines.join('\n').trim()
          });
        }
        currentHeading = headingMatch[1].trim() || 'Scene';
        currentLines = [];
        seenAnyHeading = true;
        continue;
      }
      currentLines.push(line);
    }

    if (currentLines.length > 0) {
      sections.push({
        heading: seenAnyHeading ? currentHeading : 'Scene',
        text: currentLines.join('\n').trim()
      });
    }

    return sections.filter(section => section.text.trim().length > 0);
  }

  private splitTextForChapterRecallChunks(
    text: string,
    maxChars: number,
    overlapChars: number
  ): Array<{
    text: string;
    startOffset: number;
    endOffset: number;
  }> {
    const normalized = text.replace(/\r\n?/g, '\n').trim();
    if (!normalized) {
      return [];
    }
    const boundedMaxChars = Math.max(300, Math.floor(maxChars));
    const boundedOverlap = Math.max(0, Math.min(boundedMaxChars - 1, Math.floor(overlapChars)));
    const chunks: Array<{
      text: string;
      startOffset: number;
      endOffset: number;
    }> = [];
    let cursor = 0;

    while (cursor < normalized.length) {
      const maxEnd = Math.min(normalized.length, cursor + boundedMaxChars);
      let end = maxEnd;
      if (maxEnd < normalized.length) {
        const paragraphBreak = normalized.lastIndexOf('\n\n', maxEnd);
        const lineBreak = normalized.lastIndexOf('\n', maxEnd);
        if (paragraphBreak > cursor + Math.floor(boundedMaxChars * 0.45)) {
          end = paragraphBreak;
        } else if (lineBreak > cursor + Math.floor(boundedMaxChars * 0.65)) {
          end = lineBreak;
        }
      }
      end = Math.max(cursor + Math.min(120, boundedMaxChars), end);
      end = Math.min(normalized.length, end);

      const chunkText = normalized.slice(cursor, end).trim();
      if (chunkText) {
        chunks.push({
          text: chunkText,
          startOffset: cursor,
          endOffset: end
        });
      }

      if (end >= normalized.length) {
        break;
      }
      const nextCursor = Math.max(cursor + 1, end - boundedOverlap);
      if (nextCursor <= cursor) {
        cursor = end;
      } else {
        cursor = nextCursor;
      }
    }

    return chunks;
  }

  private async buildSemanticChapterRecallContext(
    priorPaths: string[],
    priorOrderByPath: Map<string, number>,
    nodeByPath: Map<string, StoryThreadNode>,
    queryText: string,
    tokenBudget: number,
    semanticSettings: CompletionSemanticChapterRecallSettings
  ): Promise<{
    markdown: string;
    usedTokens: number;
    items: string[];
    layerTrace: string[];
  }> {
    const normalizedQuery = queryText.trim();
    const normalizedBudget = Math.max(0, Math.floor(tokenBudget));
    if (!semanticSettings.enabled || normalizedBudget < 72 || !normalizedQuery) {
      return { markdown: '', usedTokens: 0, items: [], layerTrace: [] };
    }

    const embeddingService = this.getChapterMemoryEmbeddingService();
    if (!embeddingService) {
      return {
        markdown: '',
        usedTokens: 0,
        items: [],
        layerTrace: ['chapter_memory_semantic: disabled (embedding service unavailable)']
      };
    }

    const sourcePaths = priorPaths.slice(-semanticSettings.maxSourceChapters);
    if (sourcePaths.length === 0) {
      return { markdown: '', usedTokens: 0, items: [], layerTrace: [] };
    }

    const ragChunks: RagChunk[] = [];
    const chunkMeta = new Map<string, {
      path: string;
      order: number;
      chapterTitle: string;
      chapterHeading: string;
      sectionHeading: string;
      chunkIndex: number;
      chunkText: string;
    }>();
    const maxChapterChars = Math.max(2400, semanticSettings.chunkMaxChars * 8);
    let sourceOrdinal = 0;

    for (const sourcePath of sourcePaths) {
      const file = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!(file instanceof TFile)) {
        continue;
      }

      let chapterBody = this.stripMarkdownForLlm(stripFrontmatter(await this.app.vault.cachedRead(file)));
      chapterBody = stripSummarySectionFromBody(chapterBody).trim() || chapterBody;
      if (!chapterBody) {
        continue;
      }
      if (chapterBody.length > maxChapterChars) {
        chapterBody = chapterBody.slice(chapterBody.length - maxChapterChars).trimStart();
      }

      const node = nodeByPath.get(sourcePath);
      const chapterTitle = node?.chapterTitle || node?.title || file.basename;
      const chapterPrefix = typeof node?.chapter === 'number' ? `Chapter ${node.chapter}` : 'Chapter';
      const chapterHeading = `${chapterPrefix}: ${chapterTitle}`;
      const sectionBlocks = this.splitChapterRecallSections(chapterBody);
      let chunkOrdinal = 0;

      for (const section of sectionBlocks) {
        const splits = this.splitTextForChapterRecallChunks(
          section.text,
          semanticSettings.chunkMaxChars,
          semanticSettings.chunkOverlapChars
        );
        for (const split of splits) {
          const chunkId = `chapter-recall:${normalizeVaultPath(sourcePath)}:${chunkOrdinal}`;
          const tokenEstimate = this.estimateTokens(split.text);
          ragChunks.push({
            chunkId,
            docUid: sourceOrdinal + 1,
            scope: 'chapter_memory',
            path: sourcePath,
            title: chapterTitle,
            chunkIndex: chunkOrdinal,
            heading: section.heading,
            text: split.text,
            textHash: sha256Hex(split.text),
            tokenEstimate,
            startOffset: split.startOffset,
            endOffset: split.endOffset
          });
          chunkMeta.set(chunkId, {
            path: sourcePath,
            order: priorOrderByPath.get(sourcePath) ?? 0,
            chapterTitle,
            chapterHeading,
            sectionHeading: section.heading,
            chunkIndex: chunkOrdinal,
            chunkText: split.text
          });
          chunkOrdinal += 1;
        }
      }

      sourceOrdinal += 1;
    }

    if (ragChunks.length === 0) {
      return { markdown: '', usedTokens: 0, items: [], layerTrace: [] };
    }

    const queryEmbedding = await embeddingService.embedQuery(normalizedQuery);
    if (!queryEmbedding) {
      return {
        markdown: '',
        usedTokens: 0,
        items: [],
        layerTrace: ['chapter_memory_semantic: skipped (query embedding unavailable)']
      };
    }

    const chunkEmbeddings = await embeddingService.embedChunks(ragChunks);
    const similarityScores = embeddingService.scoreChunks(queryEmbedding, ragChunks, chunkEmbeddings);
    if (similarityScores.length === 0) {
      return { markdown: '', usedTokens: 0, items: [], layerTrace: [] };
    }

    const scored = similarityScores
      .map(score => {
        const meta = chunkMeta.get(score.chunkId);
        if (!meta) {
          return null;
        }
        const recency = priorPaths.length <= 1
          ? 1
          : Math.max(0, Math.min(1, (meta.order + 1) / priorPaths.length));
        const hybridScore = score.score * (1 - semanticSettings.recencyBlend) + recency * semanticSettings.recencyBlend;
        return {
          ...meta,
          similarity: score.score,
          hybridScore
        };
      })
      .filter((item): item is {
        path: string;
        order: number;
        chapterTitle: string;
        chapterHeading: string;
        sectionHeading: string;
        chunkIndex: number;
        chunkText: string;
        similarity: number;
        hybridScore: number;
      } => Boolean(item))
      .filter(item => item.similarity >= semanticSettings.minSimilarity)
      .sort((left, right) => (
        right.hybridScore - left.hybridScore
        || right.similarity - left.similarity
        || right.order - left.order
        || left.path.localeCompare(right.path)
        || left.chunkIndex - right.chunkIndex
      ));

    if (scored.length === 0) {
      return {
        markdown: '',
        usedTokens: 0,
        items: [],
        layerTrace: [`chapter_memory_semantic: no chunks passed similarity threshold ${semanticSettings.minSimilarity.toFixed(2)}`]
      };
    }

    const selectedSections: string[] = [];
    const selectedItems: string[] = [];
    const selectedTrace: string[] = [];
    const selectedPerChapter = new Map<string, number>();
    let usedTokens = 0;

    for (const item of scored) {
      if (selectedSections.length >= semanticSettings.maxChunks) {
        break;
      }
      const alreadySelectedForChapter = selectedPerChapter.get(item.path) ?? 0;
      if (alreadySelectedForChapter >= semanticSettings.maxChunksPerChapter) {
        continue;
      }
      const remainingBudget = normalizedBudget - usedTokens;
      if (remainingBudget < 56) {
        break;
      }
      const remainingSlots = Math.max(1, semanticSettings.maxChunks - selectedSections.length);
      const targetChunkTokens = Math.max(48, Math.floor(remainingBudget / remainingSlots) - 20);
      let chunkText = this.trimTextHeadToTokenBudget(item.chunkText, targetChunkTokens).trim();
      if (!chunkText) {
        continue;
      }
      const buildSection = (bodyText: string): string => [
        `### Related Past Scene: ${item.chapterHeading}`,
        `Source: \`${item.path}\` | section ${item.sectionHeading} | chunk ${item.chunkIndex + 1} | similarity ${item.similarity.toFixed(3)}`,
        '',
        bodyText
      ].join('\n');

      let section = buildSection(chunkText);
      let sectionTokens = this.estimateTokens(section);
      if (sectionTokens > remainingBudget) {
        chunkText = this.trimTextHeadToTokenBudget(item.chunkText, Math.max(36, remainingBudget - 24)).trim();
        if (!chunkText) {
          continue;
        }
        section = buildSection(chunkText);
        sectionTokens = this.estimateTokens(section);
        if (sectionTokens > remainingBudget) {
          continue;
        }
      }

      selectedSections.push(section);
      selectedItems.push(`${item.chapterTitle} • chunk ${item.chunkIndex + 1}`);
      selectedPerChapter.set(item.path, alreadySelectedForChapter + 1);
      usedTokens += sectionTokens;
      selectedTrace.push(
        `chapter_memory_semantic:${item.chapterTitle} chunk ${item.chunkIndex + 1} (sim ${item.similarity.toFixed(3)}, hybrid ${item.hybridScore.toFixed(3)}, ~${sectionTokens} tokens)`
      );
    }

    if (selectedSections.length === 0) {
      return { markdown: '', usedTokens: 0, items: [], layerTrace: [] };
    }

    const markdown = [
      '## Related Past Scenes',
      '',
      selectedSections.join('\n\n---\n\n')
    ].join('\n');
    return {
      markdown,
      usedTokens: this.estimateTokens(markdown),
      items: selectedItems,
      layerTrace: [
        `chapter_memory_semantic: ${selectedSections.length}/${scored.length} chunks from ${sourcePaths.length} chapters (threshold ${semanticSettings.minSimilarity.toFixed(2)}, budget ~${normalizedBudget} tokens)`,
        ...selectedTrace
      ]
    };
  }

  private sanitizeTextCommandPromptId(value: string, fallbackIndex: number): string {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (normalized) {
      return normalized;
    }
    return `prompt-${fallbackIndex + 1}`;
  }

  public getTextCommandPromptsFolder(): string {
    return this.normalizeVaultPath(
      this.settings.textCommands.promptsFolder,
      DEFAULT_SETTINGS.textCommands.promptsFolder
    );
  }

  private buildDefaultTextCommandPromptNote(template: TextCommandPromptTemplate): string {
    return [
      '---',
      'type: lorevault-prompt',
      'promptKind: text_command',
      `title: "${template.name.replace(/"/g, '\\"')}"`,
      `includeLorebookContext: ${template.includeLorebookContext ? 'true' : 'false'}`,
      '---',
      '',
      template.prompt.trim(),
      ''
    ].join('\n');
  }

  public async populateDefaultTextCommandPromptNotes(): Promise<{
    created: number;
    skipped: number;
    folder: string;
  }> {
    const folder = this.getTextCommandPromptsFolder();
    await this.ensureVaultDirectory(folder);

    let created = 0;
    let skipped = 0;
    const defaults = cloneDefaultTextCommandPromptTemplates();
    for (let index = 0; index < defaults.length; index += 1) {
      const template = defaults[index];
      const slug = this.sanitizeTextCommandPromptId(template.name, index);
      const path = `${folder}/${slug}.md`;
      const exists = await this.app.vault.adapter.exists(path);
      if (exists) {
        skipped += 1;
        continue;
      }
      await this.app.vault.adapter.write(path, this.buildDefaultTextCommandPromptNote(template));
      created += 1;
    }

    return {
      created,
      skipped,
      folder
    };
  }

  public async loadTextCommandPromptTemplates(): Promise<TextCommandPromptTemplate[]> {
    const folder = this.getTextCommandPromptsFolder();
    const prefix = `${folder}/`;
    const files = this.app.vault
      .getMarkdownFiles()
      .filter(file => file.path === folder || file.path.startsWith(prefix))
      .sort((a, b) => a.path.localeCompare(b.path));

    const templates: TextCommandPromptTemplate[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const raw = await this.app.vault.cachedRead(file);
      const prompt = this.stripIgnoredCalloutsForLlm(stripFrontmatter(raw));
      if (!prompt) {
        continue;
      }

      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
      const promptKind = asString(getFrontmatterValue(frontmatter, 'promptKind', 'promptType', 'kind'));
      if (promptKind && promptKind.toLowerCase() !== 'text_command' && promptKind.toLowerCase() !== 'textcommand') {
        continue;
      }

      const name = asString(getFrontmatterValue(frontmatter, 'title', 'name')) ?? file.basename;
      templates.push({
        id: this.sanitizeTextCommandPromptId(
          asString(getFrontmatterValue(frontmatter, 'id')) ?? file.basename,
          index
        ),
        name,
        prompt,
        includeLorebookContext: asBoolean(getFrontmatterValue(frontmatter, 'includeLorebookContext', 'include_context')) ??
          this.settings.textCommands.defaultIncludeLorebookContext
      });
    }

    const deduped = templates
      .filter((item, index, array) => array.findIndex(other => other.id === item.id) === index)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

    if (deduped.length > 0) {
      return deduped;
    }
    return cloneDefaultTextCommandPromptTemplates();
  }

  private buildTextSelectionPreview(selection: string): string {
    const normalized = selection.replace(/\r\n?/g, '\n').trim();
    if (!normalized) {
      return '';
    }
    const maxChars = 900;
    if (normalized.length <= maxChars) {
      return normalized;
    }
    return `${normalized.slice(0, maxChars).trimEnd()}\n...`;
  }

  private createPendingTextCommandReview(
    promptName: string,
    target: TextCommandTargetSnapshot,
    revisedText: string,
    options: {
      includeLorebookContext: boolean;
      scopeLabels: string[];
      worldInfoCount: number;
      ragCount: number;
      worldInfoDetails: string[];
      ragDetails: string[];
    }
  ): PendingTextCommandReview {
    return {
      id: `text-command-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      promptName,
      target: cloneTextCommandTargetSnapshot(target),
      revisedText,
      includeLorebookContext: options.includeLorebookContext,
      scopeLabels: [...options.scopeLabels],
      worldInfoCount: options.worldInfoCount,
      ragCount: options.ragCount,
      worldInfoDetails: [...options.worldInfoDetails],
      ragDetails: [...options.ragDetails],
      createdAt: Date.now()
    };
  }

  private getActiveTextCommandSelectionState(): {
    filePath: string | null;
    from: { line: number; ch: number };
    to: { line: number; ch: number };
    selectedText: string;
  } | null {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = markdownView?.editor;
    if (!editor) {
      return null;
    }
    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    return {
      filePath: markdownView.file?.path ?? null,
      from,
      to,
      selectedText: editor.getRange(from, to)
    };
  }

  private shouldOpenTextCommandReviewImmediately(review: PendingTextCommandReview): boolean {
    if (typeof document !== 'undefined' && !document.hasFocus()) {
      return false;
    }
    const activeSelection = this.getActiveTextCommandSelectionState();
    if (!activeSelection) {
      return false;
    }
    return doesTextCommandSelectionMatchSnapshot(
      review.target,
      activeSelection.filePath,
      activeSelection.from,
      activeSelection.to,
      activeSelection.selectedText
    );
  }

  private updatePendingTextCommandReviewIndicator(): void {
    if (!this.pendingTextCommandReviewEl) {
      return;
    }
    const count = this.pendingTextCommandReviews.length;
    if (count === 0) {
      this.pendingTextCommandReviewEl.setText('');
      this.pendingTextCommandReviewEl.style.display = 'none';
      this.pendingTextCommandReviewEl.removeAttribute('title');
      this.pendingTextCommandReviewEl.setAttribute('aria-label', 'No pending text-command reviews');
      return;
    }

    const nextReview = this.pendingTextCommandReviews[0];
    this.pendingTextCommandReviewEl.style.display = '';
    this.pendingTextCommandReviewEl.setText(count === 1 ? 'LoreVault text review' : `LoreVault reviews ${count}`);
    this.pendingTextCommandReviewEl.setAttribute(
      'title',
      count === 1
        ? `Pending text-command review: ${nextReview.promptName}. Click to open.`
        : `${count} pending text-command reviews. Next: ${nextReview.promptName}. Click to open.`
    );
    this.pendingTextCommandReviewEl.setAttribute(
      'aria-label',
      count === 1
        ? 'One pending text-command review'
        : `${count} pending text-command reviews`
    );
  }

  private queuePendingTextCommandReview(
    review: PendingTextCommandReview,
    options: {
      toFront?: boolean;
      noticeMessage?: string;
    } = {}
  ): void {
    if (this.pendingTextCommandReviews.some(item => item.id === review.id)) {
      this.updatePendingTextCommandReviewIndicator();
      return;
    }

    if (options.toFront) {
      this.pendingTextCommandReviews.unshift(review);
    } else {
      this.pendingTextCommandReviews.push(review);
    }
    this.updatePendingTextCommandReviewIndicator();

    if (options.noticeMessage?.trim()) {
      const count = this.pendingTextCommandReviews.length;
      new Notice(`${options.noticeMessage.trim()}${count > 1 ? ` (${count} pending).` : ''}`);
    }
  }

  private takeNextPendingTextCommandReview(): PendingTextCommandReview | null {
    const next = this.pendingTextCommandReviews.shift() ?? null;
    this.updatePendingTextCommandReviewIndicator();
    return next;
  }

  private async reviewPendingTextCommandEdit(): Promise<void> {
    if (this.pendingTextCommandReviewInFlight) {
      new Notice('A text-command review is already open.');
      return;
    }

    const review = this.takeNextPendingTextCommandReview();
    if (!review) {
      new Notice('No pending text-command reviews.');
      return;
    }

    this.pendingTextCommandReviewInFlight = true;
    try {
      await this.openTextCommandReview(review);
    } finally {
      this.pendingTextCommandReviewInFlight = false;
    }
  }

  private async openTextCommandReview(review: PendingTextCommandReview): Promise<void> {
    const reviewModal = new TextCommandReviewModal(
      this.app,
      review.target.originalText,
      review.revisedText,
      review.promptName,
      {
        cancelButtonText: 'Discard Result',
        onCloseAction: 'defer'
      }
    );
    const reviewResultPromise = reviewModal.waitForResult();
    reviewModal.open();
    const reviewResult = await reviewResultPromise;

    if (reviewResult.action === 'apply') {
      const nextReview: PendingTextCommandReview = {
        ...review,
        revisedText: reviewResult.revisedText
      };
      const applyResult = await this.applyPendingTextCommandReview(nextReview);
      if (applyResult.ok) {
        this.notifyTextCommandApplySuccess(nextReview);
        return;
      }

      this.queuePendingTextCommandReview(nextReview, {
        toFront: true,
        noticeMessage: applyResult.reason === 'selection_changed'
          ? 'Text command target changed. Review kept for later so the edit is not lost'
          : applyResult.reason === 'target_missing'
            ? 'Text command target file is no longer available. Review kept for later'
            : `Failed to apply text command edit: ${applyResult.message ?? 'unknown error'}. Review kept for later`
      });
      return;
    }

    if (reviewResult.action === 'defer') {
      this.queuePendingTextCommandReview(review, {
        toFront: true,
        noticeMessage: 'Text command review dismissed. Saved for later review'
      });
      return;
    }

    new Notice('Text command discarded.');
  }

  private async applyPendingTextCommandReview(review: PendingTextCommandReview): Promise<TextCommandApplyResult> {
    const activeSelection = this.getActiveTextCommandSelectionState();
    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (
      activeSelection
      && activeMarkdownView?.editor
      && doesTextCommandSelectionMatchSnapshot(
        review.target,
        activeSelection.filePath,
        activeSelection.from,
        activeSelection.to,
        activeSelection.selectedText
      )
    ) {
      activeMarkdownView.editor.replaceRange(review.revisedText, review.target.from, review.target.to);
      return { ok: true };
    }

    const targetPath = review.target.filePath;
    if (!targetPath) {
      return {
        ok: false,
        reason: 'selection_changed'
      };
    }

    const abstract = this.app.vault.getAbstractFileByPath(targetPath);
    if (!(abstract instanceof TFile)) {
      return {
        ok: false,
        reason: 'target_missing'
      };
    }

    try {
      await this.app.vault.process(abstract, data => {
        const replaced = replaceTextCommandTargetRange(data, review.target, review.revisedText);
        if (!replaced.ok) {
          throw new Error(replaced.reason);
        }
        return replaced.text;
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'selection_mismatch' || message === 'line_out_of_range') {
        return {
          ok: false,
          reason: 'selection_changed'
        };
      }
      console.error('Failed to apply pending text-command review:', error);
      return {
        ok: false,
        reason: 'write_failed',
        message
      };
    }
  }

  private notifyTextCommandApplySuccess(review: PendingTextCommandReview): void {
    if (review.includeLorebookContext) {
      new Notice(
        `Applied text command (${review.scopeLabels.join(', ') || '(all)'} | world_info ${review.worldInfoCount}, fallback ${review.ragCount}).`
      );
    } else {
      new Notice('Applied text command edit.');
    }

    if (review.includeLorebookContext && (review.worldInfoDetails.length > 0 || review.ragDetails.length > 0)) {
      new Notice(
        [
          'text command context',
          `world_info: ${review.worldInfoDetails.join(', ') || '(none)'}`,
          `fallback: ${review.ragDetails.join(', ') || '(none)'}`
        ].join('\n')
      );
    }
  }

  private async promptForTextCommandSelection(selectionText: string): Promise<TextCommandPromptSelectionResult> {
    const templates = await this.loadTextCommandPromptTemplates();
    const modal = new TextCommandPromptModal(this.app, {
      templates,
      defaultIncludeLorebookContext: this.settings.textCommands.defaultIncludeLorebookContext,
      selectedTextPreview: this.buildTextSelectionPreview(selectionText)
    });
    const resultPromise = modal.waitForResult();
    modal.open();
    return resultPromise;
  }

  private async buildTextCommandLoreContext(
    selectionText: string,
    activeFile: TFile | null
  ): Promise<{
    markdown: string;
    selectedScopeLabels: string[];
    worldInfoCount: number;
    ragCount: number;
    worldInfoDetails: string[];
    ragDetails: string[];
    usedTokens: number;
  }> {
    const frontmatterScopes = this.resolveStoryScopesFromFrontmatter(activeFile);
    const fallbackScope = this.resolveScopeFromActiveFile(activeFile) ?? normalizeScope(this.settings.tagScoping.activeScope);
    const scopesToQuery = frontmatterScopes.length > 0
      ? frontmatterScopes
      : (fallbackScope ? [fallbackScope] : []);
    const targetScopes = scopesToQuery.length > 0 ? scopesToQuery : [''];
    const budget = Math.max(128, Math.floor(this.settings.textCommands.maxContextTokens));
    const perScopeBudget = Math.max(96, Math.floor(budget / Math.max(1, targetScopes.length)));
    const queryEmbedding = await this.liveContextIndex.computeQueryEmbedding(selectionText);

    const contexts: AssembledContext[] = await Promise.all(targetScopes.map(scope => this.liveContextIndex.query({
      queryText: selectionText,
      queryEmbedding,
      tokenBudget: perScopeBudget
    }, scope)));

    const selectedScopeLabels = contexts.map(item => item.scope || '(all)');
    const markdown = contexts
      .map(item => item.markdown)
      .filter(Boolean)
      .join('\n\n---\n\n');
    const worldInfoCount = contexts.reduce((sum, item) => sum + item.worldInfo.length, 0);
    const ragCount = contexts.reduce((sum, item) => sum + item.rag.length, 0);
    const worldInfoDetails = contexts
      .flatMap(item => item.worldInfo.slice(0, 5).map(entry => entry.entry.comment))
      .slice(0, 8);
    const ragDetails = contexts
      .flatMap(item => item.rag.slice(0, 5).map(entry => entry.document.title))
      .slice(0, 8);
    const usedTokens = contexts.reduce((sum, item) => sum + item.usedTokens, 0);

    return {
      markdown,
      selectedScopeLabels,
      worldInfoCount,
      ragCount,
      worldInfoDetails,
      ragDetails,
      usedTokens
    };
  }

  async runTextCommandOnSelection(editorOverride?: Editor, infoOverride?: MarkdownView | MarkdownFileInfo): Promise<void> {
    if (this.generationInFlight) {
      new Notice('Generation is already running. Wait for the current run to finish.');
      return;
    }

    const markdownView = infoOverride instanceof MarkdownView
      ? infoOverride
      : this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = editorOverride ?? markdownView?.editor;
    if (!editor) {
      new Notice('No active markdown editor found.');
      return;
    }

    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    const selectedText = editor.getRange(from, to);
    if (!selectedText.trim()) {
      new Notice('Select text in the editor first.');
      return;
    }

    const selection = await this.promptForTextCommandSelection(selectedText);
    if (selection.action !== 'run') {
      return;
    }
    if (!selection.promptText.trim()) {
      new Notice('Prompt cannot be empty.');
      return;
    }

    const activeFile = infoOverride instanceof MarkdownView
      ? (infoOverride.file ?? this.app.workspace.getActiveFile())
      : (markdownView?.file ?? this.app.workspace.getActiveFile());
    const targetSnapshot: TextCommandTargetSnapshot = {
      filePath: activeFile?.path ?? null,
      from: cloneTextCommandPosition(from),
      to: cloneTextCommandPosition(to),
      originalText: selectedText
    };

    let revisedText = '';
    let loreContextMarkdown = '';
    let worldInfoCount = 0;
    let ragCount = 0;
    let scopeLabels: string[] = [];
    let worldInfoDetails: string[] = [];
    let ragDetails: string[] = [];

    try {
      this.generationInFlight = true;
      this.generationAbortController = new AbortController();
      this.setGenerationStatus('running text command', 'busy');
      const completionResolution = await this.resolveEffectiveCompletionForFile(activeFile);
      const completion = completionResolution.completion;
      if (!completion.enabled) {
        new Notice('Writing completion is disabled. Enable it under LoreVault Settings → Writing Completion.');
        return;
      }
      if (completion.provider !== 'ollama' && !completion.apiKey) {
        new Notice('Missing completion API key. Configure it under LoreVault Settings → Writing Completion.');
        return;
      }

      if (selection.includeLorebookContext) {
        const context = await this.buildTextCommandLoreContext(selectedText, activeFile);
        loreContextMarkdown = context.markdown;
        worldInfoCount = context.worldInfoCount;
        ragCount = context.ragCount;
        scopeLabels = context.selectedScopeLabels;
        worldInfoDetails = context.worldInfoDetails;
        ragDetails = context.ragDetails;
      }

      const userPrompt = [
        `<instruction>${selection.promptText}</instruction>`,
        '',
        '<lorevault_context>',
        selection.includeLorebookContext
          ? (loreContextMarkdown || '[No lorebook context found for this selection.]')
          : '[Lorebook context disabled for this command.]',
        '</lorevault_context>',
        '',
        '<selected_text>',
        selectedText,
        '</selected_text>',
        '',
        'Return only the transformed text.',
        'Do not add explanations, labels, markdown fences, or notes.'
      ].join('\n');

      revisedText = await requestStoryContinuation(completion, {
        systemPrompt: this.settings.textCommands.systemPrompt,
        userPrompt,
        operationName: 'text_command_edit',
        onOperationLog: record => this.appendCompletionOperationLog(record, {
          costProfile: this.resolveEffectiveCostProfileLabel(completion.apiKey)
        }),
        onUsage: usage => {
          void this.recordCompletionUsage('text_command_edit', usage, {
            promptTemplateId: selection.promptId,
            includeLorebookContext: selection.includeLorebookContext,
            worldInfoCount,
            ragCount,
            scopeCount: scopeLabels.length,
            scopes: scopeLabels,
            completionProfileSource: completionResolution.source,
            completionProfileId: completionResolution.presetId,
            completionProfileName: completionResolution.presetName,
            autoCostProfile: this.buildAutoCostProfileLabel(completionResolution.completion.apiKey)
          });
        }
      });

      if (!revisedText.trim()) {
        throw new Error('Model returned empty output.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Text command failed:', error);
      new Notice(`Text command failed: ${message}`);
      return;
    } finally {
      this.generationInFlight = false;
      this.generationAbortController = null;
      this.setGenerationStatus('idle', 'idle');
    }

    const review = this.createPendingTextCommandReview(
      selection.promptName,
      targetSnapshot,
      revisedText,
      {
        includeLorebookContext: selection.includeLorebookContext,
        scopeLabels,
        worldInfoCount,
        ragCount,
        worldInfoDetails,
        ragDetails
      }
    );

    if (this.settings.textCommands.autoAcceptEdits) {
      const applyResult = await this.applyPendingTextCommandReview(review);
      if (applyResult.ok) {
        this.notifyTextCommandApplySuccess(review);
        return;
      }

      this.queuePendingTextCommandReview(review, {
        noticeMessage: applyResult.reason === 'selection_changed'
          ? 'Auto-accept could not safely apply the text command. Saved for later review'
          : applyResult.reason === 'target_missing'
            ? 'Text command target file is unavailable. Saved for later review'
            : `Failed to auto-apply text command edit: ${applyResult.message ?? 'unknown error'}. Saved for later review`
      });
      return;
    }

    if (!this.shouldOpenTextCommandReviewImmediately(review)) {
      this.queuePendingTextCommandReview(review, {
        noticeMessage: 'Text command finished while you were elsewhere. Saved for later review'
      });
      return;
    }

    this.pendingTextCommandReviewInFlight = true;
    try {
      await this.openTextCommandReview(review);
    } finally {
      this.pendingTextCommandReviewInFlight = false;
    }
  }

  async continueStoryWithContext(file?: TFile | null): Promise<void> {
    if (this.generationInFlight) {
      new Notice('LoreVault generation is already running.');
      return;
    }

    const activeFile = file ?? this.app.workspace.getActiveFile();
    const markdownView = await this.resolveEditableMarkdownViewForFile(activeFile);
    if (!markdownView) {
      new Notice('No active markdown editor found.');
      return;
    }

    const editor = markdownView.editor;
    const resolvedActiveFile = markdownView.file ?? activeFile;
    const cursor = editor.getCursor();
    const rawTextBeforeCursor = editor.getRange({ line: 0, ch: 0 }, cursor);
    const textBeforeCursorForQuery = stripInlineLoreDirectives(rawTextBeforeCursor, this.getPromptCleanupOptions());
    const fallbackQuery = resolvedActiveFile?.basename ?? 'story continuation';
    let targetScopes: string[] = [];
    let targetScopeLabels: string[] = ['(none)'];
    let initialScopeLabel = '(none)';
    let scopeSelectionSource: 'frontmatter' | 'author_note_frontmatter' | 'none' = 'none';

    try {
      this.generationInFlight = true;
      this.generationAbortController = new AbortController();
      const completionResolution = await this.resolveEffectiveCompletionForFile(resolvedActiveFile);
      const completion = completionResolution.completion;
      if (!completion.enabled) {
        new Notice('Writing completion is disabled. Enable it under LoreVault Settings → Writing Completion.');
        return;
      }
      if (completion.provider !== 'ollama' && !completion.apiKey) {
        new Notice('Missing completion API key. Configure it under LoreVault Settings → Writing Completion.');
        return;
      }
      const scopedSteering = await this.storySteeringStore.resolveEffectiveStateForFile(resolvedActiveFile);
      const scopeSelection = await this.resolveStoryScopeSelection(resolvedActiveFile);
      scopeSelectionSource = scopeSelection.source;
      targetScopes = scopeSelection.scopes;
      targetScopeLabels = targetScopes.length > 0
        ? targetScopes.map(scope => scope || '(all)')
        : ['(none)'];
      initialScopeLabel = this.renderScopeListLabel(targetScopeLabels);
      const startedAt = Date.now();
      this.updateGenerationTelemetry({
        ...this.createDefaultGenerationTelemetry(),
        state: 'preparing',
        statusText: 'preparing',
        startedAt,
        updatedAt: startedAt,
        provider: completion.provider,
        model: completion.model,
        scopes: targetScopeLabels,
        contextWindowTokens: completion.contextWindowTokens,
        maxInputTokens: Math.max(512, completion.contextWindowTokens - completion.maxOutputTokens),
        promptReserveTokens: completion.promptReserveTokens,
        maxOutputTokens: completion.maxOutputTokens
      });
      this.setGenerationStatus(`preparing | lorebooks ${initialScopeLabel}`, 'busy');

      const maxInputTokens = Math.max(512, completion.contextWindowTokens - completion.maxOutputTokens);
      const continuityAggressiveness = this.resolveContinuityAggressiveness();
      const continuityFromFrontmatter = this.resolveContinuityFromFrontmatter(resolvedActiveFile);
      const mergedContinuity = {
        plotThreads: this.mergeSteeringList(
          continuityFromFrontmatter.plotThreads
        ),
        openLoops: this.mergeSteeringList(
          continuityFromFrontmatter.openLoops
        ),
        canonDeltas: this.mergeSteeringList(
          continuityFromFrontmatter.canonDeltas
        ),
        selection: continuityFromFrontmatter.selection
      };
      const continuityMarkdown = this.buildContinuityMarkdown({
        plotThreads: mergedContinuity.plotThreads,
        openLoops: mergedContinuity.openLoops,
        canonDeltas: mergedContinuity.canonDeltas,
        selection: mergedContinuity.selection
      });
      const steeringSections = this.createSteeringSections({
        maxInputTokens,
        authorNote: scopedSteering.merged.authorNote
      });
      const systemSteeringMarkdown = this.renderSteeringPlacement(steeringSections, 'system');
      const preHistorySteeringMarkdown = this.renderSteeringPlacement(steeringSections, 'pre_history');
      const preResponseSteeringMarkdown = this.renderSteeringPlacement(steeringSections, 'pre_response');
      const effectiveSystemPrompt = systemSteeringMarkdown
        ? [
          completion.systemPrompt,
          '',
          STEERING_GUIDANCE_SYSTEM_PROMPT,
          '',
          '<lorevault_steering_system>',
          systemSteeringMarkdown,
          '</lorevault_steering_system>'
        ].join('\n')
        : [completion.systemPrompt, '', STEERING_GUIDANCE_SYSTEM_PROMPT].join('\n');
      const instructionOverhead = this.estimateTokens(effectiveSystemPrompt) + 180;
      const steeringSystemTokens = steeringSections
        .filter(section => section.placement === 'system')
        .reduce((sum, section) => sum + section.usedTokens, 0);
      const steeringPreHistoryTokens = steeringSections
        .filter(section => section.placement === 'pre_history')
        .reduce((sum, section) => sum + section.usedTokens, 0);
      const steeringPreResponseTokens = steeringSections
        .filter(section => section.placement === 'pre_response')
        .reduce((sum, section) => sum + section.usedTokens, 0);
      const steeringNonSystemTokens = steeringPreHistoryTokens + steeringPreResponseTokens;
      const reservedByPlacement = (placement: PromptLayerPlacement): number => steeringSections
        .filter(section => section.placement === placement)
        .reduce((sum, section) => sum + section.reservedTokens, 0);
      const trimmedByPlacement = (placement: PromptLayerPlacement): boolean => steeringSections
        .some(section => section.placement === placement && section.trimmed);
      const availablePromptBudget = Math.max(
        256,
        maxInputTokens - completion.promptReserveTokens - instructionOverhead - steeringNonSystemTokens
      );
      const desiredContextReserve = Math.max(1024, Math.min(32000, Math.floor(availablePromptBudget * 0.22)));
      const baselineStoryTarget = Math.max(256, Math.floor(availablePromptBudget * 0.62));
      const maxStoryTokensForContext = Math.max(64, availablePromptBudget - desiredContextReserve);
      const storyTokenTarget = Math.max(64, Math.min(baselineStoryTarget, maxStoryTokensForContext));
      const queryTokenTarget = Math.max(900, Math.min(40000, Math.floor(maxInputTokens * 0.22)));
      const queryText = this.extractQueryWindow(textBeforeCursorForQuery, queryTokenTarget);
      const scopedQuery = queryText || fallbackQuery;
      const initialStoryWindow = rawTextBeforeCursor;
      let storyWindow = this.extractStoryWindow(initialStoryWindow, storyTokenTarget);
      let storyTokens = this.estimateTokens(storyWindow);
      let availableForContext = maxInputTokens - completion.promptReserveTokens - instructionOverhead - steeringNonSystemTokens - storyTokens;

      if (availableForContext < 128 && initialStoryWindow.trim().length > 0) {
        const reducedStoryBudget = Math.max(
          64,
          availablePromptBudget - Math.max(512, Math.min(12000, Math.floor(availablePromptBudget * 0.12)))
        );
        storyWindow = this.extractStoryWindow(initialStoryWindow, reducedStoryBudget);
        storyTokens = this.estimateTokens(storyWindow);
        availableForContext = maxInputTokens - completion.promptReserveTokens - instructionOverhead - steeringNonSystemTokens - storyTokens;
      }

      let chapterMemoryMarkdown = '';
      let chapterMemoryTokens = 0;
      let chapterMemoryBudget = 0;
      let chapterMemoryItems: string[] = [];
      let chapterMemoryLayerTrace: string[] = [];
      if (availableForContext > 96 && resolvedActiveFile) {
        const chapterMemoryCapTokens = continuityAggressiveness === 'aggressive'
          ? Math.max(
            1400,
            Math.min(24000, Math.floor(maxInputTokens * 0.30))
          )
          : Math.max(
            900,
            Math.min(9000, Math.floor(maxInputTokens * 0.22))
          );
        const chapterMemoryShare = continuityAggressiveness === 'aggressive'
          ? (maxInputTokens >= 120000 ? 0.5 : 0.42)
          : (maxInputTokens >= 120000 ? 0.36 : 0.30);
        const minChapterMemoryBudget = continuityAggressiveness === 'aggressive' ? 128 : 96;
        chapterMemoryBudget = Math.min(
          chapterMemoryCapTokens,
          Math.max(minChapterMemoryBudget, Math.floor(Math.max(0, availableForContext) * chapterMemoryShare))
        );
        const chapterMemory = await this.buildChapterMemoryContext(
          resolvedActiveFile,
          chapterMemoryBudget,
          continuityAggressiveness,
          scopedQuery || storyWindow
        );
        chapterMemoryMarkdown = chapterMemory.markdown;
        chapterMemoryTokens = chapterMemory.usedTokens;
        chapterMemoryItems = chapterMemory.items;
        chapterMemoryLayerTrace = chapterMemory.layerTrace;
        availableForContext -= chapterMemoryTokens;
      }
      availableForContext = Math.max(64, availableForContext);

      let contextBudget = Math.max(
        64,
        Math.min(
          availableForContext,
          Math.max(this.settings.defaultLoreBook.tokenBudget, Math.floor(availableForContext * 0.92))
        )
      );
      this.updateGenerationTelemetry({
        state: 'retrieving',
        statusText: 'retrieving',
        scopes: targetScopeLabels,
        maxInputTokens,
        promptReserveTokens: completion.promptReserveTokens,
        estimatedInstructionTokens: instructionOverhead,
        storyTokens,
        contextRemainingTokens: Math.max(0, availableForContext),
        contextUsedTokens: chapterMemoryTokens + steeringNonSystemTokens
      });
      this.setGenerationStatus(
        `retrieving | lorebooks ${initialScopeLabel} | ctx ${Math.max(0, availableForContext)} left`,
        'busy'
      );

      let contexts: AssembledContext[] = [];
      let remainingInputTokens = maxInputTokens - completion.promptReserveTokens - instructionOverhead - steeringNonSystemTokens - storyTokens;
      let usedContextTokens = 0;
      if (targetScopes.length > 0) {
        const sharedQueryEmbedding = await this.liveContextIndex.computeQueryEmbedding(scopedQuery);
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const perScopeBudget = Math.max(64, Math.floor(contextBudget / Math.max(1, targetScopes.length)));
          const perScopeWorldInfoLimit = Math.max(8, Math.min(80, Math.floor(perScopeBudget / 900)));
          const perScopeRagLimit = Math.max(6, Math.min(48, Math.floor(perScopeBudget / 1800)));
          contexts = await Promise.all(targetScopes.map(scope => this.liveContextIndex.query({
            queryText: scopedQuery,
            queryEmbedding: sharedQueryEmbedding,
            tokenBudget: perScopeBudget,
            maxWorldInfoEntries: perScopeWorldInfoLimit,
            maxRagDocuments: perScopeRagLimit
          }, scope)));

          usedContextTokens = contexts.reduce((sum, item) => sum + item.usedTokens, 0);
          remainingInputTokens = maxInputTokens - completion.promptReserveTokens - instructionOverhead - steeringNonSystemTokens - storyTokens - usedContextTokens;
          if (remainingInputTokens >= 0 || contextBudget <= 64) {
            break;
          }

          const nextBudget = Math.max(64, contextBudget + remainingInputTokens - 48);
          if (nextBudget === contextBudget) {
            break;
          }
          contextBudget = nextBudget;
        }
      }

      const selectedScopeLabels = targetScopes.length > 0
        ? contexts.map(item => item.scope || '(all)')
        : ['(none)'];
      const graphContextMarkdown = contexts
        .map(item => item.markdown)
        .join('\n\n---\n\n');
      let toolContextMarkdown = '';
      let toolContextTokens = 0;
      let toolContextItems: string[] = [];
      let toolContextLayerTrace: string[] = [];
      if (remainingInputTokens > 96) {
        const toolContextBudget = Math.min(900, Math.max(96, Math.floor(remainingInputTokens * 0.55)));
        const toolContext = await this.buildToolHooksContext(
          scopedQuery,
          targetScopes,
          toolContextBudget,
          completion,
          this.generationAbortController.signal
        );
        toolContextMarkdown = toolContext.markdown;
        toolContextTokens = toolContext.usedTokens;
        toolContextItems = toolContext.selectedItems;
        toolContextLayerTrace = toolContext.layerTrace;
        remainingInputTokens -= toolContextTokens;
      }
      const totalWorldInfo = contexts.reduce((sum, item) => sum + item.worldInfo.length, 0);
      const totalRag = contexts.reduce((sum, item) => sum + item.rag.length, 0);
      const worldInfoDetails = contexts
        .flatMap(item => item.worldInfo.slice(0, 6).map(entry => entry.entry.comment))
        .slice(0, 8);
      const ragDetails = contexts
        .flatMap(item => item.rag.slice(0, 6).map(entry => entry.document.title))
        .slice(0, 8);
      const ragPolicies = [...new Set(contexts.map(context => context.explainability.rag.policy))];
      const ragEnabledScopes = contexts.filter(context => context.explainability.rag.enabled).length;
      const renderedStoryWindow = this.renderInlineLoreDirectivesForLlm(storyWindow);
      const renderedChapterMemory = this.renderInlineLoreDirectivesForLlm(chapterMemoryMarkdown);
      const renderedToolContext = this.renderInlineLoreDirectivesForLlm(toolContextMarkdown);
      const renderedGraphContext = this.renderInlineLoreDirectivesForLlm(graphContextMarkdown);
      const resolvedInlineDirectiveItems = uniqueStrings([
        ...renderedStoryWindow.directives,
        ...renderedChapterMemory.directives,
        ...renderedToolContext.directives,
        ...renderedGraphContext.directives
      ]).slice(0, 40);
      const inlineDirectiveTokens = resolvedInlineDirectiveItems.reduce((sum, directive) => (
        sum + this.estimateTokens(directive)
      ), 0);
      const preHistorySteeringReserved = reservedByPlacement('pre_history');
      const preResponseSteeringReserved = reservedByPlacement('pre_response');
      const inlineDirectiveDiagnostics = resolvedInlineDirectiveItems.length > 0
        ? [`${resolvedInlineDirectiveItems.length} inlined`, `~${inlineDirectiveTokens} tokens`]
        : ['none'];
      const continuityBudget = Math.max(96, Math.min(12000, Math.floor(maxInputTokens * 0.12)));

      const promptSegments: PromptSegment[] = [
        {
          key: 'pre_history_steering',
          label: 'Steering (pre-history)',
          content: preHistorySteeringMarkdown,
          reservedTokens: preHistorySteeringReserved,
          placement: 'pre_history',
          trimMode: 'head',
          minTokens: 0
        },
        {
          key: 'chapter_memory_context',
          label: 'Chapter Memory',
          content: renderedChapterMemory.text,
          reservedTokens: Math.max(0, chapterMemoryBudget),
          placement: 'pre_response',
          trimMode: 'head',
          minTokens: 0
        },
        {
          key: 'continuity_state',
          label: 'Continuity State',
          content: continuityMarkdown,
          reservedTokens: continuityBudget,
          placement: 'pre_response',
          trimMode: 'head',
          minTokens: 0
        },
        {
          key: 'tool_retrieval_context',
          label: 'Tool Retrieval',
          content: renderedToolContext.text,
          reservedTokens: Math.max(0, Math.floor(Math.max(0, remainingInputTokens) * 0.55)),
          placement: 'pre_response',
          trimMode: 'head',
          minTokens: 0
        },
        {
          key: 'lorebook_context',
          label: 'Lorebook Context',
          content: renderedGraphContext.text,
          reservedTokens: contextBudget,
          placement: 'pre_response',
          trimMode: 'head',
          minTokens: 0
        },
        {
          key: 'pre_response_steering',
          label: 'Steering (pre-response)',
          content: preResponseSteeringMarkdown,
          reservedTokens: preResponseSteeringReserved,
          placement: 'pre_response',
          trimMode: 'head',
          minTokens: 0
        },
        {
          key: 'story_window',
          label: 'Near-Cursor Context',
          content: renderedStoryWindow.text,
          reservedTokens: storyTokenTarget,
          placement: 'pre_response',
          trimMode: 'tail',
          minTokens: Math.max(64, Math.floor(storyTokenTarget * 0.4))
        }
      ];
      const userPromptBudget = Math.max(
        256,
        maxInputTokens - completion.promptReserveTokens - instructionOverhead
      );
      const overflowResult = applyDeterministicOverflow(
        promptSegments,
        userPromptBudget,
        [
          'tool_retrieval_context',
          'lorebook_context',
          'chapter_memory_context',
          'continuity_state',
          'pre_response_steering',
          'pre_history_steering',
          'story_window'
        ]
      );
      const promptSegmentsByKey = new Map(overflowResult.segments.map(segment => [segment.key, segment]));
      const preHistorySteeringForPrompt = promptSegmentsByKey.get('pre_history_steering')?.content ?? '';
      const chapterMemoryForPrompt = promptSegmentsByKey.get('chapter_memory_context')?.content ?? '';
      const continuityForPrompt = promptSegmentsByKey.get('continuity_state')?.content ?? '';
      const toolContextForPrompt = promptSegmentsByKey.get('tool_retrieval_context')?.content ?? '';
      const loreContextForPrompt = promptSegmentsByKey.get('lorebook_context')?.content ?? '';
      const preResponseSteeringForPrompt = promptSegmentsByKey.get('pre_response_steering')?.content ?? '';
      const storyWindowForPrompt = promptSegmentsByKey.get('story_window')?.content ?? '';
      const chapterMemoryPromptTokens = estimateTextTokens(chapterMemoryForPrompt);
      const continuityPromptTokens = estimateTextTokens(continuityForPrompt);
      const toolContextPromptTokens = estimateTextTokens(toolContextForPrompt);
      const loreContextPromptTokens = estimateTextTokens(loreContextForPrompt);
      const storyPromptTokens = estimateTextTokens(storyWindowForPrompt);
      const steeringPreHistoryPromptTokens = estimateTextTokens(preHistorySteeringForPrompt);
      const steeringPreResponsePromptTokens = estimateTextTokens(preResponseSteeringForPrompt);
      const steeringNonSystemPromptTokens = steeringPreHistoryPromptTokens + steeringPreResponsePromptTokens;
      const contextUsedPromptTokens = loreContextPromptTokens
        + chapterMemoryPromptTokens
        + continuityPromptTokens
        + toolContextPromptTokens
        + steeringNonSystemPromptTokens;
      remainingInputTokens = Math.max(
        0,
        maxInputTokens - completion.promptReserveTokens - instructionOverhead - storyPromptTokens - contextUsedPromptTokens
      );
      const combinedContextMarkdown = [loreContextForPrompt, toolContextForPrompt]
        .filter(section => section.trim().length > 0)
        .join('\n\n---\n\n');
      const contextLayerTrace: string[] = [
        `steering(system): ~${steeringSystemTokens} tokens`,
        `steering(pre_history): ~${steeringPreHistoryPromptTokens} tokens`,
        `steering(pre_response): ~${steeringPreResponsePromptTokens} tokens`,
        `lorebook_selection_source: ${scopeSelectionSource}`,
        `local_window: ~${storyPromptTokens} tokens`,
        `inline_directives: ${inlineDirectiveDiagnostics.join(', ')}`,
        `chapter_memory: ${chapterMemoryItems.length} sections, ~${chapterMemoryPromptTokens} tokens`,
        `continuity_state: threads ${mergedContinuity.selection.includePlotThreads ? mergedContinuity.plotThreads.length : 0}, open_loops ${mergedContinuity.selection.includeOpenLoops ? mergedContinuity.openLoops.length : 0}, canon_deltas ${mergedContinuity.selection.includeCanonDeltas ? mergedContinuity.canonDeltas.length : 0}, ~${continuityPromptTokens} tokens`,
        ...chapterMemoryLayerTrace,
        `graph_memory(world_info): ${totalWorldInfo} entries, ~${loreContextPromptTokens} tokens`,
        `fallback_entries: ${totalRag} entries, policy ${ragPolicies.join('/')} (${ragEnabledScopes}/${Math.max(1, contexts.length)} lorebooks enabled)`,
        `tool_hooks: ${toolContextItems.length} entries, ~${toolContextPromptTokens} tokens`,
        ...toolContextLayerTrace
      ];
      if (trimmedByPlacement('pre_history')) {
        contextLayerTrace.push('steering(pre_history): trimmed to reservation');
      }
      if (trimmedByPlacement('pre_response')) {
        contextLayerTrace.push('steering(pre_response): trimmed to reservation');
      }
      if (scopedSteering.layers.length > 0) {
        const scopedLayerLabels = scopedSteering.layers.map(layer => `${layer.scope.type}:${layer.scope.key || 'global'}`);
        contextLayerTrace.push(`scoped_steering_layers: ${scopedLayerLabels.join(' -> ')}`);
      }
      if (overflowResult.trace.length > 0) {
        contextLayerTrace.push(...overflowResult.trace.map(trace => `overflow_policy: ${trace}`));
      }
      const layerUsage = toPromptLayerUsage([
        {
          key: 'system_steering',
          label: 'Steering (system)',
          content: systemSteeringMarkdown,
          reservedTokens: reservedByPlacement('system'),
          placement: 'system',
          trimMode: 'head',
          minTokens: 0
        },
        ...overflowResult.segments
      ]);
      const scopeLabel = this.renderScopeListLabel(selectedScopeLabels);
      this.updateGenerationTelemetry({
        state: 'generating',
        statusText: 'generating',
        scopes: selectedScopeLabels,
        estimatedInstructionTokens: instructionOverhead,
        storyTokens: storyPromptTokens,
        contextUsedTokens: contextUsedPromptTokens,
        contextRemainingTokens: Math.max(0, remainingInputTokens),
        worldInfoCount: totalWorldInfo,
        ragCount: totalRag,
        worldInfoItems: worldInfoDetails,
        ragItems: ragDetails,
        inlineDirectiveItems: resolvedInlineDirectiveItems,
        continuityPlotThreads: mergedContinuity.selection.includePlotThreads ? mergedContinuity.plotThreads : [],
        continuityOpenLoops: mergedContinuity.selection.includeOpenLoops ? mergedContinuity.openLoops : [],
        continuityCanonDeltas: mergedContinuity.selection.includeCanonDeltas ? mergedContinuity.canonDeltas : [],
        layerUsage,
        overflowTrace: [...overflowResult.trace],
        contextLayerTrace,
        generatedTokens: 0,
        lastError: ''
      });

      this.setGenerationStatus(
        `generating | lorebooks ${scopeLabel} | ctx ${Math.max(0, remainingInputTokens)} left | out ~0/${completion.maxOutputTokens}`,
        'busy'
      );
      new Notice(
        `LoreVault generating | ${completion.provider} (${completion.model}) | lorebooks ${scopeLabel}`,
        3500
      );
      const userPrompt = [
        'Continue the story from where it currently ends.',
        'Respect the lore context as canon constraints.',
        'Output only the continuation text.',
        preHistorySteeringForPrompt
          ? [
            '',
            '<story_steering_pre_history>',
            preHistorySteeringForPrompt,
            '</story_steering_pre_history>'
          ].join('\n')
          : '',
        '',
        '<story_chapter_memory>',
        chapterMemoryForPrompt || '[No prior chapter memory available.]',
        '</story_chapter_memory>',
        '',
        '<continuity_state>',
        continuityForPrompt || '[No continuity state provided.]',
        '</continuity_state>',
        '',
        `<lorevault_scopes>${selectedScopeLabels.join(', ')}</lorevault_scopes>`,
        '',
        '<tool_retrieval_context>',
        toolContextForPrompt || '[No tool-retrieved context.]',
        '</tool_retrieval_context>',
        '',
        '<lorevault_context>',
        combinedContextMarkdown || '[No lorebook context selected.]',
        '</lorevault_context>',
        preResponseSteeringForPrompt
          ? [
            '',
            '<story_steering_pre_response>',
            preResponseSteeringForPrompt,
            '</story_steering_pre_response>'
          ].join('\n')
          : '',
        '',
        '<story_so_far>',
        storyWindowForPrompt || '[No story text yet. Start the scene naturally.]',
        '</story_so_far>'
      ].join('\n');

      let insertOffset = editor.posToOffset(cursor);
      const clampOffset = (offset: number): number => {
        const length = editor.getValue().length;
        if (offset <= 0) {
          return 0;
        }
        if (offset >= length) {
          return length;
        }
        return offset;
      };
      if (cursor.ch !== 0) {
        const insertedBreak = this.replaceRangePreservingViewport(editor, markdownView, '\n', cursor);
        if (insertedBreak) {
          insertOffset = editor.posToOffset(cursor) + 1;
        }
      }
      let thinkingInsertOffset = insertOffset;

      let generatedText = '';
      let reasoningText = '';
      let detachedDeltaBuffer = '';
      let lastStatusUpdate = 0;
      let completionUsage: CompletionUsageReport | null = null;
      let pendingDelta = '';
      let pendingReasoningDelta = '';
      let reasoningStarted = false;
      let flushTimer: number | null = null;
      let knownDocLength = editor.getValue().length;
      let applyingInsert = false;
      let lastUserEditAt = 0;
      let lastUserViewportInteractionAt = 0;
      let suppressProgrammaticScroll = false;

      const noteViewportInteraction = (): void => {
        lastUserViewportInteractionAt = Date.now();
      };

      const noteScrollEvent = (): void => {
        if (suppressProgrammaticScroll) return;
        lastUserViewportInteractionAt = Date.now();
      };

      const streamScroller = this.resolveMarkdownEditorScroller(markdownView);
      if (streamScroller) {
        streamScroller.addEventListener('pointerdown', noteViewportInteraction, { passive: true });
        streamScroller.addEventListener('wheel', noteViewportInteraction, { passive: true });
        streamScroller.addEventListener('scroll', noteScrollEvent, { passive: true });
        streamScroller.addEventListener('touchstart', noteViewportInteraction, { passive: true });
        streamScroller.addEventListener('touchmove', noteViewportInteraction, { passive: true });
      }

      const updateOutputTelemetry = (force = false): void => {
        const now = Date.now();
        if (!force && now - lastStatusUpdate < 250) {
          return;
        }
        lastStatusUpdate = now;
        const outTokens = this.estimateTokens(generatedText);
        this.updateGenerationTelemetry({
          generatedTokens: outTokens,
          statusText: 'generating'
        });
        this.setGenerationStatus(
          `generating | lorebooks ${scopeLabel} | ctx ${Math.max(0, remainingInputTokens)} left | out ~${outTokens}/${completion.maxOutputTokens}`,
          'busy'
        );
      };

      const editorChangeRef = this.app.workspace.on('editor-change', (changedEditor: Editor) => {
        if (changedEditor !== editor) {
          return;
        }
        const nextLength = editor.getValue().length;
        if (applyingInsert) {
          knownDocLength = nextLength;
          return;
        }
        const delta = nextLength - knownDocLength;
        knownDocLength = nextLength;
        if (delta === 0) {
          return;
        }
        const cursorOffset = editor.posToOffset(editor.getCursor('to'));
        if (cursorOffset <= thinkingInsertOffset) {
          thinkingInsertOffset = clampOffset(thinkingInsertOffset + delta);
        }
        if (cursorOffset <= insertOffset) {
          insertOffset = clampOffset(insertOffset + delta);
        }
        lastUserEditAt = Date.now();
      });

      const clearFlushTimer = (): void => {
        if (flushTimer !== null) {
          window.clearTimeout(flushTimer);
          flushTimer = null;
        }
      };

      const flushPendingReasoningDelta = (force = false): void => {
        if (!pendingReasoningDelta) {
          return;
        }
        const mostRecentInteraction = Math.max(lastUserEditAt, lastUserViewportInteractionAt);
        if (!force && Date.now() - mostRecentInteraction < 260) {
          scheduleDeltaFlush();
          return;
        }
        let chunk = pendingReasoningDelta;
        pendingReasoningDelta = '';

        let textToInsert: string;
        if (!reasoningStarted) {
          reasoningStarted = true;
          textToInsert = '> [!lv-thinking]- Thinking\n> ' + chunk.replace(/\n/g, '\n> ');
        } else {
          textToInsert = chunk.replace(/\n/g, '\n> ');
        }

        const insertPos = editor.offsetToPos(clampOffset(thinkingInsertOffset));
        applyingInsert = true;
        const ok = this.replaceRangePreservingViewport(editor, markdownView, textToInsert, insertPos, {
          preserveViewport: true
        });
        applyingInsert = false;
        if (ok) {
          thinkingInsertOffset = clampOffset(thinkingInsertOffset + textToInsert.length);
          insertOffset = clampOffset(insertOffset + textToInsert.length);
          knownDocLength = editor.getValue().length;
        }
      };

      const flushPendingDelta = (force = false): void => {
        flushPendingReasoningDelta(force);
        if (!pendingDelta) {
          return;
        }
        const mostRecentInteraction = Math.max(lastUserEditAt, lastUserViewportInteractionAt);
        if (!force && Date.now() - mostRecentInteraction < 260) {
          scheduleDeltaFlush();
          return;
        }
        const nextChunk = pendingDelta;
        pendingDelta = '';

        if (detachedDeltaBuffer.length > 0) {
          detachedDeltaBuffer += nextChunk;
          return;
        }

        const insertPos = editor.offsetToPos(clampOffset(insertOffset));
        applyingInsert = true;
        const shouldPreserveViewport = Date.now() - lastUserViewportInteractionAt > 260;
        if (shouldPreserveViewport) suppressProgrammaticScroll = true;
        const ok = this.replaceRangePreservingViewport(editor, markdownView, nextChunk, insertPos, {
          preserveViewport: shouldPreserveViewport
        });
        applyingInsert = false;
        if (suppressProgrammaticScroll) {
          setTimeout(() => { suppressProgrammaticScroll = false; }, 50);
        }
        if (!ok) {
          detachedDeltaBuffer += nextChunk;
          lastUserEditAt = Date.now();
          return;
        }

        insertOffset = clampOffset(insertOffset + nextChunk.length);
        knownDocLength = editor.getValue().length;
      };

      const scheduleDeltaFlush = (): void => {
        if (flushTimer !== null) {
          return;
        }
        flushTimer = window.setTimeout(() => {
          flushTimer = null;
          flushPendingDelta();
        }, 110);
      };

      try {
        await requestStoryContinuationStream(completion, {
          systemPrompt: effectiveSystemPrompt,
          userPrompt,
          operationName: 'editor_continuation',
          onOperationLog: record => this.appendCompletionOperationLog(record, {
            costProfile: this.resolveEffectiveCostProfileLabel(completion.apiKey)
          }),
          onDelta: (delta: string) => {
            if (!delta) {
              return;
            }
            generatedText += delta;
            if (detachedDeltaBuffer.length > 0) {
              detachedDeltaBuffer += delta;
            } else {
              pendingDelta += delta;
            }
            updateOutputTelemetry();
            scheduleDeltaFlush();
          },
          onUsage: usage => {
            completionUsage = usage;
          },
          onReasoning: (delta: string) => {
            if (!delta) {
              return;
            }
            reasoningText += delta;
            pendingReasoningDelta += delta;
            updateOutputTelemetry();
            scheduleDeltaFlush();
          },
          abortSignal: this.generationAbortController.signal
        });
      } finally {
        clearFlushTimer();
        flushPendingDelta(true);
        this.app.workspace.offref(editorChangeRef);
        if (streamScroller) {
          streamScroller.removeEventListener('pointerdown', noteViewportInteraction);
          streamScroller.removeEventListener('wheel', noteViewportInteraction);
          streamScroller.removeEventListener('scroll', noteScrollEvent);
          streamScroller.removeEventListener('touchstart', noteViewportInteraction);
          streamScroller.removeEventListener('touchmove', noteViewportInteraction);
        }
      }
      updateOutputTelemetry(true);

      if (completionUsage) {
        await this.recordCompletionUsage('editor_continuation', completionUsage, {
          scopeCount: selectedScopeLabels.length,
          scopes: selectedScopeLabels,
          worldInfoCount: totalWorldInfo,
          ragCount: totalRag,
          usedChapterMemoryContext: chapterMemoryItems.length > 0,
          inlineDirectiveCount: resolvedInlineDirectiveItems.length,
          continuityItemCount: (
            (mergedContinuity.selection.includePlotThreads ? mergedContinuity.plotThreads.length : 0)
            + (mergedContinuity.selection.includeOpenLoops ? mergedContinuity.openLoops.length : 0)
            + (mergedContinuity.selection.includeCanonDeltas ? mergedContinuity.canonDeltas.length : 0)
          ),
          completionProfileSource: completionResolution.source,
          completionProfileId: completionResolution.presetId,
          completionProfileName: completionResolution.presetName,
          autoCostProfile: this.buildAutoCostProfileLabel(completionResolution.completion.apiKey)
        });
      }

      if (!generatedText.trim()) {
        throw new Error('Completion provider returned empty output.');
      }
      if (reasoningStarted) {
        const closingNewlines = '\n\n';
        const thinkingEndPos = editor.offsetToPos(clampOffset(thinkingInsertOffset));
        const insertedClose = this.replaceRangePreservingViewport(editor, markdownView, closingNewlines, thinkingEndPos);
        if (insertedClose) {
          insertOffset = clampOffset(insertOffset + closingNewlines.length);
          knownDocLength = editor.getValue().length;
        }
      }
      if (detachedDeltaBuffer.length > 0) {
        const fallbackCursor = editor.getCursor();
        const fallbackBaseOffset = editor.posToOffset(fallbackCursor);
        let fallbackText = detachedDeltaBuffer;
        if (fallbackCursor.ch !== 0 && !fallbackText.startsWith('\n')) {
          fallbackText = `\n${fallbackText}`;
        }
        const fallbackInserted = this.replaceRangePreservingViewport(editor, markdownView, fallbackText, fallbackCursor);
        if (fallbackInserted) {
          const fallbackEndPos = editor.offsetToPos(clampOffset(fallbackBaseOffset + fallbackText.length));
          this.replaceRangePreservingViewport(editor, markdownView, '\n', fallbackEndPos);
          new Notice('Story changed while streaming. Remaining generated text was inserted at the current cursor.');
        } else {
          new Notice('Story changed while streaming. Could not auto-insert the remaining generated text.');
        }
      } else {
        const insertPos = editor.offsetToPos(clampOffset(insertOffset));
        this.replaceRangePreservingViewport(editor, markdownView, '\n', insertPos);
      }
      const generatedTokens = this.estimateTokens(generatedText);
      this.updateGenerationTelemetry({
        state: 'idle',
        statusText: 'idle',
        scopes: selectedScopeLabels,
        contextUsedTokens: contextUsedPromptTokens,
        contextRemainingTokens: Math.max(0, remainingInputTokens),
        generatedTokens,
        worldInfoCount: totalWorldInfo,
        ragCount: totalRag,
        worldInfoItems: worldInfoDetails,
        ragItems: ragDetails,
        inlineDirectiveItems: resolvedInlineDirectiveItems,
        continuityPlotThreads: mergedContinuity.selection.includePlotThreads ? mergedContinuity.plotThreads : [],
        continuityOpenLoops: mergedContinuity.selection.includeOpenLoops ? mergedContinuity.openLoops : [],
        continuityCanonDeltas: mergedContinuity.selection.includeCanonDeltas ? mergedContinuity.canonDeltas : [],
        layerUsage,
        overflowTrace: [...overflowResult.trace],
        contextLayerTrace,
        lastError: ''
      });
      new Notice(
        `Inserted continuation for ${selectedScopeLabels.length} lorebook(s) (${totalWorldInfo} world_info, ${totalRag} fallback, ~${generatedTokens} output tokens).`
      );
      this.setGenerationStatus('idle', 'idle');
    } catch (error) {
      if (this.isAbortLikeError(error)) {
        this.updateGenerationTelemetry({
          state: 'idle',
          statusText: 'idle',
          lastError: ''
        });
        this.setGenerationStatus('idle', 'idle');
        new Notice('Story generation stopped.');
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.updateGenerationTelemetry({
        state: 'error',
        statusText: 'error',
        lastError: message
      });
      this.setGenerationStatus('error', 'error');
      console.error('Continue Story with Context failed:', error);
      new Notice(`Continue Story with Context failed: ${message}`);
    } finally {
      this.generationInFlight = false;
      this.generationAbortController = null;
      if (this.generationStatusLevel === 'error') {
        window.setTimeout(() => {
          if (!this.generationInFlight && this.generationStatusLevel === 'error') {
            this.setGenerationStatus('idle', 'idle');
          }
        }, 2500);
      }
    }
  }

  // This is the main conversion function
  async convertToLorebook(scopeOverride?: string, options?: ConvertToLorebookOptions): Promise<boolean> {
    const silentSuccessNotice = options?.silentSuccessNotice === true;
    const suppressErrorNotice = options?.suppressErrorNotice === true;
    const deferViewRefresh = options?.deferViewRefresh === true;
    const quietProgress = options?.quietProgress === true;

    try {
      const files = this.app.vault.getMarkdownFiles();
      const explicitScope = normalizeScope(scopeOverride ?? this.settings.tagScoping.activeScope);
      const discoveredScopes = this.discoverAllScopes(files);
      const buildAllScopes = explicitScope.length === 0 && discoveredScopes.length > 0;
      const scopesToBuild = explicitScope
        ? [explicitScope]
        : (discoveredScopes.length > 0 ? discoveredScopes : ['']);

      const baseOutputPath = this.getBaseOutputPath();
      const worldInfoExporter = new LoreBookExporter(this.app);
      const ragExporter = new RagExporter(this.app);
      const sqliteExporter = new SqlitePackExporter(this.app);
      const sqliteReader = new SqlitePackReader(this.app);
      const embeddingService = this.settings.embeddings.enabled
        ? new EmbeddingService(this.app, this.settings.embeddings, {
          onOperationLog: record => this.appendEmbeddingOperationLog(record, {
            costProfile: this.resolveEffectiveCostProfileLabel(this.settings.embeddings.apiKey)
          }),
          onUsage: (operationName, usage, metadata) => {
            this.recordEmbeddingUsage(operationName, usage, this.settings.embeddings.apiKey, {
              source: 'lorebook_build',
              ...metadata
            });
          }
        })
        : null;
      const scopeAssignments: ScopeOutputAssignment[] = scopesToBuild.map(scope => ({
        scope,
        paths: resolveScopeOutputPaths(
          baseOutputPath,
          scope,
          buildAllScopes,
          this.settings.sqlite.outputPath
        )
      }));

      assertUniqueOutputPaths(scopeAssignments, {
        includeSqlite: this.settings.sqlite.enabled
      });

      let exportTimestampChanged = false;

      for (const assignment of scopeAssignments) {
        const { scope, paths } = assignment;
        const progress = quietProgress
          ? null
          : new ProgressBar(
            files.length + 7, // files + graph + chunks + embeddings + sqlite + sqlite-read + world_info + fallback markdown
            `Building LoreVault lorebook: ${scope || '(all)'}`
          );

        const scopePackResult = await buildScopePack(
          this.app,
          this.settings,
          scope,
          files,
          buildAllScopes,
          embeddingService,
          progress ?? undefined,
          {
            pluginId: this.manifest.id,
            pluginVersion: this.manifest.version
          }
        );

        const scopedSettings = scopePackResult.scopedSettings;
        let worldInfoEntries = scopePackResult.pack.worldInfoEntries;
        let ragDocuments = scopePackResult.pack.ragDocuments;

        if (this.settings.sqlite.enabled) {
          progress?.setStatus(`Lorebook ${scope || '(all)'}: exporting canonical SQLite pack...`);
          await sqliteExporter.exportScopePack(scopePackResult.pack, paths.sqlitePath);
          progress?.update();

          progress?.setStatus(`Lorebook ${scope || '(all)'}: reading exports from SQLite pack...`);
          const readPack = await sqliteReader.readScopePack(paths.sqlitePath);
          worldInfoEntries = readPack.worldInfoEntries;
          ragDocuments = readPack.ragDocuments;
          progress?.update();
        }

        progress?.setStatus(`Lorebook ${scope || '(all)'}: exporting world_info JSON...`);
        await worldInfoExporter.exportLoreBookJson(
          this.mapEntriesByUid(worldInfoEntries),
          paths.worldInfoPath,
          scopedSettings
        );
        progress?.update();

        progress?.setStatus(`Lorebook ${scope || '(all)'}: exporting fallback markdown...`);
        await ragExporter.exportRagMarkdown(ragDocuments, paths.ragPath, scope || '(all)');
        progress?.update();

        exportTimestampChanged = this.recordScopeCanonicalExport(scope, Date.now()) || exportTimestampChanged;

        progress?.success(
          `Lorebook ${scope || '(all)'} complete: ${worldInfoEntries.length} world_info entries, ${ragDocuments.length} fallback docs.`
        );
      }

      if (exportTimestampChanged) {
        await this.persistSettingsSnapshot(false);
      }

      if (!silentSuccessNotice) {
        new Notice(`LoreVault build complete for ${scopesToBuild.length} lorebook(s).`);
      }
      this.liveContextIndex.requestFullRefresh();
      this.invalidateLorebookScopeCache();
      this.exportScopeIndexByPath = new Map(
        this.getCachedLorebookMetadata()
          .map(item => [item.path, this.normalizeExportScopeList(item.scopes)])
      );
      if (!deferViewRefresh) {
        this.refreshManagerViews();
        this.refreshRoutingDebugViews();
        this.refreshQuerySimulationViews();
        this.refreshStoryChatViews();
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Conversion failed:', error);
      if (!suppressErrorNotice) {
        new Notice(`Conversion failed: ${message}`);
      }
      return false;
    }
  }
}
