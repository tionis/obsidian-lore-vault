import { PromptLayerPlacement, PromptLayerUsage } from './models';

export type PromptTrimMode = 'head' | 'tail';

export interface PromptSegment {
  key: string;
  label: string;
  content: string;
  reservedTokens: number;
  placement?: PromptLayerPlacement;
  trimMode?: PromptTrimMode;
  minTokens?: number;
  locked?: boolean;
  trimmed?: boolean;
  trimReason?: string;
}

export interface PromptOverflowResult {
  segments: PromptSegment[];
  totalTokens: number;
  overflowTokens: number;
  trace: string[];
}

export function estimateTextTokens(text: string): number {
  if (!text.trim()) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

export function trimTextForTokenBudget(
  text: string,
  tokenBudget: number,
  mode: PromptTrimMode
): string {
  if (!text.trim() || tokenBudget <= 0) {
    return '';
  }

  const maxChars = Math.max(1, Math.floor(tokenBudget * 4));
  if (text.length <= maxChars) {
    return text;
  }

  if (mode === 'tail') {
    return text.slice(text.length - maxChars).trimStart();
  }
  return text.slice(0, maxChars).trimEnd();
}

export function applyDeterministicOverflow(
  segmentsInput: PromptSegment[],
  maxTokens: number,
  trimOrder: string[]
): PromptOverflowResult {
  const segments = segmentsInput.map(segment => ({ ...segment }));
  const trace: string[] = [];
  const normalizedMaxTokens = Math.max(0, Math.floor(maxTokens));

  const totalTokens = (): number => segments.reduce((sum, segment) => sum + estimateTextTokens(segment.content), 0);
  let currentTotal = totalTokens();
  let overflow = currentTotal - normalizedMaxTokens;
  if (overflow <= 0) {
    return {
      segments,
      totalTokens: currentTotal,
      overflowTokens: 0,
      trace
    };
  }

  for (const key of trimOrder) {
    if (overflow <= 0) {
      break;
    }

    const segment = segments.find(item => item.key === key);
    if (!segment || segment.locked) {
      continue;
    }

    const beforeTokens = estimateTextTokens(segment.content);
    if (beforeTokens <= 0) {
      continue;
    }

    const minTokens = Math.max(0, Math.floor(segment.minTokens ?? 0));
    if (beforeTokens <= minTokens) {
      continue;
    }

    const targetTokens = Math.max(minTokens, beforeTokens - overflow);
    const nextContent = trimTextForTokenBudget(
      segment.content,
      targetTokens,
      segment.trimMode ?? 'head'
    );
    const afterTokens = estimateTextTokens(nextContent);
    if (afterTokens >= beforeTokens) {
      continue;
    }

    segment.content = nextContent;
    segment.trimmed = true;
    segment.trimReason = `overflow (${beforeTokens} -> ${afterTokens})`;
    const reduced = beforeTokens - afterTokens;
    overflow -= reduced;
    trace.push(`${segment.key}: trimmed ${reduced} tokens (${beforeTokens} -> ${afterTokens})`);
  }

  currentTotal = totalTokens();
  overflow = currentTotal - normalizedMaxTokens;
  if (overflow > 0) {
    trace.push(`overflow unresolved: ${overflow} tokens remain after fixed trim order`);
  }

  return {
    segments,
    totalTokens: currentTotal,
    overflowTokens: Math.max(0, overflow),
    trace
  };
}

export function toPromptLayerUsage(segments: PromptSegment[]): PromptLayerUsage[] {
  return segments.map(segment => {
    const usedTokens = estimateTextTokens(segment.content);
    const reservedTokens = Math.max(0, Math.floor(segment.reservedTokens));
    return {
      layer: segment.label,
      placement: segment.placement ?? 'pre_response',
      reservedTokens,
      usedTokens,
      headroomTokens: Math.max(0, reservedTokens - usedTokens),
      trimmed: Boolean(segment.trimmed),
      trimReason: segment.trimReason
    };
  });
}

