import { normalizeScope } from './lorebook-scoping';
import { normalizeLinkTarget } from './link-target-index';
import { LoreBookEntry } from './models';

export type RetrievalToolName = 'search_entries' | 'expand_neighbors' | 'get_entry';

export interface RetrievalToolDefinition {
  type: 'function';
  function: {
    name: RetrievalToolName;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface RetrievalToolPlannerCall {
  id: string;
  name: RetrievalToolName;
  argumentsJson: string;
}

export interface RetrievalToolPlannerMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: RetrievalToolName;
  toolCalls?: RetrievalToolPlannerCall[];
}

export interface RetrievalToolPlannerResponse {
  assistantText: string;
  toolCalls: RetrievalToolPlannerCall[];
  finishReason: string;
}

export interface RetrievalToolPlannerRequest {
  messages: RetrievalToolPlannerMessage[];
  toolDefinitions: RetrievalToolDefinition[];
  timeoutMs: number;
  abortSignal?: AbortSignal;
}

export type RetrievalToolPlanner = (
  request: RetrievalToolPlannerRequest
) => Promise<RetrievalToolPlannerResponse>;

export interface RetrievalToolCatalogInput {
  scope: string;
  entries: LoreBookEntry[];
}

interface CatalogEntry {
  key: string;
  scope: string;
  uid: number;
  entry: LoreBookEntry;
  normalizedTitle: string;
  normalizedKeywords: string[];
  normalizedContent: string;
  neighbors: string[];
}

export interface RetrievalToolCatalog {
  entriesByKey: Map<string, CatalogEntry>;
  keysByScope: Map<string, string[]>;
  keysByUid: Map<number, string[]>;
}

interface EntryPreview {
  uid: number;
  scope: string;
  title: string;
  keywords: string[];
  score?: number;
  reason?: string;
  distance?: number;
  path?: number[];
  snippet?: string;
}

interface ToolExecutionResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  selectedKeys: string[];
  trace: string;
}

export interface RetrievalToolLimits {
  maxCalls: number;
  maxResultTokens: number;
  maxPlanningTimeMs: number;
  maxInjectedEntries: number;
}

export interface RetrievalToolRunOptions {
  queryText: string;
  selectedScopes: string[];
  contextTokenBudget: number;
  catalog: RetrievalToolCatalog;
  planner: RetrievalToolPlanner;
  limits: RetrievalToolLimits;
  abortSignal?: AbortSignal;
}

export interface RetrievalToolRunResult {
  markdown: string;
  usedTokens: number;
  selectedItems: string[];
  trace: string[];
  executedCalls: number;
  stopReason: 'completed' | 'call_limit' | 'result_token_limit' | 'time_limit' | 'aborted' | 'planner_error';
  lastPlannerError: string;
}

const SUPPORTED_TOOL_NAMES: RetrievalToolName[] = ['search_entries', 'expand_neighbors', 'get_entry'];

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function tokenize(value: string): string[] {
  const tokens = normalizeText(value).match(/[a-z0-9][a-z0-9_-]*/g);
  if (!tokens) {
    return [];
  }
  return [...new Set(tokens)];
}

function getBasename(value: string): string {
  const normalized = normalizeLinkTarget(value);
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : normalized;
}

function makeCatalogKey(scope: string, uid: number): string {
  return `${scope}\u0000${uid}`;
}

function isToolName(value: string): value is RetrievalToolName {
  return SUPPORTED_TOOL_NAMES.includes(value as RetrievalToolName);
}

