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
  const singleLine = text
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
