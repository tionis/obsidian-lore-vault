import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyStorySteeringState,
  mergeStorySteeringStates,
  normalizeStorySteeringState,
  parseStorySteeringExtractionResponse,
  parseStorySteeringMarkdown,
  sanitizeStorySteeringExtractionState
} from '../src/story-steering';

test('story author-note markdown parser strips frontmatter deterministically', () => {
  const markdown = [
    '---',
    'lvDocType: authorNote',
    '---',
    '',
    '## Story Notes',
    '',
    'Keep tense in past tense.'
  ].join('\n');

  const parsed = parseStorySteeringMarkdown(markdown);
  assert.deepEqual(parsed, {
    authorNote: '## Story Notes\n\nKeep tense in past tense.'
  });
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

test('story steering extraction parser accepts direct authorNote payload', () => {
  const parsed = parseStorySteeringExtractionResponse(JSON.stringify({
    authorNote: '## Scene Intent\n\nEscalate the conflict.'
  }));
  assert.equal(parsed.authorNote, '## Scene Intent\n\nEscalate the conflict.');
});

test('story steering extraction parser rejects legacy structured payloads', () => {
  assert.throws(() => {
    parseStorySteeringExtractionResponse(JSON.stringify({
      state: {
        storyNotes: 'Focus on aftermath.',
        plotThreads: ['Thread A', 'Thread B']
      }
    }));
  }, /authorNote/i);
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

test('normalizeStorySteeringState trims authorNote text', () => {
  const normalized = normalizeStorySteeringState({
    authorNote: '  keep this tight\n'
  });

  assert.equal(normalized.authorNote, 'keep this tight');
});
