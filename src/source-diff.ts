export interface SourceDiffBuildOptions {
  contextLines?: number;
  maxRenderRows?: number;
  lcsCellLimit?: number;
}

type AtomicLineType = 'equal' | 'remove' | 'add';

interface AtomicLineOp {
  type: AtomicLineType;
  text: string;
}

interface AtomicLineRow {
  type: AtomicLineType;
  leftLine: number | null;
  rightLine: number | null;
  text: string;
}

export type SourceDiffRowType = 'equal' | 'replace' | 'remove' | 'add' | 'omitted';

export interface SourceDiffRow {
  type: SourceDiffRowType;
  leftLine: number | null;
  rightLine: number | null;
  leftText: string;
  rightText: string;
  omittedCount?: number;
}

export interface SourceDiffHunk {
  rows: SourceDiffRow[];
}

export interface SourceDiffPreview {
  addedLines: number;
  removedLines: number;
  preview: string;
  truncated: boolean;
  hunks: SourceDiffHunk[];
}

const DEFAULT_CONTEXT_LINES = 3;
const DEFAULT_MAX_RENDER_ROWS = 280;
const DEFAULT_LCS_CELL_LIMIT = 1_200_000;

function splitLines(content: string): string[] {
  const normalized = content.replace(/\r\n?/g, '\n');
  if (!normalized) {
    return [];
  }
  return normalized.split('\n');
}

function toPositiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value ?? fallback));
}

function buildMiddleOpsWithLcs(before: string[], after: string[], lcsCellLimit: number): AtomicLineOp[] {
  if (before.length === 0) {
    return after.map(text => ({ type: 'add', text }));
  }
  if (after.length === 0) {
    return before.map(text => ({ type: 'remove', text }));
  }

  const cellCount = before.length * after.length;
  if (cellCount > lcsCellLimit) {
    return [
      ...before.map(text => ({ type: 'remove', text } as const)),
      ...after.map(text => ({ type: 'add', text } as const))
    ];
  }

  const rows = before.length;
  const cols = after.length;
  const matrix: Uint32Array[] = new Array(rows + 1);
  for (let row = 0; row <= rows; row += 1) {
    matrix[row] = new Uint32Array(cols + 1);
  }

  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      if (before[row] === after[col]) {
        matrix[row][col] = matrix[row + 1][col + 1] + 1;
        continue;
      }
      const skipBefore = matrix[row + 1][col];
      const skipAfter = matrix[row][col + 1];
      matrix[row][col] = skipBefore >= skipAfter ? skipBefore : skipAfter;
    }
  }

  const ops: AtomicLineOp[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < rows && afterIndex < cols) {
    if (before[beforeIndex] === after[afterIndex]) {
      ops.push({
        type: 'equal',
        text: before[beforeIndex]
      });
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }
    const skipBefore = matrix[beforeIndex + 1][afterIndex];
    const skipAfter = matrix[beforeIndex][afterIndex + 1];
    if (skipBefore >= skipAfter) {
      ops.push({
        type: 'remove',
        text: before[beforeIndex]
      });
      beforeIndex += 1;
      continue;
    }
    ops.push({
      type: 'add',
      text: after[afterIndex]
    });
    afterIndex += 1;
  }

  while (beforeIndex < rows) {
    ops.push({
      type: 'remove',
      text: before[beforeIndex]
    });
    beforeIndex += 1;
  }
  while (afterIndex < cols) {
    ops.push({
      type: 'add',
      text: after[afterIndex]
    });
    afterIndex += 1;
  }

  return ops;
}

