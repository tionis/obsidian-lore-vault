import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOperationLogJsonl, summarizeOperationLogRecord } from '../src/operation-log';
import {
  buildOperationLogSearchText,
  tokenizeOperationLogSearchQuery
} from '../src/operation-log-utils';

test('parseOperationLogJsonl parses entries and sorts by start time descending', () => {
  const raw = [
    JSON.stringify({
      id: 'op-1',
      kind: 'completion',
      operationName: 'first',
      provider: 'openrouter',
      model: 'model-a',
      endpoint: 'https://example.test',
      startedAt: 100,
      finishedAt: 140,
      durationMs: 40,
      status: 'ok',
      aborted: false,
      request: { messages: [] },
      attempts: []
    }),
    JSON.stringify({
      id: 'op-2',
      costProfile: 'writer-a',
      kind: 'tool_planner',
      operationName: 'second',
      provider: 'openrouter',
      model: 'model-b',
      endpoint: 'https://example.test',
      startedAt: 240,
      finishedAt: 300,
      durationMs: 60,
      status: 'error',
      aborted: false,
      request: { messages: [] },
      attempts: [],
      error: 'request failed'
    })
  ].join('\n');

  const parsed = parseOperationLogJsonl(raw);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.entries[0].record.id, 'op-2');
  assert.equal(parsed.entries[0].record.costProfile, 'writer-a');
  assert.equal(parsed.entries[1].record.id, 'op-1');
  assert.equal(parsed.entries[0].searchText.includes('second'), true);
  assert.equal(parsed.entries[0].searchText.includes('writer-a'), true);
  assert.equal(parsed.entries[0].searchText.includes('request failed'), true);
});

test('parseOperationLogJsonl reports malformed and non-object lines', () => {
  const raw = [
    '{"id":"ok","kind":"completion","operationName":"x","provider":"openrouter","model":"m","endpoint":"e","startedAt":1,"finishedAt":1,"durationMs":0,"status":"ok","aborted":false,"request":{},"attempts":[]}',
    'not-json',
    '"string line"'
  ].join('\n');

  const parsed = parseOperationLogJsonl(raw);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.issues.length, 2);
  assert.equal(parsed.issues[0].lineNumber, 2);
  assert.equal(parsed.issues[1].lineNumber, 3);
});

test('parseOperationLogJsonl coerces partial records safely', () => {
  const raw = JSON.stringify({
    id: 'op-partial',
    kind: 'unknown_kind',
    operationName: 123,
    provider: 'unknown',
    model: 777,
    endpoint: null,
    startedAt: '9',
    finishedAt: '15',
    status: 'bad',
    aborted: 'yes',
    request: 'prompt text',
    attempts: [{ index: '2', url: 44, requestBody: { foo: 'bar' } }],
    usage: { provider: 'openrouter', model: 'm', promptTokens: '8', completionTokens: 1, totalTokens: 9, source: 'openai_usage' }
  });

  const parsed = parseOperationLogJsonl(raw);
  assert.equal(parsed.entries.length, 1);
  const entry = parsed.entries[0].record;
  assert.equal(entry.kind, 'completion');
  assert.equal(entry.operationName, '123');
  assert.equal(entry.provider, 'openrouter');
  assert.equal(entry.model, '777');
  assert.equal(entry.status, 'ok');
  assert.equal(entry.aborted, false);
  assert.deepEqual(entry.request, { value: 'prompt text' });
  assert.equal(entry.attempts[0].index, 2);
  assert.equal(entry.attempts[0].url, '44');
  assert.equal(entry.usage?.promptTokens, 8);
});

test('parseOperationLogJsonl keeps embedding kind records', () => {
  const raw = JSON.stringify({
    id: 'op-embedding',
    kind: 'embedding',
    operationName: 'embeddings_embed_query',
    provider: 'openrouter',
    model: 'qwen/qwen3-embedding-8b',
    endpoint: 'https://example.test/embeddings',
    startedAt: 20,
    finishedAt: 26,
    durationMs: 6,
    status: 'ok',
    aborted: false,
    request: { textCount: 1 },
    attempts: [{ index: 1, url: 'https://example.test/embeddings', requestBody: { model: 'm', input: ['x'] } }]
  });

  const parsed = parseOperationLogJsonl(raw);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].record.kind, 'embedding');
});

test('buildOperationLogSearchText includes core searchable payload fields', () => {
  const searchText = buildOperationLogSearchText({
    id: 'op-search',
    costProfile: 'Writer A',
    kind: 'completion',
    operationName: 'story_chat_turn',
    provider: 'openrouter',
    model: 'openai/gpt-test',
    endpoint: 'https://example.test/chat',
    startedAt: 1,
    finishedAt: 2,
    durationMs: 1,
    status: 'error',
    aborted: false,
    error: 'timeout while streaming',
    request: {
      messages: [{ role: 'user', content: 'Describe the city gates.' }]
    },
    attempts: [],
    finalText: 'The gates stood open.'
  });

  assert.equal(searchText.includes('writer a'), true);
  assert.equal(searchText.includes('story_chat_turn'), true);
  assert.equal(searchText.includes('timeout while streaming'), true);
  assert.equal(searchText.includes('describe the city gates'), true);
  assert.equal(searchText.includes('the gates stood open'), true);
});

test('summarizeOperationLogRecord strips heavy payload fields while keeping scan metadata', () => {
  const summary = summarizeOperationLogRecord({
    id: 'op-summary',
    costProfile: 'writer-a',
    kind: 'completion',
    operationName: 'story_chat_turn',
    provider: 'openrouter',
    model: 'openai/gpt-test',
    endpoint: 'https://example.test/chat',
    startedAt: 10,
    finishedAt: 25,
    durationMs: 15,
    status: 'error',
    aborted: true,
    error: 'timeout',
    request: { messages: [{ role: 'user', content: 'hello' }] },
    attempts: [{ index: 0, url: 'https://example.test/chat', requestBody: { model: 'm' } }],
    finalText: 'hello',
    usage: {
      provider: 'openrouter',
      model: 'openai/gpt-test',
      promptTokens: 10,
      completionTokens: 4,
      totalTokens: 14,
      reportedCostUsd: 0.1,
      source: 'openai_usage',
      cachedReadTokens: 0,
      cacheWriteTokens: 0
    }
  });

  assert.deepEqual(summary, {
    id: 'op-summary',
    costProfile: 'writer-a',
    kind: 'completion',
    operationName: 'story_chat_turn',
    provider: 'openrouter',
    model: 'openai/gpt-test',
    endpoint: 'https://example.test/chat',
    startedAt: 10,
    finishedAt: 25,
    durationMs: 15,
    status: 'error',
    aborted: true,
    error: 'timeout'
  });
});

test('tokenizeOperationLogSearchQuery lowercases and splits whitespace', () => {
  assert.deepEqual(
    tokenizeOperationLogSearchQuery('  Story   Gates TIMEOUT  '),
    ['story', 'gates', 'timeout']
  );
});
