import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanOrphanWebKitProcesses, describeError } from "../../src/playwright/clean-orphan-webkit-processes.js";

const WINDOWS_PLATFORM = "win32";
const ORPHAN_PROCESS = {
  processId: 100,
  parentProcessId: 10,
  executablePath: String.raw`C:\Users\dev\AppData\Local\ms-playwright\webkit-2200\WebKitWebProcess.exe`,
  startedAtMs: 2000,
};

/**
 * Builds a fake process system that records the processes it ends. The WebKit processes of the snapshot run with
 * their snapshot start time until they are ended; ended processes disappear at once, except the stuck ones, which
 * keep running as a process stuck while terminating does.
 * @param {object} [options]
 * @param {import("../../src/playwright/select-orphan-webkit-process-ids.js").WebKitProcess[]} [options.webKitProcesses]
 * @param {() => Promise<import("../../src/playwright/windows-process-system.js").ProcessSnapshot>} [options.readProcessSnapshot]
 * @param {(processId: number) => void} [options.terminateProcess]
 * @param {Set<number>} [options.stuckProcessIds] - Processes that never end.
 * @param {Map<number, number | null | undefined>} [options.startTimesAfterSnapshot] - Start time each process has once
 * the snapshot was read, by id: another time simulates a reused id, `undefined` a process that ended on its own; ids
 * missing from the map keep their snapshot time.
 * @param {(processIds: number[]) => Promise<Map<number, number | null>>} [options.readProcessStartTimes]
 */
function createProcessSystem({
  webKitProcesses = [ORPHAN_PROCESS],
  readProcessSnapshot = async () => ({ webKitProcesses, livingProcesses: new Map() }),
  terminateProcess = () => {},
  stuckProcessIds = new Set(),
  startTimesAfterSnapshot = new Map(),
  readProcessStartTimes,
} = {}) {
  /** @type {number[]} */
  const terminatedProcessIds = [];
  /** @type {number[][]} */
  const startTimeQueries = [];
  /** @type {number[]} */
  const queryTimeoutsMs = [];
  return {
    terminatedProcessIds,
    startTimeQueries,
    queryTimeoutsMs,
    readProcessSnapshot,
    /** @param {number} processId */
    terminateProcess(processId) {
      terminateProcess(processId);
      terminatedProcessIds.push(processId);
    },
    /**
     * @param {number[]} processIds
     * @param {{ timeoutMs?: number }} [queryOptions]
     */
    async readProcessStartTimes(processIds, queryOptions) {
      startTimeQueries.push(processIds);
      if (queryOptions?.timeoutMs !== undefined) queryTimeoutsMs.push(queryOptions.timeoutMs);
      if (readProcessStartTimes) return readProcessStartTimes(processIds);
      /** @type {Map<number, number | null>} */
      const runningStartTimes = new Map();
      for (const webKitProcess of webKitProcesses) {
        const { processId } = webKitProcess;
        if (processId === null || !processIds.includes(processId)) continue;
        if (terminatedProcessIds.includes(processId) && !stuckProcessIds.has(processId)) continue;
        const startedAtMs = startTimesAfterSnapshot.has(processId)
          ? startTimesAfterSnapshot.get(processId)
          : webKitProcess.startedAtMs;
        if (startedAtMs !== undefined) runningStartTimes.set(processId, startedAtMs);
      }
      return runningStartTimes;
    },
  };
}

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

/** Collects messages sent to `log` and `warn`. */
function createOutput() {
  /** @type {string[]} */
  const logs = [];
  /** @type {string[]} */
  const warnings = [];
  return {
    logs,
    warnings,
    /** @param {string} message */
    log: (message) => logs.push(message),
    /** @param {string} message */
    warn: (message) => warnings.push(message),
  };
}

