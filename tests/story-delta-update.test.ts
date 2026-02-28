import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStoryDeltaPlan,
  parseStoryDeltaOperations
} from '../src/story-delta-update';

test('parseStoryDeltaOperations validates and sorts deterministic output', () => {
  const raw = JSON.stringify({
    operations: [
      {
        pageKey: 'location/tower',
        title: 'Tower',
        summary: 'A high watchtower.',
        keywords: ['tower'],
        aliases: [],
        content: 'Used as a lookout point.',
        confidence: 0.75,
        rationale: 'Mentioned during strategy discussion.'
      },
      {
        pageKey: 'character/alice',
        title: 'Alice',
        summary: 'Lead investigator.',
        keywords: ['Alice'],
        aliases: ['Al'],
        content: 'Discovers new clues.',
        confidence: 0.9,
        rationale: 'Central actor in the chunk.'
      }
    ]
  });

  const operations = parseStoryDeltaOperations(raw, 8);
  assert.equal(operations.length, 2);
  assert.equal(operations[0].pageKey, 'character/alice');
  assert.equal(operations[1].pageKey, 'location/tower');
});

test('buildStoryDeltaPlan supports idempotent safe_append updates', async () => {
  const storyMarkdown = '# Chapter 1\nAlice returns from the tower with a sealed map.';
  const existing = {
    path: 'wiki/character-alice.md',
    content: [
      '---',
      'title: "Alice"',
      'pageKey: "character/alice"',
      '---',
      '',
      'Alice is a veteran investigator.',
      ''
    ].join('\n')
  };

  const response = JSON.stringify({
    operations: [
      {
        pageKey: 'character/alice',
        title: 'Alice',
        summary: 'Veteran investigator and courier.',
        keywords: ['Alice'],
        aliases: [],
        content: 'Alice returns from the tower with a sealed map.',
        confidence: 0.95,
        rationale: 'Narrative explicitly states this event.'
      }
    ]
  });

  const first = await buildStoryDeltaPlan({
    storyMarkdown,
    targetFolder: 'wiki',
    defaultTagsRaw: 'wiki',
    lorebookName: 'story/main',
    tagPrefix: 'lorebook',
    updatePolicy: 'safe_append',
    maxChunkChars: 500,
    maxSummaryChars: 240,
    maxOperationsPerChunk: 8,
    maxExistingPagesInPrompt: 20,
    lowConfidenceThreshold: 0.5,
    existingPages: [existing],
    callModel: async () => response
  });

  assert.equal(first.pages.length, 1);
  assert.equal(first.pages[0].action, 'update');
  assert.match(first.pages[0].content, /sealed map\./);
  assert.equal(first.pages[0].diff.addedLines > 0, true);
  assert.equal(first.pages[0].diff.removedLines >= 0, true);
  assert.equal(first.changes[0].diffAddedLines > 0, true);

  const second = await buildStoryDeltaPlan({
    storyMarkdown,
    targetFolder: 'wiki',
    defaultTagsRaw: 'wiki',
    lorebookName: 'story/main',
    tagPrefix: 'lorebook',
    updatePolicy: 'safe_append',
    maxChunkChars: 500,
    maxSummaryChars: 240,
    maxOperationsPerChunk: 8,
    maxExistingPagesInPrompt: 20,
    lowConfidenceThreshold: 0.5,
    existingPages: [{
      path: first.pages[0].path,
      content: first.pages[0].content
    }],
    callModel: async () => response
  });

  assert.equal(second.pages.length, 0);
  assert.equal(second.skippedLowConfidence, 0);
});

