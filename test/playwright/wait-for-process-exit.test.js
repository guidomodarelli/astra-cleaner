import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeQueryTimeoutMs,
  selectStillRunningProcessIds,
  waitForProcessExit,
} from "../../src/playwright/wait-for-process-exit.js";

const STARTED_AT_MS = 5_000;

/** Fake clock whose sleeps advance time instantly. */
function createClock() {
  let nowMs = 0;
  /** @type {number[]} */
  const sleeps = [];
  return {
    sleeps,
    now: () => nowMs,
    /** @param {number} durationMs */
    sleep: async (durationMs) => {
      sleeps.push(durationMs);
      nowMs += durationMs;
    },
  };
}

describe("selectStillRunningProcessIds", () => {
  it("keeps the same instance that still runs", () => {
    const closedProcesses = [{ processId: 100, startedAtMs: STARTED_AT_MS }];
    assert.deepEqual(selectStillRunningProcessIds(closedProcesses, new Map([[100, STARTED_AT_MS]])), [100]);
  });

  it("drops a process that no longer runs", () => {
    assert.deepEqual(selectStillRunningProcessIds([{ processId: 100, startedAtMs: STARTED_AT_MS }], new Map()), []);
  });

  it("drops a process whose id was reused by a newer process", () => {
    const closedProcesses = [{ processId: 100, startedAtMs: STARTED_AT_MS }];
    assert.deepEqual(selectStillRunningProcessIds(closedProcesses, new Map([[100, STARTED_AT_MS + 1]])), []);
  });

  it("assumes the instance still runs when either start time is unknown", () => {
    assert.deepEqual(selectStillRunningProcessIds([{ processId: 100, startedAtMs: null }], new Map([[100, 1]])), [100]);
    assert.deepEqual(
      selectStillRunningProcessIds([{ processId: 100, startedAtMs: STARTED_AT_MS }], new Map([[100, null]])),
      [100],
    );
  });
});

describe("waitForProcessExit", () => {
  it("returns at once, without sleeping, when every process already ended", async () => {
    const clock = createClock();
    const result = await waitForProcessExit({
      closedProcesses: [{ processId: 100, startedAtMs: STARTED_AT_MS }],
      readProcessStartTimes: async () => new Map(),
      clock,
    });
    assert.deepEqual(result, { exitedProcessIds: [100], stillRunningProcessIds: [] });
    assert.deepEqual(clock.sleeps, []);
  });

  it("queries only the pending processes, in batches, until they end", async () => {
    /** @type {number[][]} */
    const queries = [];
    const runningAfterQuery = [new Map([[100, STARTED_AT_MS], [101, STARTED_AT_MS]]), new Map([[101, STARTED_AT_MS]]), new Map()];
    const result = await waitForProcessExit({
      closedProcesses: [
        { processId: 100, startedAtMs: STARTED_AT_MS },
        { processId: 101, startedAtMs: STARTED_AT_MS },
      ],
      readProcessStartTimes: async (processIds) => {
        queries.push(processIds);
        return runningAfterQuery[queries.length - 1] ?? new Map();
      },
      clock: createClock(),
      pollIntervalMs: 100,
    });
    assert.deepEqual(queries, [[100, 101], [100, 101], [101]]);
    assert.deepEqual(result, { exitedProcessIds: [100, 101], stillRunningProcessIds: [] });
  });

  it("stops at the timeout and reports the processes still running", async () => {
    const clock = createClock();
    const result = await waitForProcessExit({
      closedProcesses: [{ processId: 100, startedAtMs: STARTED_AT_MS }],
      readProcessStartTimes: async () => new Map([[100, STARTED_AT_MS]]),
      clock,
      timeoutMs: 1_000,
      pollIntervalMs: 300,
    });
    assert.deepEqual(result, { exitedProcessIds: [], stillRunningProcessIds: [100] });
    assert.deepEqual(clock.sleeps, [300, 300, 300, 100]);
  });

  it("stops waiting and leaves the processes unconfirmed when a query fails", async () => {
    /** @type {unknown[]} */
    const queryErrors = [];
    const result = await waitForProcessExit({
      closedProcesses: [{ processId: 100, startedAtMs: STARTED_AT_MS }],
      readProcessStartTimes: async () => {
        throw new Error("access denied");
      },
      clock: createClock(),
      onQueryError: (error) => queryErrors.push(error),
    });
    assert.deepEqual(result, { exitedProcessIds: [], stillRunningProcessIds: [100] });
    assert.equal(queryErrors.length, 1);
  });
});

describe("computeQueryTimeoutMs", () => {
  it("uses the time left, capped by the usual timeout and never below the floor", () => {
    assert.equal(computeQueryTimeoutMs(5_000, 30_000), 5_000);
    assert.equal(computeQueryTimeoutMs(60_000, 30_000), 30_000);
    assert.equal(computeQueryTimeoutMs(100, 30_000), 250);
  });
});
