/** @module playwright/clean-orphan-webkit-processes Finds and closes orphan Playwright WebKit processes on Windows. */
import process from "node:process";
import { ORPHAN_CLEANUP_PLATFORM, PLAYWRIGHT_LOG_PREFIX } from "./constants.js";
import { selectOrphanWebKitProcessIds } from "./select-orphan-webkit-process-ids.js";
import { windowsProcessSystem } from "./windows-process-system.js";

/** @typedef {import("./windows-process-system.js").ProcessSystem} ProcessSystem */

/**
 * @typedef {object} CleanupResult
 * @property {boolean} applies - Whether the cleanup runs on this platform.
 * @property {number[]} orphanProcessIds - Orphan Playwright WebKit processes found.
 * @property {number[]} terminatedProcessIds - Orphans that were closed.
 * @property {number[]} failedProcessIds - Orphans that could not be closed.
 */

/**
 * @typedef {object} CleanupOptions
 * @property {string} [platform] - Platform to act on; defaults to the current one.
 * @property {ProcessSystem} [system] - Process access; defaults to Windows' PowerShell and `process.kill`.
 * @property {boolean} [dryRun] - Report the orphans without closing them.
 * @property {boolean} [reportClean] - Also log when no orphan is found, for manual runs.
 * @property {(message: string) => void} [log] - Receives informational messages.
 * @property {(message: string) => void} [warn] - Receives failure messages.
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
  return { applies, orphanProcessIds: [], terminatedProcessIds: [], failedProcessIds: [] };
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

  for (const processId of orphanProcessIds) {
    try {
      system.terminateProcess(processId);
      result.terminatedProcessIds.push(processId);
    } catch (error) {
      result.failedProcessIds.push(processId);
      warn(`${PLAYWRIGHT_LOG_PREFIX} terminateProcess failed for pid=${processId}: ${describeError(error)}`);
    }
  }

  if (result.terminatedProcessIds.length > 0) {
    log(
      `${PLAYWRIGHT_LOG_PREFIX} Closed ${result.terminatedProcessIds.length} orphan Playwright WebKit process(es): ${result.terminatedProcessIds.join(", ")}.`,
    );
  }
  return result;
}
