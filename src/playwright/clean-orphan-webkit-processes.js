/** @module playwright/clean-orphan-webkit-processes Finds and closes orphan Playwright WebKit processes on Windows. */
import process from "node:process";
import { ORPHAN_CLEANUP_PLATFORM, PLAYWRIGHT_LOG_PREFIX, TERMINATION_WAIT_TIMEOUT_MS } from "./constants.js";
import { selectOrphanWebKitProcessIds } from "./select-orphan-webkit-process-ids.js";
import { checkProcessIdentity } from "./process-identity.js";
import { waitForProcessExit } from "./wait-for-process-exit.js";
import { windowsProcessSystem } from "./windows-process-system.js";

/** @typedef {import("./windows-process-system.js").ProcessSystem} ProcessSystem */
/** @typedef {import("./wait-for-process-exit.js").Clock} Clock */

/**
 * @typedef {object} CleanupResult
 * @property {boolean} applies - Whether the cleanup runs on this platform.
 * @property {number[]} orphanProcessIds - Orphan Playwright WebKit processes found.
 * @property {number[]} terminatedProcessIds - Orphans closed and confirmed gone.
 * @property {number[]} stillRunningProcessIds - Orphans asked to end that did not end within the wait, or whose end
 * could not be confirmed; they may keep their folder locked until Windows restarts.
 * @property {number[]} failedProcessIds - Orphans left running because they could not be asked to end, or because
 * their identity could not be checked right before closing.
 */

/**
 * @typedef {object} CleanupOptions
 * @property {string} [platform] - Platform to act on; defaults to the current one.
 * @property {ProcessSystem} [system] - Process access; defaults to Windows' PowerShell and `process.kill`.
 * @property {boolean} [dryRun] - Report the orphans without closing them.
 * @property {boolean} [reportClean] - Also log when no orphan is found, for manual runs.
 * @property {(message: string) => void} [log] - Receives informational messages.
 * @property {(message: string) => void} [warn] - Receives failure messages.
 * @property {Clock} [clock] - Time source for the wait after closing, replaceable for tests.
 * @property {number} [terminationTimeoutMs] - Longest wait for closed processes to really end.
 */

/**
 * Turns a caught value into a one-line reason for a warning, without its stack: the error code when there is one
 * (`EPERM` for a process stuck while terminating, `ETIMEDOUT` for a stalled query) and its message.
 * @param {unknown} error - Caught value.
 * @returns {string} Its code and message.
 */
export function describeError(error) {
  if (!(error instanceof Error)) return String(error);
  const errorCode = "code" in error && error.code ? String(error.code) : undefined;
  return errorCode && !error.message.includes(errorCode) ? `${errorCode}: ${error.message}` : error.message;
}

/**
 * Builds a result that found and closed nothing.
 * @param {boolean} applies - Whether the cleanup runs on this platform.
 * @returns {CleanupResult} Empty result.
 */
function createEmptyResult(applies) {
  return { applies, orphanProcessIds: [], terminatedProcessIds: [], stillRunningProcessIds: [], failedProcessIds: [] };
}

/**
 * Tells whether the Playwright cleanup acts on a platform: only Windows leaves WebKit processes behind.
 * @param {string} platform - Platform name, as `process.platform` reports it.
 * @returns {boolean} `true` on Windows.
 */
export function playwrightCleanupApplies(platform) {
  return platform === ORPHAN_CLEANUP_PLATFORM;
}

/**
 * Finds orphan Playwright WebKit processes and closes them. Does nothing outside Windows and never throws: failures
 * to read the process list or to close a process are reported through `warn` with the operation and process id.
 * @param {CleanupOptions} [options] - Behavior and system access, replaceable for tests.
 * @returns {Promise<CleanupResult>} What was found, closed and left running.
 */
