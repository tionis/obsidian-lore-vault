import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOperationLogJsonl } from '../src/operation-log';

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
  assert.equal(parsed.entries[1].record.id, 'op-1');
  assert.equal(parsed.entries[0].searchText.includes('second'), true);
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