test('buildStoryDeltaPlan enforces low-confidence gating and deterministic create path', async () => {
  const storyMarkdown = '# Chapter 2\nRowan fortifies the old tower and creates a new watch post.';

  const result = await buildStoryDeltaPlan({
    storyMarkdown,
    targetFolder: 'wiki',
    defaultTagsRaw: 'wiki, updated',
    lorebookName: 'story/main',
    tagPrefix: 'lorebook',
    updatePolicy: 'structured_merge',
    maxChunkChars: 500,
    maxSummaryChars: 240,
    maxOperationsPerChunk: 8,
    maxExistingPagesInPrompt: 20,
    lowConfidenceThreshold: 0.6,
    existingPages: [],
    callModel: async () => JSON.stringify({
      operations: [
        {
          pageKey: 'location/old-tower',
          title: 'Old Tower',
          summary: 'Main fortified location.',
          keywords: ['old tower'],
          aliases: [],
          content: 'Reinforced with new defenses.',
          confidence: 0.82,
          rationale: 'Explicitly described fortification actions.'
        },
        {
          pageKey: 'faction/shadow-couriers',
          title: 'Shadow Couriers',
          summary: 'Rumored faction connected to the watch post.',
          keywords: ['couriers'],
          aliases: [],
          content: 'Possibly involved in covert operations.',
          confidence: 0.2,
          rationale: 'Only implied and uncertain.'
        }
      ]
    })
  });

  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].action, 'create');
  assert.equal(result.pages[0].path, 'wiki/location-old-tower.md');
  assert.equal(/^summary:/m.test(result.pages[0].content), false);
  assert.match(result.pages[0].content, /^# Old Tower$/m);
  assert.match(result.pages[0].content, /## Summary\n\nMain fortified location\./);
  assert.match(result.pages[0].content, /## Overview\n\nReinforced with new defenses\./);
  assert.equal(result.skippedLowConfidence, 1);
  assert.match(result.pages[0].content, /lorebook\/story\/main/);
  assert.equal(result.pages[0].diff.removedLines, 0);
  assert.equal(result.pages[0].diff.addedLines > 0, true);
});

test('safe_append does not inject frontmatter into existing notes without frontmatter', async () => {
  const result = await buildStoryDeltaPlan({
    storyMarkdown: '# Chapter\nThe shrine gains a new warding sigil.',
    targetFolder: 'wiki',
    defaultTagsRaw: 'wiki',
    lorebookName: 'story/main',
    tagPrefix: 'lorebook',
    updatePolicy: 'safe_append',
    maxChunkChars: 500,
    maxSummaryChars: 200,
    maxOperationsPerChunk: 8,
    maxExistingPagesInPrompt: 20,
    lowConfidenceThreshold: 0.5,
    existingPages: [
      {
        path: 'wiki/shrine.md',
        content: 'The shrine is old and weathered.\n'
      }
    ],
    callModel: async () => JSON.stringify({
      operations: [
        {
          pageKey: 'location/shrine',
          title: 'Shrine',
          summary: 'Ancient protected shrine.',
          keywords: ['shrine'],
          aliases: [],
          content: 'The shrine gains a new warding sigil.',
          confidence: 0.9,
          rationale: 'Directly described state update.'
        }
      ]
    })
  });

  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].path, 'wiki/shrine.md');
  assert.equal(result.pages[0].content.startsWith('---\n'), false);
  assert.match(result.pages[0].content, /new warding sigil/);
});

test('structured_merge migrates legacy frontmatter summary to summary section', async () => {
  const result = await buildStoryDeltaPlan({
    storyMarkdown: '# Chapter\nAlice documents the hidden routes near the tower.',
    targetFolder: 'wiki',
    defaultTagsRaw: 'wiki',
    lorebookName: 'story/main',
    tagPrefix: 'lorebook',
    updatePolicy: 'structured_merge',
    maxChunkChars: 500,
    maxSummaryChars: 220,
    maxOperationsPerChunk: 8,
    maxExistingPagesInPrompt: 20,
    lowConfidenceThreshold: 0.5,
    existingPages: [
      {
        path: 'wiki/alice.md',
        content: [
          '---',
          'title: "Alice"',
          'summary: "Legacy summary from frontmatter."',
          'pageKey: "character/alice"',
          '---',
          '',
          'Alice is already known to the guild.',
          ''
        ].join('\n')
      }
    ],
    callModel: async () => JSON.stringify({
      operations: [
        {
          pageKey: 'character/alice',
          title: 'Alice',
          summary: '',
          keywords: ['Alice'],
          aliases: [],
          content: 'She records hidden routes near the tower.',
          confidence: 0.92,
          rationale: 'Durable new investigation detail.'
        }
      ]
    })
  });

  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].path, 'wiki/alice.md');
  assert.equal(/^summary:/m.test(result.pages[0].content), false);
  assert.match(result.pages[0].content, /## Summary\n\nLegacy summary from frontmatter\./);
  assert.match(result.pages[0].content, /records hidden routes near the tower/);
});

test('structured_merge prefers existing summary section over frontmatter fallback', async () => {
  const result = await buildStoryDeltaPlan({
    storyMarkdown: '# Chapter\nThe watch confirms another patrol update.',
    targetFolder: 'wiki',
    defaultTagsRaw: 'wiki',
    lorebookName: 'story/main',
    tagPrefix: 'lorebook',
    updatePolicy: 'structured_merge',
    maxChunkChars: 500,
    maxSummaryChars: 220,
    maxOperationsPerChunk: 8,
    maxExistingPagesInPrompt: 20,
    lowConfidenceThreshold: 0.5,
    existingPages: [
      {
        path: 'wiki/tower.md',
        content: [
          '---',
          'title: "Old Tower"',
          'summary: "Legacy fallback summary."',
          'pageKey: "location/old-tower"',
          '---',
          '',
          '## Summary',
          '',
          'Section summary takes precedence.',
          '',
          'Current tower details.',
          ''
        ].join('\n')
      }
    ],
    callModel: async () => JSON.stringify({
      operations: [
        {
          pageKey: 'location/old-tower',
          title: 'Old Tower',
          summary: '',
          keywords: ['tower'],
          aliases: [],
          content: 'Patrol routes were updated again.',
          confidence: 0.9,
          rationale: 'Explicit operational change.'
        }
      ]
    })
  });

  assert.equal(result.pages.length, 1);
  assert.equal(/^summary:/m.test(result.pages[0].content), false);
  assert.match(result.pages[0].content, /## Summary\n\nSection summary takes precedence\./);
  assert.equal(result.pages[0].content.includes('Legacy fallback summary.'), false);
});
