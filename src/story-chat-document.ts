import { ContinuitySelection, StoryChatContextMeta } from './models';
import { normalizeStoryChatSteeringRefs } from './story-chat-steering-refs';

export const CHAT_SCHEMA_VERSION = 2;

export interface ChatMessageVersion {
  id: string;
  content: string;
  createdAt: number;
  contextMeta?: StoryChatContextMeta;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  createdAt: number;
  versions: ChatMessageVersion[];
  activeVersionId: string;
}

export interface ConversationDocument {
  schemaVersion: number;
  id: string;
  title: string;
  completionPresetId: string;
  createdAt: number;
  updatedAt: number;
  selectedScopes: string[];
  useLorebookContext: boolean;
  manualContext: string;
  steeringScopeRefs: string[];
  continuityPlotThreads: string[];
  continuityOpenLoops: string[];
  continuityCanonDeltas: string[];
  continuitySelection: ContinuitySelection;
  noteContextRefs: string[];
  messages: ConversationMessage[];
}

type CreateIdFn = (prefix: string) => string;
type NowFn = () => number;

function defaultCreateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function dedupeStrings(values: string[]): string[] {
  return values.filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);
}

function normalizeContinuitySelection(raw: unknown): ContinuitySelection {
  if (!raw || typeof raw !== 'object') {
    return {
      includePlotThreads: true,
      includeOpenLoops: true,
      includeCanonDeltas: true
    };
  }

  const value = raw as Record<string, unknown>;
  return {
    includePlotThreads: value.includePlotThreads !== false,
    includeOpenLoops: value.includeOpenLoops !== false,
    includeCanonDeltas: value.includeCanonDeltas !== false
  };
}

export function cloneStoryChatContextMeta(meta: StoryChatContextMeta | undefined): StoryChatContextMeta | undefined {
  if (!meta) {
    return undefined;
  }

  return {
    ...meta,
    completionProfileSource: meta.completionProfileSource,
    completionProfileId: meta.completionProfileId,
    completionProfileName: meta.completionProfileName,
    completionProvider: meta.completionProvider,
    completionModel: meta.completionModel,
    scopes: [...meta.scopes],
    steeringSourceRefs: [...(meta.steeringSourceRefs ?? [])],
    steeringSourceScopes: [...(meta.steeringSourceScopes ?? [])],
    unresolvedSteeringSourceRefs: [...(meta.unresolvedSteeringSourceRefs ?? [])],
    specificNotePaths: [...meta.specificNotePaths],
    unresolvedNoteRefs: [...meta.unresolvedNoteRefs],
    chapterMemoryItems: [...(meta.chapterMemoryItems ?? [])],
    inlineDirectiveItems: [...(meta.inlineDirectiveItems ?? [])],
    continuityPlotThreads: [...(meta.continuityPlotThreads ?? [])],
    continuityOpenLoops: [...(meta.continuityOpenLoops ?? [])],
    continuityCanonDeltas: [...(meta.continuityCanonDeltas ?? [])],
    continuitySelection: meta.continuitySelection ? { ...meta.continuitySelection } : undefined,
    layerTrace: [...(meta.layerTrace ?? [])],
    layerUsage: (meta.layerUsage ?? []).map(layer => ({ ...layer })),
    overflowTrace: [...(meta.overflowTrace ?? [])],
    chatToolTrace: [...(meta.chatToolTrace ?? [])],
    chatToolCalls: [...(meta.chatToolCalls ?? [])],
    chatToolWrites: [...(meta.chatToolWrites ?? [])],
    worldInfoItems: [...meta.worldInfoItems],
    ragItems: [...meta.ragItems]
  };
}

