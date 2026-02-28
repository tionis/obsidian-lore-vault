import { StoryChatContextMeta } from './models';

export const CHAT_SCHEMA_VERSION = 1;
export const CHAT_CODE_BLOCK_LANGUAGE = 'lorevault-chat';

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
  createdAt: number;
  updatedAt: number;
  selectedScopes: string[];
  useLorebookContext: boolean;
  manualContext: string;
  pinnedInstructions: string;
  storyNotes: string;
  sceneIntent: string;
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

export function cloneStoryChatContextMeta(meta: StoryChatContextMeta | undefined): StoryChatContextMeta | undefined {
  if (!meta) {
    return undefined;
  }

  return {
    ...meta,
    scopes: [...meta.scopes],
    specificNotePaths: [...meta.specificNotePaths],
    unresolvedNoteRefs: [...meta.unresolvedNoteRefs],
    chapterMemoryItems: [...(meta.chapterMemoryItems ?? [])],
    inlineDirectiveItems: [...(meta.inlineDirectiveItems ?? [])],
    layerTrace: [...(meta.layerTrace ?? [])],
    layerUsage: (meta.layerUsage ?? []).map(layer => ({ ...layer })),
    overflowTrace: [...(meta.overflowTrace ?? [])],
    worldInfoItems: [...meta.worldInfoItems],
    ragItems: [...meta.ragItems]
  };
}

function normalizeContextMeta(raw: unknown): StoryChatContextMeta | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const meta = raw as Record<string, unknown>;
  return {
    usedLorebookContext: Boolean(meta.usedLorebookContext),
    usedManualContext: Boolean(meta.usedManualContext),
    usedSpecificNotesContext: Boolean(meta.usedSpecificNotesContext),
    usedChapterMemoryContext: Boolean(meta.usedChapterMemoryContext),
    usedInlineDirectives: Boolean(meta.usedInlineDirectives),
    scopes: Array.isArray(meta.scopes)
      ? meta.scopes.map(value => String(value ?? ''))
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
  const noteContextRefs = Array.isArray(payload.noteContextRefs)
    ? dedupeStrings(payload.noteContextRefs.map(value => String(value ?? '').trim()))
    : [];

  return {
    schemaVersion: Number.isFinite(payload.schemaVersion) ? Math.floor(Number(payload.schemaVersion)) : CHAT_SCHEMA_VERSION,
    id: typeof payload.id === 'string' && payload.id.trim() ? payload.id : createId('conv'),
    title: typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : fallbackTitle,
    createdAt: Number.isFinite(payload.createdAt) ? Math.floor(Number(payload.createdAt)) : now,
    updatedAt: Number.isFinite(payload.updatedAt) ? Math.floor(Number(payload.updatedAt)) : now,
    selectedScopes,
    useLorebookContext: Boolean(payload.useLorebookContext ?? true),
    manualContext: typeof payload.manualContext === 'string' ? payload.manualContext : '',
    pinnedInstructions: typeof payload.pinnedInstructions === 'string' ? payload.pinnedInstructions : '',
    storyNotes: typeof payload.storyNotes === 'string' ? payload.storyNotes : '',
    sceneIntent: typeof payload.sceneIntent === 'string' ? payload.sceneIntent : '',
    noteContextRefs,
    messages
  };
}

export function parseConversationMarkdown(
  markdown: string,
  fallbackTitle: string,
  createId: CreateIdFn = defaultCreateId
): ConversationDocument | null {
  const match = markdown.match(/```lorevault-chat\s*([\s\S]*?)```/i);
  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1].trim()) as unknown;
    return normalizeConversationDocument(parsed, fallbackTitle, createId);
  } catch (error) {
    console.error('Failed to parse LoreVault chat payload:', error);
    return null;
  }
}

export function serializeConversationMarkdown(document: ConversationDocument): string {
  const payload = {
    ...document,
    messages: document.messages.map(message => ({
      ...message,
      versions: message.versions.map(version => ({
        ...version,
        contextMeta: cloneStoryChatContextMeta(version.contextMeta)
      }))
    }))
  };

  return [
    `# ${document.title}`,
    '',
    `\`\`\`${CHAT_CODE_BLOCK_LANGUAGE}`,
    JSON.stringify(payload, null, 2),
    '```',
    ''
  ].join('\n');
}
