/**
 * Tests for the flushRefreshQueue race-condition fix and destroy() guard.
 *
 * LiveContextIndex cannot be imported directly (it imports Obsidian APIs), so these
 * tests validate the same algorithm using a minimal in-process stub that mirrors the
 * relevant logic.  They serve as regression coverage for two bugs fixed:
 *
 *  Bug 1 — Before the fix, when flushRefreshQueue() was called while a refresh was
 *  already in-flight it would await the in-flight promise and return early, silently
 *  dropping any changedPaths that had accumulated during that refresh.  Callers such
 *  as resolveScopePack would receive a "done" signal while the index was still stale.
 *
 *  Bug 2 — LiveContextIndex had no destroy() method, so its internal debounce timer
 *  would fire after the plugin was disabled, executing async work against a dead plugin.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Minimal queue stub mirroring LiveContextIndex.flushRefreshQueue
// ---------------------------------------------------------------------------

type FlushFn = (paths: Set<string>) => Promise<void>;

function makeQueue(onFlush: FlushFn): {
  task: { changedPaths: Set<string> };
  destroyed: boolean;
  destroy(): void;
  flush(): Promise<void>;
} {
  let refreshInFlight: Promise<void> | null = null;

  const q = {
    task: { changedPaths: new Set<string>() },
    destroyed: false,

    destroy() {
      q.destroyed = true;
    },

    async flush(): Promise<void> {
      if (refreshInFlight) {
        await refreshInFlight;
        if (q.task.changedPaths.size > 0 && !q.destroyed) {
          await q.flush();
        }
        return;
      }
      refreshInFlight = onFlush(q.task.changedPaths);
      q.task.changedPaths = new Set();
      try {
        await refreshInFlight;
      } finally {
        refreshInFlight = null;
      }
    }
  };
  return q;
}

/** Yield one macrotask turn so that async coroutines can advance. */
function nextTick(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('flush processes paths that arrive during an in-flight refresh', async () => {
  const batches: string[][] = [];
  let releaseInFlight!: () => void;
  let callCount = 0;

  const q = makeQueue(async (paths) => {
    batches.push([...paths].sort());
    if (callCount === 0) {
      // First call blocks until released by the test.
      await new Promise<void>(r => { releaseInFlight = r; });
    }
    callCount++;
  });

  // Start flush with path A — blocks inside onFlush.
  q.task.changedPaths.add('a.md');
  const firstDone = q.flush();

  await nextTick(); // let the coroutine reach its await

  // New change arrives while the first flush is still in-flight.
  q.task.changedPaths.add('b.md');

  // A second caller (e.g. resolveScopePack) calls flush; it should wait for
  // the in-flight refresh and then process b.md in a follow-up pass.
  const secondDone = q.flush();

  // Release the first flush.
  releaseInFlight();
  await firstDone;
  await secondDone;

  assert.equal(batches.length, 2, 'Both batches must be processed');
  assert.deepEqual(batches[0], ['a.md'], 'First batch: a.md');
  assert.deepEqual(batches[1], ['b.md'], 'b.md must not be silently dropped');
});

test('flush with no in-flight and empty queue runs onFlush once', async () => {
  const batches: string[][] = [];
  const q = makeQueue(async (paths) => { batches.push([...paths]); });

  await q.flush();

  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0], []);
});

test('concurrent flush calls serialise — no paths are lost', async () => {
  const order: string[] = [];
  const q = makeQueue(async (paths) => {
    order.push([...paths].sort().join(','));
  });

  q.task.changedPaths.add('x.md');
  const p1 = q.flush();

  q.task.changedPaths.add('y.md');
  const p2 = q.flush();

  await Promise.all([p1, p2]);

  assert.equal(order.length, 2);
  assert.equal(order[0], 'x.md');
  assert.equal(order[1], 'y.md');
});

test('destroy prevents accumulated paths from triggering a second flush', async () => {
  let callCount = 0;
  let releaseInFlight!: () => void;

  const q = makeQueue(async (_paths) => {
    callCount++;
    if (callCount === 1) {
      await new Promise<void>(r => { releaseInFlight = r; });
    }
  });

  // Start flush with path A.
  q.task.changedPaths.add('a.md');
  const firstDone = q.flush();

  await nextTick();

  // Path B arrives and destroy() is called while first flush is in-flight.
  q.task.changedPaths.add('b.md');
  q.destroy();

  // Second caller awaits flush — the re-entry for b.md must be suppressed.
  const secondDone = q.flush();

  releaseInFlight();
  await firstDone;
  await secondDone;

  assert.equal(callCount, 1, 'After destroy, accumulated paths must not trigger a second flush');
});