function normalizeContextMeta(raw: unknown): StoryChatContextMeta | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const meta = raw as Record<string, unknown>;
  const completionProfileSource = typeof meta.completionProfileSource === 'string'
    ? meta.completionProfileSource.trim()
    : '';
  const completionProfileId = typeof meta.completionProfileId === 'string'
    ? meta.completionProfileId.trim()
    : '';
  const completionProfileName = typeof meta.completionProfileName === 'string'
    ? meta.completionProfileName.trim()
    : '';
  const completionProvider = typeof meta.completionProvider === 'string'
    ? meta.completionProvider.trim()
    : '';
  const completionModel = typeof meta.completionModel === 'string'
    ? meta.completionModel.trim()
    : '';
  return {
    usedLorebookContext: Boolean(meta.usedLorebookContext),
    usedManualContext: Boolean(meta.usedManualContext),
    usedSpecificNotesContext: Boolean(meta.usedSpecificNotesContext),
    usedChapterMemoryContext: Boolean(meta.usedChapterMemoryContext),
    usedInlineDirectives: Boolean(meta.usedInlineDirectives),
    usedContinuityState: Boolean(meta.usedContinuityState),
    ...(completionProfileSource ? { completionProfileSource } : {}),
    ...(completionProfileId ? { completionProfileId } : {}),
    ...(completionProfileName ? { completionProfileName } : {}),
    ...(completionProvider ? { completionProvider } : {}),
    ...(completionModel ? { completionModel } : {}),
    scopes: Array.isArray(meta.scopes)
      ? meta.scopes.map(value => String(value ?? ''))
      : [],
    steeringSourceRefs: Array.isArray(meta.steeringSourceRefs)
      ? meta.steeringSourceRefs.map(value => String(value ?? ''))
      : [],
    steeringSourceScopes: Array.isArray(meta.steeringSourceScopes)
      ? meta.steeringSourceScopes.map(value => String(value ?? ''))
      : [],
    unresolvedSteeringSourceRefs: Array.isArray(meta.unresolvedSteeringSourceRefs)
      ? meta.unresolvedSteeringSourceRefs.map(value => String(value ?? ''))
      : [],
    specificNotePaths: Array.isArray(meta.specificNotePaths)
      ? meta.specificNotePaths.map(value => String(value ?? ''))
      : [],
    unresolvedNoteRefs: Array.isArray(meta.unresolvedNoteRefs)
      ? meta.unresolvedNoteRefs.map(value => String(value ?? ''))
      : [],
    chapterMemoryItems: Array.isArray(meta.chapterMemoryItems)
      ? meta.chapterMemoryItems.map(value => String(value ?? ''))
      : [],
    inlineDirectiveItems: Array.isArray(meta.inlineDirectiveItems)
      ? meta.inlineDirectiveItems.map(value => String(value ?? ''))
      : [],
    continuityPlotThreads: Array.isArray(meta.continuityPlotThreads)
      ? meta.continuityPlotThreads.map(value => String(value ?? ''))
      : [],
    continuityOpenLoops: Array.isArray(meta.continuityOpenLoops)
      ? meta.continuityOpenLoops.map(value => String(value ?? ''))
      : [],
    continuityCanonDeltas: Array.isArray(meta.continuityCanonDeltas)
      ? meta.continuityCanonDeltas.map(value => String(value ?? ''))
      : [],
    continuitySelection: normalizeContinuitySelection(meta.continuitySelection),
    layerTrace: Array.isArray(meta.layerTrace)
      ? meta.layerTrace.map(value => String(value ?? ''))
      : [],
    layerUsage: Array.isArray(meta.layerUsage)
      ? meta.layerUsage
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map(item => {
          const placement = item.placement === 'system' || item.placement === 'pre_history'
            ? item.placement
            : 'pre_response';
          const trimReason = typeof item.trimReason === 'string' ? item.trimReason : '';
          return {
            layer: String(item.layer ?? ''),
            placement,
            reservedTokens: Math.max(0, Math.floor(Number(item.reservedTokens ?? 0))),
            usedTokens: Math.max(0, Math.floor(Number(item.usedTokens ?? 0))),
            headroomTokens: Math.max(0, Math.floor(Number(item.headroomTokens ?? 0))),
            trimmed: Boolean(item.trimmed),
            ...(trimReason ? { trimReason } : {})
          };
        })
      : [],
    overflowTrace: Array.isArray(meta.overflowTrace)
      ? meta.overflowTrace.map(value => String(value ?? ''))
      : [],
    chatToolTrace: Array.isArray(meta.chatToolTrace)
      ? meta.chatToolTrace.map(value => String(value ?? ''))
      : [],
    chatToolCalls: Array.isArray(meta.chatToolCalls)
      ? meta.chatToolCalls.map(value => String(value ?? ''))
      : [],
    chatToolWrites: Array.isArray(meta.chatToolWrites)
      ? meta.chatToolWrites.map(value => String(value ?? ''))
      : [],
    contextTokens: Math.max(0, Math.floor(Number(meta.contextTokens ?? 0))),
    worldInfoCount: Math.max(0, Math.floor(Number(meta.worldInfoCount ?? 0))),
    ragCount: Math.max(0, Math.floor(Number(meta.ragCount ?? 0))),
    worldInfoItems: Array.isArray(meta.worldInfoItems)
      ? meta.worldInfoItems.map(value => String(value ?? ''))
      : [],
    ragItems: Array.isArray(meta.ragItems)
      ? meta.ragItems.map(value => String(value ?? ''))
      : []
  };
}