function getScopeLabel(scope: string): string {
  return scope || '(all)';
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function buildTargetIndexForScope(entries: CatalogEntry[]): Map<string, string[]> {
  const targetIndex = new Map<string, string[]>();

  const addTarget = (target: string, key: string): void => {
    const normalized = normalizeLinkTarget(target);
    if (!normalized) {
      return;
    }
    const existing = targetIndex.get(normalized) ?? [];
    if (!existing.includes(key)) {
      existing.push(key);
      existing.sort((a, b) => a.localeCompare(b));
      targetIndex.set(normalized, existing);
    }
  };

  for (const entry of entries) {
    const terms = [entry.entry.comment, ...entry.entry.key, ...entry.entry.keysecondary];
    for (const term of terms) {
      const normalized = normalizeLinkTarget(term);
      if (!normalized) {
        continue;
      }
      addTarget(normalized, entry.key);
      const basename = getBasename(normalized);
      if (basename && basename !== normalized) {
        addTarget(basename, entry.key);
      }
      if (normalized.includes(' ')) {
        addTarget(normalized.replace(/ /g, '-'), entry.key);
        addTarget(normalized.replace(/ /g, '_'), entry.key);
      }
    }
  }

  return targetIndex;
}

export function createRetrievalToolCatalog(inputs: RetrievalToolCatalogInput[]): RetrievalToolCatalog {
  const entriesByKey = new Map<string, CatalogEntry>();
  const keysByScope = new Map<string, string[]>();
  const keysByUid = new Map<number, string[]>();
  const entriesByScope = new Map<string, CatalogEntry[]>();

  const sortedInputs = [...inputs].sort((a, b) => {
    const scopeA = normalizeScope(a.scope);
    const scopeB = normalizeScope(b.scope);
    return scopeA.localeCompare(scopeB);
  });

  for (const input of sortedInputs) {
    const scope = normalizeScope(input.scope);
    const sortedEntries = [...input.entries].sort((a, b) => a.uid - b.uid);
    for (const entry of sortedEntries) {
      const key = makeCatalogKey(scope, entry.uid);
      const normalizedKeywords = uniqueSorted([
        ...entry.key.map(item => normalizeText(item)),
        ...entry.keysecondary.map(item => normalizeText(item))
      ].filter(Boolean));
      const item: CatalogEntry = {
        key,
        scope,
        uid: entry.uid,
        entry,
        normalizedTitle: normalizeText(entry.comment),
        normalizedKeywords,
        normalizedContent: normalizeText(entry.content),
        neighbors: []
      };
      entriesByKey.set(key, item);

      const scopeKeys = keysByScope.get(scope) ?? [];
      scopeKeys.push(key);
      scopeKeys.sort((a, b) => a.localeCompare(b));
      keysByScope.set(scope, scopeKeys);

      const uidKeys = keysByUid.get(entry.uid) ?? [];
      uidKeys.push(key);
      uidKeys.sort((a, b) => a.localeCompare(b));
      keysByUid.set(entry.uid, uidKeys);

      const byScope = entriesByScope.get(scope) ?? [];
      byScope.push(item);
      entriesByScope.set(scope, byScope);
    }
  }

  for (const [scope, scopeEntries] of entriesByScope.entries()) {
    const targetIndex = buildTargetIndexForScope(scopeEntries);
    for (const item of scopeEntries) {
      const neighbors = new Set<string>();
      for (const wikilink of item.entry.wikilinks ?? []) {
        const normalized = normalizeLinkTarget(wikilink);
        if (!normalized) {
          continue;
        }
        const candidates = [
          ...(targetIndex.get(normalized) ?? []),
          ...(targetIndex.get(getBasename(normalized)) ?? [])
        ];
        for (const candidate of candidates) {
          if (candidate !== item.key) {
            neighbors.add(candidate);
          }
        }
      }
      const sortedNeighbors = [...neighbors].sort((a, b) => {
        const left = entriesByKey.get(a);
        const right = entriesByKey.get(b);
        if (!left || !right) {
          return a.localeCompare(b);
        }
        return right.entry.order - left.entry.order || left.uid - right.uid;
      });
      const current = entriesByKey.get(item.key);
      if (current) {
        current.neighbors = sortedNeighbors;
      }
    }
    entriesByScope.set(scope, scopeEntries);
  }

  return {
    entriesByKey,
    keysByScope,
    keysByUid
  };
}

function parseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (_error) {
    return null;
  }
}

