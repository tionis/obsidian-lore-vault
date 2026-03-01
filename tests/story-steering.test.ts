import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStorySteeringScopeResolutions,
  buildStorySteeringFilePath,
  createStorySteeringChapterId,
  createStorySteeringStoryId,
  createEmptyStorySteeringState,
  mergeStorySteeringStates,
  parseStorySteeringExtractionResponse,
  parseStorySteeringMarkdown,
  sanitizeStorySteeringExtractionState,
  StorySteeringScope,
  stringifyStorySteeringMarkdown
} from '../src/story-steering';

test('story author-note markdown round-trips deterministically', () => {
  const scope: StorySteeringScope = {
    type: 'note',
    key: 'note:lvn-abc123'
  };
  const state = {
    authorNote: [
      '## General Writing Instructions',
      '',
      '- Keep tense in past tense.',
      '',
      '## Story Notes',
      '',
      'Highlight character conflict.'
    ].join('\n')
  };

  const markdown = stringifyStorySteeringMarkdown(scope, state);
  const parsed = parseStorySteeringMarkdown(markdown);
  assert.deepEqual(parsed, state);
});

test('story steering parser strips legacy title wrapper', () => {
  const markdown = [
    '# LoreVault Steering',
    '',
    '## Story Notes',
    '',
    'Focus on consequences.'
  ].join('\n');

  const parsed = parseStorySteeringMarkdown(markdown);
  assert.equal(parsed.authorNote, '## Story Notes\n\nFocus on consequences.');
});

test('story steering merge combines layers deterministically', () => {
  const merged = mergeStorySteeringStates([
    {
      ...createEmptyStorySteeringState(),
      authorNote: '## Story Notes\n\nFocus on tension.'
    },
    {
      ...createEmptyStorySteeringState(),
      authorNote: '## Story Notes\n\nFocus on tension.'
    },
    {
      ...createEmptyStorySteeringState(),
      authorNote: '## Scene Intent\n\nEnd on a hard decision.'
    }
  ]);

  assert.equal(
    merged.authorNote,
    [
      '## Story Notes',
      '',
      'Focus on tension.',
      '',
      '## Scene Intent',
      '',
      'End on a hard decision.'
    ].join('\n')
  );
});

test('story steering file paths are scoped and deterministic', () => {
  const storyPath = buildStorySteeringFilePath('LoreVault/steering', {
    type: 'story',
    key: 'chronicles-main'
  });
  const legacyThreadPath = buildStorySteeringFilePath('LoreVault/steering', {
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

  assert.match(storyPath, /^LoreVault\/steering\/story\/chronicles-main-[a-f0-9]{10}\.md$/);
  assert.match(legacyThreadPath, /^LoreVault\/steering\/thread\/chronicles-main-[a-f0-9]{10}\.md$/);
  assert.match(notePath, /^LoreVault\/steering\/note\/ch07\.md-[a-f0-9]{10}\.md$/);
  assert.equal(globalPath, 'LoreVault/steering/global.md');
});

test('auto-generated story/chapter steering ids are deterministic and scoped to note identity', () => {
  const path = 'stories/act1/chapter-07.md';
  const noteId = 'lvn-abc123';

  const storyIdA = createStorySteeringStoryId(path, noteId);
  const storyIdB = createStorySteeringStoryId(path, noteId);
  const chapterIdA = createStorySteeringChapterId(path, noteId);
  const chapterIdB = createStorySteeringChapterId(path, noteId);

  assert.equal(storyIdA, storyIdB);
  assert.equal(chapterIdA, chapterIdB);
  assert.match(storyIdA, /^chapter-07-[a-f0-9]{6}$/);
  assert.match(chapterIdA, /^chapter-07-[a-f0-9]{6}$/);
  assert.notEqual(storyIdA, chapterIdA);
});

test('story steering extraction parser accepts direct authorNote payload', () => {
  const parsed = parseStorySteeringExtractionResponse(JSON.stringify({
    authorNote: '## Scene Intent\n\nEscalate the conflict.'
  }));
  assert.equal(parsed.authorNote, '## Scene Intent\n\nEscalate the conflict.');
});

test('story steering extraction parser supports legacy structured payloads', () => {
  const parsed = parseStorySteeringExtractionResponse(JSON.stringify({
    state: {
      pinnedInstructions: 'Keep tone bleak.',
      storyNotes: 'Focus on aftermath.',
      plotThreads: ['Thread A', 'Thread B'],
      openLoops: '1. Loop C\n- Loop D'
    }
  }));

  assert.match(parsed.authorNote, /## General Writing Instructions/);
  assert.match(parsed.authorNote, /## Story Notes/);
  assert.match(parsed.authorNote, /## Active Plot Threads/);
  assert.match(parsed.authorNote, /## Open Questions/);
  assert.match(parsed.authorNote, /Thread A/);
  assert.match(parsed.authorNote, /Loop D/);
});

test('story steering extraction sanitization removes lorebook-like profile facts', () => {
  const sanitized = sanitizeStorySteeringExtractionState({
    authorNote: [
      'Baalthasar is an ancient dark elven archmage.',
      '',
      'Focus on escalating tension and keep dialogue concise.',
      '',
      'Ari now knows the true sigil sequence.'
    ].join('\n')
  });

  assert.equal(sanitized.authorNote, 'Focus on escalating tension and keep dialogue concise.\n\nAri now knows the true sigil sequence.');
});

test('story steering scope resolutions use note-id keys with legacy path alias', () => {
  const resolutions = buildStorySteeringScopeResolutions(
    'stories/ch07.md',
    {},
    'lvn-abc123'
  );

  assert.equal(resolutions.length, 1);
  assert.equal(resolutions[0].scope.type, 'note');
  assert.equal(resolutions[0].scope.key, 'note:lvn-abc123');
  assert.deepEqual(resolutions[0].legacyScopes, [{
    type: 'note',
    key: 'stories/ch07.md'
  }]);
});
