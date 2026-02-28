import { MarkdownView, Plugin, Notice, TFile, addIcon, getAllTags, Menu, Editor, MarkdownFileInfo } from 'obsidian';
import {
  ContinuitySelection,
  cloneDefaultTextCommandPromptTemplates,
  CompletionPreset,
  ConverterSettings,
  DEFAULT_SETTINGS,
  LoreBookEntry,
  PromptLayerPlacement,
  PromptLayerUsage,
  TextCommandPromptTemplate,
  StoryChatContextMeta,
  StoryChatForkSnapshot,
  StoryChatMessage
} from './models';
import { ProgressBar } from './progress-bar';
import { createTemplate } from './template-creator';
import { LoreBookExporter } from './lorebook-exporter'; 
import { LoreBookConverterSettingTab } from './settings-tab';
import { extractLorebookScopesFromTags, normalizeScope, normalizeTagPrefix } from './lorebook-scoping';
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
import { LOREVAULT_STORY_STEERING_VIEW_TYPE, StorySteeringView } from './story-steering-view';
import { LOREVAULT_HELP_VIEW_TYPE, LorevaultHelpView } from './lorevault-help-view';
import { LOREVAULT_IMPORT_VIEW_TYPE, LorevaultImportView } from './lorevault-import-view';
import {
  LOREVAULT_STORY_EXTRACT_VIEW_TYPE,
  LorevaultStoryExtractView
} from './lorevault-story-extract-view';
import {
  LOREVAULT_STORY_DELTA_VIEW_TYPE,
  LorevaultStoryDeltaView
} from './lorevault-story-delta-view';
import { LiveContextIndex } from './live-context-index';
import { ChapterSummaryStore } from './chapter-summary-store';
import { EmbeddingService } from './embedding-service';
import {
  CompletionUsageReport,
  createCompletionRetrievalToolPlanner,
  requestStoryContinuation,
  requestStoryContinuationStream
} from './completion-provider';
import { parseStoryScopesFromFrontmatter } from './story-scope-selector';
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
  resolveStoryThread
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
import { KeywordReviewModal, KeywordReviewResult } from './keyword-review-modal';
import { collectLorebookNoteMetadata } from './lorebooks-manager-collector';
import { buildScopeSummaries } from './lorebooks-manager-data';
import { UsageLedgerStore } from './usage-ledger-store';
import { estimateUsageCostUsd } from './cost-utils';
import {
  buildUsageLedgerReportSnapshot,
  serializeUsageLedgerEntriesCsv,
  UsageLedgerReportSnapshot
} from './usage-ledger-report';
import { parseGeneratedKeywords, upsertKeywordsFrontmatter } from './keyword-utils';
import { getVaultBasename, normalizeVaultPath, normalizeVaultRelativePath } from './vault-path-utils';
import { extractAdaptiveQueryWindow, extractAdaptiveStoryWindow } from './context-window-strategy';
import { extractInlineLoreDirectives, stripInlineLoreDirectives } from './inline-directives';
import {
  normalizeStorySteeringState,
  parseStorySteeringExtractionResponse,
  sanitizeStorySteeringExtractionState,
  StorySteeringEffectiveState,
  StorySteeringScope,
  StorySteeringScopeType,
  StorySteeringState,
  StorySteeringStore
} from './story-steering';
import {
  applyDeterministicOverflow,
  estimateTextTokens,
  PromptSegment,
  toPromptLayerUsage,
  trimTextForTokenBudget
} from './prompt-staging';

const INLINE_DIRECTIVE_SCAN_TOKENS = 1800;
const INLINE_DIRECTIVE_MAX_COUNT = 6;
const INLINE_DIRECTIVE_MAX_TOKENS = 220;
const STEERING_RESERVE_FRACTION = 0.14;

type SteeringLayerKey = 'pinned_instructions' | 'story_notes' | 'scene_intent' | 'inline_directives';

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
  useLorebookContext: boolean;
  manualContext: string;
  pinnedInstructions: string;
  storyNotes: string;
  sceneIntent: string;
  continuityPlotThreads: string[];
  continuityOpenLoops: string[];
  continuityCanonDeltas: string[];
  continuitySelection: ContinuitySelection;
  noteContextRefs: string[];
  history: StoryChatMessage[];
  onDelta: (delta: string) => void;
}

export interface StoryChatTurnResult {
  assistantText: string;
  contextMeta: StoryChatContextMeta;
}

export type StorySteeringExtractionSource = 'active_note' | 'story_window';

export default class LoreBookConverterPlugin extends Plugin {
  settings: ConverterSettings;
  liveContextIndex: LiveContextIndex;
  private usageLedgerStore!: UsageLedgerStore;
  private storySteeringStore!: StorySteeringStore;
  private readonly sessionStartedAt = Date.now();
  private chapterSummaryStore!: ChapterSummaryStore;
  private generationStatusEl: HTMLElement | null = null;
  private generationInFlight = false;
  private generationAbortController: AbortController | null = null;
  private generationStatusLevel: 'idle' | 'busy' | 'error' = 'idle';
  private generationTelemetry: GenerationTelemetry = this.createDefaultGenerationTelemetry();
  private managerRefreshTimer: number | null = null;

  private getBaseOutputPath(): string {
    return this.settings.outputPath?.trim() || DEFAULT_SETTINGS.outputPath;
  }

