import test from 'node:test';
import assert from 'node:assert/strict';
import { StoryChatContextMeta } from '../src/models';
import {
  buildStoryChatContextInspectorLines,
  buildStoryChatContextInspectorSummary
} from '../src/story-chat-context-inspector';

function buildMeta(overrides: Partial<StoryChatContextMeta> = {}): StoryChatContextMeta {
  return {
    usedLorebookContext: true,
    usedManualContext: false,
    usedSpecificNotesContext: false,
    usedChapterMemoryContext: true,
    usedInlineDirectives: true,
    usedContinuityState: true,
    scopes: ['universe/yggdrasil'],
    specificNotePaths: [],
    unresolvedNoteRefs: [],
    chapterMemoryItems: ['Chapter 2', 'Chapter 3'],
    inlineDirectiveItems: ['Keep POV narrow', 'Do not resolve cliffhanger'],
    continuityPlotThreads: ['Broken seal in the north'],
    continuityOpenLoops: ['Who hired the assassin?'],
    continuityCanonDeltas: ['Ari knows the true sigil'],
    continuitySelection: {
      includePlotThreads: true,
      includeOpenLoops: true,
      includeCanonDeltas: true
    },
    layerTrace: ['history_window: 1200 tokens'],
    layerUsage: [
      {
        layer: 'inline_directives',
        placement: 'pre_response',
        reservedTokens: 64,
        usedTokens: 28,
        headroomTokens: 36,
        trimmed: false
      }
    ],
    overflowTrace: ['history_window: trimmed 200 tokens'],
    chatToolTrace: ['story_chat_tools: 1 call(s), stop=completed, write_tools=off'],
    chatToolCalls: ['get_steering_scope: note:lvn-abc123'],
    chatToolWrites: [],
    contextTokens: 2048,
    worldInfoCount: 5,
    ragCount: 1,
    worldInfoItems: ['Ari', 'Broken Seal'],
    ragItems: ['notes/chapter-03.md'],
    ...overrides
  };
}

test('buildStoryChatContextInspectorSummary exposes directive counts and scope list', () => {
  const summary = buildStoryChatContextInspectorSummary(buildMeta());
  assert.match(summary, /scopes universe\/yggdrasil/);
  assert.match(summary, /directives 2/);
  assert.match(summary, /world_info 5/);
  assert.match(summary, /fallback 1/);
  assert.match(summary, /tools 1/);
});

test('buildStoryChatContextInspectorLines renders inline directives and optional diagnostics', () => {
  const lines = buildStoryChatContextInspectorLines(buildMeta());
  assert.ok(lines.includes('inline directives: Keep POV narrow | Do not resolve cliffhanger'));
  assert.ok(lines.includes('chat tools: calls get_steering_scope: note:lvn-abc123'));
  assert.ok(lines.includes('chat tools: writes (none)'));
  assert.ok(lines.includes('chat tool trace: story_chat_tools: 1 call(s), stop=completed, write_tools=off'));
  assert.ok(lines.includes('overflow policy: history_window: trimmed 200 tokens'));
  assert.ok(lines.some(line => line.startsWith('layer budgets: inline_directives@pre_response used 28/64')));
  assert.ok(lines.includes('layer trace: history_window: 1200 tokens'));
});

test('buildStoryChatContextInspectorLines renders none markers when optional lists are empty', () => {
  const lines = buildStoryChatContextInspectorLines(buildMeta({
    scopes: [],
    specificNotePaths: [],
    unresolvedNoteRefs: [],
    chapterMemoryItems: [],
    inlineDirectiveItems: [],
    continuityPlotThreads: [],
    continuityOpenLoops: [],
    continuityCanonDeltas: [],
    overflowTrace: [],
    chatToolTrace: [],
    chatToolCalls: [],
    chatToolWrites: [],
    layerUsage: [],
    worldInfoItems: [],
    ragItems: [],
    layerTrace: []
  }));

  assert.ok(lines.includes('inline directives: (none)'));
  assert.ok(lines.includes('chat tools: calls (none)'));
  assert.ok(lines.includes('chat tools: writes (none)'));
  assert.ok(lines.includes('chat tool trace: (none)'));
  assert.ok(lines.includes('world_info: (none)'));
  assert.ok(lines.includes('fallback: (none)'));
  assert.ok(lines.includes('layer trace: (none)'));
  assert.ok(!lines.some(line => line.startsWith('overflow policy: ')));
  assert.ok(!lines.some(line => line.startsWith('layer budgets: ')));
});
