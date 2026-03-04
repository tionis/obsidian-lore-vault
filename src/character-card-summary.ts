import { ParsedCharacterCard } from './sillytavern-character-card';

export interface CharacterCardSummaryPayload {
  summary: string;
  themes: string[];
  tone: string[];
  scenarioFocus: string;
  hook: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    const values = value
      .map(item => asString(item))
      .filter(Boolean);
    return uniqueStrings(values);
  }
  if (typeof value === 'string') {
    return uniqueStrings(
      value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
    );
  }
  return [];
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
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
    out.push(normalized);
  }
  return out;
}

function trimTo(value: string, maxChars: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  const clipped = normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd();
  return `${clipped}…`;
}

function clampWordCount(value: string, maxWords: number): string {
  const words = value
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (words.length <= maxWords) {
    return words.join(' ');
  }
  return `${words.slice(0, maxWords).join(' ')}…`;
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

export function buildCharacterCardSummarySystemPrompt(): string {
  return [
    'You summarize character cards for a fiction-writing library browser.',
    'Use only provided card data. Do not invent traits, lore, events, or constraints.',
    'Avoid roleplay output and meta commentary.',
    'Output valid JSON only. Do not wrap in markdown fences.',
    'Required JSON schema:',
    '{',
    '  "summary": "string",',
    '  "themes": ["string"],',
    '  "tone": ["string"],',
    '  "scenario_focus": "string",',
    '  "hook": "string"',
    '}',
    'Rules:',
    '- summary: one paragraph, 70-120 words, clear and easy to skim.',
    '- themes: 3-6 concise tags describing scenario motifs/subject matter.',
    '- tone: 3-6 concise tags describing narrative mood and style.',
    '- scenario_focus: one sentence explaining what story setup this card drives.',
    '- hook: one sentence explaining why this card is compelling for writing.',
    '- Keep wording concrete and practical for writers browsing many cards.'
  ].join('\n');
}

export function buildCharacterCardSummaryUserPrompt(card: ParsedCharacterCard): string {
  const payload = {
    card: {
      sourceFormat: card.sourceFormat,
      spec: card.spec,
      specVersion: card.specVersion,
      name: card.name,
      tags: card.tags,
      creator: card.creator,
      creatorNotes: trimTo(card.creatorNotes, 700),
      description: trimTo(card.description, 3200),
      personality: trimTo(card.personality, 2200),
      scenario: trimTo(card.scenario, 3200),
      firstMessage: trimTo(card.firstMessage, 1800),
      messageExample: trimTo(card.messageExample, 1800),
      alternateGreetings: card.alternateGreetings.slice(0, 8).map(value => trimTo(value, 220)),
      groupOnlyGreetings: card.groupOnlyGreetings.slice(0, 8).map(value => trimTo(value, 220)),
      systemPrompt: trimTo(card.systemPrompt, 1600),
      postHistoryInstructions: trimTo(card.postHistoryInstructions, 1600),
      embeddedLorebookName: card.embeddedLorebookName,
      embeddedLorebookEntryCount: card.embeddedLorebookEntries.length
    }
  };

  return [
    'Summarize this character card for a writing library.',
    '',
    'Input JSON:',
    JSON.stringify(payload, null, 2)
  ].join('\n');
}

export function parseCharacterCardSummaryResponse(raw: string): CharacterCardSummaryPayload {
  const payload = extractJsonPayload(raw);
  const objectPayload = asRecord(payload);
  if (!objectPayload) {
    throw new Error('Character-card summary response payload is not an object.');
  }

  const summary = clampWordCount(
    asString(objectPayload.summary)
      || asString(objectPayload.overview)
      || asString(objectPayload.synopsis),
    140
  );
  if (!summary) {
    throw new Error('Character-card summary response is missing `summary`.');
  }

  const themes = asStringArray(objectPayload.themes ?? objectPayload.tags).slice(0, 8);
  const tone = asStringArray(objectPayload.tone ?? objectPayload.mood).slice(0, 8);
  const scenarioFocus = clampWordCount(
    asString(objectPayload.scenario_focus)
      || asString(objectPayload.scenarioFocus)
      || asString(objectPayload.story_focus),
    36
  );
  const hook = clampWordCount(
    asString(objectPayload.hook)
      || asString(objectPayload.writer_hook)
      || asString(objectPayload.writerHook),
    36
  );

  return {
    summary,
    themes,
    tone,
    scenarioFocus,
    hook
  };
}
