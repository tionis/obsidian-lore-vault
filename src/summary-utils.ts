import { ConverterSettings } from './models';

export type GeneratedSummaryMode = 'world_info' | 'chapter';

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function normalizeGeneratedSummaryText(text: string, maxChars: number): string {
  const sanitized = sanitizeSummaryModelOutput(text);
  const singleLine = sanitized
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!singleLine) {
    return '';
  }
  const limit = Math.max(80, Math.floor(maxChars));
  if (singleLine.length <= limit) {
    return singleLine;
  }
  return `${singleLine.slice(0, limit).trimEnd()}...`;
}

function removeThinkBlocks(text: string): string {
  return text
    .replace(/<think[\s\S]*?<\/think>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ');
}

function stripSummaryLabels(text: string): string {
  const labelPattern = /\b(final\s+summary|summary|final answer|answer|output)\s*:/ig;
  let lastEnd = -1;
  let match: RegExpExecArray | null = labelPattern.exec(text);
  while (match) {
    lastEnd = match.index + match[0].length;
    match = labelPattern.exec(text);
  }
  if (lastEnd > 0 && lastEnd < text.length) {
    return text.slice(lastEnd).trim();
  }
  return text;
}

function shouldDropReasoningSentence(sentence: string): boolean {
  const normalized = sentence.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const startsWithReasoningMarker = /^(i|we|let(?:'s)?|the user|task|goal|analysis|reasoning|thinking|first|second|third)\b/.test(normalized);
  const hasReasoningPhrase = /\b(i need to|let me|i should|we need to|i will|the user asks|i can|i must)\b/.test(normalized);
  return startsWithReasoningMarker || hasReasoningPhrase;
}

function stripReasoningPreamble(text: string): string {
  const sentenceLike = text
    .replace(/\r\n?/g, '\n')
    .split(/(?<=[.!?])\s+|\n+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);

  if (sentenceLike.length === 0) {
    return '';
  }

  let startIndex = 0;
  while (startIndex < sentenceLike.length && shouldDropReasoningSentence(sentenceLike[startIndex])) {
    startIndex += 1;
  }

  const remaining = startIndex < sentenceLike.length
    ? sentenceLike.slice(startIndex)
    : [sentenceLike[sentenceLike.length - 1]];

  const listItems: string[] = [];
  const regularSentences: string[] = [];
  let previousWasNumberMarker = false;

  for (const sentence of remaining) {
    const trimmed = sentence.trim();
    if (!trimmed) {
      continue;
    }

    const markerOnly = /^\d+\s*[).]$/.test(trimmed);
    if (markerOnly) {
      previousWasNumberMarker = true;
      continue;
    }

    const startsWithMarker = /^\d+\s*[).]\s*/.test(trimmed);
    if (startsWithMarker || previousWasNumberMarker) {
      listItems.push(trimmed.replace(/^\d+\s*[).]\s*/, '').trim());
      previousWasNumberMarker = false;
      continue;
    }

    regularSentences.push(trimmed);
    previousWasNumberMarker = false;
  }

  if (regularSentences.length > 0) {
    return regularSentences.join(' ').trim();
  }

  if (listItems.length > 0) {
    return listItems.join('; ').trim();
  }

  return remaining.join(' ').trim();
}

export function sanitizeSummaryModelOutput(text: string): string {
  const withoutThinkBlocks = removeThinkBlocks(text);
  const withoutLabels = stripSummaryLabels(withoutThinkBlocks);
  return stripReasoningPreamble(withoutLabels).trim();
}

export function buildGeneratedSummarySignature(
  mode: GeneratedSummaryMode,
  bodyText: string,
  settings: ConverterSettings
): string {
  const summarySettings = settings.summaries;
  const completionSettings = settings.completion;
  const settingsKey = JSON.stringify({
    mode,
    promptVersion: summarySettings.promptVersion,
    provider: completionSettings.provider,
    model: completionSettings.model,
    maxSummaryChars: summarySettings.maxSummaryChars,
    maxInputChars: summarySettings.maxInputChars
  });
  return `${mode}:${fnv1a32(bodyText)}:${fnv1a32(settingsKey)}`;
}

export function resolveWorldInfoContent(
  noteBody: string,
  summaryOverride: string | undefined,
  generatedSummary: string
): string {
  const manualSummary = summaryOverride?.trim() ?? '';
  if (manualSummary) {
    return manualSummary;
  }

  const generated = generatedSummary.trim();
  if (generated) {
    return generated;
  }

  return noteBody;
}
