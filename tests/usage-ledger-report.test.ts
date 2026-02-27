import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUsageLedgerReportSnapshot,
  serializeUsageLedgerEntriesCsv
} from '../src/usage-ledger-report';
import { UsageLedgerEntry } from '../src/usage-ledger-store';

function entry(overrides: Partial<UsageLedgerEntry>): UsageLedgerEntry {
  return {
    id: 'id-1',
    timestamp: Date.UTC(2026, 1, 27, 12, 0, 0),
    operation: 'story_chat_turn',
    provider: 'openrouter',
    model: 'model-a',
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    reportedCostUsd: null,
    estimatedCostUsd: 0.001,
    costSource: 'estimated',
    metadata: {},
    ...overrides
  };
}

test('buildUsageLedgerReportSnapshot aggregates totals deterministically', () => {
  const nowMs = Date.UTC(2026, 1, 27, 20, 0, 0);
  const entries: UsageLedgerEntry[] = [
    entry({
      id: 'a',
      timestamp: Date.UTC(2026, 1, 27, 10, 0, 0),
      operation: 'summary_world_info',
      totalTokens: 40,
      promptTokens: 30,
      completionTokens: 10,
      estimatedCostUsd: 0.0005
    }),
    entry({
      id: 'b',
      timestamp: Date.UTC(2026, 1, 27, 11, 0, 0),
      operation: 'story_chat_turn',
      totalTokens: 200,
      promptTokens: 130,
      completionTokens: 70,
      estimatedCostUsd: null,
      reportedCostUsd: null,
      costSource: 'unknown'
    }),
    entry({
      id: 'c',
      timestamp: Date.UTC(2026, 1, 26, 22, 0, 0),
      operation: 'editor_continuation',
      totalTokens: 300,
      promptTokens: 180,
      completionTokens: 120,
      estimatedCostUsd: 0.004
    })
  ];

  const snapshot = buildUsageLedgerReportSnapshot(entries, {
    nowMs,
    sessionStartAt: Date.UTC(2026, 1, 27, 9, 0, 0),
    dailyBudgetUsd: 0.0004,
    sessionBudgetUsd: 0.0004
  });

  assert.equal(snapshot.totals.project.requests, 3);
  assert.equal(snapshot.totals.project.totalTokens, 540);
  assert.equal(snapshot.totals.project.costUsdKnown, 0.0045000000000000005);
  assert.equal(snapshot.totals.project.unknownCostCount, 1);

  assert.equal(snapshot.totals.day.requests, 2);
  assert.equal(snapshot.totals.day.totalTokens, 240);
  assert.equal(snapshot.totals.day.costUsdKnown, 0.0005);
  assert.equal(snapshot.totals.day.unknownCostCount, 1);

  assert.equal(snapshot.totals.session.requests, 2);
  assert.equal(snapshot.totals.session.totalTokens, 240);
  assert.equal(snapshot.totals.session.costUsdKnown, 0.0005);
  assert.equal(snapshot.totals.session.unknownCostCount, 1);

  assert.equal(snapshot.byOperation[0].key, 'editor_continuation');
  assert.equal(snapshot.byModel[0].key, 'openrouter:model-a');
  assert.ok(snapshot.warnings.some(item => item.includes('Daily known cost')));
  assert.ok(snapshot.warnings.some(item => item.includes('Session known cost')));
  assert.ok(snapshot.warnings.some(item => item.includes('unknown cost')));
});

test('serializeUsageLedgerEntriesCsv writes stable sorted rows', () => {
  const csv = serializeUsageLedgerEntriesCsv([
    entry({
      id: 'b',
      timestamp: Date.UTC(2026, 1, 27, 12, 0, 0),
      metadata: { z: 1, a: 'two' }
    }),
    entry({
      id: 'a',
      timestamp: Date.UTC(2026, 1, 27, 11, 0, 0),
      operation: 'summary_world_info'
    })
  ]);

  const lines = csv.split('\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes('timestamp_iso'));
  assert.ok(lines[1].includes(',summary_world_info,'));
  assert.ok(lines[2].includes(',story_chat_turn,'));
});