function readOptionalString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function readInteger(
  obj: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const value = Number(obj[key]);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function resolveScopeFilter(
  scopeArg: string,
  allowedScopes: Set<string>,
  catalog: RetrievalToolCatalog
): string[] {
  const normalized = normalizeScope(scopeArg);
  if (!normalized) {
    return [...allowedScopes].sort((a, b) => a.localeCompare(b));
  }
  if (!allowedScopes.has(normalized)) {
    return [];
  }
  if (!catalog.keysByScope.has(normalized)) {
    return [];
  }
  return [normalized];
}

function createSnippet(content: string, queryTokens: string[]): string {
  const cleaned = content.trim();
  if (!cleaned) {
    return '';
  }

  const maxChars = 260;
  const normalized = normalizeText(cleaned);
  let start = 0;
  for (const token of queryTokens) {
    const index = normalized.indexOf(token);
    if (index >= 0) {
      start = Math.max(0, index - 80);
      break;
    }
  }
  const segment = cleaned.slice(start, start + maxChars).trim();
  if (start + maxChars < cleaned.length) {
    return `${segment}...`;
  }
  return segment;
}

function searchEntries(
  catalog: RetrievalToolCatalog,
  args: Record<string, unknown>,
  allowedScopes: Set<string>
): ToolExecutionResult {
  const query = readOptionalString(args, 'query');
  if (!query) {
    return {
      ok: false,
      error: 'search_entries requires a non-empty "query" string.',
      selectedKeys: [],
      trace: 'search_entries error: missing query'
    };
  }

  const scopeValues = resolveScopeFilter(readOptionalString(args, 'scope'), allowedScopes, catalog);
  if (scopeValues.length === 0) {
    return {
      ok: false,
      error: 'search_entries scope did not match active scopes.',
      selectedKeys: [],
      trace: 'search_entries error: scope not active'
    };
  }

  const limit = readInteger(args, 'limit', 6, 1, 20);
  const normalizedQuery = normalizeText(query);
  const queryTokens = tokenize(query);
  const tokenSet = new Set(queryTokens);

  const matches: Array<{ key: string; preview: EntryPreview; score: number }> = [];
  for (const scope of scopeValues) {
    for (const key of catalog.keysByScope.get(scope) ?? []) {
      const item = catalog.entriesByKey.get(key);
      if (!item) {
        continue;
      }

      let score = 0;
      const reasons: string[] = [];
      if (item.normalizedTitle && normalizedQuery.includes(item.normalizedTitle)) {
        score += 120;
        reasons.push('title phrase');
      }
      for (const keyword of item.normalizedKeywords) {
        if (tokenSet.has(keyword)) {
          score += 80;
          reasons.push(`keyword:${keyword}`);
        } else if (keyword && normalizedQuery.includes(keyword)) {
          score += 30;
          reasons.push(`keyword phrase:${keyword}`);
        }
      }
      for (const token of tokenSet) {
        if (token.length < 3) {
          continue;
        }
        if (item.normalizedTitle.includes(token)) {
          score += 30;
          reasons.push(`title token:${token}`);
        } else if (item.normalizedContent.includes(token)) {
          score += 8;
          reasons.push(`content token:${token}`);
        }
      }

      if (score <= 0) {
        continue;
      }

      const preview: EntryPreview = {
        uid: item.uid,
        scope: item.scope,
        title: item.entry.comment,
        keywords: item.entry.key,
        score,
        reason: uniqueSorted(reasons).join(', '),
        snippet: createSnippet(item.entry.content, queryTokens)
      };
      matches.push({ key, preview, score });
    }
  }

  matches.sort((a, b) => {
    const left = catalog.entriesByKey.get(a.key);
    const right = catalog.entriesByKey.get(b.key);
    const leftOrder = left?.entry.order ?? 0;
    const rightOrder = right?.entry.order ?? 0;
    return (
      b.score - a.score ||
      rightOrder - leftOrder ||
      a.preview.scope.localeCompare(b.preview.scope) ||
      a.preview.uid - b.preview.uid
    );
  });

  const top = matches.slice(0, limit);
  return {
    ok: true,
    data: {
      matches: top.map(item => item.preview)
    },
    selectedKeys: top.map(item => item.key),
    trace: `search_entries returned ${top.length}`
  };
}

function resolveEntryKey(
  catalog: RetrievalToolCatalog,
  uid: number,
  scope: string,
  allowedScopes: Set<string>
): string | null {
  const scopeValue = normalizeScope(scope);
  if (scopeValue) {
    if (!allowedScopes.has(scopeValue)) {
      return null;
    }
    const key = makeCatalogKey(scopeValue, uid);
    return catalog.entriesByKey.has(key) ? key : null;
  }

  const keys = catalog.keysByUid.get(uid) ?? [];
  const allowed = keys.filter(key => {
    const item = catalog.entriesByKey.get(key);
    if (!item) {
      return false;
    }
    return allowedScopes.has(item.scope);
  });
  if (allowed.length === 0) {
    return null;
  }
  return allowed.sort((a, b) => a.localeCompare(b))[0];
}

function expandNeighbors(
  catalog: RetrievalToolCatalog,
  args: Record<string, unknown>,
  allowedScopes: Set<string>
): ToolExecutionResult {
  const uid = readInteger(args, 'uid', -1, -1, Number.MAX_SAFE_INTEGER);
  if (uid < 0) {
    return {
      ok: false,
      error: 'expand_neighbors requires an integer "uid".',
      selectedKeys: [],
      trace: 'expand_neighbors error: missing uid'
    };
  }

  const sourceKey = resolveEntryKey(catalog, uid, readOptionalString(args, 'scope'), allowedScopes);
  if (!sourceKey) {
    return {
      ok: false,
      error: 'expand_neighbors could not resolve the requested entry in active scopes.',
      selectedKeys: [],
      trace: `expand_neighbors error: entry ${uid} not found`
    };
  }

  const depth = readInteger(args, 'depth', 1, 1, 3);
  const limit = readInteger(args, 'limit', 8, 1, 20);

  interface QueueItem {
    key: string;
    depth: number;
    path: string[];
  }

  const queue: QueueItem[] = [{ key: sourceKey, depth: 0, path: [sourceKey] }];
  const seenDepth = new Map<string, number>([[sourceKey, 0]]);
  const neighbors: Array<{ key: string; preview: EntryPreview; depth: number; path: string[] }> = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    if (current.depth >= depth) {
      continue;
    }

    const item = catalog.entriesByKey.get(current.key);
    if (!item) {
      continue;
    }

    for (const neighborKey of item.neighbors) {
      const neighbor = catalog.entriesByKey.get(neighborKey);
      if (!neighbor) {
        continue;
      }

      const nextDepth = current.depth + 1;
      const existingDepth = seenDepth.get(neighborKey);
      if (existingDepth !== undefined && existingDepth <= nextDepth) {
        continue;
      }

      seenDepth.set(neighborKey, nextDepth);
      const path = [...current.path, neighborKey];
      if (neighborKey !== sourceKey) {
        neighbors.push({
          key: neighborKey,
          depth: nextDepth,
          path,
          preview: {
            uid: neighbor.uid,
            scope: neighbor.scope,
            title: neighbor.entry.comment,
            keywords: neighbor.entry.key,
            distance: nextDepth,
            path: path.map(value => catalog.entriesByKey.get(value)?.uid ?? -1).filter(value => value >= 0),
            snippet: createSnippet(neighbor.entry.content, [])
          }
        });
      }

      if (nextDepth < depth) {
        queue.push({ key: neighborKey, depth: nextDepth, path });
      }
    }
  }

  neighbors.sort((a, b) => {
    const left = catalog.entriesByKey.get(a.key);
    const right = catalog.entriesByKey.get(b.key);
    const leftOrder = left?.entry.order ?? 0;
    const rightOrder = right?.entry.order ?? 0;
    return (
      a.depth - b.depth ||
      rightOrder - leftOrder ||
      a.preview.scope.localeCompare(b.preview.scope) ||
      a.preview.uid - b.preview.uid
    );
  });

  const selected = neighbors.slice(0, limit);
  return {
    ok: true,
    data: {
      source: {
        uid: uid,
        scope: catalog.entriesByKey.get(sourceKey)?.scope ?? '',
        title: catalog.entriesByKey.get(sourceKey)?.entry.comment ?? `UID ${uid}`
      },
      neighbors: selected.map(item => item.preview)
    },
    selectedKeys: selected.map(item => item.key),
    trace: `expand_neighbors returned ${selected.length}`
  };
}