export function normalizeConversationDocument(
  raw: unknown,
  fallbackTitle: string,
  createId: CreateIdFn = defaultCreateId,
  nowFn: NowFn = () => Date.now()
): ConversationDocument {
  const payload = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  const now = nowFn();
  const normalizedMessages = Array.isArray(payload.messages) ? payload.messages : [];
  const messages: ConversationMessage[] = normalizedMessages
    .map((item): ConversationMessage | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const candidate = item as Record<string, unknown>;
      const role = candidate.role === 'assistant' ? 'assistant' : (candidate.role === 'user' ? 'user' : null);
      if (!role) {
        return null;
      }

      const rawVersions = Array.isArray(candidate.versions) ? candidate.versions : [];
      const versions: ChatMessageVersion[] = rawVersions
        .map((version): ChatMessageVersion | null => {
          if (!version || typeof version !== 'object') {
            return null;
          }
          const candidateVersion = version as Record<string, unknown>;
          const id = typeof candidateVersion.id === 'string' && candidateVersion.id.trim()
            ? candidateVersion.id
            : createId('ver');
          const content = typeof candidateVersion.content === 'string'
            ? candidateVersion.content
            : String(candidateVersion.content ?? '');
          const createdAt = Number.isFinite(candidateVersion.createdAt)
            ? Math.floor(Number(candidateVersion.createdAt))
            : now;

          return {
            id,
            content,
            createdAt,
            contextMeta: normalizeContextMeta(candidateVersion.contextMeta)
          };
        })
        .filter((version): version is ChatMessageVersion => Boolean(version));

      if (versions.length === 0) {
        const fallbackContent = typeof candidate.content === 'string'
          ? candidate.content
          : String(candidate.content ?? '');
        versions.push({
          id: createId('ver'),
          content: fallbackContent,
          createdAt: Number.isFinite(candidate.createdAt) ? Math.floor(Number(candidate.createdAt)) : now
        });
      }

      const activeVersionIdRaw = typeof candidate.activeVersionId === 'string'
        ? candidate.activeVersionId
        : '';
      const activeVersionId = versions.some(version => version.id === activeVersionIdRaw)
        ? activeVersionIdRaw
        : versions[0].id;

      return {
        id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : createId(role),
        role,
        createdAt: Number.isFinite(candidate.createdAt) ? Math.floor(Number(candidate.createdAt)) : versions[0].createdAt,
        versions,
        activeVersionId
      };
    })
    .filter((message): message is ConversationMessage => Boolean(message));

  const selectedScopes = Array.isArray(payload.selectedScopes)
    ? dedupeStrings(payload.selectedScopes.map(value => String(value ?? '').trim()))
    : [];
  const completionPresetId = typeof payload.completionPresetId === 'string'
    ? payload.completionPresetId.trim()
    : '';
  const noteContextRefs = Array.isArray(payload.noteContextRefs)
    ? dedupeStrings(payload.noteContextRefs.map(value => String(value ?? '').trim()))
    : [];
  const steeringScopeRefs = Array.isArray(payload.steeringScopeRefs)
    ? normalizeStoryChatSteeringRefs(payload.steeringScopeRefs.map(value => String(value ?? '')))
    : [];
  const continuityPlotThreads = Array.isArray(payload.continuityPlotThreads)
    ? dedupeStrings(payload.continuityPlotThreads.map(value => String(value ?? '').trim()))
    : [];
  const continuityOpenLoops = Array.isArray(payload.continuityOpenLoops)
    ? dedupeStrings(payload.continuityOpenLoops.map(value => String(value ?? '').trim()))
    : [];
  const continuityCanonDeltas = Array.isArray(payload.continuityCanonDeltas)
    ? dedupeStrings(payload.continuityCanonDeltas.map(value => String(value ?? '').trim()))
    : [];

  return {
    schemaVersion: Number.isFinite(payload.schemaVersion) ? Math.floor(Number(payload.schemaVersion)) : CHAT_SCHEMA_VERSION,
    id: typeof payload.id === 'string' && payload.id.trim() ? payload.id : createId('conv'),
    title: typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : fallbackTitle,
    completionPresetId,
    createdAt: Number.isFinite(payload.createdAt) ? Math.floor(Number(payload.createdAt)) : now,
    updatedAt: Number.isFinite(payload.updatedAt) ? Math.floor(Number(payload.updatedAt)) : now,
    selectedScopes,
    useLorebookContext: Boolean(payload.useLorebookContext ?? true),
    manualContext: typeof payload.manualContext === 'string' ? payload.manualContext : '',
    steeringScopeRefs,
    continuityPlotThreads,
    continuityOpenLoops,
    continuityCanonDeltas,
    continuitySelection: normalizeContinuitySelection(payload.continuitySelection),
    noteContextRefs,
    messages
  };
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === '') {
    return '';
  }
  if (trimmed === '[]') {
    return [];
  }
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch (_error) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseFrontmatterBlock(markdown: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return {
      frontmatter: {},
      body: markdown
    };
  }

  const source = match[1];
  const lines = source.split(/\r?\n/);
  const frontmatter: Record<string, unknown> = {};

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const keyMatch = line.match(/^([A-Za-z0-9_]+):(?:\s*(.*))?$/);
    if (!keyMatch) {
      index += 1;
      continue;
    }

    const key = keyMatch[1];
    const inlineValue = keyMatch[2] ?? '';
    if (inlineValue.trim()) {
      frontmatter[key] = parseScalar(inlineValue);
      index += 1;
      continue;
    }

    const nestedLines: string[] = [];
    index += 1;
    while (index < lines.length) {
      const nested = lines[index];
      if (!nested.trim()) {
        nestedLines.push('');
        index += 1;
        continue;
      }
      if (!nested.startsWith('  ')) {
        break;
      }
      nestedLines.push(nested);
      index += 1;
    }

    const compactNested = nestedLines.filter(item => item.trim().length > 0);
    if (compactNested.length === 0) {
      frontmatter[key] = '';
      continue;
    }

    if (compactNested[0].trim().startsWith('- ')) {
      const items = compactNested
        .map(item => item.trim())
        .filter(item => item.startsWith('- '))
        .map(item => parseScalar(item.slice(2)));
      frontmatter[key] = items;
      continue;
    }

    const objectValue: Record<string, unknown> = {};
    for (const nested of compactNested) {
      const objectMatch = nested.trim().match(/^([A-Za-z0-9_]+):(?:\s*(.*))?$/);
      if (!objectMatch) {
        continue;
      }
      objectValue[objectMatch[1]] = parseScalar(objectMatch[2] ?? '');
    }
    frontmatter[key] = objectValue;
  }

  return {
    frontmatter,
    body: markdown.slice(match[0].length)
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return dedupeStrings(value.map(item => String(item ?? '').trim()));
}

function parseTimestampValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }
  const text = String(value ?? '').trim();
  if (!text) {
    return undefined;
  }
  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    return Math.floor(numeric);
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseBooleanText(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'true' || normalized === 'yes' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === 'no' || normalized === '0') {
    return false;
  }
  return undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const next = [...lines];
  while (next.length > 0 && next[next.length - 1].trim() === '') {
    next.pop();
  }
  return next;
}

function extractFencedTextSection(body: string, heading: string): string {
  const headingPattern = new RegExp(`^###\\s+${escapeRegex(heading)}\\s*$`, 'm');
  const headingMatch = headingPattern.exec(body);
  if (!headingMatch) {
    return '';
  }

  const start = headingMatch.index + headingMatch[0].length;
  const after = body.slice(start);
  const nextHeadingPattern = /^###\s+.+$|^##\s+(?:User|Model)\s*$/m;
  const nextHeading = nextHeadingPattern.exec(after);
  const sectionBody = nextHeading ? after.slice(0, nextHeading.index) : after;
  const fenceMatch = sectionBody.match(/```(?:text|md|markdown)?\s*\r?\n([\s\S]*?)\r?\n```/i);
  if (!fenceMatch) {
    return '';
  }
  return fenceMatch[1].replace(/\r/g, '');
}

function parseMetadataTableValues(sectionBody: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /^>\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/gm;
  let match: RegExpExecArray | null = pattern.exec(sectionBody);
  while (match) {
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (key && key !== 'property' && key !== '--------') {
      result[key] = value;
    }
    match = pattern.exec(sectionBody);
  }
  return result;
}

function countLeadingSpaces(value: string): number {
  const match = value.match(/^ */);
  return match ? match[0].length : 0;
}

function parseYamlScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === '') {
    return '';
  }
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (trimmed === 'null' || trimmed === '~') {
    return null;
  }
  if (trimmed === '{}') {
    return {};
  }
  if (trimmed === '[]') {
    return [];
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch (_error) {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch (_error) {
      return trimmed;
    }
  }
  return trimmed;
}