function buildAtomicRows(beforeText: string, afterText: string, lcsCellLimit: number): AtomicLineRow[] {
  const beforeLines = splitLines(beforeText);
  const afterLines = splitLines(afterText);

  let prefixCount = 0;
  while (
    prefixCount < beforeLines.length &&
    prefixCount < afterLines.length &&
    beforeLines[prefixCount] === afterLines[prefixCount]
  ) {
    prefixCount += 1;
  }

  let beforeTail = beforeLines.length - 1;
  let afterTail = afterLines.length - 1;
  while (
    beforeTail >= prefixCount &&
    afterTail >= prefixCount &&
    beforeLines[beforeTail] === afterLines[afterTail]
  ) {
    beforeTail -= 1;
    afterTail -= 1;
  }

  const prefix = beforeLines.slice(0, prefixCount);
  const middleBefore = beforeTail >= prefixCount ? beforeLines.slice(prefixCount, beforeTail + 1) : [];
  const middleAfter = afterTail >= prefixCount ? afterLines.slice(prefixCount, afterTail + 1) : [];
  const suffix = beforeLines.slice(beforeTail + 1);
  const middleOps = buildMiddleOpsWithLcs(middleBefore, middleAfter, lcsCellLimit);

  const rows: AtomicLineRow[] = [];
  let leftLine = 1;
  let rightLine = 1;

  for (const text of prefix) {
    rows.push({
      type: 'equal',
      leftLine,
      rightLine,
      text
    });
    leftLine += 1;
    rightLine += 1;
  }

  for (const op of middleOps) {
    if (op.type === 'equal') {
      rows.push({
        type: 'equal',
        leftLine,
        rightLine,
        text: op.text
      });
      leftLine += 1;
      rightLine += 1;
      continue;
    }
    if (op.type === 'remove') {
      rows.push({
        type: 'remove',
        leftLine,
        rightLine: null,
        text: op.text
      });
      leftLine += 1;
      continue;
    }
    rows.push({
      type: 'add',
      leftLine: null,
      rightLine,
      text: op.text
    });
    rightLine += 1;
  }

  for (const text of suffix) {
    rows.push({
      type: 'equal',
      leftLine,
      rightLine,
      text
    });
    leftLine += 1;
    rightLine += 1;
  }

  return rows;
}

function buildDisplayRows(atomicRows: AtomicLineRow[]): SourceDiffRow[] {
  const rows: SourceDiffRow[] = [];
  let index = 0;

  while (index < atomicRows.length) {
    const row = atomicRows[index];
    if (row.type === 'equal') {
      rows.push({
        type: 'equal',
        leftLine: row.leftLine,
        rightLine: row.rightLine,
        leftText: row.text,
        rightText: row.text
      });
      index += 1;
      continue;
    }

    const removed: AtomicLineRow[] = [];
    const added: AtomicLineRow[] = [];
    while (index < atomicRows.length && atomicRows[index].type !== 'equal') {
      if (atomicRows[index].type === 'remove') {
        removed.push(atomicRows[index]);
      } else {
        added.push(atomicRows[index]);
      }
      index += 1;
    }

    const pairCount = Math.max(removed.length, added.length);
    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      const removedRow = removed[pairIndex] ?? null;
      const addedRow = added[pairIndex] ?? null;
      if (removedRow && addedRow) {
        rows.push({
          type: 'replace',
          leftLine: removedRow.leftLine,
          rightLine: addedRow.rightLine,
          leftText: removedRow.text,
          rightText: addedRow.text
        });
        continue;
      }
      if (removedRow) {
        rows.push({
          type: 'remove',
          leftLine: removedRow.leftLine,
          rightLine: null,
          leftText: removedRow.text,
          rightText: ''
        });
        continue;
      }
      if (addedRow) {
        rows.push({
          type: 'add',
          leftLine: null,
          rightLine: addedRow.rightLine,
          leftText: '',
          rightText: addedRow.text
        });
      }
    }
  }

  return rows;
}

function buildVisibleRanges(rows: SourceDiffRow[], contextLines: number): Array<{ start: number; end: number }> {
  const changedIndices: number[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].type !== 'equal') {
      changedIndices.push(index);
    }
  }
  if (changedIndices.length === 0) {
    return [];
  }

  const ranges: Array<{ start: number; end: number }> = [];
  for (const changedIndex of changedIndices) {
    const rangeStart = Math.max(0, changedIndex - contextLines);
    const rangeEnd = Math.min(rows.length - 1, changedIndex + contextLines);
    const previous = ranges[ranges.length - 1];
    if (!previous || rangeStart > previous.end + 1) {
      ranges.push({ start: rangeStart, end: rangeEnd });
      continue;
    }
    previous.end = Math.max(previous.end, rangeEnd);
  }
  return ranges;
}