function getEntry(
  catalog: RetrievalToolCatalog,
  args: Record<string, unknown>,
  allowedScopes: Set<string>
): ToolExecutionResult {
  const uid = readInteger(args, 'uid', -1, -1, Number.MAX_SAFE_INTEGER);
  if (uid < 0) {
    return {
      ok: false,
      error: 'get_entry requires an integer "uid".',
      selectedKeys: [],
      trace: 'get_entry error: missing uid'
    };
  }

  const key = resolveEntryKey(catalog, uid, readOptionalString(args, 'scope'), allowedScopes);
  if (!key) {
    return {
      ok: false,
      error: 'get_entry could not resolve the requested entry in active scopes.',
      selectedKeys: [],
      trace: `get_entry error: entry ${uid} not found`
    };
  }

  const item = catalog.entriesByKey.get(key);
  if (!item) {
    return {
      ok: false,
      error: 'get_entry internal lookup failed.',
      selectedKeys: [],
      trace: `get_entry error: lookup failure for ${uid}`
    };
  }

  const contentChars = readInteger(args, 'contentChars', 1200, 120, 5000);
  const neighbors = item.neighbors
    .map(neighborKey => catalog.entriesByKey.get(neighborKey))
    .filter((entry): entry is CatalogEntry => Boolean(entry))
    .slice(0, 8)
    .map(neighbor => ({
      uid: neighbor.uid,
      scope: neighbor.scope,
      title: neighbor.entry.comment
    }));

  return {
    ok: true,
    data: {
      entry: {
        uid: item.uid,
        scope: item.scope,
        title: item.entry.comment,
        keywords: item.entry.key,
        order: item.entry.order,
        snippet: item.entry.content.trim().slice(0, contentChars),
        neighbors
      }
    },
    selectedKeys: [key],
    trace: 'get_entry returned 1'
  };
}

