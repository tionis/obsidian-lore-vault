import { normalizeLinkTarget } from './link-target-index';
import {
  BuildImportedWikiPagesOptions,
  ImportedLorebookEntry,
  ImportedWikiPage,
  buildImportedWikiPages,
  parseSillyTavernLorebookPayload
} from './sillytavern-import';
import { normalizeVaultPath } from './vault-path-utils';

export interface ParsedCharacterCard {
  sourceFormat: 'json' | 'png';
  spec: string;
  specVersion: string;
  name: string;
  tags: string[];
  creator: string;
  creatorNotes: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  messageExample: string;
  alternateGreetings: string[];
  groupOnlyGreetings: string[];
  systemPrompt: string;
  postHistoryInstructions: string;
  embeddedLorebookName: string;
  embeddedLorebookEntries: ImportedLorebookEntry[];
  warnings: string[];
  rawPayload: unknown;
}

export interface CharacterCardRewriteResult {
  title: string;
  storyMarkdown: string;
  authorNoteMarkdown: string;
  rewriteNotes: string[];
}

export interface BuildCharacterCardImportPlanOptions {
  targetFolder: string;
  authorNoteFolder: string;
  defaultTagsRaw: string;
  lorebookNames: string[];
  tagPrefix: string;
  maxSummaryChars: number;
  includeEmbeddedLorebook: boolean;
  sourceCardPath: string;
  completionPresetId: string;
}

export interface CharacterCardImportPlan {
  storyPath: string;
  authorNotePath: string;
  pages: ImportedWikiPage[];
  warnings: string[];
  effectiveLorebooks: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  const items: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = asString(item);
      if (normalized) {
        items.push(normalized);
      }
    }
  } else if (typeof value === 'string') {
    const split = value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
    items.push(...split);
  }
  return uniqueStrings(items);
}

function uniqueStrings(values: string[]): string[] {
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

function hasMeaningfulLorebookPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const objectValue = value as Record<string, unknown>;
  const entries = objectValue.entries;
  if (Array.isArray(entries)) {
    return entries.length > 0;
  }
  if (entries && typeof entries === 'object') {
    return Object.keys(entries as Record<string, unknown>).length > 0;
  }
  return false;
}

function normalizeScopeName(value: string): string {
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

function normalizeLorebookNames(values: string[]): string[] {
  return uniqueStrings(values.map(normalizeScopeName).filter(Boolean))
    .sort((left, right) => left.localeCompare(right));
}

function toSafeFileStem(value: string): string {
  const withoutControls = [...value]
    .filter(char => char.charCodeAt(0) >= 32)
    .join('');
  const normalized = withoutControls
    .trim()
    .toLowerCase()
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/[^a-z0-9._ -]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return normalized || 'story';
}

function parseDefaultTags(raw: string): string[] {
  return uniqueStrings(
    raw
      .split(/[\n,]+/)
      .map(item => item.trim().replace(/^#+/, '').replace(/^\/+|\/+$/g, ''))
      .filter(Boolean)
  );
}

function yamlQuote(value: string): string {
  return JSON.stringify(value);
}

function yamlArrayBlock(key: string, values: string[]): string[] {
  if (values.length === 0) {
    return [];
  }
  const lines = [`${key}:`];
  for (const value of values) {
    lines.push(`  - ${yamlQuote(value)}`);
  }
  return lines;
}

function ensureHeading(markdown: string, heading: string): string {
  const normalized = markdown.trim();
  if (!normalized) {
    return `# ${heading}\n`;
  }
  if (/^\s*#\s+/m.test(normalized)) {
    return `${normalized}\n`;
  }
  return `# ${heading}\n\n${normalized}\n`;
}

function resolveCharacterCardAvatarLink(sourceCardPath: string): string {
  const normalizedPath = normalizeVaultPath(sourceCardPath.trim());
  if (!normalizedPath) {
    return '';
  }
  const extension = normalizedPath.split('.').pop()?.toLowerCase() ?? '';
  const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif']);
  if (!imageExtensions.has(extension)) {
    return '';
  }
  return `[[${normalizeLinkTarget(normalizedPath)}]]`;
}

function toAscii(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) {
    result += String.fromCharCode(byte & 0x7f);
  }
  return result;
}

function toLatin1(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) {
    result += String.fromCharCode(byte);
  }
  return result;
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24)
    | (bytes[offset + 1] << 16)
    | (bytes[offset + 2] << 8)
    | bytes[offset + 3]
  ) >>> 0;
}

