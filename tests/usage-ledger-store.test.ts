import test from 'node:test';
import assert from 'node:assert/strict';
import { UsageLedgerStore } from '../src/usage-ledger-store';

function createMockApp() {
  const files = new Map<string, string>();
  const directories = new Set<string>();

  const adapter = {
    exists: async (path: string) => files.has(path) || directories.has(path),
    mkdir: async (path: string) => {
      directories.add(path);
    },
    read: async (path: string) => {
      const value = files.get(path);
      if (value === undefined) {
        throw new Error(`Missing file ${path}`);
      }
      return value;
    },
    write: async (path: string, content: string) => {
      files.set(path, content);
    }
  };

  return {
    app: {
      vault: {
        adapter
      }
    } as any,
    files
  };
}

test('UsageLedgerStore appends deterministic sorted entries', async () => {
  const { app, files } = createMockApp();
  const ledgerPath = '.obsidian/plugins/lore-vault/cache/usage-ledger.json';
  const store = new UsageLedgerStore(app, ledgerPath);
  await store.initialize();

  await store.append({
    timestamp: 200,
    operation: 'story_chat_turn',
    provider: 'openrouter',
    model: 'model-a',
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    reportedCostUsd: null,
    estimatedCostUsd: 0.001,
    costSource: 'estimated',
    metadata: {
      scopeCount: 2
    }
  });

  await store.append({
    timestamp: 100,
    operation: 'summary_world_info',
    provider: 'openrouter',
    model: 'model-a',
    promptTokens: 40,
    completionTokens: 12,
    totalTokens: 52,
    reportedCostUsd: 0.0002,
    estimatedCostUsd: 0.0002,
    costSource: 'provider_reported',
    metadata: {
      notePath: 'notes/a.md'
    }
  });

  const raw = files.get(ledgerPath);
  assert.ok(raw);
  const payload = JSON.parse(raw ?? '{}');
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.entries.length, 2);
  assert.equal(payload.entries[0].timestamp, 100);
  assert.equal(payload.entries[1].timestamp, 200);
  assert.equal(payload.entries[0].operation, 'summary_world_info');
  assert.equal(payload.entries[1].operation, 'story_chat_turn');
});