function parseYamlBlock(
  lines: string[],
  startIndex: number,
  indent: number
): { value: unknown; nextIndex: number } {
  let index = startIndex;
  while (index < lines.length && lines[index].trim() === '') {
    index += 1;
  }
  if (index >= lines.length) {
    return { value: undefined, nextIndex: index };
  }

  const firstLine = lines[index];
  const firstIndent = countLeadingSpaces(firstLine);
  if (firstIndent < indent) {
    return { value: undefined, nextIndex: index };
  }
  const firstTrimmed = firstLine.trim();

  if (firstTrimmed.startsWith('-')) {
    const values: unknown[] = [];
    while (index < lines.length) {
      const line = lines[index];
      if (line.trim() === '') {
        index += 1;
        continue;
      }

      const lineIndent = countLeadingSpaces(line);
      if (lineIndent < indent) {
        break;
      }
      if (lineIndent !== indent || !line.trim().startsWith('-')) {
        break;
      }

      const trimmed = line.trim();
      const remainder = trimmed.slice(1).trim();
      if (!remainder) {
        const nested = parseYamlBlock(lines, index + 1, indent + 2);
        values.push(nested.value ?? null);
        index = nested.nextIndex;
        continue;
      }

      values.push(parseYamlScalar(remainder));
      index += 1;
    }
    return { value: values, nextIndex: index };
  }

  const objectValue: Record<string, unknown> = {};
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const lineIndent = countLeadingSpaces(line);
    if (lineIndent < indent) {
      break;
    }
    if (lineIndent !== indent) {
      break;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith('-')) {
      break;
    }

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex < 0) {
      index += 1;
      continue;
    }

    const key = trimmed.slice(0, colonIndex).trim();
    const remainder = trimmed.slice(colonIndex + 1).trim();
    if (!key) {
      index += 1;
      continue;
    }

    if (remainder) {
      objectValue[key] = parseYamlScalar(remainder);
      index += 1;
      continue;
    }

    let lookahead = index + 1;
    while (lookahead < lines.length && lines[lookahead].trim() === '') {
      lookahead += 1;
    }
    if (lookahead >= lines.length) {
      objectValue[key] = '';
      index += 1;
      continue;
    }

    const nextIndent = countLeadingSpaces(lines[lookahead]);
    if (nextIndent <= lineIndent) {
      objectValue[key] = '';
      index += 1;
      continue;
    }

    const nested = parseYamlBlock(lines, lookahead, lineIndent + 2);
    objectValue[key] = nested.value;
    index = nested.nextIndex;
  }

  return { value: objectValue, nextIndex: index };
}

function extractMetadataCalloutBody(sectionBody: string, heading: string): string {
  const markerPattern = new RegExp(`^>\\s*\\[!metadata\\]-\\s*${escapeRegex(heading)}\\s*$`, 'im');
  const markerMatch = markerPattern.exec(sectionBody);
  if (!markerMatch) {
    return '';
  }

  const start = markerMatch.index + markerMatch[0].length;
  const lines = sectionBody
    .slice(start)
    .replace(/^\r?\n/, '')
    .split(/\r?\n/);
  const contentLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('>')) {
      contentLines.push(line.replace(/^>\s?/, ''));
      continue;
    }
    if (line.trim() === '' && contentLines.length === 0) {
      continue;
    }
    break;
  }
  return trimTrailingBlankLines(contentLines).join('\n');
}

function parseContextMetaFromMetadataCallout(sectionBody: string): StoryChatContextMeta | undefined {
  const calloutBody = extractMetadataCalloutBody(sectionBody, 'Context Meta');
  if (!calloutBody) {
    return undefined;
  }

  const codeblockMatch = calloutBody.match(/```(?:yaml|yml)\s*\r?\n([\s\S]*?)\r?\n```/i);
  if (!codeblockMatch) {
    return undefined;
  }

  const payload = codeblockMatch[1].trim();
  if (!payload) {
    return undefined;
  }

  try {
    if (payload.startsWith('{') || payload.startsWith('[')) {
      return normalizeContextMeta(JSON.parse(payload) as unknown);
    }
    const parsed = parseYamlBlock(payload.replace(/\r/g, '').split('\n'), 0, 0).value;
    return normalizeContextMeta(parsed);
  } catch (error) {
    console.error('Failed to parse Story Chat context metadata block:', error);
  }
  return undefined;
}

function extractCalloutContent(sectionBody: string, role: 'user' | 'assistant'): string {
  const calloutType = role === 'user' ? 'user' : 'assistant';
  const markerPattern = new RegExp(`^>\\s*\\[!${calloutType}\\]\\+\\s*$`, 'm');
  const markerMatch = markerPattern.exec(sectionBody);
  if (!markerMatch) {
    return '';
  }

  const start = markerMatch.index + markerMatch[0].length;
  const lines = sectionBody
    .slice(start)
    .replace(/^\r?\n/, '')
    .split(/\r?\n/);

  const contentLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('>')) {
      contentLines.push(line.replace(/^>\s?/, ''));
      continue;
    }
    if (line.trim() === '' && contentLines.length === 0) {
      continue;
    }
    break;
  }

  return trimTrailingBlankLines(contentLines).join('\n');
}

