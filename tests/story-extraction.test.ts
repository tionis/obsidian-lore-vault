import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractWikiPagesFromStory,
  parseStoryExtractionOperations,
  splitStoryMarkdownIntoChunks
} from '../src/story-extraction';

test('splitStoryMarkdownIntoChunks deterministically splits by heading and size', () => {
  const markdown = [
    '# Chapter 1',
    'Alice arrives in the city and records everything in detail for the guild archives.',
    '',
    '## Scene 1',
    'She meets Captain Rowan and they discuss old treaties, symbols, and hidden routes.',
    '',
    '## Scene 2',
    'They discuss the old tower and its history. They map tunnels, ruins, and faction patrol routes.'
  ].join('\n');

  const chunks = splitStoryMarkdownIntoChunks(markdown, 220);
  assert.equal(chunks.length >= 2, true);
  assert.equal(chunks[0].index, 1);
  assert.ok(chunks[0].text.includes('Chapter 1'));
  assert.equal(chunks[chunks.length - 1].index, chunks.length);
});

test('parseStoryExtractionOperations validates and sorts operations', () => {
  const raw = [
    '```json',
    JSON.stringify({
      operations: [
        {
          pageKey: 'location/tower',
          title: 'Old Tower',
          summary: 'Ancient watchtower.',
          keywords: ['tower'],
          aliases: [],
          content: 'Ruined but active in the story.',
          confidence: 0.8
        },
        {
          pageKey: 'character/alice',
          title: 'Alice',
          summary: 'Main protagonist.',
          keywords: ['Alice'],
          aliases: ['A.'],
          content: 'Arrives in the city.',
          confidence: 0.9
        }
      ]
    }, null, 2),
    '```'
  ].join('\n');

  const operations = parseStoryExtractionOperations(raw, 10);
  assert.equal(operations.length, 2);
  assert.equal(operations[0].pageKey, 'character/alice');
  assert.equal(operations[1].pageKey, 'location/tower');
});

test('extractWikiPagesFromStory merges repeated page updates across chunks deterministically', async () => {
  const longChapterTwo = Array.from({ length: 16 })
    .map(() => 'Alice studies the old tower and meets Rowan while recording symbols and structural clues.')
    .join(' ');
  const story = [
    '# Chapter 1',
    'Alice enters the city.',
    '',
    '# Chapter 2',
    longChapterTwo
  ].join('\n');

  let callCount = 0;

  const result = await extractWikiPagesFromStory({
    storyMarkdown: story,
    targetFolder: 'wiki/extracted',
    defaultTagsRaw: 'wiki, extracted',
    lorebookName: 'story/main',
    tagPrefix: 'lorebook',
    maxChunkChars: 220,
    maxSummaryChars: 320,
    maxOperationsPerChunk: 8,
    maxExistingPagesInPrompt: 40,
    callModel: async () => {
      callCount += 1;
      if (callCount === 1) {
        return JSON.stringify({
          operations: [
            {
              pageKey: 'character/alice',
              title: 'Alice',
              summary: 'Young scholar entering the city.',
              keywords: ['Alice'],
              aliases: [],
              content: 'Alice arrives in the city seeking clues.',
              confidence: 0.9
            }
          ]
        });
      }

      return JSON.stringify({
        operations: [
          {
            pageKey: 'character/alice',
            title: 'Alice',
            summary: 'Investigates the old tower with Rowan.',
            keywords: ['Alice', 'Rowan'],
            aliases: ['Scholar Alice'],
            content: 'She investigates the old tower and works with Rowan.',
            confidence: 0.8
          },
          {
            pageKey: 'location/old-tower',
            title: 'Old Tower',
            summary: 'Ancient structure tied to hidden clues.',
            keywords: ['old tower', 'tower'],
            aliases: [],
            content: 'A recurring location for key revelations.',
            confidence: 0.85
          }
        ]
      });
    }
  });

  assert.equal(callCount >= 2, true);
  assert.equal(result.pages.length, 2);
  assert.equal(result.chunks.length >= 1, true);
  assert.equal(result.warnings.length, 0);

  const alice = result.pages.find(page => page.pageKey === 'character/alice');
  assert.ok(alice);
  assert.equal(alice?.path, 'wiki/extracted/character-alice.md');
  assert.match(alice?.content ?? '', /keywords:\n {2}- "Alice"\n {2}- "Rowan"/);
  assert.equal(/^summary:/m.test(alice?.content ?? ''), false);
  assert.match(alice?.content ?? '', /## Summary\n\nYoung scholar entering the city\./);
  assert.match(alice?.content ?? '', /Alice arrives in the city seeking clues\./);
  assert.match(alice?.content ?? '', /works with Rowan\./);

  const tower = result.pages.find(page => page.pageKey === 'location/old-tower');
  assert.ok(tower);
  assert.equal(tower?.path, 'wiki/extracted/location-old-tower.md');
});
