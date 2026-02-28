import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStorySteeringScopeResolutions,
  buildStorySteeringFilePath,
  createEmptyStorySteeringState,
  mergeStorySteeringStates,
  parseStorySteeringExtractionResponse,
  parseStorySteeringMarkdown,
  sanitizeStorySteeringExtractionState,
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

test('story steering extraction parser keeps raw values before optional sanitization', () => {
  const parsed = parseStorySteeringExtractionResponse(JSON.stringify({
    pinnedInstructions: 'Baalthasar is an ancient dark elven archmage.'
  }));
  assert.equal(parsed.pinnedInstructions, 'Baalthasar is an ancient dark elven archmage.');
});

test('story steering extraction sanitization removes lorebook-like profile facts', () => {
  const sanitized = sanitizeStorySteeringExtractionState({
    pinnedInstructions: 'Baalthasar is an ancient dark elven archmage.',
    storyNotes: 'Focus on escalating tension and keep dialogue concise.',
    sceneIntent: 'Ari is a young courier.',
    plotThreads: [
      'Who sabotaged the bridge?',
      'Baalthasar is a dark elf mage.'
    ],
    openLoops: [
      'What is the envoy hiding?',
      'The city is a massive floating metropolis.'
    ],
    canonDeltas: [
      'Ari now knows the true sigil sequence.',
      'Baalthasar is an archmage.'
    ]
  });

  assert.equal(sanitized.pinnedInstructions, '');
  assert.equal(sanitized.sceneIntent, '');
  assert.equal(sanitized.storyNotes, 'Focus on escalating tension and keep dialogue concise.');
  assert.deepEqual(sanitized.plotThreads, ['Who sabotaged the bridge?']);
  assert.deepEqual(sanitized.openLoops, ['What is the envoy hiding?']);
  assert.deepEqual(sanitized.canonDeltas, ['Ari now knows the true sigil sequence.']);
});

test('story steering scope resolutions use stable note-id keys with legacy path alias', () => {
  const resolutions = buildStorySteeringScopeResolutions(
    'stories/ch07.md',
    {},
    'lvn-abc123'
  );

  const noteResolution = resolutions.find(item => item.scope.type === 'note');
  assert.ok(noteResolution);
  assert.equal(noteResolution?.scope.key, 'note:lvn-abc123');
  assert.deepEqual(noteResolution?.legacyScopes, [{
    type: 'note',
    key: 'stories/ch07.md'
  }]);
});

test('chapter scope resolution migrates from legacy path fallback to note-id fallback', () => {
  const resolutions = buildStorySteeringScopeResolutions(
    'stories/ch07.md',
    {
      chapter: 7
    },
    'lvn-abc123'
  );

  const chapterResolution = resolutions.find(item => item.scope.type === 'chapter');
  assert.ok(chapterResolution);
  assert.equal(chapterResolution?.scope.key, 'note:lvn-abc123::chapter:7');
  assert.deepEqual(chapterResolution?.legacyScopes, [{
    type: 'chapter',
    key: 'stories/ch07.md::chapter:7'
  }]);
});
