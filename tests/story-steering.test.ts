import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStorySteeringFilePath,
  createEmptyStorySteeringState,
  mergeStorySteeringStates,
  parseStorySteeringExtractionResponse,
  parseStorySteeringMarkdown,
  StorySteeringScope,
  stringifyStorySteeringMarkdown
} from '../src/story-steering';

test('story steering markdown round-trips deterministic sections', () => {
  const scope: StorySteeringScope = {
    type: 'thread',
    key: 'chronicles-main'
  };
  const state = {
    pinnedInstructions: 'Keep tense in past tense.',
    storyNotes: 'Highlight character conflict.',
    sceneIntent: 'End on a hard decision.',
    plotThreads: ['The envoy is hiding something'],
    openLoops: ['Who sabotaged the bridge?'],
    canonDeltas: ['Ari knows the true sigil']
  };

  const markdown = stringifyStorySteeringMarkdown(scope, state);
  const parsed = parseStorySteeringMarkdown(markdown);
  assert.deepEqual(parsed, state);
});

test('story steering parser supports bullet and ordered list forms', () => {
  const markdown = [
    '# Any title',
    '',
    '## Active Plot Threads',
    '',
    '- Thread A',
    '1. Thread B',
    '',
    '## Open Loops',
    '',
    '* Loop A',
    '',
    '## Canon Deltas',
    '',
    'Delta A'
  ].join('\n');

  const parsed = parseStorySteeringMarkdown(markdown);
  assert.deepEqual(parsed.plotThreads, ['Thread A', 'Thread B']);
  assert.deepEqual(parsed.openLoops, ['Loop A']);
  assert.deepEqual(parsed.canonDeltas, ['Delta A']);
});

test('story steering merge combines layered text and list state deterministically', () => {
  const merged = mergeStorySteeringStates([
    {
      ...createEmptyStorySteeringState(),
      pinnedInstructions: 'Keep prose concise.',
      plotThreads: ['Thread A'],
      openLoops: ['Loop A']
    },
    {
      ...createEmptyStorySteeringState(),
      pinnedInstructions: 'Keep prose concise.',
      storyNotes: 'Focus on tension.',
      plotThreads: ['Thread B', 'Thread A'],
      canonDeltas: ['Delta A']
    }
  ]);

  assert.equal(merged.pinnedInstructions, 'Keep prose concise.');
  assert.equal(merged.storyNotes, 'Focus on tension.');
  assert.deepEqual(merged.plotThreads, ['Thread A', 'Thread B']);
  assert.deepEqual(merged.openLoops, ['Loop A']);
  assert.deepEqual(merged.canonDeltas, ['Delta A']);
});

test('story steering file paths are scoped and deterministic', () => {
  const threadPath = buildStorySteeringFilePath('LoreVault/steering', {
    type: 'thread',
    key: 'chronicles-main'
  });
  const notePath = buildStorySteeringFilePath('LoreVault/steering', {
    type: 'note',
    key: 'story/ch07.md'
  });
  const globalPath = buildStorySteeringFilePath('LoreVault/steering', {
    type: 'global',
    key: 'global'
  });

  assert.match(threadPath, /^LoreVault\/steering\/thread\/chronicles-main-[a-f0-9]{10}\.md$/);
  assert.match(notePath, /^LoreVault\/steering\/note\/ch07\.md-[a-f0-9]{10}\.md$/);
  assert.equal(globalPath, 'LoreVault/steering/global.md');
});

test('story steering extraction parser accepts plain json and fenced json payloads', () => {
  const plain = parseStorySteeringExtractionResponse(JSON.stringify({
    pinnedInstructions: 'Keep tone bleak.',
    storyNotes: 'Focus on aftermath.',
    sceneIntent: 'End with unresolved threat.',
    plotThreads: ['Thread A', 'Thread B'],
    openLoops: ['Loop A'],
    canonDeltas: ['Delta A']
  }));
  assert.equal(plain.pinnedInstructions, 'Keep tone bleak.');
  assert.deepEqual(plain.plotThreads, ['Thread A', 'Thread B']);

  const fenced = parseStorySteeringExtractionResponse([
    '```json',
    '{',
    '  "state": {',
    '    "pinnedInstructions": "Keep tense consistent.",',
    '    "plotThreads": ["Thread C"],',
    '    "openLoops": "1. Loop C\\n- Loop D"',
    '  }',
    '}',
    '```'
  ].join('\n'));
  assert.equal(fenced.pinnedInstructions, 'Keep tense consistent.');
  assert.deepEqual(fenced.plotThreads, ['Thread C']);
  assert.deepEqual(fenced.openLoops, ['Loop C', 'Loop D']);
});