function executeToolCall(
  call: RetrievalToolPlannerCall,
  catalog: RetrievalToolCatalog,
  allowedScopes: Set<string>
): ToolExecutionResult {
  const args = parseObject(call.argumentsJson);
  if (!args) {
    return {
      ok: false,
      error: `Tool "${call.name}" received invalid JSON arguments.`,
      selectedKeys: [],
      trace: `${call.name} error: invalid args`
    };
  }

  if (call.name === 'search_entries') {
    return searchEntries(catalog, args, allowedScopes);
  }
  if (call.name === 'expand_neighbors') {
    return expandNeighbors(catalog, args, allowedScopes);
  }
  return getEntry(catalog, args, allowedScopes);
}

function buildContextMarkdown(
  catalog: RetrievalToolCatalog,
  selectedKeys: string[],
  maxEntries: number,
  tokenBudget: number
): { markdown: string; usedTokens: number; selectedItems: string[] } {
  const limit = Math.max(1, maxEntries);
  const budget = Math.max(32, tokenBudget);
  const sections: string[] = [];
  const selectedItems: string[] = [];
  let usedTokens = estimateTokens('## Tool Retrieval Context\n');

  for (const key of selectedKeys.slice(0, limit)) {
    const item = catalog.entriesByKey.get(key);
    if (!item) {
      continue;
    }

    const section = [
      `### [${getScopeLabel(item.scope)}] ${item.entry.comment}`,
      `UID: ${item.uid}`,
      `Keys: ${item.entry.key.join(', ') || '-'}`,
      '',
      item.entry.content.trim()
    ].join('\n');
    const sectionTokens = estimateTokens(section);
    if (usedTokens + sectionTokens > budget) {
      continue;
    }

    usedTokens += sectionTokens;
    sections.push(section);
    selectedItems.push(`[${getScopeLabel(item.scope)}] ${item.entry.comment}`);
  }

  if (sections.length === 0) {
    return {
      markdown: '',
      usedTokens: 0,
      selectedItems: []
    };
  }

  return {
    markdown: ['## Tool Retrieval Context', sections.join('\n\n---\n\n')].join('\n\n'),
    usedTokens,
    selectedItems
  };
}