describe("cleanOrphanWebKitProcesses", () => {
  it("does nothing outside Windows", async () => {
    const system = createProcessSystem({
      readProcessSnapshot: async () => assert.fail("must not read processes outside Windows"),
    });
    const result = await cleanOrphanWebKitProcesses({ platform: "linux", system });
    assert.deepEqual(result, { applies: false, orphanProcessIds: [], terminatedProcessIds: [], stillRunningProcessIds: [], failedProcessIds: [] });
  });

  it("closes the orphans and reports them", async () => {
    const system = createProcessSystem();
    const output = createOutput();
    const result = await cleanOrphanWebKitProcesses({ platform: WINDOWS_PLATFORM, system, ...output });
    assert.deepEqual(system.terminatedProcessIds, [100]);
    assert.deepEqual(result.terminatedProcessIds, [100]);
    assert.match(output.logs.join("\n"), /Closed 1 orphan Playwright WebKit process\(es\): 100/u);
    assert.deepEqual(output.warnings, []);
  });

  it("waits until a closed process really ends before reporting it closed", async () => {
    // The first query revalidates the orphan before closing; the next two still see it while it terminates.
    let remainingRunningQueries = 3;
    const system = createProcessSystem({
      readProcessStartTimes: async () => {
        if (remainingRunningQueries === 0) return new Map();
        remainingRunningQueries -= 1;
        return new Map([[100, ORPHAN_PROCESS.startedAtMs]]);
      },
    });
    const clock = createClock();
    const output = createOutput();
    const result = await cleanOrphanWebKitProcesses({ platform: WINDOWS_PLATFORM, system, clock, ...output });
    assert.deepEqual(system.terminatedProcessIds, [100]);
    assert.deepEqual(system.startTimeQueries, [[100], [100], [100], [100]]);
    assert.equal(clock.sleeps.length, 2);
    assert.deepEqual(result.terminatedProcessIds, [100]);
    assert.deepEqual(result.stillRunningProcessIds, []);
    assert.deepEqual(output.warnings, []);
  });

  it("reports processes stuck while terminating apart and keeps the run going", async () => {
    const secondOrphan = { ...ORPHAN_PROCESS, processId: 101 };
    const system = createProcessSystem({
      webKitProcesses: [ORPHAN_PROCESS, secondOrphan],
      stuckProcessIds: new Set([101]),
    });
    const clock = createClock();
    const output = createOutput();
    const result = await cleanOrphanWebKitProcesses({
      platform: WINDOWS_PLATFORM,
      system,
      clock,
      terminationTimeoutMs: 1_000,
      ...output,
    });
    assert.deepEqual(result.terminatedProcessIds, [100]);
    assert.deepEqual(result.stillRunningProcessIds, [101]);
    assert.equal(clock.now() >= 1_000, true);
    assert.match(output.warnings.join("\n"), /did not end within 1000 ms.*pid=101.*locked until Windows restarts/u);
    assert.match(output.logs.join("\n"), /Closed 1 orphan Playwright WebKit process\(es\): 100/u);
  });

  it("cuts each liveness query to the time left and stops querying at the deadline", async () => {
    const system = createProcessSystem({ stuckProcessIds: new Set([100]) });
    const clock = createClock();
    const result = await cleanOrphanWebKitProcesses({
      platform: WINDOWS_PLATFORM,
      system,
      clock,
      terminationTimeoutMs: 600,
      log: () => {},
      warn: () => {},
    });
    // The revalidation query uses the usual timeout; the wait queries use what is left of the 600 ms, never below 250.
    assert.deepEqual(system.queryTimeoutsMs, [600, 350, 250]);
    assert.equal(clock.now(), 600);
    assert.deepEqual(result.stillRunningProcessIds, [100]);
  });

  it("closes only orphans that are still the same instance right before closing", async () => {
    const reusedOrphan = { ...ORPHAN_PROCESS, processId: 101 };
    const goneOrphan = { ...ORPHAN_PROCESS, processId: 102 };
    const system = createProcessSystem({
      webKitProcesses: [ORPHAN_PROCESS, reusedOrphan, goneOrphan],
      // Process 101 now names a newer process; process 102 ended between the snapshot and the close.
      startTimesAfterSnapshot: new Map([
        [101, ORPHAN_PROCESS.startedAtMs + 1],
        [102, undefined],
      ]),
    });
    const output = createOutput();
    const result = await cleanOrphanWebKitProcesses({ platform: WINDOWS_PLATFORM, system, clock: createClock(), ...output });
    assert.deepEqual(system.terminatedProcessIds, [100]);
    assert.deepEqual(result.terminatedProcessIds, [100, 101, 102]);
    assert.deepEqual(result.failedProcessIds, []);
    assert.deepEqual(output.warnings, []);
  });

  it("leaves running an orphan whose identity cannot be checked before closing", async () => {
    const system = createProcessSystem({ startTimesAfterSnapshot: new Map([[100, null]]) });
    const output = createOutput();
    const result = await cleanOrphanWebKitProcesses({ platform: WINDOWS_PLATFORM, system, clock: createClock(), ...output });
    assert.deepEqual(system.terminatedProcessIds, []);
    assert.deepEqual(result.failedProcessIds, [100]);
    assert.match(output.warnings.join("\n"), /could not verify the identity of pid=100/u);
  });

  it("closes nothing and warns when the revalidation query fails", async () => {
    const system = createProcessSystem({
      readProcessStartTimes: async () => {
        throw new Error("powershell timed out");
      },
    });
    const output = createOutput();
    const result = await cleanOrphanWebKitProcesses({ platform: WINDOWS_PLATFORM, system, clock: createClock(), ...output });
    assert.deepEqual(system.terminatedProcessIds, []);
    assert.deepEqual(result.failedProcessIds, [100]);
    assert.deepEqual(result.terminatedProcessIds, []);
    assert.match(output.warnings.join("\n"), /failed before closing; no orphan was closed \(pid=100\).*powershell timed out/u);
  });

  it("warns and leaves the closes unconfirmed when the exit check fails", async () => {
    let queryCount = 0;
    const system = createProcessSystem({
      readProcessStartTimes: async () => {
        queryCount += 1;
        if (queryCount === 1) return new Map([[100, ORPHAN_PROCESS.startedAtMs]]);
        throw new Error("powershell timed out");
      },
    });
    const output = createOutput();
    const result = await cleanOrphanWebKitProcesses({ platform: WINDOWS_PLATFORM, system, clock: createClock(), ...output });
    assert.deepEqual(system.terminatedProcessIds, [100]);
    assert.deepEqual(result.terminatedProcessIds, []);
    assert.deepEqual(result.stillRunningProcessIds, [100]);
    assert.match(output.warnings.join("\n"), /could not confirm that closed processes ended.*powershell timed out/u);
  });

  it("only reports the orphans in a dry run", async () => {
    const system = createProcessSystem();
    const output = createOutput();
    const clock = createClock();
    const result = await cleanOrphanWebKitProcesses({ platform: WINDOWS_PLATFORM, system, dryRun: true, clock, ...output });
    assert.deepEqual(system.startTimeQueries, []);
    assert.deepEqual(clock.sleeps, []);
    assert.deepEqual(system.terminatedProcessIds, []);
    assert.deepEqual(result.orphanProcessIds, [100]);
    assert.deepEqual(result.terminatedProcessIds, []);
    assert.match(output.logs.join("\n"), /Dry run: would close 1 .*: 100/u);
  });

  it("logs a clean machine only when asked to", async () => {
    const system = createProcessSystem({
      readProcessSnapshot: async () => ({ webKitProcesses: [], livingProcesses: new Map() }),
    });
    const quietOutput = createOutput();
    await cleanOrphanWebKitProcesses({ platform: WINDOWS_PLATFORM, system, ...quietOutput });
    assert.deepEqual(quietOutput.logs, []);

    const reportingOutput = createOutput();
    await cleanOrphanWebKitProcesses({ platform: WINDOWS_PLATFORM, system, reportClean: true, ...reportingOutput });
    assert.match(reportingOutput.logs.join("\n"), /No orphan Playwright WebKit processes found/u);
  });

  it("warns and closes nothing when the process list cannot be read", async () => {
    const system = createProcessSystem({
      readProcessSnapshot: async () => {
        throw new Error("powershell timed out");
      },
    });
    const output = createOutput();
    const result = await cleanOrphanWebKitProcesses({ platform: WINDOWS_PLATFORM, system, ...output });
    assert.deepEqual(result, { applies: true, orphanProcessIds: [], terminatedProcessIds: [], stillRunningProcessIds: [], failedProcessIds: [] });
    assert.deepEqual(system.terminatedProcessIds, []);
    assert.equal(output.warnings.length, 1);
    assert.match(output.warnings[0], /readProcessSnapshot failed.*powershell timed out/u);
  });

  it("warns with the process id and keeps going when a process cannot be closed", async () => {
    const secondOrphan = { ...ORPHAN_PROCESS, processId: 101 };
    const system = createProcessSystem({
      webKitProcesses: [ORPHAN_PROCESS, secondOrphan],
      terminateProcess: (processId) => {
        if (processId === 100) throw new Error("EPERM");
      },
    });
    const output = createOutput();
    const result = await cleanOrphanWebKitProcesses({ platform: WINDOWS_PLATFORM, system, ...output });
    assert.deepEqual(result.failedProcessIds, [100]);
    assert.deepEqual(result.terminatedProcessIds, [101]);
    assert.match(output.warnings.join("\n"), /terminateProcess failed for pid=100: EPERM/u);
  });

  it("warns with the error code when a process stuck while terminating cannot be closed", async () => {
    const system = createProcessSystem({
      terminateProcess: () => {
        throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
      },
    });
    const output = createOutput();
    const result = await cleanOrphanWebKitProcesses({ platform: WINDOWS_PLATFORM, system, ...output });
    assert.deepEqual(result.failedProcessIds, [100]);
    assert.match(output.warnings[0], /terminateProcess failed for pid=100: EPERM: operation not permitted/u);
  });

  it("describes thrown values that are not errors", async () => {
    const system = createProcessSystem({
      readProcessSnapshot: async () => {
        throw "access denied";
      },
    });
    const output = createOutput();
    await cleanOrphanWebKitProcesses({ platform: WINDOWS_PLATFORM, system, ...output });
    assert.match(output.warnings[0], /access denied/u);
  });
});

describe("describeError", () => {
  it("adds the error code unless the message already names it", () => {
    assert.equal(describeError(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })), "ETIMEDOUT: timed out");
    assert.equal(describeError(Object.assign(new Error("kill EPERM"), { code: "EPERM" })), "kill EPERM");
    assert.equal(describeError(new Error("plain")), "plain");
    assert.equal(describeError(42), "42");
  });
});