function decodeBase64ToUtf8(value: string): string {
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index) & 0xff;
    }
    return new TextDecoder().decode(bytes);
  }

  const maybeBuffer = (globalThis as unknown as {Buffer?: {from: (data: string, encoding: string) => Uint8Array}}).Buffer;
  if (maybeBuffer?.from) {
    return new TextDecoder().decode(maybeBuffer.from(value, 'base64'));
  }

  throw new Error('Base64 decoding is unavailable in this runtime.');
}

function parsePngCardPayload(bytes: Uint8Array): unknown {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) {
      throw new Error('File is not a valid PNG character card.');
    }
  }

  let offset = 8;
  let ccv3Chunk = '';
  let charaChunk = '';

  while (offset + 8 <= bytes.length) {
    const chunkLength = readUint32Be(bytes, offset);
    offset += 4;
    if (offset + 4 > bytes.length) {
      break;
    }
    const chunkType = toAscii(bytes.subarray(offset, offset + 4));
    offset += 4;
    if (offset + chunkLength + 4 > bytes.length) {
      break;
    }

    if (chunkType === 'tEXt') {
      const chunkData = bytes.subarray(offset, offset + chunkLength);
      const nullIndex = chunkData.indexOf(0);
      if (nullIndex > 0 && nullIndex < chunkData.length - 1) {
        const keyword = toAscii(chunkData.subarray(0, nullIndex)).toLowerCase();
        const text = toLatin1(chunkData.subarray(nullIndex + 1));
        if (keyword === 'ccv3') {
          ccv3Chunk = text;
        } else if (keyword === 'chara') {
          charaChunk = text;
        }
      }
    }

    if (chunkType === 'IEND') {
      break;
    }
    offset += chunkLength + 4;
  }

  const rawChunk = ccv3Chunk || charaChunk;
  if (!rawChunk) {
    throw new Error('PNG metadata does not contain character-card payload (`ccv3` or `chara`).');
  }

  const decoded = decodeBase64ToUtf8(rawChunk);
  return JSON.parse(decoded);
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