export async function cleanOrphanWebKitProcesses({
  platform = process.platform,
  system = windowsProcessSystem,
  dryRun = false,
  reportClean = false,
  log = console.log,
  warn = console.warn,
  clock,
  terminationTimeoutMs = TERMINATION_WAIT_TIMEOUT_MS,
} = {}) {
  if (!playwrightCleanupApplies(platform)) return createEmptyResult(false);

  let snapshot;
  try {
    snapshot = await system.readProcessSnapshot();
  } catch (error) {
    warn(
      `${PLAYWRIGHT_LOG_PREFIX} readProcessSnapshot failed; orphan WebKit processes were not cleaned: ${describeError(error)}`,
    );
    return createEmptyResult(true);
  }

  const orphanProcessIds = selectOrphanWebKitProcessIds(snapshot.webKitProcesses, snapshot.livingProcesses);
  const result = { ...createEmptyResult(true), orphanProcessIds };
  if (orphanProcessIds.length === 0) {
    if (reportClean) log(`${PLAYWRIGHT_LOG_PREFIX} No orphan Playwright WebKit processes found.`);
    return result;
  }

  if (dryRun) {
    log(
      `${PLAYWRIGHT_LOG_PREFIX} Dry run: would close ${orphanProcessIds.length} orphan Playwright WebKit process(es): ${orphanProcessIds.join(", ")}.`,
    );
    return result;
  }

  const startTimesById = new Map(
    snapshot.webKitProcesses.map((webKitProcess) => [webKitProcess.processId, webKitProcess.startedAtMs]),
  );
  /** @type {import("./process-identity.js").ProcessInstance[]} */
  const orphanInstances = orphanProcessIds.map((processId) => ({
    processId,
    startedAtMs: startTimesById.get(processId) ?? null,
  }));

  // Windows may reuse an orphan's id between the snapshot and the close, and `process.kill` would then end an
  // unrelated process. Checking each id against its snapshot start time right before closing narrows that race
  // window; it cannot remove it, since the id can still be reused between this query and the close.
  let identityCheck;
  try {
    identityCheck = checkProcessIdentity(orphanInstances, await system.readProcessStartTimes(orphanProcessIds));
  } catch (error) {
    result.failedProcessIds.push(...orphanProcessIds);
    warn(
      `${PLAYWRIGHT_LOG_PREFIX} readProcessStartTimes failed before closing; no orphan was closed (pid=${orphanProcessIds.join(", ")}): ${describeError(error)}`,
    );
    return result;
  }
  if (identityCheck.unverifiableProcessIds.length > 0) {
    result.failedProcessIds.push(...identityCheck.unverifiableProcessIds);
    warn(
      `${PLAYWRIGHT_LOG_PREFIX} could not verify the identity of pid=${identityCheck.unverifiableProcessIds.join(", ")} before closing; left running.`,
    );
  }
  const sameInstanceProcessIds = new Set(identityCheck.sameInstanceProcessIds);

  /** @type {import("./process-identity.js").ProcessInstance[]} */
  const closedProcesses = [];
  for (const { processId } of orphanInstances.filter((orphanInstance) =>
    sameInstanceProcessIds.has(orphanInstance.processId),
  )) {
    try {
      system.terminateProcess(processId);
      closedProcesses.push({ processId, startedAtMs: startTimesById.get(processId) ?? null });
    } catch (error) {
      result.failedProcessIds.push(processId);
      warn(`${PLAYWRIGHT_LOG_PREFIX} terminateProcess failed for pid=${processId}: ${describeError(error)}`);
    }
  }

  /** @type {number[]} */
  let exitedProcessIds = [];
  let exitUnconfirmed = false;
  if (closedProcesses.length > 0) {
    const processExitWait = await waitForProcessExit({
      closedProcesses,
      readProcessStartTimes: (processIds, queryOptions) => system.readProcessStartTimes(processIds, queryOptions),
      clock,
      timeoutMs: terminationTimeoutMs,
      onQueryError: (error) =>
        warn(`${PLAYWRIGHT_LOG_PREFIX} readProcessStartTimes failed; could not confirm that closed processes ended: ${describeError(error)}`),
    });
    result.stillRunningProcessIds = processExitWait.stillRunningProcessIds;
    exitedProcessIds = processExitWait.exitedProcessIds;
    exitUnconfirmed = processExitWait.exitUnconfirmed;
  }
  // Orphans that ended on their own, or whose id now names another process, count as terminated without a close.
  const terminatedProcessIdSet = new Set([...identityCheck.goneProcessIds, ...exitedProcessIds]);
  result.terminatedProcessIds = orphanProcessIds.filter((processId) => terminatedProcessIdSet.has(processId));

  if (exitUnconfirmed) {
    warn(
      `${PLAYWRIGHT_LOG_PREFIX} could not confirm that ${result.stillRunningProcessIds.length} closed orphan WebKit process(es) ended (pid=${result.stillRunningProcessIds.join(", ")}); if one is still running it may keep its folder locked.`,
    );
  } else if (result.stillRunningProcessIds.length > 0) {
    warn(
      `${PLAYWRIGHT_LOG_PREFIX} ${result.stillRunningProcessIds.length} orphan WebKit process(es) did not end within ${terminationTimeoutMs} ms after TerminateProcess (pid=${result.stillRunningProcessIds.join(", ")}); they may keep their folder locked until Windows restarts.`,
    );
  }

  if (result.terminatedProcessIds.length > 0) {
    log(
      `${PLAYWRIGHT_LOG_PREFIX} Closed ${result.terminatedProcessIds.length} orphan Playwright WebKit process(es): ${result.terminatedProcessIds.join(", ")}.`,
    );
  }
  return result;
}
