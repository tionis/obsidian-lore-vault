export type GeneratedSummaryMode = 'world_info' | 'chapter';
export type NoteSummarySource = 'section' | 'frontmatter';

const SUMMARY_SECTION_HEADING_PATTERN = /^\s{0,3}##\s+summary\s*$/i;
const MAJOR_HEADING_PATTERN = /^\s{0,3}#{1,2}\s+\S/;
const H1_HEADING_PATTERN = /^\s{0,3}#\s+\S/;

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

interface SummarySectionRange {
  startLine: number;
  endLineExclusive: number;
}

function normalizeMarkdownNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function findSummarySectionRange(bodyText: string): SummarySectionRange | null {
  const normalized = normalizeMarkdownNewlines(bodyText);
  const lines = normalized.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (!SUMMARY_SECTION_HEADING_PATTERN.test(lines[index].trim())) {
      continue;
    }

    let cursor = index + 1;
    while (cursor < lines.length && lines[cursor].trim().length === 0) {
      cursor += 1;
    }

    while (cursor < lines.length) {
      if (MAJOR_HEADING_PATTERN.test(lines[cursor])) {
        break;
      }
      if (lines[cursor].trim().length === 0) {
        break;
      }
      cursor += 1;
    }

    let endLineExclusive = cursor;
    if (
      endLineExclusive < lines.length &&
      lines[endLineExclusive].trim().length === 0 &&
      !MAJOR_HEADING_PATTERN.test(lines[endLineExclusive])
    ) {
      endLineExclusive += 1;
    }

    return {
      startLine: index,
      endLineExclusive
    };
  }

  return null;
}

function splitFrontmatterAndBody(rawContent: string): { frontmatterBlock: string; bodyText: string } {
  const normalized = normalizeMarkdownNewlines(rawContent);
  const match = normalized.match(/^(---\s*\n[\s\S]*?\n---)(?:\n([\s\S]*))?$/);
  if (!match) {
    return {
      frontmatterBlock: '',
      bodyText: normalized
    };
  }

  return {
    frontmatterBlock: `${match[1]}\n`,
    bodyText: match[2] ?? ''
  };
}

export function extractSummarySectionFromBody(bodyText: string): string {
  const normalized = normalizeMarkdownNewlines(bodyText);
  const range = findSummarySectionRange(normalized);
  if (!range) {
    return '';
  }

  const lines = normalized.split('\n');
  return lines
    .slice(range.startLine + 1, range.endLineExclusive)
    .join('\n')
    .trim();
}

export function stripSummarySectionFromBody(bodyText: string): string {
  const normalized = normalizeMarkdownNewlines(bodyText);
  const range = findSummarySectionRange(normalized);
  if (!range) {
    return normalized.trim();
  }

  const lines = normalized.split('\n');
  const nextLines = [
    ...lines.slice(0, range.startLine),
    ...lines.slice(range.endLineExclusive)
  ];

  return nextLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function resolveNoteSummary(
  bodyText: string,
  frontmatterSummary: string | undefined
): { text: string; source: NoteSummarySource } | null {
  const sectionSummary = extractSummarySectionFromBody(bodyText);
  if (sectionSummary) {
    return {
      text: sectionSummary,
      source: 'section'
    };
  }

  const fallbackFrontmatterSummary = frontmatterSummary?.trim() ?? '';
  if (fallbackFrontmatterSummary) {
    return {
      text: fallbackFrontmatterSummary,
      source: 'frontmatter'
    };
  }

  return null;
}

export function upsertSummarySectionInMarkdown(rawContent: string, summaryText: string): string {
  const summary = summaryText.trim();
  const { frontmatterBlock, bodyText } = splitFrontmatterAndBody(rawContent);
  const bodyNormalized = normalizeMarkdownNewlines(bodyText);
  const lines = bodyNormalized.length > 0 ? bodyNormalized.split('\n') : [];
  const existingRange = findSummarySectionRange(bodyNormalized);

  const linesWithoutSummary = existingRange
    ? [
      ...lines.slice(0, existingRange.startLine),
      ...lines.slice(existingRange.endLineExclusive)
    ]
    : lines;

  const firstH1Index = linesWithoutSummary.findIndex(line => H1_HEADING_PATTERN.test(line));
  let insertionIndex = firstH1Index >= 0 ? firstH1Index + 1 : 0;
  while (
    insertionIndex < linesWithoutSummary.length &&
    linesWithoutSummary[insertionIndex].trim().length === 0
  ) {
    insertionIndex += 1;
  }

  const summaryLines = [
    '## Summary',
    '',
    ...summary.split('\n').map(line => line.trimEnd()),
    ''
  ];
  if (
    insertionIndex > 0 &&
    linesWithoutSummary[insertionIndex - 1].trim().length > 0
  ) {
    summaryLines.unshift('');
  }

  const nextLines = [
    ...linesWithoutSummary.slice(0, insertionIndex),
    ...summaryLines,
    ...linesWithoutSummary.slice(insertionIndex)
  ];

  const nextBody = nextLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!frontmatterBlock) {
    return nextBody;
  }
  if (!nextBody) {
    return frontmatterBlock.trimEnd();
  }

  return `${frontmatterBlock}${nextBody}`;
}

export function resolveWorldInfoContent(
  noteBody: string,
  frontmatterSummary: string | undefined
): string {
  const noteSummary = resolveNoteSummary(noteBody, frontmatterSummary);
  if (noteSummary) {
    return noteSummary.text;
  }

  return stripSummarySectionFromBody(noteBody);
}