function parseMessageSections(body: string, createId: CreateIdFn): ConversationMessage[] {
  const headingPattern = /^##\s+(User|Model)\s*$/gm;
  const headings: Array<{ role: 'user' | 'assistant'; index: number; length: number }> = [];

  let match: RegExpExecArray | null = headingPattern.exec(body);
  while (match) {
    headings.push({
      role: match[1] === 'User' ? 'user' : 'assistant',
      index: match.index,
      length: match[0].length
    });
    match = headingPattern.exec(body);
  }

  const messagesById = new Map<string, {
    id: string;
    role: 'user' | 'assistant';
    createdAt: number;
    versions: ChatMessageVersion[];
    activeVersionId: string;
    order: number;
    hasExplicitActiveVersion: boolean;
  }>();

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const sectionStart = heading.index + heading.length;
    const sectionEnd = index + 1 < headings.length ? headings[index + 1].index : body.length;
    const sectionBody = body.slice(sectionStart, sectionEnd);

    const tableValues = parseMetadataTableValues(sectionBody);
    const messageId = tableValues['message id'] || createId(heading.role);
    const versionId = tableValues['version id'] || createId('ver');
    const versionCreatedAt = parseTimestampValue(tableValues.time) ?? Date.now();
    const activeVersion = parseBooleanText(tableValues['active version']) === true;

    const contextMeta = parseContextMetaFromMetadataCallout(sectionBody);

    const version: ChatMessageVersion = {
      id: versionId,
      content: extractCalloutContent(sectionBody, heading.role),
      createdAt: versionCreatedAt,
      ...(contextMeta ? { contextMeta } : {})
    };

    const existing = messagesById.get(messageId);
    if (existing) {
      existing.versions.push(version);
      existing.createdAt = Math.min(existing.createdAt, versionCreatedAt);
      if (activeVersion) {
        existing.activeVersionId = versionId;
        existing.hasExplicitActiveVersion = true;
      }
      continue;
    }

    messagesById.set(messageId, {
      id: messageId,
      role: heading.role,
      createdAt: versionCreatedAt,
      versions: [version],
      activeVersionId: versionId,
      order: index,
      hasExplicitActiveVersion: activeVersion
    });
  }

  return [...messagesById.values()]
    .sort((a, b) => a.order - b.order)
    .map(item => {
      const activeVersionId = item.hasExplicitActiveVersion
        ? item.activeVersionId
        : item.versions[0].id;
      return {
        id: item.id,
        role: item.role,
        createdAt: item.createdAt,
        versions: item.versions,
        activeVersionId
      };
    });
}

function formatIsoTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return new Date(0).toISOString();
  }
  return new Date(Math.floor(timestamp)).toISOString();
}

function serializeYamlScalar(value: unknown): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return JSON.stringify(String(value ?? ''));
}

function appendYamlArray(lines: string[], key: string, values: string[]): void {
  if (values.length === 0) {
    lines.push(`${key}: []`);
    return;
  }

  lines.push(`${key}:`);
  for (const value of values) {
    lines.push(`  - ${serializeYamlScalar(value)}`);
  }
}

function quoteMarkdownCallout(content: string): string[] {
  const normalized = content.replace(/\r/g, '');
  const rawLines = normalized.split('\n');
  if (rawLines.length === 0) {
    return ['>'];
  }
  return rawLines.map(line => (line.length > 0 ? `> ${line}` : '>'));
}

function renderTextSection(lines: string[], heading: string, content: string): void {
  lines.push(`### ${heading}`);
  lines.push('```text');
  if (content) {
    lines.push(...content.replace(/\r/g, '').split('\n'));
  }
  lines.push('```');
  lines.push('');
}

function toBooleanText(value: boolean | undefined): string {
  return value ? 'true' : 'false';
}

function toCountText(values: string[] | undefined): string {
  return String(Array.isArray(values) ? values.length : 0);
}

function toListOrNone(values: string[] | undefined): string {
  if (!Array.isArray(values) || values.length === 0) {
    return '(none)';
  }
  return values.join(', ');
}

function toProfileLabel(meta: StoryChatContextMeta): string {
  return meta.completionProfileName?.trim()
    || meta.completionProfileId?.trim()
    || meta.completionProfileSource?.trim()
    || '(none)';
}

function isYamlScalarValue(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function serializeYamlScalarValue(value: unknown): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (value === null) {
    return 'null';
  }
  return JSON.stringify(String(value ?? ''));
}