function clampLimit(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function createPlannerSystemPrompt(): string {
  return [
    'You are LoreVault retrieval planner.',
    'Use only available tools to fetch relevant world_info entries.',
    'Prefer precise calls with small limits.',
    'When enough data is available, stop issuing tool calls.',
    'Never invent entry IDs.'
  ].join('\n');
}

function createPlannerUserPrompt(queryText: string, scopes: string[]): string {
  return [
    'Query text:',
    queryText.trim() || '(empty)',
    '',
    `Active scopes: ${scopes.length > 0 ? scopes.map(getScopeLabel).join(', ') : '(none)'}`,
    '',
    'Find the most relevant entries for this query.'
  ].join('\n');
}

export function createRetrievalToolDefinitions(): RetrievalToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: 'search_entries',
        description: 'Search world_info entries by query text and optional scope.',
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
    },
    {
      type: 'function',
      function: {
        name: 'expand_neighbors',
        description: 'Expand wikilink neighbors from a known entry uid.',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'integer' },
            scope: { type: 'string' },
            depth: { type: 'integer', minimum: 1, maximum: 3 },
            limit: { type: 'integer', minimum: 1, maximum: 20 }
          },
          required: ['uid']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_entry',
        description: 'Fetch one entry by uid and optional scope.',
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
    }
  ];
}

