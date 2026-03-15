import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationMessage } from '../src/story-chat-document';
import { applyStoryChatAssistantFailure } from '../src/story-chat-message-state';

test('applyStoryChatAssistantFailure keeps a retryable placeholder for empty failed new turns', () => {
  const messages: ConversationMessage[] = [
    {
      id: 'user-1',
      role: 'user',
      createdAt: 1,
      activeVersionId: 'ver-user-1',
      versions: [
        {
          id: 'ver-user-1',
          content: 'What happens next?',
          createdAt: 1
        }
      ]
    },
    {
      id: 'assistant-1',
      role: 'assistant',
      createdAt: 2,
      activeVersionId: 'ver-assistant-1',
      versions: [
        {
          id: 'ver-assistant-1',
          content: '',
          createdAt: 2
        }
      ]
    }
  ];

  const next = applyStoryChatAssistantFailure({
    messages,
    assistantMessageId: 'assistant-1',
    failedVersionId: 'ver-assistant-1',
    previousActiveVersionId: '',
    createdNewMessage: true,
    stopRequested: false,
    errorMessage: 'Completion provider returned empty output.'
  });

  assert.equal(next.length, 2);
  assert.equal(next[1].versions.length, 1);
  assert.equal(next[1].activeVersionId, 'ver-assistant-1');
  assert.equal(next[1].versions[0].content, '');
  assert.equal(next[1].versions[0].status, 'error');
  assert.equal(next[1].versions[0].errorMessage, 'Completion provider returned empty output.');
});

test('applyStoryChatAssistantFailure restores the prior assistant version for failed regenerations', () => {
  const messages: ConversationMessage[] = [
    {
      id: 'assistant-1',
      role: 'assistant',
      createdAt: 2,
      activeVersionId: 'ver-new',
      versions: [
        {
          id: 'ver-old',
          content: 'Original reply.',
          createdAt: 2
        },
        {
          id: 'ver-new',
          content: '',
          createdAt: 3
        }
      ]
    }
  ];

  const next = applyStoryChatAssistantFailure({
    messages,
    assistantMessageId: 'assistant-1',
    failedVersionId: 'ver-new',
    previousActiveVersionId: 'ver-old',
    createdNewMessage: false,
    stopRequested: false,
    errorMessage: 'network timeout'
  });

  assert.equal(next.length, 1);
  assert.equal(next[0].versions.length, 1);
  assert.equal(next[0].versions[0].id, 'ver-old');
  assert.equal(next[0].activeVersionId, 'ver-old');
});
