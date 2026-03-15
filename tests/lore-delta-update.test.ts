import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLoreDeltaPlan,
  parseLoreDeltaOperations
} from '../src/lore-delta-update';

function countOccurrences(text: string, pattern: RegExp): number {
  const matches = text.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`));
  return matches ? matches.length : 0;
}

test('parseLoreDeltaOperations validates and sorts deterministic output', () => {
  const raw = JSON.stringify({
    operations: [
      {
        pageKey: 'location/tower',
        title: 'Tower',
        updateMode: 'merge',
        summary: 'A high watchtower.',
        keywords: ['tower'],
        aliases: [],
        content: '## Overview\n\nUsed as a lookout point.',
        confidence: 0.75,
        rationale: 'New durable location detail.'
      },
      {
        pageKey: 'character/alice',
        title: 'Alice',
        updateMode: 'rewrite',
        summary: 'Lead investigator.',
        keywords: ['Alice'],
        aliases: ['Al'],
        content: '## Overview\n\nReorganized canon entry.',
        confidence: 0.9,
        rationale: 'Focused cleanup request.'
      }
    ]
  });

  const operations = parseLoreDeltaOperations(raw, 8);
  assert.equal(operations.length, 2);
  assert.equal(operations[0].pageKey, 'character/alice');
  assert.equal(operations[0].updateMode, 'rewrite');
  assert.equal(operations[1].pageKey, 'location/tower');
});

test('buildLoreDeltaPlan strips inline LV directives from idea brief prompt', async () => {
  let capturedUserPrompt = '';

  await buildLoreDeltaPlan({
    ideaMarkdown: '# Idea\n[LV: Keep this hidden]\nAurelia now has a sibling who affects court politics.',
    newNoteFolder: 'wiki',
    defaultTagsRaw: '',
    lorebookScopes: ['world/main'],
    tagPrefix: 'lorebook',
    updatePolicy: 'section_merge',
    allowCreateNotes: true,
    maxChunkChars: 500,
    maxOperationsPerChunk: 8,
    maxExistingPagesInPrompt: 20,
    focusedPagePaths: [],
    maxFocusedPagesInPrompt: 4,
    maxFocusedPageChars: 2000,
    lowConfidenceThreshold: 0.5,
    existingPages: [],
    callModel: async (_systemPrompt, userPrompt) => {
      capturedUserPrompt = userPrompt;
      return JSON.stringify({
        operations: [
          {
            pageKey: 'character/aurelia',
            title: 'Aurelia',
            updateMode: 'merge',
            summary: 'Court figure with a newly introduced sibling.',
            keywords: ['Aurelia'],
            aliases: [],
            content: '## Relationships\n\nAurelia has a sibling with influence at court.',
            confidence: 0.9,
            rationale: 'Directly requested canon addition.'
          }
        ]
      });
    }
  });

  assert.equal(capturedUserPrompt.includes('LV:'), false);
});

test('section_merge merges matching sections and preserves untouched sections', async () => {
  const result = await buildLoreDeltaPlan({
    ideaMarkdown: '# Idea\nAdd a new court tie and timeline note for Aurelia.',
    newNoteFolder: 'wiki',
    defaultTagsRaw: 'wiki',
    lorebookScopes: ['world/main'],
    tagPrefix: 'lorebook',
    updatePolicy: 'section_merge',
    allowCreateNotes: true,
    maxChunkChars: 500,
    maxOperationsPerChunk: 8,
    maxExistingPagesInPrompt: 20,
    focusedPagePaths: [],
    maxFocusedPagesInPrompt: 4,
    maxFocusedPageChars: 2000,
    lowConfidenceThreshold: 0.5,
    existingPages: [
      {
        path: 'wiki/aurelia.md',
        content: [
          '---',
          'title: "Aurelia"',
          'pageKey: "character/aurelia"',
          '---',
          '',
          '## Summary',
          '',
          'Existing summary.',
          '',
          '## Overview',
          '',
          'Aurelia is a royal astronomer.',
          '',
          '## Relationships',
          '',
          'Existing ally note.',
          ''
        ].join('\n')
      }
    ],
    callModel: async () => JSON.stringify({
      operations: [
        {
          pageKey: 'character/aurelia',
          title: 'Aurelia',
          updateMode: 'merge',
          summary: 'Royal astronomer with new court entanglements.',
          keywords: ['Aurelia', 'court'],
          aliases: [],
          content: [
            '## Overview',
            '',
            'She now advises the regent directly.',
            '',
            '## Timeline',
            '',
            'Recently elevated after the eclipse.'
          ].join('\n'),
          confidence: 0.91,
          rationale: 'Idea adds durable setting changes.'
        }
      ]
    })
  });

  assert.equal(result.pages.length, 1);
  const content = result.pages[0].content;
  assert.equal(countOccurrences(content, /^## Overview$/m), 1);
  assert.match(content, /Aurelia is a royal astronomer\./);
  assert.match(content, /She now advises the regent directly\./);
  assert.match(content, /## Relationships\n\nExisting ally note\./);
  assert.match(content, /## Timeline\n\nRecently elevated after the eclipse\./);
  assert.match(content, /## Summary\n\nRoyal astronomer with new court entanglements\./);
});

test('rewrite_focused replaces managed body for focused target notes', async () => {
  const result = await buildLoreDeltaPlan({
    ideaMarkdown: '# Idea\nRewrite Aurelia for cleaner structure.',
    newNoteFolder: 'wiki',
    defaultTagsRaw: 'wiki',
    lorebookScopes: ['world/main'],
    tagPrefix: 'lorebook',
    updatePolicy: 'rewrite_focused',
    allowCreateNotes: true,
    maxChunkChars: 500,
    maxOperationsPerChunk: 8,
    maxExistingPagesInPrompt: 20,
    focusedPagePaths: ['wiki/aurelia.md'],
    maxFocusedPagesInPrompt: 4,
    maxFocusedPageChars: 4000,
    lowConfidenceThreshold: 0.5,
    existingPages: [
      {
        path: 'wiki/aurelia.md',
        content: [
          '---',
          'title: "Aurelia"',
          'pageKey: "character/aurelia"',
          'mood: bright',
          '---',
          '',
          '## Summary',
          '',
          'Old summary.',
          '',
          '## Overview',
          '',
          'Old muddled text.',
          '',
          '## Relationships',
          '',
          'Outdated tie.',
          ''
        ].join('\n')
      }
    ],
    callModel: async () => JSON.stringify({
      operations: [
        {
          pageKey: 'character/aurelia',
          title: 'Aurelia',
          updateMode: 'rewrite',
          summary: 'Cleaned summary.',
          keywords: ['Aurelia', 'astronomer'],
          aliases: [],
          content: [
            '## Overview',
            '',
            'Aurelia serves as the realm\'s astronomer and court omens expert.',
            '',
            '## Relationships',
            '',
            'She reports directly to the regent.',
            '',
            '## Voice',
            '',
            'Measured, precise, and ceremonial.'
          ].join('\n'),
          confidence: 0.96,
          rationale: 'Explicit focused rewrite request.'
        }
      ]
    })
  });

  assert.equal(result.pages.length, 1);
  const content = result.pages[0].content;
  assert.match(content, /mood: bright/);
  assert.match(content, /Aurelia serves as the realm's astronomer/);
  assert.match(content, /## Voice\n\nMeasured, precise, and ceremonial\./);
  assert.equal(content.includes('Old muddled text.'), false);
  assert.equal(content.includes('Outdated tie.'), false);
});

test('rewrite requests for non-focused pages are downgraded to section merge', async () => {
  const result = await buildLoreDeltaPlan({
    ideaMarkdown: '# Idea\nRework Aurelia, but no focused note was selected.',
    newNoteFolder: 'wiki',
    defaultTagsRaw: 'wiki',
    lorebookScopes: ['world/main'],
    tagPrefix: 'lorebook',
    updatePolicy: 'rewrite_focused',
    allowCreateNotes: true,
    maxChunkChars: 500,
    maxOperationsPerChunk: 8,
    maxExistingPagesInPrompt: 20,
    focusedPagePaths: [],
    maxFocusedPagesInPrompt: 4,
    maxFocusedPageChars: 4000,
    lowConfidenceThreshold: 0.5,
    existingPages: [
      {
        path: 'wiki/aurelia.md',
        content: [
          '---',
          'title: "Aurelia"',
          'pageKey: "character/aurelia"',
          '---',
          '',
          '## Summary',
          '',
          'Old summary.',
          '',
          '## Overview',
          '',
          'Old overview.',
          '',
          '## Relationships',
          '',
          'Old relationship.',
          ''
        ].join('\n')
      }
    ],
    callModel: async () => JSON.stringify({
      operations: [
        {
          pageKey: 'character/aurelia',
          title: 'Aurelia',
          updateMode: 'rewrite',
          summary: 'New summary.',
          keywords: ['Aurelia'],
          aliases: [],
          content: [
            '## Overview',
            '',
            'Replacement overview text.'
          ].join('\n'),
          confidence: 0.88,
          rationale: 'Attempted rewrite without focused-note approval.'
        }
      ]
    })
  });

  assert.equal(result.pages.length, 1);
  const content = result.pages[0].content;
  assert.match(content, /Old overview\./);
  assert.match(content, /Replacement overview text\./);
  assert.match(content, /## Relationships\n\nOld relationship\./);
  assert.ok(result.warnings.some(warning => warning.includes('downgraded to section merge')));
});

test('lore delta skips create operations when new-note creation is disabled', async () => {
  const result = await buildLoreDeltaPlan({
    ideaMarkdown: '# Idea\nIntroduce the Moon Archive as a new concept.',
    newNoteFolder: 'wiki',
    defaultTagsRaw: 'wiki',
    lorebookScopes: ['world/main'],
    tagPrefix: 'lorebook',
    updatePolicy: 'section_merge',
    allowCreateNotes: false,
    maxChunkChars: 500,
    maxOperationsPerChunk: 8,
    maxExistingPagesInPrompt: 20,
    focusedPagePaths: [],
    maxFocusedPagesInPrompt: 4,
    maxFocusedPageChars: 2000,
    lowConfidenceThreshold: 0.5,
    existingPages: [],
    callModel: async () => JSON.stringify({
      operations: [
        {
          pageKey: 'location/moon-archive',
          title: 'Moon Archive',
          updateMode: 'merge',
          summary: 'A newly introduced archive.',
          keywords: ['Moon Archive'],
          aliases: [],
          content: '## Overview\n\nA sealed archive tied to eclipse rites.',
          confidence: 0.92,
          rationale: 'New durable concept.'
        }
      ]
    })
  });

  assert.equal(result.pages.length, 0);
  assert.ok(result.warnings.some(warning => warning.includes('new-note creation is disabled')));
});