function buildHunks(rows: SourceDiffRow[], contextLines: number): SourceDiffHunk[] {
  const ranges = buildVisibleRanges(rows, contextLines);
  if (ranges.length === 0) {
    return [];
  }

  const hunks: SourceDiffHunk[] = [];
  let previousEnd = -1;
  for (const range of ranges) {
    const hunkRows: SourceDiffRow[] = [];
    const omittedCount = range.start - previousEnd - 1;
    if (omittedCount > 0) {
      hunkRows.push({
        type: 'omitted',
        leftLine: null,
        rightLine: null,
        leftText: '',
        rightText: '',
        omittedCount
      });
    }
    for (let index = range.start; index <= range.end; index += 1) {
      hunkRows.push(rows[index]);
    }
    hunks.push({ rows: hunkRows });
    previousEnd = range.end;
  }
  return hunks;
}

function limitHunks(hunks: SourceDiffHunk[], maxRenderRows: number): { hunks: SourceDiffHunk[]; truncated: boolean } {
  if (hunks.length === 0) {
    return {
      hunks: [],
      truncated: false
    };
  }

  const limited: SourceDiffHunk[] = [];
  let remainingRows = maxRenderRows;
  let truncated = false;
  for (const hunk of hunks) {
    if (remainingRows <= 0) {
      truncated = true;
      break;
    }
    if (hunk.rows.length <= remainingRows) {
      limited.push({
        rows: [...hunk.rows]
      });
      remainingRows -= hunk.rows.length;
      continue;
    }
    limited.push({
      rows: hunk.rows.slice(0, remainingRows)
    });
    remainingRows = 0;
    truncated = true;
    break;
  }
  if (!truncated && limited.length < hunks.length) {
    truncated = true;
  }
  return {
    hunks: limited,
    truncated
  };
}

function buildPreviewFromHunks(hunks: SourceDiffHunk[], truncated: boolean): string {
  const lines: string[] = [];
  for (const hunk of hunks) {
    for (const row of hunk.rows) {
      if (row.type === 'omitted') {
        lines.push(`... [${row.omittedCount ?? 0} unchanged line(s) omitted]`);
        continue;
      }
      if (row.type === 'equal') {
        lines.push(` ${row.leftText}`);
        continue;
      }
      if (row.type === 'remove') {
        lines.push(`-${row.leftText}`);
        continue;
      }
      if (row.type === 'add') {
        lines.push(`+${row.rightText}`);
        continue;
      }
      lines.push(`-${row.leftText}`);
      lines.push(`+${row.rightText}`);
    }
  }
  if (lines.length === 0) {
    return '(no changes)';
  }
  if (truncated) {
    lines.push('... [truncated]');
  }
  return lines.join('\n');
}

function countChangedLines(rows: SourceDiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.type === 'add') {
      added += 1;
      continue;
    }
    if (row.type === 'remove') {
      removed += 1;
      continue;
    }
    if (row.type === 'replace') {
      added += 1;
      removed += 1;
    }
  }
  return { added, removed };
}

export function buildSourceDiffPreview(
  beforeText: string,
  afterText: string,
  options: SourceDiffBuildOptions = {}
): SourceDiffPreview {
  if (beforeText === afterText) {
    return {
      addedLines: 0,
      removedLines: 0,
      preview: '(no changes)',
      truncated: false,
      hunks: []
    };
  }

  const contextLines = toPositiveInt(options.contextLines, DEFAULT_CONTEXT_LINES);
  const maxRenderRows = Math.max(40, toPositiveInt(options.maxRenderRows, DEFAULT_MAX_RENDER_ROWS));
  const lcsCellLimit = Math.max(50_000, toPositiveInt(options.lcsCellLimit, DEFAULT_LCS_CELL_LIMIT));

  const atomicRows = buildAtomicRows(beforeText, afterText, lcsCellLimit);
  const displayRows = buildDisplayRows(atomicRows);
  const fullHunks = buildHunks(displayRows, contextLines);
  const { hunks, truncated } = limitHunks(fullHunks, maxRenderRows);
  const counts = countChangedLines(displayRows);

  return {
    addedLines: counts.added,
    removedLines: counts.removed,
    preview: buildPreviewFromHunks(hunks, truncated),
    truncated,
    hunks
  };
}