function appendYamlValueLines(lines: string[], value: unknown, indent: number): void {
  const padding = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${padding}[]`);
      return;
    }
    for (const item of value) {
      if (isYamlScalarValue(item)) {
        lines.push(`${padding}- ${serializeYamlScalarValue(item)}`);
        continue;
      }
      lines.push(`${padding}-`);
      appendYamlValueLines(lines, item, indent + 2);
    }
    return;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined);
    if (entries.length === 0) {
      lines.push(`${padding}{}`);
      return;
    }

    for (const [key, entryValue] of entries) {
      if (isYamlScalarValue(entryValue)) {
        lines.push(`${padding}${key}: ${serializeYamlScalarValue(entryValue)}`);
        continue;
      }
      if (Array.isArray(entryValue) && entryValue.length === 0) {
        lines.push(`${padding}${key}: []`);
        continue;
      }
      if (entryValue && typeof entryValue === 'object' && Object.keys(entryValue).length === 0) {
        lines.push(`${padding}${key}: {}`);
        continue;
      }
      lines.push(`${padding}${key}:`);
      appendYamlValueLines(lines, entryValue, indent + 2);
    }
    return;
  }

  lines.push(`${padding}${serializeYamlScalarValue(value)}`);
}

function serializeContextMetaAsYaml(meta: StoryChatContextMeta): string {
  const normalized = cloneStoryChatContextMeta(meta);
  if (!normalized) {
    return '';
  }
  const lines: string[] = [];
  appendYamlValueLines(lines, normalized, 0);
  return lines.join('\n');
}

function quoteCodeFenceCallout(content: string, language: string): string[] {
  const normalized = content.replace(/\r/g, '');
  const rawLines = normalized.split('\n');
  const lines: string[] = [`> \`\`\`${language}`];
  for (const line of rawLines) {
    lines.push(line ? `> ${line}` : '>');
  }
  lines.push('> ```');
  return lines;
}

export function parseConversationMarkdown(
  markdown: string,
  fallbackTitle: string,
  createId: CreateIdFn = defaultCreateId
): ConversationDocument | null {
  const parsed = parseFrontmatterBlock(markdown);
  const typeValue = String(parsed.frontmatter.type ?? '').trim().toLowerCase();
  if (typeValue !== 'agent-session') {
    return null;
  }

  const messageList = parseMessageSections(parsed.body, createId);
  const continuitySelectionRaw = parsed.frontmatter.continuity_selection;

  const rawDocument = {
    schemaVersion: parsed.frontmatter.schema_version,
    id: parsed.frontmatter.session_id,
    title: parsed.frontmatter.title,
    completionPresetId: parsed.frontmatter.completion_preset_id,
    createdAt: parseTimestampValue(parsed.frontmatter.created),
    updatedAt: parseTimestampValue(parsed.frontmatter.last_active),
    selectedScopes: asStringArray(parsed.frontmatter.selected_lorebooks),
    useLorebookContext: parsed.frontmatter.use_lorebook_context,
    manualContext: extractFencedTextSection(parsed.body, 'Manual Context'),
    steeringScopeRefs: asStringArray(parsed.frontmatter.author_note_refs),
    continuityPlotThreads: asStringArray(parsed.frontmatter.continuity_plot_threads),
    continuityOpenLoops: asStringArray(parsed.frontmatter.continuity_open_loops),
    continuityCanonDeltas: asStringArray(parsed.frontmatter.continuity_canon_deltas),
    continuitySelection: continuitySelectionRaw && typeof continuitySelectionRaw === 'object'
      ? {
        includePlotThreads: (continuitySelectionRaw as Record<string, unknown>).includePlotThreads,
        includeOpenLoops: (continuitySelectionRaw as Record<string, unknown>).includeOpenLoops,
        includeCanonDeltas: (continuitySelectionRaw as Record<string, unknown>).includeCanonDeltas
      }
      : undefined,
    noteContextRefs: asStringArray(parsed.frontmatter.note_context_refs),
    messages: messageList
  };

  return normalizeConversationDocument(rawDocument, fallbackTitle, createId);
}

