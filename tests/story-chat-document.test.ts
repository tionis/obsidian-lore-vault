import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_SCHEMA_VERSION,
  ConversationDocument,
  normalizeConversationDocument,
  parseConversationMarkdown,
  serializeConversationMarkdown
} from '../src/story-chat-document';

test('normalizeConversationDocument sanitizes malformed conversation payloads', () => {
  let counter = 0;
  const createId = (prefix: string): string => `${prefix}-${++counter}`;
  const now = () => 1700000000000;

  const normalized = normalizeConversationDocument({
    schemaVersion: 'bad',
    title: '  Test Chat  ',
    selectedScopes: ['universe', 'universe', 'world/a'],
    steeringScopeRefs: ['story:chronicles-main', 'Characters/Alice', 'note:Characters/Alice'],
    noteContextRefs: ['Characters/Alice', '', 'Characters/Alice'],
    messages: [
      {
        role: 'assistant',
        content: 42
      },
      {
        role: 'invalid'
      },
      {
        role: 'user',
        versions: [
          {
            content: 'Hello',
            contextMeta: {
              usedLorebookContext: true,
              usedManualContext: 'yes',
              usedSpecificNotesContext: 1,
              scopes: ['scope/a'],
              specificNotePaths: ['notes/a.md'],
              unresolvedNoteRefs: ['unknown'],
              contextTokens: '22',
              worldInfoCount: '2',
              ragCount: '3',
              worldInfoItems: ['Entry A'],
              ragItems: ['Doc B']
            }
          }
        ]
      }
    ]
  }, 'Fallback Chat', createId, now);

  assert.equal(normalized.schemaVersion, CHAT_SCHEMA_VERSION);
  assert.equal(normalized.title, 'Test Chat');
  assert.deepEqual(normalized.selectedScopes, ['universe', 'world/a']);
  assert.deepEqual(normalized.noteContextRefs, ['Characters/Alice']);
  assert.deepEqual(normalized.steeringScopeRefs, ['story:chronicles-main', 'note:Characters/Alice']);
  assert.equal(normalized.pinnedInstructions, '');
  assert.equal(normalized.storyNotes, '');
  assert.equal(normalized.sceneIntent, '');
  assert.deepEqual(normalized.continuityPlotThreads, []);
  assert.deepEqual(normalized.continuityOpenLoops, []);
  assert.deepEqual(normalized.continuityCanonDeltas, []);
  assert.deepEqual(normalized.continuitySelection, {
    includePlotThreads: true,
    includeOpenLoops: true,
    includeCanonDeltas: true
  });
  assert.equal(normalized.messages.length, 2);
  assert.equal(normalized.messages[0].role, 'assistant');
  assert.equal(normalized.messages[0].versions[0].content, '42');
  assert.equal(normalized.messages[1].role, 'user');
  assert.equal(normalized.messages[1].versions[0].content, 'Hello');
  assert.equal(normalized.messages[1].versions[0].contextMeta?.contextTokens, 22);
  assert.equal(normalized.messages[1].versions[0].contextMeta?.worldInfoCount, 2);
  assert.equal(normalized.messages[1].versions[0].contextMeta?.ragCount, 3);
});

test('serializeConversationMarkdown and parseConversationMarkdown round-trip conversation state', () => {
  const document: ConversationDocument = {
    schemaVersion: CHAT_SCHEMA_VERSION,
    id: 'conv-1',
    title: 'Story Chat',
    createdAt: 1700000000000,
    updatedAt: 1700000100000,
    selectedScopes: ['universe/core'],
    useLorebookContext: true,
    manualContext: 'Manual context',
    steeringScopeRefs: ['note:stories/ch01.md', 'story:chronicles-main'],
    pinnedInstructions: 'Keep the narration in close third person.',
    storyNotes: 'Avoid sudden POV shifts.',
    sceneIntent: 'Escalate conflict before chapter close.',
    continuityPlotThreads: ['Recover the relic', 'Secure alliance with House Ryn'],
    continuityOpenLoops: ['Who leaked the route?'],
    continuityCanonDeltas: ['Aerin learned void-step'],
    continuitySelection: {
      includePlotThreads: true,
      includeOpenLoops: true,
      includeCanonDeltas: true
    },
    noteContextRefs: ['Characters/Alice'],
    messages: [
      {
        id: 'user-1',
        role: 'user',
        createdAt: 1700000001000,
        activeVersionId: 'ver-1',
        versions: [
          {
            id: 'ver-1',
            content: 'How does this scene end?',
            createdAt: 1700000001000
          }
        ]
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: 1700000002000,
        activeVersionId: 'ver-2',
        versions: [
          {
            id: 'ver-2',
            content: 'The team departs at dawn.',
            createdAt: 1700000002000,
            contextMeta: {
              usedLorebookContext: true,
              usedManualContext: false,
              usedSpecificNotesContext: true,
              usedChapterMemoryContext: false,
              usedInlineDirectives: false,
              usedContinuityState: true,
              scopes: ['universe/core'],
              steeringSourceRefs: [],
              steeringSourceScopes: [],
              unresolvedSteeringSourceRefs: [],
              specificNotePaths: ['Characters/Alice.md'],
              unresolvedNoteRefs: [],
              chapterMemoryItems: [],
              inlineDirectiveItems: [],
              continuityPlotThreads: ['Recover the relic'],
              continuityOpenLoops: ['Who leaked the route?'],
              continuityCanonDeltas: ['Aerin learned void-step'],
              continuitySelection: {
                includePlotThreads: true,
                includeOpenLoops: true,
                includeCanonDeltas: true
              },
              layerTrace: [],
              layerUsage: [
                {
                  layer: 'Steering (system)',
                  placement: 'system',
                  reservedTokens: 120,
                  usedTokens: 62,
                  headroomTokens: 58,
                  trimmed: false
                }
              ],
              overflowTrace: [],
              chatToolTrace: [],
              chatToolCalls: [],
              chatToolWrites: [],
              contextTokens: 320,
              worldInfoCount: 4,
              ragCount: 1,
              worldInfoItems: ['Alice', 'Bob'],
              ragItems: ['Chapter Notes']
            }
          }
        ]
      }
    ]
  };

  const markdown = serializeConversationMarkdown(document);
  const parsed = parseConversationMarkdown(markdown, 'Fallback');

  assert.ok(parsed);
  assert.equal(parsed?.id, document.id);
  assert.equal(parsed?.title, document.title);
  assert.equal(parsed?.messages.length, document.messages.length);
  assert.equal(parsed?.messages[0].versions[0].content, document.messages[0].versions[0].content);
  assert.deepEqual(parsed?.messages[1].versions[0].contextMeta, document.messages[1].versions[0].contextMeta);
});

test('parseConversationMarkdown returns null when payload block is missing', () => {
  const parsed = parseConversationMarkdown('# No payload here', 'Fallback');
  assert.equal(parsed, null);
});