export async function runModelDrivenRetrievalHooks(
  options: RetrievalToolRunOptions
): Promise<RetrievalToolRunResult> {
  const maxCalls = clampLimit(options.limits.maxCalls, 4, 1, 16);
  const maxResultTokens = clampLimit(options.limits.maxResultTokens, 1200, 128, 12000);
  const maxPlanningTimeMs = clampLimit(options.limits.maxPlanningTimeMs, 8000, 500, 120000);
  const maxInjectedEntries = clampLimit(options.limits.maxInjectedEntries, 6, 1, 32);
  const contextTokenBudget = Math.max(32, Math.floor(options.contextTokenBudget));

  const scopeSet = new Set<string>();
  const requestedScopes = options.selectedScopes
    .map(scope => normalizeScope(scope))
    .filter(Boolean);
  if (requestedScopes.length > 0) {
    for (const scope of requestedScopes) {
      if (options.catalog.keysByScope.has(scope)) {
        scopeSet.add(scope);
      }
    }
  } else {
    for (const scope of options.catalog.keysByScope.keys()) {
      scopeSet.add(scope);
    }
  }

  if (scopeSet.size === 0) {
    return {
      markdown: '',
      usedTokens: 0,
      selectedItems: [],
      trace: ['tool_hooks: no active scopes'],
      executedCalls: 0,
      stopReason: 'completed',
      lastPlannerError: ''
    };
  }

  const messages: RetrievalToolPlannerMessage[] = [
    {
      role: 'system',
      content: createPlannerSystemPrompt()
    },
    {
      role: 'user',
      content: createPlannerUserPrompt(options.queryText, [...scopeSet])
    }
  ];
  const toolDefinitions = createRetrievalToolDefinitions();

  const trace: string[] = [];
  const selectedKeys: string[] = [];
  const selectedKeySet = new Set<string>();
  const startedAt = Date.now();
  let executedCalls = 0;
  let usedToolResultTokens = 0;
  let stopReason: RetrievalToolRunResult['stopReason'] = 'completed';
  let lastPlannerError = '';

  while (executedCalls < maxCalls) {
    if (options.abortSignal?.aborted) {
      stopReason = 'aborted';
      break;
    }

    const elapsed = Date.now() - startedAt;
    const timeLeftMs = maxPlanningTimeMs - elapsed;
    if (timeLeftMs <= 0) {
      stopReason = 'time_limit';
      break;
    }

    let plannerResponse: RetrievalToolPlannerResponse;
    try {
      plannerResponse = await options.planner({
        messages,
        toolDefinitions,
        timeoutMs: timeLeftMs,
        abortSignal: options.abortSignal
      });
    } catch (error) {
      stopReason = 'planner_error';
      lastPlannerError = error instanceof Error ? error.message : String(error);
      trace.push(`tool_hooks: planner error (${lastPlannerError})`);
      break;
    }

    if (Date.now() - startedAt > maxPlanningTimeMs) {
      stopReason = 'time_limit';
      break;
    }

    const toolCalls = plannerResponse.toolCalls.filter(call => isToolName(call.name));
    if (toolCalls.length === 0) {
      trace.push(`tool_hooks: planner stop (${plannerResponse.finishReason || 'no_tool_calls'})`);
      break;
    }

    messages.push({
      role: 'assistant',
      content: plannerResponse.assistantText || '',
      toolCalls
    });

    let reachedResultTokenLimit = false;
    for (const call of toolCalls) {
      if (executedCalls >= maxCalls) {
        stopReason = 'call_limit';
        break;
      }

      const execution = executeToolCall(call, options.catalog, scopeSet);
      const resultPayload = JSON.stringify(execution.ok
        ? { ok: true, ...execution.data }
        : { ok: false, error: execution.error ?? 'unknown error' });
      const resultTokens = estimateTokens(resultPayload);

      if (usedToolResultTokens + resultTokens > maxResultTokens) {
        reachedResultTokenLimit = true;
        stopReason = 'result_token_limit';
        break;
      }

      usedToolResultTokens += resultTokens;
      executedCalls += 1;
      trace.push(`${call.name}: ${execution.trace} (~${resultTokens} tokens)`);

      for (const key of execution.selectedKeys) {
        if (!selectedKeySet.has(key)) {
          selectedKeySet.add(key);
          selectedKeys.push(key);
        }
      }

      messages.push({
        role: 'tool',
        content: resultPayload,
        toolCallId: call.id,
        toolName: call.name
      });
    }

    if (reachedResultTokenLimit || stopReason === 'call_limit') {
      break;
    }
  }

  const context = buildContextMarkdown(
    options.catalog,
    selectedKeys,
    maxInjectedEntries,
    contextTokenBudget
  );

  if (trace.length === 0) {
    trace.push('tool_hooks: no tool calls executed');
  }
  trace.unshift(
    `tool_hooks: ${executedCalls} call(s), ${context.selectedItems.length} selected entries, stop=${stopReason}`
  );

  return {
    markdown: context.markdown,
    usedTokens: context.usedTokens,
    selectedItems: context.selectedItems,
    trace,
    executedCalls,
    stopReason,
    lastPlannerError
  };
}
