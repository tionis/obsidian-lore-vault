import test from 'node:test';
import assert from 'node:assert/strict';
import { UsageLedgerEntry, UsageLedgerStore } from '../src/usage-ledger-store';

type MockFileRecord = {
  content: string;
  mtime: number;
};

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function getParentPath(filePath: string): string {
  const normalized = normalizePath(filePath);
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex > 0 ? normalized.slice(0, slashIndex) : '';
}

function createMockApp() {
  const files = new Map<string, MockFileRecord>();
  const directories = new Set<string>();
  let nextMtime = 1;
  let listCallCount = 0;

  function ensureDirectory(path: string): void {
    const normalized = normalizePath(path);
    if (!normalized) {
      return;
    }
    const parts = normalized.split('/');
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      directories.add(current);
    }
  }

  function setFile(path: string, content: string): void {
    const normalized = normalizePath(path);
    ensureDirectory(getParentPath(normalized));
    files.set(normalized, { content, mtime: nextMtime++ });
  }

  function deleteFile(path: string): void {
    files.delete(normalizePath(path));
  }

  const adapter = {
    exists: async (path: string) => {
      const normalized = normalizePath(path);
      return files.has(normalized) || directories.has(normalized);
    },
    read: async (path: string) => {
      const normalized = normalizePath(path);
      const file = files.get(normalized);
      if (!file) {
        throw new Error(`Missing file ${normalized}`);
      }
      return file.content;
    },
    write: async (path: string, content: string) => {
      setFile(path, content);
    },
    stat: async (path: string) => {
      const normalized = normalizePath(path);
      const file = files.get(normalized);
      if (file) {
        return {
          type: 'file',
          mtime: file.mtime
        };
      }
      if (directories.has(normalized)) {
        return {
          type: 'folder',
          mtime: 0
        };
      }
      return null;
    },
    list: async (path: string) => {
      listCallCount += 1;
      const normalized = normalizePath(path);
      const prefix = normalized ? `${normalized}/` : '';
      const folderEntries = [...directories]
        .filter(candidate => candidate.startsWith(prefix) && candidate !== normalized)
        .filter(candidate => !candidate.slice(prefix.length).includes('/'))
        .sort((left, right) => left.localeCompare(right));
      const fileEntries = [...files.keys()]
        .filter(candidate => candidate.startsWith(prefix))
        .filter(candidate => !candidate.slice(prefix.length).includes('/'))
        .sort((left, right) => left.localeCompare(right));
      return {
        folders: folderEntries,
        files: fileEntries
      };
    }
  };

  const vault = {
    adapter,
    getAbstractFileByPath: (path: string) => {
      const normalized = normalizePath(path);
      if (directories.has(normalized)) {
        return {
          path: normalized,
          children: []
        };
      }
      if (files.has(normalized)) {
        return {
          path: normalized
        };
      }
      return null;
    },
    createFolder: async (path: string) => {
      const normalized = normalizePath(path);
      if (files.has(normalized)) {
        throw new Error(`Expected folder at "${normalized}" but found a file.`);
      }
      ensureDirectory(normalized);
    }
  };

  return {
    app: { vault } as any,
    files,
    setFile,
    deleteFile,
    getListCallCount: () => listCallCount
  };
}

function buildEntry(overrides: Partial<Omit<UsageLedgerEntry, 'id'>>): Omit<UsageLedgerEntry, 'id'> {
  return {
    timestamp: 0,
    operation: 'story_chat_turn',
    provider: 'openrouter',
    model: 'model-a',
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    reportedCostUsd: null,
    estimatedCostUsd: 0.001,
    costSource: 'estimated',
    pricingSource: 'default_rates',
    inputCostPerMillionUsd: 1,
    outputCostPerMillionUsd: 2,
    pricingRule: 'settings.default_rates',
    pricingSnapshotAt: 1700000000000,
    metadata: {},
    ...overrides
  };
}

