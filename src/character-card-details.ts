import { uniqueStrings } from './frontmatter-utils';

export const CHARACTER_CARD_DETAILS_BLOCK_BEGIN = '<!-- LV_BEGIN_CHARACTER_CARD_DETAILS -->';
export const CHARACTER_CARD_DETAILS_BLOCK_END = '<!-- LV_END_CHARACTER_CARD_DETAILS -->';
export const CHARACTER_CARD_DETAILS_BLOCK_VERSION = 2;
export const CHARACTER_CARD_DETAILS_BLOCK_VERSION_PREFIX = '<!-- LV_CHARACTER_CARD_DETAILS_VERSION:';

interface ParsedSectionMap {
  [heading: string]: string;
}

export interface CharacterCardDetailsContent {
  avatarEmbedMarkdown: string;
  cardSummary: string;
  cardSummaryScenarioFocus: string;
  cardSummaryHook: string;
  cardSummaryTone: string[];
  cardSummaryThemes: string[];
  creatorNotes: string;
  cardPersonality: string;
  cardDescription: string;
  cardScenario: string;
  cardFirstMessage: string;
  cardMessageExample: string;
  cardSystemPrompt: string;
  cardPostHistoryInstructions: string;
  cardAlternateGreetings: string[];
  cardGroupOnlyGreetings: string[];
}

function getEmptyCharacterCardDetailsContent(): CharacterCardDetailsContent {
  return {
    avatarEmbedMarkdown: '',
    cardSummary: '',
    cardSummaryScenarioFocus: '',
    cardSummaryHook: '',
    cardSummaryTone: [],
    cardSummaryThemes: [],
    creatorNotes: '',
    cardPersonality: '',
    cardDescription: '',
    cardScenario: '',
    cardFirstMessage: '',
    cardMessageExample: '',
    cardSystemPrompt: '',
    cardPostHistoryInstructions: '',
    cardAlternateGreetings: [],
    cardGroupOnlyGreetings: []
  };
}

function normalizeMarkdown(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function parseListSection(value: string): string[] {
  const items: string[] = [];
  for (const rawLine of normalizeMarkdown(value).split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith('- ')) {
      const candidate = trimmed.slice(2).trim();
      if (candidate) {
        items.push(candidate);
      }
      continue;
    }
    items.push(trimmed);
  }
  return uniqueStrings(items);
}

function parseTextSections(markdown: string): ParsedSectionMap {
  const sections: ParsedSectionMap = {};
  const lines = normalizeMarkdown(markdown).split('\n');
  let currentHeading = '';
  let buffer: string[] = [];

  const flush = () => {
    if (!currentHeading) {
      return;
    }
    sections[currentHeading] = buffer.join('\n').trim();
    currentHeading = '';
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^###\s+(.+?)\s*$/);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1].trim().toLowerCase();
      continue;
    }
    if (currentHeading) {
      buffer.push(line);
    }
  }
  flush();

  return sections;
}

function isImageEmbedLine(line: string): boolean {
  if (line.startsWith('![[')) {
    return true;
  }
  if (!line.startsWith('![')) {
    return false;
  }
  const openParenIndex = line.indexOf('](');
  return openParenIndex > 1 && line.endsWith(')');
}

function extractAvatarEmbedFromPayload(payload: string): string {
  const lines = normalizeMarkdown(payload).split('\n');
  let insideDetailsHeading = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (!insideDetailsHeading) {
      if (/^##\s+Character Card Details\s*$/i.test(line)) {
        insideDetailsHeading = true;
      }
      continue;
    }
    if (line.startsWith('Source Card:')) {
      break;
    }
    if (isImageEmbedLine(line)) {
      return line;
    }
  }

  // Fallback: keep any image embed found inside the managed block.
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (isImageEmbedLine(line)) {
      return line;
    }
  }

  return '';
}

function extractManagedDetailsPayload(markdown: string): string {
  const normalized = normalizeMarkdown(markdown);
  const beginIndex = normalized.indexOf(CHARACTER_CARD_DETAILS_BLOCK_BEGIN);
  const endIndex = normalized.indexOf(CHARACTER_CARD_DETAILS_BLOCK_END);
  if (beginIndex < 0 || endIndex <= beginIndex) {
    return '';
  }

  const blockStart = beginIndex + CHARACTER_CARD_DETAILS_BLOCK_BEGIN.length;
  const rawBlock = normalized.slice(blockStart, endIndex).trim();
  if (!rawBlock) {
    return '';
  }

  const blockLines = rawBlock
    .split('\n')
    .filter(line => !line.trim().startsWith(CHARACTER_CARD_DETAILS_BLOCK_VERSION_PREFIX));
  return blockLines.join('\n').trim();
}

export function parseCharacterCardDetailsContentFromMarkdown(markdown: string): CharacterCardDetailsContent {
  const payload = extractManagedDetailsPayload(markdown);
  if (!payload) {
    return getEmptyCharacterCardDetailsContent();
  }

  const sections = parseTextSections(payload);
  const details = getEmptyCharacterCardDetailsContent();
  details.avatarEmbedMarkdown = extractAvatarEmbedFromPayload(payload);
  details.cardSummary = sections['card summary'] ?? '';
  details.cardSummaryScenarioFocus = sections['summary scenario focus'] ?? '';
  details.cardSummaryHook = sections['summary hook'] ?? '';
  details.cardSummaryTone = parseListSection(sections['summary tone'] ?? '');
  details.cardSummaryThemes = parseListSection(sections['summary themes'] ?? '');
  details.creatorNotes = sections['creator notes'] ?? '';
  details.cardPersonality = sections['personality'] ?? '';
  details.cardDescription = sections['description'] ?? '';
  details.cardScenario = sections['scenario'] ?? '';
  details.cardFirstMessage = sections['first message'] ?? '';
  details.cardMessageExample = sections['message example'] ?? '';
  details.cardSystemPrompt = sections['system prompt'] ?? '';
  details.cardPostHistoryInstructions = sections['post history instructions'] ?? '';
  details.cardAlternateGreetings = parseListSection(sections['alternate greetings'] ?? '');
  details.cardGroupOnlyGreetings = parseListSection(sections['group-only greetings'] ?? '');
  return details;
}