function trimTo(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function resolveCardRoot(payload: Record<string, unknown>): Record<string, unknown> {
  const data = asRecord(payload.data);
  if (data) {
    return data;
  }
  return payload;
}

export function parseSillyTavernCharacterCardPayload(
  payload: unknown,
  sourceFormat: 'json' | 'png'
): ParsedCharacterCard {
  const parsedPayload = asRecord(payload);
  if (!parsedPayload) {
    throw new Error('Character card payload must be an object.');
  }

  const root = resolveCardRoot(parsedPayload);
  const metadata = asRecord(root.metadata);
  const spec = asString(parsedPayload.spec) || 'v1';
  const specVersion = asString(parsedPayload.spec_version);
  const name = asString(root.name);
  const tags = uniqueStrings([
    ...asStringArray(root.tags),
    ...asStringArray(metadata?.tags)
  ]);
  const creator = asString(root.creator) || asString(metadata?.creator);
  const creatorNotes = asString(root.creator_notes) || asString(root.creatorcomment) || asString(metadata?.creator_notes);
  const description = asString(root.description);
  const personality = asString(root.personality);
  const scenario = asString(root.scenario);
  const firstMessage = asString(root.first_mes) || asString(root.firstMessage);
  const messageExample = asString(root.mes_example) || asString(root.messageExample);
  const alternateGreetings = asStringArray(root.alternate_greetings);
  const groupOnlyGreetings = asStringArray(root.group_only_greetings);
  const systemPrompt = asString(root.system_prompt);
  const postHistoryInstructions = asString(root.post_history_instructions);
  const characterBook = root.character_book;
  const embeddedLorebookName = asString(asRecord(characterBook)?.name);
  const parsedLorebook = hasMeaningfulLorebookPayload(characterBook)
    ? parseSillyTavernLorebookPayload(characterBook)
    : { entries: [], warnings: [] };

  const warnings = [...parsedLorebook.warnings];
  if (!name) {
    warnings.push('Character card is missing `name`.');
  }

  return {
    sourceFormat,
    spec,
    specVersion,
    name,
    tags,
    creator,
    creatorNotes,
    description,
    personality,
    scenario,
    firstMessage,
    messageExample,
    alternateGreetings,
    groupOnlyGreetings,
    systemPrompt,
    postHistoryInstructions,
    embeddedLorebookName,
    embeddedLorebookEntries: parsedLorebook.entries,
    warnings,
    rawPayload: payload
  };
}

export function parseSillyTavernCharacterCardJson(rawJson: string): ParsedCharacterCard {
  const payload = JSON.parse(rawJson);
  return parseSillyTavernCharacterCardPayload(payload, 'json');
}

export function parseSillyTavernCharacterCardPngBytes(bytes: Uint8Array): ParsedCharacterCard {
  const payload = parsePngCardPayload(bytes);
  return parseSillyTavernCharacterCardPayload(payload, 'png');
}

export function buildCharacterCardRewriteSystemPrompt(): string {
  return [
    'You are a careful fiction editor.',
    'Convert SillyTavern roleplay character cards into freeform story assets for LoreVault.',
    'Return JSON only. Do not wrap in markdown fences.',
    'Required JSON schema:',
    '{',
    '  "title": "string",',
    '  "storyMarkdown": "markdown string",',
    '  "authorNoteMarkdown": "markdown string",',
    '  "rewriteNotes": ["string"]',
    '}',
    'Rules:',
    '- Preserve canon facts and constraints from the card.',
    '- Rewrite roleplay placeholders (for example {{char}}, {{user}}, <START>) into natural freeform-story framing.',
    '- storyMarkdown should be setup text suitable for starting or continuing a prose chapter.',
    '- authorNoteMarkdown should be practical writing guidance in markdown format.',
    '- Choose structure and emphasis based on relevance; do not force template sections.',
    '- Keep language natural and direct (avoid rigid/template phrasing or hype wording).',
    '- Prefer specific constraints and immediate next actions over broad thematic statements.',
    '- Avoid conversion/meta commentary or references to prompt mechanics.',
    '- Keep output concise, specific, and internally consistent.'
  ].join('\n');
}

export function buildCharacterCardRewriteUserPrompt(card: ParsedCharacterCard): string {
  const lorebookPreview = card.embeddedLorebookEntries
    .slice(0, 24)
    .map(entry => ({
      uid: entry.uid,
      comment: entry.comment,
      key: entry.key,
      keysecondary: entry.keysecondary,
      content: trimTo(entry.content, 600)
    }));

  const promptPayload = {
    card: {
      sourceFormat: card.sourceFormat,
      spec: card.spec,
      specVersion: card.specVersion,
      name: card.name,
      tags: card.tags,
      creator: card.creator,
      creatorNotes: card.creatorNotes,
      description: card.description,
      personality: card.personality,
      scenario: card.scenario,
      firstMessage: card.firstMessage,
      messageExample: card.messageExample,
      alternateGreetings: card.alternateGreetings,
      groupOnlyGreetings: card.groupOnlyGreetings,
      systemPrompt: card.systemPrompt,
      postHistoryInstructions: card.postHistoryInstructions
    },
    embeddedLorebook: {
      name: card.embeddedLorebookName,
      totalEntries: card.embeddedLorebookEntries.length,
      entries: lorebookPreview
    }
  };

  return [
    'Rewrite this character card for freeform-story usage.',
    '',
    'Input JSON:',
    JSON.stringify(promptPayload, null, 2),
    '',
    'Output only JSON with keys: title, storyMarkdown, authorNoteMarkdown, rewriteNotes.'
  ].join('\n');
}

export function parseCharacterCardRewriteResponse(raw: string): CharacterCardRewriteResult {
  const payload = extractJsonPayload(raw);
  const objectPayload = asRecord(payload);
  if (!objectPayload) {
    throw new Error('Rewrite response payload is not an object.');
  }

  const title = asString(objectPayload.title)
    || asString(objectPayload.storyTitle)
    || asString(objectPayload.name)
    || 'Imported Character Story';
  const storyMarkdown = asString(objectPayload.storyMarkdown)
    || asString(objectPayload.story)
    || asString(objectPayload.storyNote);
  const authorNoteMarkdown = asString(objectPayload.authorNoteMarkdown)
    || asString(objectPayload.authorNote)
    || asString(objectPayload.notes);
  const rewriteNotes = asStringArray(objectPayload.rewriteNotes);

  if (!storyMarkdown) {
    throw new Error('Rewrite response is missing `storyMarkdown`.');
  }
  if (!authorNoteMarkdown.trim()) {
    throw new Error('Rewrite response is missing author-note content.');
  }

  return {
    title,
    storyMarkdown,
    authorNoteMarkdown,
    rewriteNotes
  };
}

function buildStoryPageContent(
  card: ParsedCharacterCard,
  rewrite: CharacterCardRewriteResult,
  storyPath: string,
  authorNotePath: string,
  defaultTags: string[],
  lorebookNames: string[],
  sourceCardPath: string
): string {
  const heading = rewrite.title || card.name || 'Imported Story';
  const avatarLink = resolveCharacterCardAvatarLink(sourceCardPath);
  const lines: string[] = ['---'];
  lines.push(`title: ${yamlQuote(heading)}`);
  lines.push(`authorNote: ${yamlQuote(`[[${normalizeLinkTarget(authorNotePath)}]]`)}`);
  lines.push(...yamlArrayBlock('tags', defaultTags));
  lines.push(...yamlArrayBlock('lorebooks', lorebookNames));
  lines.push(`sourceType: "sillytavern_character_card_import"`);
  lines.push(`characterCardName: ${yamlQuote(card.name || heading)}`);
  if (card.creator) {
    lines.push(`characterCardCreator: ${yamlQuote(card.creator)}`);
  }
  if (card.spec) {
    lines.push(`characterCardSpec: ${yamlQuote(card.spec)}`);
  }
  if (sourceCardPath) {
    lines.push(`characterCardPath: ${yamlQuote(sourceCardPath)}`);
  }
  if (avatarLink) {
    lines.push(`characterCardAvatar: ${yamlQuote(avatarLink)}`);
  }
  lines.push(...yamlArrayBlock('characterCardTags', card.tags));
  lines.push('---');
  lines.push('');
  if (avatarLink) {
    lines.push(`!${avatarLink}`);
    lines.push('');
  }
  lines.push(ensureHeading(rewrite.storyMarkdown, heading).trimEnd());
  lines.push('');
  return lines.join('\n');
}

function buildAuthorNoteContent(
  card: ParsedCharacterCard,
  rewrite: CharacterCardRewriteResult,
  authorNoteTitle: string,
  defaultTags: string[],
  lorebookNames: string[],
  completionPresetId: string,
  sourceCardPath: string
): string {
  const lines: string[] = ['---'];
  lines.push(`title: ${yamlQuote(authorNoteTitle)}`);
  lines.push(`lvDocType: "authorNote"`);
  lines.push(...yamlArrayBlock('tags', defaultTags));
  lines.push(...yamlArrayBlock('lorebooks', lorebookNames));
  if (completionPresetId) {
    lines.push(`completionProfile: ${yamlQuote(completionPresetId)}`);
  }
  lines.push(`sourceType: "sillytavern_character_card_import"`);
  lines.push(`characterCardName: ${yamlQuote(card.name || authorNoteTitle)}`);
  if (card.creator) {
    lines.push(`characterCardCreator: ${yamlQuote(card.creator)}`);
  }
  if (sourceCardPath) {
    lines.push(`characterCardPath: ${yamlQuote(sourceCardPath)}`);
  }
  lines.push('---');
  lines.push('');
  lines.push(rewrite.authorNoteMarkdown.trim() || '# Author Note');
  lines.push('');
  return lines.join('\n');
}

export function buildCharacterCardImportPlan(
  card: ParsedCharacterCard,
  rewrite: CharacterCardRewriteResult,
  options: BuildCharacterCardImportPlanOptions
): CharacterCardImportPlan {
  const targetFolder = normalizeVaultPath(options.targetFolder.trim().replace(/^\/+|\/+$/g, ''));
  if (!targetFolder) {
    throw new Error('Target folder is required.');
  }
  const authorNoteFolder = normalizeVaultPath(options.authorNoteFolder.trim().replace(/^\/+|\/+$/g, ''));
  if (!authorNoteFolder) {
    throw new Error('Author-note folder is required.');
  }

  const baseTitle = rewrite.title || card.name || 'Imported Character Story';
  const storyStem = toSafeFileStem(baseTitle);
  const storyPath = normalizeVaultPath(`${targetFolder}/${storyStem}.md`);
  const authorNotePath = normalizeVaultPath(`${authorNoteFolder}/${storyStem}-author-note.md`);
  const authorNoteTitle = `${baseTitle} Author Note`;

  const defaultTags = parseDefaultTags(options.defaultTagsRaw);
  const requestedLorebooks = normalizeLorebookNames(options.lorebookNames);
  const fallbackLorebook = normalizeScopeName(`characters/${storyStem}`);
  const effectiveLorebooks = requestedLorebooks.length > 0
    ? requestedLorebooks
    : (fallbackLorebook ? [fallbackLorebook] : []);

  const storyContent = buildStoryPageContent(
    card,
    rewrite,
    storyPath,
    authorNotePath,
    defaultTags,
    effectiveLorebooks,
    options.sourceCardPath
  );
  const authorNoteContent = buildAuthorNoteContent(
    card,
    rewrite,
    authorNoteTitle,
    defaultTags,
    effectiveLorebooks,
    options.completionPresetId,
    options.sourceCardPath
  );

  const pages: ImportedWikiPage[] = [
    {
      path: storyPath,
      content: storyContent,
      uid: 0
    },
    {
      path: authorNotePath,
      content: authorNoteContent,
      uid: 1
    }
  ];

  const warnings: string[] = [];
  if (options.includeEmbeddedLorebook && card.embeddedLorebookEntries.length > 0) {
    const embeddedFolder = normalizeVaultPath(`${targetFolder}/${storyStem}-lorebook`);
    const embeddedOptions: BuildImportedWikiPagesOptions = {
      targetFolder: embeddedFolder,
      defaultTagsRaw: options.defaultTagsRaw,
      lorebookName: '',
      lorebookNames: effectiveLorebooks,
      tagPrefix: options.tagPrefix,
      maxSummaryChars: options.maxSummaryChars
    };
    const embeddedPages = buildImportedWikiPages(card.embeddedLorebookEntries, embeddedOptions);
    let nextUid = 1000;
    for (const page of embeddedPages) {
      pages.push({
        ...page,
        uid: nextUid
      });
      nextUid += 1;
    }
  } else if (card.embeddedLorebookEntries.length > 0) {
    warnings.push(`Embedded lorebook contains ${card.embeddedLorebookEntries.length} entries but import is disabled.`);
  }

  return {
    storyPath,
    authorNotePath,
    pages,
    warnings,
    effectiveLorebooks
  };
}
