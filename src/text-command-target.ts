export interface TextCommandPosition {
  line: number;
  ch: number;
}

export interface TextCommandTargetSnapshot {
  filePath: string | null;
  from: TextCommandPosition;
  to: TextCommandPosition;
  originalText: string;
}

export type TextCommandTargetReplaceResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'line_out_of_range' | 'selection_mismatch' };

export function cloneTextCommandPosition(position: TextCommandPosition): TextCommandPosition {
  return {
    line: position.line,
    ch: position.ch
  };
}

export function cloneTextCommandTargetSnapshot(snapshot: TextCommandTargetSnapshot): TextCommandTargetSnapshot {
  return {
    filePath: snapshot.filePath,
    from: cloneTextCommandPosition(snapshot.from),
    to: cloneTextCommandPosition(snapshot.to),
    originalText: snapshot.originalText
  };
}

export function doesTextCommandSelectionMatchSnapshot(
  snapshot: TextCommandTargetSnapshot,
  filePath: string | null,
  from: TextCommandPosition,
  to: TextCommandPosition,
  selectedText: string
): boolean {
  return snapshot.filePath === filePath
    && positionsEqual(snapshot.from, from)
    && positionsEqual(snapshot.to, to)
    && snapshot.originalText === selectedText;
}

export function replaceTextCommandTargetRange(
  sourceText: string,
  snapshot: TextCommandTargetSnapshot,
  revisedText: string
): TextCommandTargetReplaceResult {
  const startOffset = positionToOffset(sourceText, snapshot.from);
  if (startOffset === null) {
    return { ok: false, reason: 'line_out_of_range' };
  }
  const endOffset = positionToOffset(sourceText, snapshot.to);
  if (endOffset === null) {
    return { ok: false, reason: 'line_out_of_range' };
  }
  if (endOffset < startOffset) {
    return { ok: false, reason: 'selection_mismatch' };
  }
  const currentSelection = sourceText.slice(startOffset, endOffset);
  if (currentSelection !== snapshot.originalText) {
    return { ok: false, reason: 'selection_mismatch' };
  }
  return {
    ok: true,
    text: `${sourceText.slice(0, startOffset)}${revisedText}${sourceText.slice(endOffset)}`
  };
}

function positionsEqual(left: TextCommandPosition, right: TextCommandPosition): boolean {
  return left.line === right.line && left.ch === right.ch;
}

function positionToOffset(sourceText: string, position: TextCommandPosition): number | null {
  if (!Number.isInteger(position.line) || !Number.isInteger(position.ch) || position.line < 0 || position.ch < 0) {
    return null;
  }

  let offset = 0;
  let currentLine = 0;
  while (currentLine < position.line) {
    const newlineIndex = sourceText.indexOf('\n', offset);
    if (newlineIndex === -1) {
      return null;
    }
    offset = newlineIndex + 1;
    currentLine += 1;
  }

  const lineEnd = sourceText.indexOf('\n', offset);
  const effectiveLineEnd = lineEnd === -1 ? sourceText.length : lineEnd;
  const lineLength = effectiveLineEnd - offset;
  if (position.ch > lineLength) {
    return null;
  }
  return offset + position.ch;
}
