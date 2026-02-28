const CHARS_PER_TOKEN = 4;
const MIN_QUERY_CHARS = 5000;
const MAX_QUERY_CHARS = 180000;
const MIN_STORY_CHARS = 12000;
const MAX_STORY_CHARS = 900000;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function normalizeText(text: string): string {
  return (text ?? '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

function tokenBudgetToCharLimit(tokenBudget: number, minChars: number, maxChars: number): number {
  const estimated = Math.floor(Math.max(1, tokenBudget) * CHARS_PER_TOKEN);
  return clamp(estimated, minChars, maxChars);
}

function trimAtWordBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const boundary = text.slice(0, maxChars + 1).lastIndexOf(' ');
  const cut = boundary >= Math.floor(maxChars * 0.5) ? boundary : maxChars;
  return `${text.slice(0, cut).trimEnd()}\n...`;
}

function collectHeadingHighlights(text: string): string[] {
  const lines = text.split('\n');
  const highlights: string[] = [];
  const headingPattern = /^\s{0,3}#{1,6}\s+\S+/;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!headingPattern.test(line)) {
      continue;
    }

    let body = '';
    for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex += 1) {
      const candidate = lines[bodyIndex].trim();
      if (!candidate) {
        if (body) {
          break;
        }
        continue;
      }
      if (headingPattern.test(candidate)) {
        break;
      }
      body = body ? `${body} ${candidate}` : candidate;
      if (body.length >= 320) {
        break;
      }
    }

    if (body) {
      highlights.push(`${line}\n${trimAtWordBoundary(body, 260)}`);
    } else {
      highlights.push(line);
    }
  }

  return highlights;
}

function collectSampledParagraphHighlights(text: string, maxChars: number): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) {
    return [];
  }

  const sampleCount = Math.max(1, Math.min(6, Math.floor(maxChars / 450)));
  const seen = new Set<number>();
  const sampled: string[] = [];
  const perSnippetBudget = Math.max(140, Math.floor(maxChars / sampleCount) - 24);

  for (let i = 0; i < sampleCount; i += 1) {
    const position = sampleCount === 1
      ? 0
      : Math.floor((i * (paragraphs.length - 1)) / (sampleCount - 1));
    if (seen.has(position)) {
      continue;
    }
    seen.add(position);
    sampled.push(trimAtWordBoundary(paragraphs[position], perSnippetBudget));
  }

  return sampled;
}

function renderMiddleHighlights(middleText: string, maxChars: number): string {
  if (maxChars <= 0) {
    return '';
  }
  const normalized = normalizeText(middleText);
  if (!normalized) {
    return '';
  }

  const headingHighlights = collectHeadingHighlights(normalized);
  const candidates = headingHighlights.length > 0
    ? headingHighlights
    : collectSampledParagraphHighlights(normalized, maxChars);

  if (candidates.length === 0) {
    return '';
  }

  const selected: string[] = [];
  let usedChars = 0;
  for (const candidate of candidates) {
    const snippet = candidate.trim();
    if (!snippet) {
      continue;
    }
    const nextCost = snippet.length + (selected.length > 0 ? 2 : 0);
    if (usedChars + nextCost > maxChars) {
      if (selected.length === 0) {
        selected.push(trimAtWordBoundary(snippet, maxChars));
      }
      break;
    }
    selected.push(snippet);
    usedChars += nextCost;
    if (usedChars >= Math.floor(maxChars * 0.95)) {
      break;
    }
  }

  return selected.join('\n\n');
}

function buildStructuredStoryWindow(
  sourceText: string,
  headChars: number,
  tailChars: number,
  middleChars: number
): string {
  const safeHeadChars = Math.max(0, headChars);
  const safeTailChars = Math.max(0, tailChars);
  const sourceLength = sourceText.length;
  if (sourceLength === 0) {
    return '';
  }

  const head = sourceText.slice(0, safeHeadChars).trimEnd();
  const tailStart = Math.max(safeHeadChars, sourceLength - safeTailChars);
  const tail = sourceText.slice(tailStart).trimStart();
  const middleSource = sourceText.slice(safeHeadChars, tailStart);
  const middle = middleChars > 0 ? renderMiddleHighlights(middleSource, middleChars) : '';

  const sections: string[] = [];
  if (head) {
    sections.push(head);
  }
  if (middle) {
    sections.push('[... middle story highlights ...]');
    sections.push(middle);
  }
  if (tail) {
    sections.push(tail);
  }

  return sections.join('\n\n');
}

export function extractAdaptiveQueryWindow(text: string, tokenBudget: number): string {
  const normalized = normalizeText(text);
  if (!normalized) {
    return '';
  }

  const maxChars = tokenBudgetToCharLimit(tokenBudget, MIN_QUERY_CHARS, MAX_QUERY_CHARS);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return normalized.slice(normalized.length - maxChars).trimStart();
}

export function extractAdaptiveStoryWindow(text: string, tokenBudget: number): string {
  const normalized = normalizeText(text);
  if (!normalized) {
    return '';
  }

  const maxChars = tokenBudgetToCharLimit(tokenBudget, MIN_STORY_CHARS, MAX_STORY_CHARS);
  if (normalized.length <= maxChars) {
    return normalized;
  }

  let headChars = Math.max(1200, Math.floor(maxChars * 0.18));
  let tailChars = Math.max(2400, Math.floor(maxChars * 0.62));
  if (headChars + tailChars > maxChars) {
    const scale = maxChars / (headChars + tailChars);
    headChars = Math.max(700, Math.floor(headChars * scale));
    tailChars = Math.max(1200, Math.floor(tailChars * scale));
  }

  let middleChars = Math.max(0, maxChars - headChars - tailChars - 80);
  let composed = buildStructuredStoryWindow(normalized, headChars, tailChars, middleChars);
  if (composed.length <= maxChars) {
    return composed;
  }

  // If still too long, drop middle highlights first, then shrink opening, then hard-cut tail.
  middleChars = 0;
  composed = buildStructuredStoryWindow(normalized, headChars, tailChars, middleChars);
  if (composed.length <= maxChars) {
    return composed;
  }

  headChars = Math.max(500, Math.floor(headChars * 0.55));
  composed = buildStructuredStoryWindow(normalized, headChars, tailChars, 0);
  if (composed.length <= maxChars) {
    return composed;
  }

  return composed.slice(composed.length - maxChars).trimStart();
}