  private estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }

  private getActiveEditorTextBeforeCursor(): string {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView) {
      return '';
    }
    const editor = markdownView.editor;
    if (!editor) {
      return '';
    }
    const cursor = editor.getCursor();
    return editor.getRange({ line: 0, ch: 0 }, cursor);
  }

  private resolveInlineDirectivesFromText(sourceText: string): {
    directives: string[];
    usedTokens: number;
    foundCount: number;
    droppedByCount: number;
    droppedByBudget: number;
  } {
    const scanWindow = this.extractQueryWindow(sourceText, INLINE_DIRECTIVE_SCAN_TOKENS);
    const foundDirectives = extractInlineLoreDirectives(scanWindow);
    if (foundDirectives.length === 0) {
      return {
        directives: [],
        usedTokens: 0,
        foundCount: 0,
        droppedByCount: 0,
        droppedByBudget: 0
      };
    }

    const directives: string[] = [];
    let usedTokens = 0;
    let droppedByCount = 0;
    let droppedByBudget = 0;

    for (let index = 0; index < foundDirectives.length; index += 1) {
      const directive = foundDirectives[index];
      if (directives.length >= INLINE_DIRECTIVE_MAX_COUNT) {
        droppedByCount = foundDirectives.length - index;
        break;
      }

      const directiveTokens = this.estimateTokens(directive);
      if (usedTokens + directiveTokens > INLINE_DIRECTIVE_MAX_TOKENS) {
        droppedByBudget += 1;
        continue;
      }

      directives.push(directive);
      usedTokens += directiveTokens;
    }

    return {
      directives,
      usedTokens,
      foundCount: foundDirectives.length,
      droppedByCount,
      droppedByBudget
    };
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
      pinnedInstructions: this.resolvePromptLayerPlacement(
        configured.pinnedInstructions,
        DEFAULT_SETTINGS.completion.layerPlacement.pinnedInstructions
      ),
      storyNotes: this.resolvePromptLayerPlacement(
        configured.storyNotes,
        DEFAULT_SETTINGS.completion.layerPlacement.storyNotes
      ),
      sceneIntent: this.resolvePromptLayerPlacement(
        configured.sceneIntent,
        DEFAULT_SETTINGS.completion.layerPlacement.sceneIntent
      ),
      inlineDirectives: this.resolvePromptLayerPlacement(
        configured.inlineDirectives,
        DEFAULT_SETTINGS.completion.layerPlacement.inlineDirectives
      )
    };
  }

  private createSteeringSections(args: {
    maxInputTokens: number;
    pinnedInstructions: string;
    storyNotes: string;
    sceneIntent: string;
    inlineDirectives: string[];
  }): SteeringLayerSection[] {
    const placements = this.getCompletionLayerPlacementConfig();
    const steeringReserve = Math.max(
      160,
      Math.min(24000, Math.floor(args.maxInputTokens * STEERING_RESERVE_FRACTION))
    );
    const inlineText = args.inlineDirectives
      .map((directive, index) => `${index + 1}. ${directive}`)
      .join('\n');

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
        key: 'pinned_instructions',
        label: 'Pinned Instructions',
        tag: 'pinned_session_instructions',
        placement: placements.pinnedInstructions,
        text: args.pinnedInstructions,
        reserveFraction: 0.4,
        locked: true
      },
      {
        key: 'story_notes',
        label: 'Story Notes',
        tag: 'story_author_notes',
        placement: placements.storyNotes,
        text: args.storyNotes,
        reserveFraction: 0.24,
        locked: false
      },
      {
        key: 'scene_intent',
        label: 'Scene Intent',
        tag: 'scene_intent',
        placement: placements.sceneIntent,
        text: args.sceneIntent,
        reserveFraction: 0.18,
        locked: false
      },
      {
        key: 'inline_directives',
        label: 'Inline Directives',
        tag: 'inline_story_directives',
        placement: placements.inlineDirectives,
        text: inlineText,
        reserveFraction: 0.18,
        locked: false
      }
    ];

    return layerSpecs.map(spec => {
      const reservedTokens = Math.max(48, Math.floor(steeringReserve * spec.reserveFraction));
      const normalizedText = spec.text.trim();
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

  private resolveSteeringFromFrontmatter(file: TFile | null): {
    pinnedInstructions: string;
    storyNotes: string;
    sceneIntent: string;
  } {
    if (!file) {
      return {
        pinnedInstructions: '',
        storyNotes: '',
        sceneIntent: ''
      };
    }

    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    return {
      pinnedInstructions: asString(
        getFrontmatterValue(frontmatter, 'lvPinnedInstructions', 'lvPinned', 'pinnedInstructions', 'pinned')
      ) ?? '',
      storyNotes: asString(
        getFrontmatterValue(frontmatter, 'lvStoryNotes', 'lvStoryNote', 'storyNotes', 'authorNote')
      ) ?? '',
      sceneIntent: asString(
        getFrontmatterValue(frontmatter, 'lvSceneIntent', 'sceneIntent', 'chapterIntent')
      ) ?? ''
    };
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

  private async recordCompletionUsage(
    operation: string,
    usage: CompletionUsageReport,
    metadata: {[key: string]: unknown} = {}
  ): Promise<void> {
    if (!this.settings.costTracking.enabled) {
      return;
    }

    const cost = estimateUsageCostUsd(
      usage.promptTokens,
      usage.completionTokens,
      this.settings.costTracking.defaultInputCostPerMillionUsd,
      this.settings.costTracking.defaultOutputCostPerMillionUsd,
      usage.reportedCostUsd
    );

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
        metadata
      });
    } catch (error) {
      console.error('Failed to record usage entry:', error);
    }
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
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  public async getUsageReportSnapshot(): Promise<UsageLedgerReportSnapshot> {
    const entries = await this.usageLedgerStore.listEntries();
    const nowMs = Date.now();
    return buildUsageLedgerReportSnapshot(entries, {
      nowMs,
      sessionStartAt: this.sessionStartedAt,
      dailyBudgetUsd: this.settings.costTracking.dailyBudgetUsd,
      sessionBudgetUsd: this.settings.costTracking.sessionBudgetUsd
    });
  }

  private async exportUsageReport(format: 'json' | 'csv'): Promise<void> {
    try {
      const entries = await this.usageLedgerStore.listEntries();
      const snapshot = await this.getUsageReportSnapshot();
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

    const completion = this.settings.completion;
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

  async openImportLorebookView(): Promise<void> {
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

  private createMessageId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  public getAvailableScopes(): string[] {
    const fromIndex = this.liveContextIndex?.getScopes() ?? [];
    if (fromIndex.length > 0) {
      return [...fromIndex].sort((a, b) => a.localeCompare(b));
    }

    const files = this.app.vault.getMarkdownFiles();
    return this.discoverAllScopes(files);
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

  public async getSuggestedStorySteeringScope(type: StorySteeringScopeType): Promise<StorySteeringScope> {
    if (type === 'global') {
      return { type: 'global', key: 'global' };
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      return {
        type,
        key: ''
      };
    }

    const scopeChain = await this.storySteeringStore.getScopeChainForFile(activeFile);
    const matched = scopeChain.find(scope => scope.type === type);
    if (matched) {
      return matched;
    }

    if (type === 'note') {
      return {
        type: 'note',
        key: normalizeVaultPath(activeFile.path)
      };
    }

    return {
      type,
      key: ''
    };
  }

  public async loadStorySteeringScope(scope: StorySteeringScope): Promise<StorySteeringState> {
    return this.storySteeringStore.loadScope(scope);
  }

  public async saveStorySteeringScope(scope: StorySteeringScope, state: StorySteeringState): Promise<string> {
    return this.storySteeringStore.saveScope(scope, state);
  }

  public async openStorySteeringScopeNote(scope: StorySteeringScope): Promise<void> {
    const existingState = await this.storySteeringStore.loadScope(scope);
    const path = await this.storySteeringStore.saveScope(scope, existingState);
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

  public async extractStorySteeringProposal(
    source: StorySteeringExtractionSource,
    currentState: StorySteeringState,
    abortSignal?: AbortSignal
  ): Promise<{
    proposal: StorySteeringState;
    notePath: string;
    sourceLabel: string;
    sourceChars: number;
  }> {
    if (!this.settings.completion.enabled) {
      throw new Error('Writing completion is disabled. Enable it under LoreVault Settings -> Writing Completion.');
    }
    if (this.settings.completion.provider !== 'ollama' && !this.settings.completion.apiKey) {
      throw new Error('Missing completion API key. Configure it under LoreVault Settings -> Writing Completion.');
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile)) {
      throw new Error('No active markdown note.');
    }

    const raw = await this.app.vault.cachedRead(activeFile);
    const noteBody = stripInlineLoreDirectives(stripFrontmatter(raw)).trim();
    const editorWindow = this.getActiveEditorTextBeforeCursor().trim();

    let sourceText = '';
    let sourceLabel = '';
    if (source === 'active_note') {
      sourceText = noteBody;
      sourceLabel = 'Active note body';
    } else {
      sourceText = editorWindow || noteBody;
      sourceLabel = editorWindow ? 'Story window near cursor' : 'Story window near cursor (fallback to note body)';
    }

    if (!sourceText) {
      throw new Error('Active note content is empty.');
    }

    const completion = this.settings.completion;
    const maxInputTokens = Math.max(512, completion.contextWindowTokens - completion.maxOutputTokens);
    const sourceTokenBudget = Math.max(800, Math.min(64000, Math.floor(maxInputTokens * 0.6)));
    const truncatedSource = source === 'story_window'
      ? this.extractStoryWindow(sourceText, sourceTokenBudget)
      : this.trimTextHeadToTokenBudget(sourceText, sourceTokenBudget);

    const normalizedCurrent = normalizeStorySteeringState(currentState);
    const systemPrompt = [
      'You are a writing assistant extracting structured story steering state.',
      'Return JSON only. No markdown, no prose, no reasoning.',
      'Output exactly one object with keys:',
      'pinnedInstructions, storyNotes, sceneIntent, plotThreads, openLoops, canonDeltas.',
      'Use strings for text fields and arrays of strings for list fields.',
      'Keep entries concise and actionable for story generation guidance.',
      'Do NOT restate encyclopedic lore that belongs in lorebook entries.',
      'Exclude static character bios, world/location descriptions, appearance/personality summaries, and backstory recaps.',
      'Only keep writer-control guidance, active plot pressure, unresolved questions, and recent canon changes that matter for next generation.',
      'If the source does not provide evidence for a field, preserve the existing value.'
    ].join('\n');
    const userPrompt = [
      `Source mode: ${sourceLabel}`,
      '',
      '<existing_steering_json>',
      JSON.stringify(normalizedCurrent, null, 2),
      '</existing_steering_json>',
      '',
      '<story_source>',
      truncatedSource,
      '</story_source>',
      '',
      'Return JSON with the required keys only.'
    ].join('\n');

    let usageReport: CompletionUsageReport | null = null;
    const rawResponse = await requestStoryContinuation(completion, {
      systemPrompt,
      userPrompt,
      abortSignal,
      onUsage: usage => {
        usageReport = usage;
      }
    });

    if (usageReport) {
      await this.recordCompletionUsage('story_steering_extract', usageReport, {
        notePath: activeFile.path,
        source
      });
    }

    const parsed = parseStorySteeringExtractionResponse(rawResponse);
    const proposal = this.settings.storySteering.extractionSanitization === 'off'
      ? normalizeStorySteeringState(parsed)
      : sanitizeStorySteeringExtractionState(parsed);
    return {
      proposal,
      notePath: activeFile.path,
      sourceLabel,
      sourceChars: truncatedSource.length
    };
  }

  public getStoryChatMessages(): StoryChatMessage[] {
    return this.settings.storyChat.messages.map(message => ({
      ...message,
      contextMeta: message.contextMeta ? {
        ...message.contextMeta,
        scopes: [...message.contextMeta.scopes],
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
        worldInfoItems: [...message.contextMeta.worldInfoItems],
        ragItems: [...message.contextMeta.ragItems]
      } : undefined
    }));
  }

  public getStoryChatForkSnapshots(): StoryChatForkSnapshot[] {
    return this.settings.storyChat.forkSnapshots.map(snapshot => ({
      ...snapshot,
      selectedScopes: [...snapshot.selectedScopes],
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
    await super.saveData(this.settings);
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

  private normalizeNoteContextRef(rawRef: string): string {
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

    return normalizeLinkTarget(normalized);
  }

  private resolveNoteContextFile(ref: string): TFile | null {
    const normalizedRef = this.normalizeNoteContextRef(ref);
    if (!normalizedRef) {
      return null;
    }

    const activePath = this.app.workspace.getActiveFile()?.path ?? '';
    const resolvedFromLink = this.app.metadataCache.getFirstLinkpathDest(normalizedRef, activePath);
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
      const body = stripInlineLoreDirectives(stripFrontmatter(raw)).trim();
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

    const planner = createCompletionRetrievalToolPlanner(this.settings.completion);
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
    if (!this.settings.completion.enabled) {
      throw new Error('Writing completion is disabled. Enable it under LoreVault Settings → Writing Completion.');
    }
    if (this.settings.completion.provider !== 'ollama' && !this.settings.completion.apiKey) {
      throw new Error('Missing completion API key. Configure it under LoreVault Settings → Writing Completion.');
    }

    const raw = await this.app.vault.cachedRead(file);
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    const existingKeywords = uniqueStrings(
      asStringArray(getFrontmatterValue(frontmatter, 'keywords', 'key'))
    );
    const frontmatterSummary = asString(getFrontmatterValue(frontmatter, 'summary')) ?? '';
    const bodyWithSummary = stripInlineLoreDirectives(stripFrontmatter(raw)).trim();
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
    const responseText = await requestStoryContinuation(this.settings.completion, {
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      onUsage: usage => {
        usageReport = usage;
      }
    });

    if (usageReport) {
      await this.recordCompletionUsage('keywords_generate', usageReport, {
        notePath: file.path
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
    const truncated = bodyText.length > maxChars ? bodyText.slice(0, maxChars) : bodyText;
    const modeInstruction = mode === 'chapter'
      ? 'Summarize this chapter for long-form continuity memory.'
      : 'Summarize this lore entry for compact world_info retrieval.';

    const systemPrompt = [
      'You write concise canonical summaries for a fiction writing assistant.',
      'Output one plain-text paragraph only.',
      `Keep summary under ${this.settings.summaries.maxSummaryChars} characters.`,
      'Focus on durable facts, names, states, and consequences.',
      'Do not include headings, markdown, or bullet points.',
      'Do not include reasoning, analysis, or preambles like "I need to..." or numbered planning.',
      'Start directly with the factual summary content.',
      'Bad output example: "I need to create a summary. 1. ... 2. ..."',
      'Good output example: "Baalthasar is a dark elven Archmage whose unmatched mind magic and arcana priorities define his strategic role."',
      modeInstruction
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
    if (!this.settings.completion.enabled) {
      throw new Error('Writing completion is disabled. Enable it under LoreVault Settings → Writing Completion.');
    }
    if (this.settings.completion.provider !== 'ollama' && !this.settings.completion.apiKey) {
      throw new Error('Missing completion API key. Configure it under LoreVault Settings → Writing Completion.');
    }

    const raw = await this.app.vault.cachedRead(file);
    const bodyWithSummary = stripInlineLoreDirectives(stripFrontmatter(raw)).trim();
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
    const rawSummary = await requestStoryContinuation(this.settings.completion, {
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      onUsage: usage => {
        usageReport = usage;
      }
    });
    if (usageReport) {
      await this.recordCompletionUsage(
        mode === 'chapter' ? 'summary_chapter' : 'summary_world_info',
        usageReport,
        {
          notePath: file.path
        }
      );
    }

    const normalizedSummary = normalizeGeneratedSummaryText(
      rawSummary,
      this.settings.summaries.maxSummaryChars
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

  private async applySummaryToNoteSection(file: TFile, summary: string): Promise<void> {
    const raw = await this.app.vault.cachedRead(file);
    const next = upsertSummarySectionInMarkdown(raw, summary);
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

    await this.applySummaryToNoteSection(file, review.summaryText);

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

  private async generateSummaryForActiveNote(mode: GeneratedSummaryMode): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
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
    const bodyWithSummary = stripInlineLoreDirectives(stripFrontmatter(raw)).trim();
    return Boolean(resolveNoteSummary(bodyWithSummary, frontmatterSummary));
  }

  private async generateWorldInfoSummariesForActiveScope(): Promise<void> {
    const scope = this.resolveBuildScopeFromContext();
    if (!scope) {
      new Notice('No active scope found for world_info summary generation.');
      return;
    }

    const notes = collectLorebookNoteMetadata(this.app, this.settings);
    const summaries = buildScopeSummaries(notes, this.settings, scope);
    const summary = summaries[0];
    if (!summary) {
      new Notice('No scope summary available.');
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
      new Notice('No world_info notes without summary found in the active scope.');
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
    const resolution = resolveStoryThread(nodes, activeFile.path);
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

    if (!this.settings.completion.enabled) {
      throw new Error('Writing completion is disabled. Enable it under LoreVault Settings → Writing Completion.');
    }
    if (this.settings.completion.provider !== 'ollama' && !this.settings.completion.apiKey) {
      throw new Error('Missing completion API key. Configure it under LoreVault Settings → Writing Completion.');
    }

    const completion = this.settings.completion;
    const selectedScopes = request.selectedScopes.length > 0
      ? request.selectedScopes.map(scope => normalizeScope(scope)).filter(Boolean)
      : [];
    const scopeLabels = selectedScopes.length > 0 ? selectedScopes : ['(none)'];
    const noteContextRefs = request.noteContextRefs
      .map(ref => this.normalizeNoteContextRef(ref))
      .filter((ref, index, array): ref is string => Boolean(ref) && array.indexOf(ref) === index);
    const activeStoryFile = this.app.workspace.getActiveFile();
    const scopedSteering = await this.storySteeringStore.resolveEffectiveStateForFile(activeStoryFile);
    const mergedPinnedInstructions = this.mergeSteeringText(
      scopedSteering.merged.pinnedInstructions,
      request.pinnedInstructions
    );
    const mergedStoryNotes = this.mergeSteeringText(
      scopedSteering.merged.storyNotes,
      request.storyNotes
    );
    const mergedSceneIntent = this.mergeSteeringText(
      scopedSteering.merged.sceneIntent,
      request.sceneIntent
    );
    const continuityPlotThreads = this.mergeSteeringList(
      scopedSteering.merged.plotThreads,
      this.normalizeContinuityItems(request.continuityPlotThreads ?? [])
    );
    const continuityOpenLoops = this.mergeSteeringList(
      scopedSteering.merged.openLoops,
      this.normalizeContinuityItems(request.continuityOpenLoops ?? [])
    );
    const continuityCanonDeltas = this.mergeSteeringList(
      scopedSteering.merged.canonDeltas,
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
    const activeEditorTextBeforeCursor = this.getActiveEditorTextBeforeCursor();
    const inlineDirectiveResolution = this.resolveInlineDirectivesFromText(activeEditorTextBeforeCursor);
    const inlineDirectives = inlineDirectiveResolution.directives;
    const maxInputTokens = Math.max(512, completion.contextWindowTokens - completion.maxOutputTokens);
    const steeringSections = this.createSteeringSections({
      maxInputTokens,
      pinnedInstructions: mergedPinnedInstructions,
      storyNotes: mergedStoryNotes,
      sceneIntent: mergedSceneIntent,
      inlineDirectives
    });
    const systemSteeringMarkdown = this.renderSteeringPlacement(steeringSections, 'system');
    const preHistorySteeringMarkdown = this.renderSteeringPlacement(steeringSections, 'pre_history');
    const preResponseSteeringMarkdown = this.renderSteeringPlacement(steeringSections, 'pre_response');
    const effectiveSystemPrompt = systemSteeringMarkdown
      ? [
        completion.systemPrompt,
        '',
        '<lorevault_steering_system>',
        systemSteeringMarkdown,
        '</lorevault_steering_system>'
      ].join('\n')
      : completion.systemPrompt;
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
        chapterMemoryBudget = useLorebookContext
          ? Math.min(700, Math.max(96, Math.floor(remainingAfterSpecificNotes * 0.25)))
          : Math.min(900, Math.max(96, Math.floor(remainingAfterSpecificNotes * 0.45)));
        const chapterMemory = await this.buildChapterMemoryContext(activeStoryFile, chapterMemoryBudget);
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
        for (const scope of selectedScopes) {
          contexts.push(await this.liveContextIndex.query({
            queryText: querySeed || request.userMessage,
            tokenBudget: perScopeBudget,
            maxWorldInfoEntries: perScopeWorldInfoLimit,
            maxRagDocuments: perScopeRagLimit
          }, scope));
        }

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
    if (useLorebookContext) {
      const remainingAfterLorebook = Math.max(0, availableForLorebookContext - usedContextTokens);
      if (remainingAfterLorebook > 96) {
        toolContextBudget = Math.min(700, Math.max(96, Math.floor(remainingAfterLorebook * 0.5)));
        const toolContext = await this.buildToolHooksContext(
          querySeed || request.userMessage,
          selectedScopes,
          toolContextBudget
        );
        toolContextMarkdown = toolContext.markdown;
        toolContextItems = toolContext.selectedItems;
        toolContextLayerTrace = toolContext.layerTrace;
      }
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
    const inlineDirectiveSection = steeringSections.find(section => section.key === 'inline_directives');
    const inlineDirectiveTokens = inlineDirectiveSection?.usedTokens ?? 0;
    const resolvedInlineDirectiveItems = inlineDirectiveSection?.text
      ? inlineDirectiveSection.text
        .split('\n')
        .map(line => line.replace(/^\d+\.\s*/, '').trim())
        .filter(Boolean)
      : [];
    const reservedByPlacement = (placement: PromptLayerPlacement): number => steeringSections
      .filter(section => section.placement === placement)
      .reduce((sum, section) => sum + section.reservedTokens, 0);
    const trimmedByPlacement = (placement: PromptLayerPlacement): boolean => steeringSections
      .some(section => section.placement === placement && section.trimmed);
    const preHistorySteeringReserved = reservedByPlacement('pre_history');
    const preResponseSteeringReserved = reservedByPlacement('pre_response');
    const inlineDirectiveDiagnostics = [
      `${resolvedInlineDirectiveItems.length}/${inlineDirectiveResolution.foundCount} active`,
      `~${inlineDirectiveTokens} tokens`
    ];
    if (inlineDirectiveResolution.droppedByCount > 0) {
      inlineDirectiveDiagnostics.push(`dropped_by_count=${inlineDirectiveResolution.droppedByCount}`);
    }
    if (inlineDirectiveResolution.droppedByBudget > 0) {
      inlineDirectiveDiagnostics.push(`dropped_by_budget=${inlineDirectiveResolution.droppedByBudget}`);
    }
    if (inlineDirectiveSection?.trimmed) {
      inlineDirectiveDiagnostics.push('trimmed_to_reservation');
    }
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
        content: chatHistory,
        reservedTokens: historyTokenBudget,
        placement: 'pre_history',
        trimMode: 'tail',
        minTokens: 0
      },
      {
        key: 'manual_context',
        label: 'Manual Context',
        content: manualContext,
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
        content: specificNotesContextMarkdown,
        reservedTokens: Math.max(0, noteContextBudget),
        placement: 'pre_response',
        trimMode: 'head',
        minTokens: 0
      },
      {
        key: 'chapter_memory_context',
        label: 'Chapter Memory',
        content: chapterMemoryMarkdown,
        reservedTokens: Math.max(0, chapterMemoryBudget),
        placement: 'pre_response',
        trimMode: 'head',
        minTokens: 0
      },
      {
        key: 'tool_retrieval_context',
        label: 'Tool Retrieval',
        content: toolContextMarkdown,
        reservedTokens: Math.max(0, toolContextBudget),
        placement: 'pre_response',
        trimMode: 'head',
        minTokens: 0
      },
      {
        key: 'lorebook_context',
        label: 'Lorebook Context',
        content: contextMarkdown,
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
    const toolContextPromptTokens = estimateTextTokens(toolContextForPrompt);
    const loreContextPromptTokens = estimateTextTokens(loreContextForPrompt);
    const steeringPreHistoryPromptTokens = estimateTextTokens(preHistorySteeringForPrompt);
    const steeringPreResponsePromptTokens = estimateTextTokens(preResponseSteeringForPrompt);
    const steeringNonSystemPromptTokens = steeringPreHistoryPromptTokens + steeringPreResponsePromptTokens;
    const combinedLoreContextMarkdown = [loreContextForPrompt, toolContextForPrompt]
      .filter(section => section.trim().length > 0)
      .join('\n\n---\n\n');
    const contextTokensUsed = loreContextPromptTokens
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
      layerTrace.push(`chapter_memory: ${chapterMemoryItems.length} chapter summaries, ~${chapterMemoryPromptTokens} tokens`);
      layerTrace.push(...chapterMemoryLayerTrace);
    }
    if (useLorebookContext) {
      layerTrace.push(`graph_memory(world_info): ${totalWorldInfoCount} entries from ${selectedScopes.length} scope(s), ~${loreContextPromptTokens} tokens`);
      layerTrace.push(`fallback_entries: ${totalRagCount} entries, policy ${ragPolicies.join('/')} (${ragEnabledScopes}/${selectedScopes.length} scopes enabled)`);
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
    const scopedSteeringLabels = scopedSteering.layers.map(layer => `${layer.scope.type}:${layer.scope.key || 'global'}`);
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
      scopes: selectedScopes,
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
    let streamFailure: Error | null = null;
    let completionUsage: CompletionUsageReport | null = null;
    try {
      await requestStoryContinuationStream(completion, {
        systemPrompt: effectiveSystemPrompt,
        userPrompt,
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
        onUsage: usage => {
          completionUsage = usage;
        },
        abortSignal: this.generationAbortController.signal
      });
    } catch (error) {
      if (!this.isAbortLikeError(error)) {
        streamFailure = error instanceof Error ? error : new Error(String(error));
      }
    } finally {
      this.generationInFlight = false;
      this.generationAbortController = null;
      this.setGenerationStatus('idle', 'idle');
    }

    if (completionUsage) {
      await this.recordCompletionUsage('story_chat_turn', completionUsage, {
        scopeCount: selectedScopes.length,
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
        )
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
      contextMeta
    };
  }

  private mergeSettings(data: Partial<ConverterSettings> | null | undefined): ConverterSettings {
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
      completion: {
        ...DEFAULT_SETTINGS.completion,
        ...(data?.completion ?? {})
      },
      storyChat: {
        ...DEFAULT_SETTINGS.storyChat,
        ...(data?.storyChat ?? {})
      },
      storySteering: {
        ...DEFAULT_SETTINGS.storySteering,
        ...(data?.storySteering ?? {})
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

    merged.embeddings.enabled = Boolean(merged.embeddings.enabled);
    merged.embeddings.provider = (
      merged.embeddings.provider === 'ollama' ||
      merged.embeddings.provider === 'openai_compatible'
    ) ? merged.embeddings.provider : 'openrouter';
    merged.embeddings.endpoint = merged.embeddings.endpoint.trim();
    merged.embeddings.apiKey = merged.embeddings.apiKey.trim();
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
      80,
      Math.min(2000, Math.floor(Number(merged.summaries.maxSummaryChars)))
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

    merged.completion.enabled = Boolean(merged.completion.enabled);
    merged.completion.provider = (
      merged.completion.provider === 'ollama' ||
      merged.completion.provider === 'openai_compatible'
    ) ? merged.completion.provider : 'openrouter';
    merged.completion.endpoint = merged.completion.endpoint.trim() || DEFAULT_SETTINGS.completion.endpoint;
    merged.completion.apiKey = merged.completion.apiKey.trim();
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
    const completionLayerPlacement = merged.completion.layerPlacement ?? DEFAULT_SETTINGS.completion.layerPlacement;
    merged.completion.layerPlacement = {
      pinnedInstructions: this.resolvePromptLayerPlacement(
        completionLayerPlacement.pinnedInstructions,
        DEFAULT_SETTINGS.completion.layerPlacement.pinnedInstructions
      ),
      storyNotes: this.resolvePromptLayerPlacement(
        completionLayerPlacement.storyNotes,
        DEFAULT_SETTINGS.completion.layerPlacement.storyNotes
      ),
      sceneIntent: this.resolvePromptLayerPlacement(
        completionLayerPlacement.sceneIntent,
        DEFAULT_SETTINGS.completion.layerPlacement.sceneIntent
      ),
      inlineDirectives: this.resolvePromptLayerPlacement(
        completionLayerPlacement.inlineDirectives,
        DEFAULT_SETTINGS.completion.layerPlacement.inlineDirectives
      )
    };
    const rawPresets = Array.isArray(merged.completion.presets) ? merged.completion.presets : [];
    const normalizedPresets: CompletionPreset[] = [];
    for (const rawPreset of rawPresets) {
      if (!rawPreset || typeof rawPreset !== 'object') {
        continue;
      }
      const candidate = rawPreset as Partial<CompletionPreset>;
      const id = typeof candidate.id === 'string' && candidate.id.trim()
        ? candidate.id.trim()
        : `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const name = typeof candidate.name === 'string' && candidate.name.trim()
        ? candidate.name.trim()
        : 'Preset';
      const provider: CompletionPreset['provider'] = (
        candidate.provider === 'ollama' ||
        candidate.provider === 'openai_compatible'
      ) ? candidate.provider : 'openrouter';
      normalizedPresets.push({
        id,
        name,
        provider,
        endpoint: (candidate.endpoint ?? DEFAULT_SETTINGS.completion.endpoint).toString().trim() || DEFAULT_SETTINGS.completion.endpoint,
        apiKey: (candidate.apiKey ?? '').toString().trim(),
        model: (candidate.model ?? DEFAULT_SETTINGS.completion.model).toString().trim() || DEFAULT_SETTINGS.completion.model,
        systemPrompt: (candidate.systemPrompt ?? DEFAULT_SETTINGS.completion.systemPrompt).toString().trim() || DEFAULT_SETTINGS.completion.systemPrompt,
        temperature: Math.max(0, Math.min(2, Number(candidate.temperature ?? DEFAULT_SETTINGS.completion.temperature))),
        maxOutputTokens: Math.max(64, Math.floor(Number(candidate.maxOutputTokens ?? DEFAULT_SETTINGS.completion.maxOutputTokens))),
        contextWindowTokens: Math.max(
          Math.max(64, Math.floor(Number(candidate.maxOutputTokens ?? DEFAULT_SETTINGS.completion.maxOutputTokens))) + 512,
          Math.floor(Number(candidate.contextWindowTokens ?? DEFAULT_SETTINGS.completion.contextWindowTokens))
        ),
        promptReserveTokens: Math.max(0, Math.floor(Number(candidate.promptReserveTokens ?? DEFAULT_SETTINGS.completion.promptReserveTokens))),
        timeoutMs: Math.max(1000, Math.floor(Number(candidate.timeoutMs ?? DEFAULT_SETTINGS.completion.timeoutMs)))
      });
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
    merged.storyChat.pinnedInstructions = (merged.storyChat.pinnedInstructions ?? '').toString();
    merged.storyChat.storyNotes = (merged.storyChat.storyNotes ?? '').toString();
    merged.storyChat.sceneIntent = (merged.storyChat.sceneIntent ?? '').toString();
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
          pinnedInstructions: (snapshot.pinnedInstructions ?? '').toString(),
          storyNotes: (snapshot.storyNotes ?? '').toString(),
          sceneIntent: (snapshot.sceneIntent ?? '').toString(),
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
    this.settings = this.mergeSettings(await this.loadData());
    this.usageLedgerStore = new UsageLedgerStore(this.app, this.resolveUsageLedgerPath());
    this.storySteeringStore = new StorySteeringStore(
      this.app,
      () => this.getStorySteeringFolderPath()
    );
    this.liveContextIndex = new LiveContextIndex(
      this.app,
      () => this.settings
    );
    this.chapterSummaryStore = new ChapterSummaryStore(this.app);
    this.registerView(LOREVAULT_MANAGER_VIEW_TYPE, leaf => new LorebooksManagerView(leaf, this));
    this.registerView(LOREVAULT_ROUTING_DEBUG_VIEW_TYPE, leaf => new LorebooksRoutingDebugView(leaf, this));
    this.registerView(LOREVAULT_QUERY_SIMULATION_VIEW_TYPE, leaf => new LorebooksQuerySimulationView(leaf, this));
    this.registerView(LOREVAULT_STORY_CHAT_VIEW_TYPE, leaf => new StoryChatView(leaf, this));
    this.registerView(LOREVAULT_STORY_STEERING_VIEW_TYPE, leaf => new StorySteeringView(leaf, this));
    this.registerView(LOREVAULT_HELP_VIEW_TYPE, leaf => new LorevaultHelpView(leaf, this));
    this.registerView(LOREVAULT_IMPORT_VIEW_TYPE, leaf => new LorevaultImportView(leaf, this));
    this.registerView(LOREVAULT_STORY_EXTRACT_VIEW_TYPE, leaf => new LorevaultStoryExtractView(leaf, this));
    this.registerView(LOREVAULT_STORY_DELTA_VIEW_TYPE, leaf => new LorevaultStoryDeltaView(leaf, this));

    // Add custom ribbon icons with clearer intent.
    addIcon('lorevault-build', `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" d="M16 20h44a8 8 0 0 1 8 8v56a8 8 0 0 0-8-8H16z"/>
      <path fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" d="M68 28h16"/>
      <path fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" d="M76 20v16"/>
      <path fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" d="M30 38h24M30 52h20M30 66h16"/>
    </svg>`);
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

    // Add settings tab
    this.addSettingTab(new LoreBookConverterSettingTab(this.app, this));
    this.generationStatusEl = this.addStatusBarItem();
    this.syncIdleGenerationTelemetryToSettings();

    // Add ribbon icon
    this.addRibbonIcon('lorevault-build', 'Build Active Lorebook Scope', () => {
      void this.buildActiveScopeExport();
    });

    this.addRibbonIcon('lorevault-manager', 'Open LoreVault Manager', () => {
      void this.openLorebooksManagerView();
    });

    this.addRibbonIcon('lorevault-chat', 'Open Story Chat', () => {
      void this.openStoryChatView();
    });

    this.addRibbonIcon('help-circle', 'Open LoreVault Help', () => {
      void this.openHelpView();
    });

    // Add command
    this.addCommand({
      id: 'convert-to-lorebook',
      name: 'Build Active Lorebook Scope',
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
      id: 'open-story-steering',
      name: 'Open Story Steering',
      callback: () => {
        void this.openStorySteeringView();
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
      id: 'import-sillytavern-lorebook',
      name: 'Import SillyTavern Lorebook',
      callback: () => {
        void this.openImportLorebookView();
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
      id: 'apply-story-delta-to-existing-wiki',
      name: 'Apply Story Delta to Existing Wiki',
      callback: () => {
        void this.openStoryDeltaView();
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
      id: 'run-text-command-on-selection',
      name: 'Run Text Command on Selection',
      editorCallback: (editor, info) => {
        void this.runTextCommandOnSelection(editor, info);
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
      id: 'generate-chapter-summary-active-note',
      name: 'Generate Chapter Summary (Active Note)',
      callback: () => {
        void this.generateSummaryForActiveNote('chapter');
      }
    });

    this.addCommand({
      id: 'generate-world-info-summaries-active-scope',
      name: 'Generate World Info Summaries (Active Scope)',
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
      const isChapterNote = targetFile ? this.noteHasChapterFrontmatter(targetFile) : false;
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

      if (targetFile && isChapterNote) {
        menu.addItem(item => {
          item
            .setTitle('LoreVault: Generate Chapter Summary')
            .setIcon('file-text')
            .onClick(() => {
              void this.generateSummaryForNote(targetFile, 'chapter');
            });
        });
      }

      menu.addItem(item => {
        if (this.generationInFlight) {
          item.setTitle('LoreVault: Generation Running');
          item.setDisabled(true);
          return;
        }

        item
          .setTitle('LoreVault: Continue Story with Context')
          .setIcon('book-open-text')
          .onClick(() => {
            void this.continueStoryWithContext();
          });
      });

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
      this.liveContextIndex.markFileChanged(file);
      this.chapterSummaryStore.invalidatePath(file.path);
      this.refreshManagerViews();
      this.refreshRoutingDebugViews();
      this.refreshQuerySimulationViews();
      this.refreshStoryChatViews();
      this.refreshStorySteeringViews();
    }));

    this.registerEvent(this.app.vault.on('modify', file => {
      this.liveContextIndex.markFileChanged(file);
      this.chapterSummaryStore.invalidatePath(file.path);
      this.refreshManagerViews();
      this.refreshRoutingDebugViews();
      this.refreshQuerySimulationViews();
      this.refreshStoryChatViews();
      this.refreshStorySteeringViews();
    }));

    this.registerEvent(this.app.vault.on('delete', file => {
      this.liveContextIndex.markFileChanged(file);
      this.chapterSummaryStore.invalidatePath(file.path);
      this.refreshManagerViews();
      this.refreshRoutingDebugViews();
      this.refreshQuerySimulationViews();
      this.refreshStoryChatViews();
      this.refreshStorySteeringViews();
    }));

    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.liveContextIndex.markRenamed(file, oldPath);
      this.chapterSummaryStore.invalidatePath(oldPath);
      this.chapterSummaryStore.invalidatePath(file.path);
      this.refreshManagerViews();
      this.refreshRoutingDebugViews();
      this.refreshQuerySimulationViews();
      this.refreshStoryChatViews();
      this.refreshStorySteeringViews();
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
    this.app.workspace.detachLeavesOfType(LOREVAULT_STORY_STEERING_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_HELP_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_IMPORT_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_STORY_EXTRACT_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LOREVAULT_STORY_DELTA_VIEW_TYPE);
    if (this.managerRefreshTimer !== null) {
      window.clearTimeout(this.managerRefreshTimer);
      this.managerRefreshTimer = null;
    }
    this.generationStatusEl = null;
  }

  async saveData(settings: any) {
    this.settings = this.mergeSettings(settings as Partial<ConverterSettings>);
    await super.saveData(this.settings);
    this.syncUsageLedgerStorePath();
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

  private resolveStoryScopesFromFrontmatter(activeFile: TFile | null): string[] {
    if (!activeFile) {
      return [];
    }

    const cache = this.app.metadataCache.getFileCache(activeFile);
    const frontmatter = normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
    return parseStoryScopesFromFrontmatter(frontmatter, this.settings.tagScoping.tagPrefix);
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
    tokenBudget: number
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
    const resolution = resolveStoryThread(nodes, activeFile.path);
    if (!resolution || resolution.currentIndex <= 0) {
      return { markdown: '', usedTokens: 0, items: [], layerTrace: [] };
    }

    const nodeByPath = new Map(nodes.map(node => [node.path, node]));
    const priorPaths = resolution.orderedPaths
      .slice(0, resolution.currentIndex)
      .slice(-4);

    const sections: string[] = [];
    const items: string[] = [];
    const layerTrace: string[] = [];
    let usedTokens = 0;

    for (const priorPath of priorPaths) {
      if (usedTokens >= tokenBudget) {
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
        body => this.trimTextHeadToTokenBudget(body, 180)
      );
      if (!summary?.text.trim()) {
        continue;
      }

      const node = nodeByPath.get(priorPath);
      const chapterPrefix = typeof node?.chapter === 'number'
        ? `Chapter ${node.chapter}`
        : 'Chapter';
      const chapterTitle = node?.chapterTitle || node?.title || file.basename;
      const section = [
        `### ${chapterPrefix}: ${chapterTitle}`,
        `Source: \`${priorPath}\``,
        '',
        summary.text
      ].join('\n');

      const sectionTokens = this.estimateTokens(section);
      if (usedTokens + sectionTokens > tokenBudget) {
        continue;
      }

      usedTokens += sectionTokens;
      sections.push(section);
      items.push(chapterTitle);
      layerTrace.push(`chapter_memory:${chapterTitle} (${summary.source}, ~${sectionTokens} tokens)`);
    }

    return {
      markdown: sections.join('\n\n---\n\n'),
      usedTokens,
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
      new Notice('No lorebook scope found for active file. Tag the note or set Active Scope.');
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
      const prompt = stripFrontmatter(raw).trim();
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

    const contexts: AssembledContext[] = [];
    for (const scope of targetScopes) {
      contexts.push(await this.liveContextIndex.query({
        queryText: selectionText,
        tokenBudget: perScopeBudget
      }, scope));
    }

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
      if (!this.settings.completion.enabled) {
        new Notice('Writing completion is disabled. Enable it under LoreVault Settings → Writing Completion.');
        return;
      }
      if (this.settings.completion.provider !== 'ollama' && !this.settings.completion.apiKey) {
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

      const completion = this.settings.completion;
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
        onUsage: usage => {
          void this.recordCompletionUsage('text_command_edit', usage, {
            promptTemplateId: selection.promptId,
            includeLorebookContext: selection.includeLorebookContext,
            worldInfoCount,
            ragCount,
            scopeCount: scopeLabels.length
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

    let nextText = revisedText;
    if (!this.settings.textCommands.autoAcceptEdits) {
      const reviewModal = new TextCommandReviewModal(
        this.app,
        selectedText,
        revisedText,
        selection.promptName
      );
      const reviewResultPromise = reviewModal.waitForResult();
      reviewModal.open();
      const review = await reviewResultPromise;
      if (review.action !== 'apply') {
        new Notice('Text command cancelled.');
        return;
      }
      nextText = review.revisedText;
    }

    const currentSelectedText = editor.getRange(from, to);
    if (currentSelectedText !== selectedText) {
      new Notice('Selection changed while generating. Re-run the text command on the current selection.');
      return;
    }

    editor.replaceRange(nextText, from, to);
    if (selection.includeLorebookContext) {
      new Notice(
        `Applied text command (${scopeLabels.join(', ') || '(all)'} | world_info ${worldInfoCount}, fallback ${ragCount}).`
      );
    } else {
      new Notice('Applied text command edit.');
    }

    if (selection.includeLorebookContext && (worldInfoDetails.length > 0 || ragDetails.length > 0)) {
      new Notice(
        [
          `text command context`,
          `world_info: ${worldInfoDetails.join(', ') || '(none)'}`,
          `fallback: ${ragDetails.join(', ') || '(none)'}`
        ].join('\n')
      );
    }
  }

  async continueStoryWithContext(): Promise<void> {
    if (this.generationInFlight) {
      new Notice('LoreVault generation is already running.');
      return;
    }

    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView) {
      new Notice('No active markdown editor found.');
      return;
    }

    const editor = markdownView.editor;
    const activeFile = markdownView.file ?? this.app.workspace.getActiveFile();
    const cursor = editor.getCursor();
    const rawTextBeforeCursor = editor.getRange({ line: 0, ch: 0 }, cursor);
    const inlineDirectiveResolution = this.resolveInlineDirectivesFromText(rawTextBeforeCursor);
    const inlineDirectives = inlineDirectiveResolution.directives;
    const textBeforeCursor = stripInlineLoreDirectives(rawTextBeforeCursor);
    const fallbackQuery = activeFile?.basename ?? 'story continuation';
    const frontmatterScopes = this.resolveStoryScopesFromFrontmatter(activeFile);
    const fallbackScope = this.resolveScopeFromActiveFile(activeFile) ?? normalizeScope(this.settings.tagScoping.activeScope);
    const scopesToQuery = frontmatterScopes.length > 0
      ? frontmatterScopes
      : (fallbackScope ? [fallbackScope] : []);
    const targetScopes = scopesToQuery.length > 0 ? scopesToQuery : [''];
    const targetScopeLabels = targetScopes.map(scope => scope || '(all)');
    const initialScopeLabel = this.renderScopeListLabel(targetScopeLabels);

    try {
      this.generationInFlight = true;
      this.generationAbortController = new AbortController();
      if (!this.settings.completion.enabled) {
        new Notice('Writing completion is disabled. Enable it under LoreVault Settings → Writing Completion.');
        return;
      }
      if (this.settings.completion.provider !== 'ollama' && !this.settings.completion.apiKey) {
        new Notice('Missing completion API key. Configure it under LoreVault Settings → Writing Completion.');
        return;
      }

      const completion = this.settings.completion;
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
      this.setGenerationStatus(`preparing | scopes ${initialScopeLabel}`, 'busy');

      const maxInputTokens = Math.max(512, completion.contextWindowTokens - completion.maxOutputTokens);
      const scopedSteering = await this.storySteeringStore.resolveEffectiveStateForFile(activeFile);
      const steeringFromFrontmatter = this.resolveSteeringFromFrontmatter(activeFile);
      const mergedSteering = {
        pinnedInstructions: this.mergeSteeringText(
          scopedSteering.merged.pinnedInstructions,
          steeringFromFrontmatter.pinnedInstructions
        ),
        storyNotes: this.mergeSteeringText(
          scopedSteering.merged.storyNotes,
          steeringFromFrontmatter.storyNotes
        ),
        sceneIntent: this.mergeSteeringText(
          scopedSteering.merged.sceneIntent,
          steeringFromFrontmatter.sceneIntent
        )
      };
      const continuityFromFrontmatter = this.resolveContinuityFromFrontmatter(activeFile);
      const mergedContinuity = {
        plotThreads: this.mergeSteeringList(
          scopedSteering.merged.plotThreads,
          continuityFromFrontmatter.plotThreads
        ),
        openLoops: this.mergeSteeringList(
          scopedSteering.merged.openLoops,
          continuityFromFrontmatter.openLoops
        ),
        canonDeltas: this.mergeSteeringList(
          scopedSteering.merged.canonDeltas,
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
        pinnedInstructions: mergedSteering.pinnedInstructions,
        storyNotes: mergedSteering.storyNotes,
        sceneIntent: mergedSteering.sceneIntent,
        inlineDirectives
      });
      const systemSteeringMarkdown = this.renderSteeringPlacement(steeringSections, 'system');
      const preHistorySteeringMarkdown = this.renderSteeringPlacement(steeringSections, 'pre_history');
      const preResponseSteeringMarkdown = this.renderSteeringPlacement(steeringSections, 'pre_response');
      const effectiveSystemPrompt = systemSteeringMarkdown
        ? [
          completion.systemPrompt,
          '',
          '<lorevault_steering_system>',
          systemSteeringMarkdown,
          '</lorevault_steering_system>'
        ].join('\n')
        : completion.systemPrompt;
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
      const inlineDirectiveSection = steeringSections.find(section => section.key === 'inline_directives');
      const inlineDirectiveTokens = inlineDirectiveSection?.usedTokens ?? 0;
      const resolvedInlineDirectiveItems = inlineDirectiveSection?.text
        ? inlineDirectiveSection.text
          .split('\n')
          .map(line => line.replace(/^\d+\.\s*/, '').trim())
          .filter(Boolean)
        : [];
      const availablePromptBudget = Math.max(
        256,
        maxInputTokens - completion.promptReserveTokens - instructionOverhead - steeringNonSystemTokens
      );
      const desiredContextReserve = Math.max(1024, Math.min(32000, Math.floor(availablePromptBudget * 0.22)));
      const baselineStoryTarget = Math.max(256, Math.floor(availablePromptBudget * 0.62));
      const maxStoryTokensForContext = Math.max(64, availablePromptBudget - desiredContextReserve);
      const storyTokenTarget = Math.max(64, Math.min(baselineStoryTarget, maxStoryTokensForContext));
      const queryTokenTarget = Math.max(900, Math.min(40000, Math.floor(maxInputTokens * 0.22)));
      const queryText = this.extractQueryWindow(textBeforeCursor, queryTokenTarget);
      const scopedQuery = queryText || fallbackQuery;
      const initialStoryWindow = textBeforeCursor;
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
      let chapterMemoryItems: string[] = [];
      let chapterMemoryLayerTrace: string[] = [];
      if (availableForContext > 96 && activeFile) {
        const chapterMemoryBudget = Math.min(
          900,
          Math.max(96, Math.floor(Math.max(0, availableForContext) * 0.3))
        );
        const chapterMemory = await this.buildChapterMemoryContext(activeFile, chapterMemoryBudget);
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
        `retrieving | scopes ${initialScopeLabel} | ctx ${Math.max(0, availableForContext)} left`,
        'busy'
      );

      let contexts: AssembledContext[] = [];
      let remainingInputTokens = 0;
      let usedContextTokens = 0;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const perScopeBudget = Math.max(64, Math.floor(contextBudget / Math.max(1, targetScopes.length)));
        const perScopeWorldInfoLimit = Math.max(8, Math.min(80, Math.floor(perScopeBudget / 900)));
        const perScopeRagLimit = Math.max(6, Math.min(48, Math.floor(perScopeBudget / 1800)));
        contexts = [];
        for (const scope of targetScopes) {
          contexts.push(await this.liveContextIndex.query({
            queryText: scopedQuery,
            tokenBudget: perScopeBudget,
            maxWorldInfoEntries: perScopeWorldInfoLimit,
            maxRagDocuments: perScopeRagLimit
          }, scope));
        }

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

      const selectedScopeLabels = contexts.map(item => item.scope || '(all)');
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
      const preHistorySteeringReserved = reservedByPlacement('pre_history');
      const preResponseSteeringReserved = reservedByPlacement('pre_response');
      const inlineDirectiveDiagnostics = [
        `${resolvedInlineDirectiveItems.length}/${inlineDirectiveResolution.foundCount} active`,
        `~${inlineDirectiveTokens} tokens`
      ];
      if (inlineDirectiveResolution.droppedByCount > 0) {
        inlineDirectiveDiagnostics.push(`dropped_by_count=${inlineDirectiveResolution.droppedByCount}`);
      }
      if (inlineDirectiveResolution.droppedByBudget > 0) {
        inlineDirectiveDiagnostics.push(`dropped_by_budget=${inlineDirectiveResolution.droppedByBudget}`);
      }
      if (inlineDirectiveSection?.trimmed) {
        inlineDirectiveDiagnostics.push('trimmed_to_reservation');
      }
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
          content: chapterMemoryMarkdown,
          reservedTokens: Math.max(0, Math.floor(Math.max(0, availableForContext) * 0.3)),
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
          content: toolContextMarkdown,
          reservedTokens: Math.max(0, Math.floor(Math.max(0, remainingInputTokens) * 0.55)),
          placement: 'pre_response',
          trimMode: 'head',
          minTokens: 0
        },
        {
          key: 'lorebook_context',
          label: 'Lorebook Context',
          content: graphContextMarkdown,
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
          label: 'Story Window',
          content: storyWindow,
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
        `local_window: ~${storyPromptTokens} tokens`,
        `inline_directives: ${inlineDirectiveDiagnostics.join(', ')}`,
        `chapter_memory: ${chapterMemoryItems.length} summaries, ~${chapterMemoryPromptTokens} tokens`,
        `continuity_state: threads ${mergedContinuity.selection.includePlotThreads ? mergedContinuity.plotThreads.length : 0}, open_loops ${mergedContinuity.selection.includeOpenLoops ? mergedContinuity.openLoops.length : 0}, canon_deltas ${mergedContinuity.selection.includeCanonDeltas ? mergedContinuity.canonDeltas.length : 0}, ~${continuityPromptTokens} tokens`,
        ...chapterMemoryLayerTrace,
        `graph_memory(world_info): ${totalWorldInfo} entries, ~${loreContextPromptTokens} tokens`,
        `fallback_entries: ${totalRag} entries, policy ${ragPolicies.join('/')} (${ragEnabledScopes}/${Math.max(1, contexts.length)} scopes enabled)`,
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
        `generating | scopes ${scopeLabel} | ctx ${Math.max(0, remainingInputTokens)} left | out ~0/${completion.maxOutputTokens}`,
        'busy'
      );
      new Notice(
        [
          `LoreVault generating for scopes: ${scopeLabel}`,
          `Provider: ${completion.provider} (${completion.model})`,
          `Context window left: ${Math.max(0, remainingInputTokens)} tokens`,
          `inline directives: ${resolvedInlineDirectiveItems.join(' | ') || '(none)'}`,
          `chapter memory: ${chapterMemoryItems.join(', ') || '(none)'}`,
          `continuity: threads ${(mergedContinuity.selection.includePlotThreads ? mergedContinuity.plotThreads : []).join(' | ') || '(none)'} | open loops ${(mergedContinuity.selection.includeOpenLoops ? mergedContinuity.openLoops : []).join(' | ') || '(none)'} | canon deltas ${(mergedContinuity.selection.includeCanonDeltas ? mergedContinuity.canonDeltas : []).join(' | ') || '(none)'}`,
          `world_info: ${worldInfoDetails.join(', ') || '(none)'}`,
          `fallback: ${ragDetails.join(', ') || '(none)'}`,
          `tool_hooks: ${toolContextItems.join(', ') || '(none)'}`,
          `layers: ${contextLayerTrace.join(' | ')}`
        ].join('\n')
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

      let insertPos = cursor;
      if (cursor.ch !== 0) {
        editor.replaceRange('\n', insertPos);
        const offset = editor.posToOffset(insertPos) + 1;
        insertPos = editor.offsetToPos(offset);
      }

      let generatedText = '';
      let lastStatusUpdate = 0;
      let completionUsage: CompletionUsageReport | null = null;

      await requestStoryContinuationStream(completion, {
        systemPrompt: effectiveSystemPrompt,
        userPrompt,
        onDelta: (delta: string) => {
          if (!delta) {
            return;
          }

          editor.replaceRange(delta, insertPos);
          const nextOffset = editor.posToOffset(insertPos) + delta.length;
          insertPos = editor.offsetToPos(nextOffset);
          generatedText += delta;

          const now = Date.now();
          if (now - lastStatusUpdate >= 250) {
            lastStatusUpdate = now;
            const outTokens = this.estimateTokens(generatedText);
            this.updateGenerationTelemetry({
              generatedTokens: outTokens,
              statusText: 'generating'
            });
            this.setGenerationStatus(
              `generating | scopes ${scopeLabel} | ctx ${Math.max(0, remainingInputTokens)} left | out ~${outTokens}/${completion.maxOutputTokens}`,
              'busy'
            );
          }
        },
        onUsage: usage => {
          completionUsage = usage;
        },
        abortSignal: this.generationAbortController.signal
      });

      if (completionUsage) {
        await this.recordCompletionUsage('editor_continuation', completionUsage, {
          scopeCount: selectedScopeLabels.length,
          worldInfoCount: totalWorldInfo,
          ragCount: totalRag,
          usedChapterMemoryContext: chapterMemoryItems.length > 0,
          inlineDirectiveCount: resolvedInlineDirectiveItems.length,
          continuityItemCount: (
            (mergedContinuity.selection.includePlotThreads ? mergedContinuity.plotThreads.length : 0)
            + (mergedContinuity.selection.includeOpenLoops ? mergedContinuity.openLoops.length : 0)
            + (mergedContinuity.selection.includeCanonDeltas ? mergedContinuity.canonDeltas.length : 0)
          )
        });
      }

      if (!generatedText.trim()) {
        throw new Error('Completion provider returned empty output.');
      }
      editor.replaceRange('\n', insertPos);
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
        `Inserted continuation for ${selectedScopeLabels.length} scope(s) (${totalWorldInfo} world_info, ${totalRag} fallback, ~${generatedTokens} output tokens).`
      );
      this.setGenerationStatus('idle', 'idle');
    } catch (error) {
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
  async convertToLorebook(scopeOverride?: string) {
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
        ? new EmbeddingService(this.app, this.settings.embeddings)
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

      for (const assignment of scopeAssignments) {
        const { scope, paths } = assignment;
        const progress = new ProgressBar(
          files.length + 7, // files + graph + chunks + embeddings + sqlite + sqlite-read + world_info + fallback markdown
          `Building LoreVault scope: ${scope || '(all)'}`
        );

        const scopePackResult = await buildScopePack(
          this.app,
          this.settings,
          scope,
          files,
          buildAllScopes,
          embeddingService,
          progress
        );

        const scopedSettings = scopePackResult.scopedSettings;
        let worldInfoEntries = scopePackResult.pack.worldInfoEntries;
        let ragDocuments = scopePackResult.pack.ragDocuments;

        if (this.settings.sqlite.enabled) {
          progress.setStatus(`Scope ${scope || '(all)'}: exporting canonical SQLite pack...`);
          await sqliteExporter.exportScopePack(scopePackResult.pack, paths.sqlitePath);
          progress.update();

          progress.setStatus(`Scope ${scope || '(all)'}: reading exports from SQLite pack...`);
          const readPack = await sqliteReader.readScopePack(paths.sqlitePath);
          worldInfoEntries = readPack.worldInfoEntries;
          ragDocuments = readPack.ragDocuments;
          progress.update();
        }

        progress.setStatus(`Scope ${scope || '(all)'}: exporting world_info JSON...`);
        await worldInfoExporter.exportLoreBookJson(
          this.mapEntriesByUid(worldInfoEntries),
          paths.worldInfoPath,
          scopedSettings
        );
        progress.update();

        progress.setStatus(`Scope ${scope || '(all)'}: exporting fallback markdown...`);
        await ragExporter.exportRagMarkdown(ragDocuments, paths.ragPath, scope || '(all)');
        progress.update();

        progress.success(
          `Scope ${scope || '(all)'} complete: ${worldInfoEntries.length} world_info entries, ${ragDocuments.length} fallback docs.`
        );
      }

      new Notice(`LoreVault build complete for ${scopesToBuild.length} scope(s).`);
      this.liveContextIndex.requestFullRefresh();
      this.refreshManagerViews();
      this.refreshRoutingDebugViews();
      this.refreshQuerySimulationViews();
      this.refreshStoryChatViews();
    } catch (error) {
      console.error('Conversion failed:', error);
      new Notice(`Conversion failed: ${error.message}`);
    }
  }
}
