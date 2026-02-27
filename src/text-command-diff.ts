export interface TextCommandDiffPreview {
  addedLines: number;
  removedLines: number;
  preview: string;
  truncated: boolean;
}

const DIFF_PREVIEW_MAX_LINES = 220;

function splitLines(content: string): string[] {
  const normalized = content.replace(/\r\n?/g, '\n');
  if (!normalized) {
    return [];
  }
  return normalized.split('\n');
}

export function buildTextCommandDiffPreview(originalText: string, revisedText: string): TextCommandDiffPreview {
  if (originalText === revisedText) {
    return {
      addedLines: 0,
      removedLines: 0,
      preview: '(no changes)',
      truncated: false
    };
  }

  const before = splitLines(originalText);
  const after = splitLines(revisedText);

  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }

  let beforeEnd = before.length - 1;
  let afterEnd = after.length - 1;
  while (beforeEnd >= prefix && afterEnd >= prefix && before[beforeEnd] === after[afterEnd]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const removedSegment = before.slice(prefix, beforeEnd + 1);
  const addedSegment = after.slice(prefix, afterEnd + 1);
  const raw: string[] = [];
  raw.push(`@@ -${prefix + 1},${removedSegment.length} +${prefix + 1},${addedSegment.length} @@`);
  if (prefix > 0) {
    raw.push(` ${before[prefix - 1]}`);
  }
  for (const line of removedSegment) {
    raw.push(`-${line}`);
  }
  for (const line of addedSegment) {
    raw.push(`+${line}`);
  }
  if (beforeEnd + 1 < before.length) {
    raw.push(` ${before[beforeEnd + 1]}`);
  }

  const truncated = raw.length > DIFF_PREVIEW_MAX_LINES;
  const previewLines = truncated
    ? [...raw.slice(0, DIFF_PREVIEW_MAX_LINES), '... [truncated]']
    : raw;

  return {
    addedLines: addedSegment.length,
    removedLines: removedSegment.length,
    preview: previewLines.join('\n'),
    truncated
  };
}