export function serializeConversationMarkdown(document: ConversationDocument): string {
  const normalizedSelectedScopes = dedupeStrings(document.selectedScopes.map(scope => scope.trim()));
  const normalizedSteeringRefs = normalizeStoryChatSteeringRefs(document.steeringScopeRefs);
  const normalizedNoteRefs = dedupeStrings(document.noteContextRefs.map(ref => ref.trim()));

  const lines: string[] = [];

  lines.push('---');
  lines.push(`session_id: ${serializeYamlScalar(document.id)}`);
  lines.push('type: agent-session');
  lines.push(`schema_version: ${CHAT_SCHEMA_VERSION}`);
  lines.push(`title: ${serializeYamlScalar(document.title)}`);
  lines.push(`completion_preset_id: ${serializeYamlScalar(document.completionPresetId ?? '')}`);
  appendYamlArray(lines, 'selected_lorebooks', normalizedSelectedScopes);
  lines.push(`use_lorebook_context: ${serializeYamlScalar(document.useLorebookContext)}`);
  appendYamlArray(lines, 'author_note_refs', normalizedSteeringRefs);
  appendYamlArray(lines, 'note_context_refs', normalizedNoteRefs);
  appendYamlArray(lines, 'continuity_plot_threads', dedupeStrings(document.continuityPlotThreads.map(item => item.trim())));
  appendYamlArray(lines, 'continuity_open_loops', dedupeStrings(document.continuityOpenLoops.map(item => item.trim())));
  appendYamlArray(lines, 'continuity_canon_deltas', dedupeStrings(document.continuityCanonDeltas.map(item => item.trim())));
  lines.push('continuity_selection:');
  lines.push(`  includePlotThreads: ${serializeYamlScalar(document.continuitySelection.includePlotThreads !== false)}`);
  lines.push(`  includeOpenLoops: ${serializeYamlScalar(document.continuitySelection.includeOpenLoops !== false)}`);
  lines.push(`  includeCanonDeltas: ${serializeYamlScalar(document.continuitySelection.includeCanonDeltas !== false)}`);
  lines.push(`created: ${serializeYamlScalar(formatIsoTimestamp(document.createdAt))}`);
  lines.push(`last_active: ${serializeYamlScalar(formatIsoTimestamp(document.updatedAt))}`);
  lines.push('metadata:');
  lines.push('  source: "lorevault"');
  lines.push('---');
  lines.push('');

  lines.push(`# Agent Session: ${document.title}`);
  lines.push('');
  lines.push('## Conversation Context');
  lines.push('');
  renderTextSection(lines, 'Manual Context', document.manualContext);

  for (const message of document.messages) {
    for (const version of message.versions) {
      const isActiveVersion = version.id === message.activeVersionId;
      const heading = message.role === 'user' ? 'User' : 'Model';
      const calloutType = message.role === 'user' ? 'user' : 'assistant';

      lines.push(`## ${heading}`);
      lines.push('');
      lines.push('> [!metadata]- Message Info');
      lines.push('> | Property | Value |');
      lines.push('> | -------- | ----- |');
      lines.push(`> | Time | ${formatIsoTimestamp(version.createdAt)} |`);
      lines.push(`> | Message ID | ${message.id} |`);
      lines.push(`> | Version ID | ${version.id} |`);
      lines.push(`> | Active Version | ${isActiveVersion ? 'true' : 'false'} |`);
      if (message.role === 'assistant' && version.contextMeta) {
        const meta = version.contextMeta;
        lines.push(`> | Completion Profile | ${toProfileLabel(meta)} |`);
        lines.push(`> | Completion Model | ${meta.completionModel?.trim() || '(unknown)'} |`);
        lines.push(`> | Scopes | ${toListOrNone(meta.scopes)} |`);
        lines.push(`> | Context Tokens | ${String(meta.contextTokens)} |`);
        lines.push(`> | world_info Count | ${String(meta.worldInfoCount)} |`);
        lines.push(`> | Fallback Count | ${String(meta.ragCount)} |`);
        lines.push(`> | Used Lorebook Context | ${toBooleanText(meta.usedLorebookContext)} |`);
        lines.push(`> | Used Manual Context | ${toBooleanText(meta.usedManualContext)} |`);
        lines.push(`> | Used Specific Notes | ${toBooleanText(meta.usedSpecificNotesContext)} |`);
        lines.push(`> | Used Chapter Memory | ${toBooleanText(meta.usedChapterMemoryContext)} |`);
        lines.push(`> | Used Inline Directives | ${toBooleanText(meta.usedInlineDirectives)} |`);
        lines.push(`> | Used Continuity State | ${toBooleanText(meta.usedContinuityState)} |`);
        lines.push(`> | Specific Notes Count | ${toCountText(meta.specificNotePaths)} |`);
        lines.push(`> | Unresolved Note Refs Count | ${toCountText(meta.unresolvedNoteRefs)} |`);
        lines.push(`> | Directive Count | ${toCountText(meta.inlineDirectiveItems)} |`);
        lines.push(`> | Plot Thread Count | ${toCountText(meta.continuityPlotThreads)} |`);
        lines.push(`> | Open Loop Count | ${toCountText(meta.continuityOpenLoops)} |`);
        lines.push(`> | Canon Delta Count | ${toCountText(meta.continuityCanonDeltas)} |`);
        lines.push(`> | Tool Call Count | ${toCountText(meta.chatToolCalls)} |`);
        lines.push(`> | Tool Write Count | ${toCountText(meta.chatToolWrites)} |`);
      }
      lines.push('');
      lines.push(`> [!${calloutType}]+`);
      lines.push(...quoteMarkdownCallout(version.content));
      lines.push('');

      if (version.contextMeta) {
        const serializedMeta = serializeContextMetaAsYaml(version.contextMeta);
        lines.push('> [!metadata]- Context Meta');
        lines.push(...quoteCodeFenceCallout(serializedMeta, 'yaml'));
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }
  }

  return lines.join('\n');
}
