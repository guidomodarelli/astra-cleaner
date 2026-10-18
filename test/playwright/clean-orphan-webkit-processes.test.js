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
 * Builds a fake process system that records the processes it ends. Ended processes disappear at once, except the
 * stuck ones, which keep running with their start time as a process stuck while terminating does.
 * @param {object} [options]
 * @param {() => Promise<import("../../src/playwright/windows-process-system.js").ProcessSnapshot>} [options.readProcessSnapshot]
 * @param {(processId: number) => void} [options.terminateProcess]
 * @param {Map<number, number>} [options.stuckProcesses] - Start time of the processes that never end, by id.
 * @param {(processIds: number[]) => Promise<Map<number, number | null>>} [options.readProcessStartTimes]
 */
function createProcessSystem({
  readProcessSnapshot = async () => ({ webKitProcesses: [ORPHAN_PROCESS], livingProcesses: new Map() }),
  terminateProcess = () => {},
  stuckProcesses = new Map(),
  readProcessStartTimes,
} = {}) {
  /** @type {number[]} */
  const terminatedProcessIds = [];
  /** @type {number[][]} */
  const startTimeQueries = [];
  return {
    terminatedProcessIds,
    startTimeQueries,
    readProcessSnapshot,
    /** @param {number} processId */
    terminateProcess(processId) {
      terminateProcess(processId);
      terminatedProcessIds.push(processId);
    },
    /** @param {number[]} processIds */
    async readProcessStartTimes(processIds) {
      startTimeQueries.push(processIds);
      if (readProcessStartTimes) return readProcessStartTimes(processIds);
      return new Map(
        processIds.flatMap((processId) => {
          const stuckStartedAtMs = stuckProcesses.get(processId);
          return stuckStartedAtMs === undefined ? [] : [[processId, stuckStartedAtMs]];
        }),
      );
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
    let remainingRunningQueries = 2;
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
    assert.deepEqual(system.startTimeQueries, [[100], [100], [100]]);
    assert.equal(clock.sleeps.length, 2);
    assert.deepEqual(result.terminatedProcessIds, [100]);
    assert.deepEqual(result.stillRunningProcessIds, []);
    assert.deepEqual(output.warnings, []);
  });

  it("reports processes stuck while terminating apart and keeps the run going", async () => {
    const secondOrphan = { ...ORPHAN_PROCESS, processId: 101 };
    const system = createProcessSystem({
      readProcessSnapshot: async () => ({ webKitProcesses: [ORPHAN_PROCESS, secondOrphan], livingProcesses: new Map() }),
      stuckProcesses: new Map([[101, secondOrphan.startedAtMs]]),
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

  it("warns and leaves the closes unconfirmed when the exit check fails", async () => {
    const system = createProcessSystem({
      readProcessStartTimes: async () => {
        throw new Error("powershell timed out");
      },
    });
    const output = createOutput();
    const result = await cleanOrphanWebKitProcesses({ platform: WINDOWS_PLATFORM, system, clock: createClock(), ...output });
    assert.deepEqual(result.terminatedProcessIds, []);
    assert.deepEqual(result.stillRunningProcessIds, [100]);
    assert.match(output.warnings.join("\n"), /readProcessStartTimes failed.*powershell timed out/u);
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
      readProcessSnapshot: async () => ({ webKitProcesses: [ORPHAN_PROCESS, secondOrphan], livingProcesses: new Map() }),
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