function buildCanonicalRecordPath(ledgerPath: string, entry: UsageLedgerEntry): string {
  const root = normalizePath(ledgerPath).replace(/\.json$/i, '');
  const date = new Date(entry.timestamp);
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${root}/${year}/${month}/${day}/${entry.timestamp}-${entry.id}.json`;
}

function buildCanonicalRecordContent(entry: UsageLedgerEntry): string {
  return JSON.stringify({
    schemaVersion: 1,
    entry
  });
}

function createMockInternalDbClient() {
  const dbEntries = new Map<string, UsageLedgerEntry>();
  const importedBatches: Array<{ sourceRoot: string; entries: UsageLedgerEntry[] }> = [];
  const replacedBatches: Array<{ sourceRoot: string; entries: UsageLedgerEntry[] }> = [];

  return {
    dbEntries,
    importedBatches,
    replacedBatches,
    client: {
      initialize: async () => ({
        available: true,
        backend: 'idb' as const,
        backendLabel: 'IndexedDB',
        sqliteVersion: 'test',
        storagePersisted: true,
        errorMessage: ''
      }),
      importUsageLedgerEntries: async (sourceRoot: string, entries: UsageLedgerEntry[]) => {
        importedBatches.push({
          sourceRoot,
          entries: entries.map(entry => ({
            ...entry,
            metadata: { ...entry.metadata }
          }))
        });
        for (const entry of entries) {
          dbEntries.set(entry.id, {
            ...entry,
            metadata: { ...entry.metadata }
          });
        }
      },
      replaceUsageLedgerEntries: async (sourceRoot: string, entries: UsageLedgerEntry[]) => {
        replacedBatches.push({
          sourceRoot,
          entries: entries.map(entry => ({
            ...entry,
            metadata: { ...entry.metadata }
          }))
        });
        dbEntries.clear();
        for (const entry of entries) {
          dbEntries.set(entry.id, {
            ...entry,
            metadata: { ...entry.metadata }
          });
        }
      },
      queryUsageLedger: async (request: { sourceRoot: string; costProfile?: string | null }) => {
        return {
          entries: [...dbEntries.values()]
            .filter(entry => !request.costProfile || entry.metadata.costProfile === request.costProfile)
            .sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id))
        };
      },
      listUsageLedgerCostProfiles: async (_sourceRoot: string) => ({
        profiles: [...new Set(
          [...dbEntries.values()]
            .map(entry => typeof entry.metadata.costProfile === 'string' ? entry.metadata.costProfile : '')
            .filter(Boolean)
        )].sort((left, right) => left.localeCompare(right))
      }),
      appendUsageLedgerEntry: async (_sourceRoot: string, entry: UsageLedgerEntry) => {
        dbEntries.set(entry.id, {
          ...entry,
          metadata: { ...entry.metadata }
        });
      }
    }
  };
}

test('UsageLedgerStore writes immutable canonical record files and returns sorted entries', async () => {
  const { app, files } = createMockApp();
  const ledgerPath = '.obsidian/plugins/lore-vault/cache/usage-ledger.json';
  const store = new UsageLedgerStore(app, ledgerPath);

  await store.append(buildEntry({
    timestamp: 200,
    operation: 'story_chat_turn',
    metadata: {
      costProfile: 'beta',
      scopeCount: 2
    }
  }));
  await store.append(buildEntry({
    timestamp: 100,
    operation: 'summary_world_info',
    reportedCostUsd: 0.0002,
    estimatedCostUsd: 0.0002,
    costSource: 'provider_reported',
    pricingSource: 'provider_reported',
    inputCostPerMillionUsd: null,
    outputCostPerMillionUsd: null,
    pricingRule: null,
    pricingSnapshotAt: null,
    metadata: {
      costProfile: 'alpha',
      notePath: 'notes/a.md'
    }
  }));

  assert.equal(files.has(normalizePath(ledgerPath)), false);
  const canonicalFiles = [...files.keys()].filter(path =>
    path.startsWith('.obsidian/plugins/lore-vault/cache/usage-ledger/')
  );
  assert.equal(canonicalFiles.length, 2);

  const entries = await store.listEntries();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].timestamp, 100);
  assert.equal(entries[1].timestamp, 200);
  assert.equal(entries[0].operation, 'summary_world_info');
  assert.equal(entries[1].operation, 'story_chat_turn');

  const record = JSON.parse(files.get(canonicalFiles[0])?.content ?? '{}') as {
    schemaVersion?: number;
    entry?: UsageLedgerEntry;
  };
  assert.equal(record.schemaVersion, 1);
  assert.ok(record.entry?.id);
});

test('UsageLedgerStore migrates legacy JSON ledger entries into canonical record files', async () => {
  const { app, files, setFile } = createMockApp();
  const ledgerPath = '.obsidian/plugins/lore-vault/cache/usage-ledger.json';
  setFile(ledgerPath, JSON.stringify({
    schemaVersion: 1,
    entries: [
      {
        id: 'legacy-b',
        ...buildEntry({
          timestamp: 200,
          operation: 'story_chat_turn',
          metadata: {
            costProfile: 'beta'
          }
        })
      },
      {
        id: 'legacy-a',
        ...buildEntry({
          timestamp: 100,
          operation: 'summary_world_info',
          metadata: {
            costProfile: 'alpha'
          }
        })
      }
    ]
  }));

  const store = new UsageLedgerStore(app, ledgerPath);
  await store.initialize();

  const canonicalFiles = [...files.keys()].filter(path =>
    path.startsWith('.obsidian/plugins/lore-vault/cache/usage-ledger/')
  );
  assert.equal(canonicalFiles.length, 2);

  const entries = await store.listEntries();
  assert.deepEqual(
    entries.map(entry => entry.id),
    ['legacy-a', 'legacy-b']
  );
});

test('UsageLedgerStore imports legacy JSON entries into the internal DB on initialize', async () => {
  const { app, setFile } = createMockApp();
  const ledgerPath = '.obsidian/plugins/lore-vault/cache/usage-ledger.json';
  setFile(ledgerPath, JSON.stringify({
    schemaVersion: 1,
    entries: [
      {
        id: 'legacy-b',
        ...buildEntry({
          timestamp: 200,
          operation: 'story_chat_turn',
          metadata: {
            costProfile: 'beta'
          }
        })
      },
      {
        id: 'legacy-a',
        ...buildEntry({
          timestamp: 100,
          operation: 'summary_world_info',
          metadata: {
            costProfile: 'alpha'
          }
        })
      }
    ]
  }));

  const internalDb = createMockInternalDbClient();

  const store = new UsageLedgerStore(app, ledgerPath, {
    internalDbClient: internalDb.client as any
  });
  await store.initialize();

  assert.equal(internalDb.replacedBatches.length, 1);
  assert.equal(internalDb.replacedBatches[0].sourceRoot, '.obsidian/plugins/lore-vault/cache/usage-ledger');
  assert.deepEqual(
    internalDb.replacedBatches[0].entries.map(entry => entry.id),
    ['legacy-a', 'legacy-b']
  );

  const entries = await store.listEntries();
  assert.deepEqual(
    entries.map(entry => entry.id),
    ['legacy-a', 'legacy-b']
  );
});

test('UsageLedgerStore avoids repeated canonical tree scans for repeated internal DB queries', async () => {
  const { app, getListCallCount } = createMockApp();
  const ledgerPath = '.obsidian/plugins/lore-vault/cache/usage-ledger.json';
  const seedStore = new UsageLedgerStore(app, ledgerPath);
  await seedStore.append({
    id: 'alpha-entry',
    ...buildEntry({
      timestamp: 100,
      metadata: {
        costProfile: 'alpha'
      }
    })
  } as UsageLedgerEntry);
  await seedStore.append({
    id: 'beta-entry',
    ...buildEntry({
      timestamp: 200,
      metadata: {
        costProfile: 'beta'
      }
    })
  } as UsageLedgerEntry);

  const internalDb = createMockInternalDbClient();
  const store = new UsageLedgerStore(app, ledgerPath, {
    internalDbClient: internalDb.client as any
  });
  await store.initialize();

  const listCallsAfterInitialize = getListCallCount();
  assert.equal(internalDb.replacedBatches.length, 1);

  const entries = await store.listEntries();
  const profiles = await store.listKnownCostProfiles();

  assert.deepEqual(
    entries.map(entry => entry.id),
    ['alpha-entry', 'beta-entry']
  );
  assert.deepEqual(profiles, ['alpha', 'beta']);
  assert.equal(getListCallCount(), listCallsAfterInitialize);
});

test('UsageLedgerStore incrementally imports created canonical record files without a full rescan', async () => {
  const { app, setFile, getListCallCount } = createMockApp();
  const ledgerPath = '.obsidian/plugins/lore-vault/cache/usage-ledger.json';
  const seedStore = new UsageLedgerStore(app, ledgerPath);
  await seedStore.append({
    id: 'alpha-entry',
    ...buildEntry({
      timestamp: 100,
      metadata: {
        costProfile: 'alpha'
      }
    })
  } as UsageLedgerEntry);

  const internalDb = createMockInternalDbClient();
  const store = new UsageLedgerStore(app, ledgerPath, {
    internalDbClient: internalDb.client as any
  });
  await store.initialize();

  const listCallsAfterInitialize = getListCallCount();
  const importedBatchCount = internalDb.importedBatches.length;

  const externalEntry: UsageLedgerEntry = {
    id: 'external-entry',
    ...buildEntry({
      timestamp: 300,
      metadata: {
        costProfile: 'gamma'
      }
    })
  };
  const externalPath = buildCanonicalRecordPath(ledgerPath, externalEntry);
  setFile(externalPath, buildCanonicalRecordContent(externalEntry));

  assert.equal(store.handleVaultCreate(externalPath), true);

  const entries = await store.listEntries();
  assert.deepEqual(
    entries.map(entry => entry.id),
    ['alpha-entry', 'external-entry']
  );
  assert.equal(getListCallCount(), listCallsAfterInitialize);
  assert.equal(internalDb.importedBatches.length, importedBatchCount + 1);
  const lastImportedBatch = internalDb.importedBatches[internalDb.importedBatches.length - 1];
  assert.deepEqual(
    lastImportedBatch?.entries.map((entry: UsageLedgerEntry) => entry.id),
    ['external-entry']
  );
});

test('UsageLedgerStore replaces internal DB rows after canonical record deletion', async () => {
  const { app, deleteFile, getListCallCount } = createMockApp();
  const ledgerPath = '.obsidian/plugins/lore-vault/cache/usage-ledger.json';
  const seedStore = new UsageLedgerStore(app, ledgerPath);
  const alphaEntry: UsageLedgerEntry = {
    id: 'alpha-entry',
    ...buildEntry({
      timestamp: 100,
      metadata: {
        costProfile: 'alpha'
      }
    })
  };
  const betaEntry: UsageLedgerEntry = {
    id: 'beta-entry',
    ...buildEntry({
      timestamp: 200,
      metadata: {
        costProfile: 'beta'
      }
    })
  };
  await seedStore.append(alphaEntry);
  await seedStore.append(betaEntry);

  const internalDb = createMockInternalDbClient();
  const store = new UsageLedgerStore(app, ledgerPath, {
    internalDbClient: internalDb.client as any
  });
  await store.initialize();

  const listCallsAfterInitialize = getListCallCount();
  const alphaPath = buildCanonicalRecordPath(ledgerPath, alphaEntry);
  deleteFile(alphaPath);

  assert.equal(store.handleVaultDelete(alphaPath), true);

  const entries = await store.listEntries();
  assert.deepEqual(
    entries.map(entry => entry.id),
    ['beta-entry']
  );
  assert.ok(getListCallCount() > listCallsAfterInitialize);
  assert.equal(internalDb.replacedBatches.length, 2);
});

test('UsageLedgerStore lists known cost profiles deterministically', async () => {
  const { app } = createMockApp();
  const ledgerPath = '.obsidian/plugins/lore-vault/cache/usage-ledger.json';
  const store = new UsageLedgerStore(app, ledgerPath);

  await store.append(buildEntry({
    timestamp: 100,
    metadata: {
      costProfile: 'zeta'
    }
  }));
  await store.append(buildEntry({
    timestamp: 200,
    metadata: {
      costProfile: 'alpha'
    }
  }));
  await store.append(buildEntry({
    timestamp: 300,
    metadata: {}
  }));
  await store.append(buildEntry({
    timestamp: 400,
    metadata: {
      costProfile: 'alpha'
    }
  }));

  const profiles = await store.listKnownCostProfiles();
  assert.deepEqual(profiles, ['alpha', 'zeta']);

  const filtered = await store.listEntries({ costProfile: 'alpha' });
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every(entry => entry.metadata.costProfile === 'alpha'));
});
