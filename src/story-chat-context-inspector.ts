import { StoryChatContextMeta } from './models';

function joinOrNone(values: string[] | undefined, separator: string): string {
  if (!values || values.length === 0) {
    return '(none)';
  }
  return values.join(separator);
}

function formatLayerUsage(meta: StoryChatContextMeta): string | null {
  const layerUsage = meta.layerUsage ?? [];
  if (layerUsage.length === 0) {
    return null;
  }
  const layerRows = layerUsage.map(layer =>
    `${layer.layer}@${layer.placement} used ${layer.usedTokens}/${layer.reservedTokens} (headroom ${layer.headroomTokens})${layer.trimmed ? ` [trimmed: ${layer.trimReason ?? 'budget'}]` : ''}`
  );
  return `layer budgets: ${layerRows.join(' | ')}`;
}

export function buildStoryChatContextInspectorSummary(meta: StoryChatContextMeta): string {
  return `Injected context · scopes ${joinOrNone(meta.scopes, ', ')} · directives ${(meta.inlineDirectiveItems ?? []).length} · notes ${meta.specificNotePaths.length} · world_info ${meta.worldInfoCount} · fallback ${meta.ragCount} · tools ${(meta.chatToolCalls ?? []).length}`;
}

export function buildStoryChatContextInspectorLines(meta: StoryChatContextMeta): string[] {
  const lines: string[] = [
    `Tokens: ${meta.contextTokens} | lorebook: ${meta.usedLorebookContext ? 'on' : 'off'} | manual: ${meta.usedManualContext ? 'on' : 'off'} | inline-directives: ${meta.usedInlineDirectives ? 'on' : 'off'} | specific-notes: ${meta.usedSpecificNotesContext ? 'on' : 'off'}`,
    `chapter-memory: ${meta.usedChapterMemoryContext ? 'on' : 'off'} | chapters: ${joinOrNone(meta.chapterMemoryItems, ', ')}`,
    `specific notes: ${joinOrNone(meta.specificNotePaths, ', ')}`,
    `unresolved note refs: ${joinOrNone(meta.unresolvedNoteRefs, ', ')}`,
    `inline directives: ${joinOrNone(meta.inlineDirectiveItems, ' | ')}`,
    `continuity: ${meta.usedContinuityState ? 'on' : 'off'} | threads ${(meta.continuityPlotThreads ?? []).length} | open loops ${(meta.continuityOpenLoops ?? []).length} | canon deltas ${(meta.continuityCanonDeltas ?? []).length}`,
    `continuity items: threads ${joinOrNone(meta.continuityPlotThreads, ' | ')}`,
    `continuity items: open loops ${joinOrNone(meta.continuityOpenLoops, ' | ')}`,
    `continuity items: canon deltas ${joinOrNone(meta.continuityCanonDeltas, ' | ')}`,
    `chat tools: calls ${joinOrNone(meta.chatToolCalls, ' | ')}`,
    `chat tools: writes ${joinOrNone(meta.chatToolWrites, ' | ')}`,
  ];

  const overflowTrace = meta.overflowTrace ?? [];
  if (overflowTrace.length > 0) {
    lines.push(`overflow policy: ${overflowTrace.join(' | ')}`);
  }

  const layerUsageLine = formatLayerUsage(meta);
  if (layerUsageLine) {
    lines.push(layerUsageLine);
  }

  lines.push(`world_info: ${joinOrNone(meta.worldInfoItems, ', ')}`);
  lines.push(`fallback: ${joinOrNone(meta.ragItems, ', ')}`);
  lines.push(`chat tool trace: ${joinOrNone(meta.chatToolTrace, ' | ')}`);
  lines.push(`layer trace: ${joinOrNone(meta.layerTrace, ' | ')}`);
  return lines;
}
