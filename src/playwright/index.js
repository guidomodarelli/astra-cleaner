/**
 * @module @astra-kit/cleaner/playwright Closes Playwright WebKit processes that outlived the run that started them.
 *
 * On Windows, ending a process does not end its children. When a Playwright run dies abruptly (an agent tool
 * timeout, a closed terminal, `TerminateProcess`), `globalTeardown` never runs and WebKit's processes stay alive
 * under `ms-playwright`, holding the repository folder as working directory and keeping worktrees from being deleted.
 */
export {
  ORPHAN_CLEANUP_PLATFORM,
  PLAYWRIGHT_BROWSERS_FOLDER,
  TERMINATION_MIN_QUERY_TIMEOUT_MS,
  TERMINATION_POLL_INTERVAL_MS,
  TERMINATION_WAIT_TIMEOUT_MS,
  WEBKIT_EXECUTABLES,
} from "./constants.js";
export {
  isParentAlive,
  isPlaywrightWebKitExecutable,
  selectOrphanWebKitProcessIds,
} from "./select-orphan-webkit-process-ids.js";
export { parseProcessSnapshot, parseProcessStartTimes, windowsProcessSystem } from "./windows-process-system.js";
export { cleanOrphanWebKitProcesses, describeError, playwrightCleanupApplies } from "./clean-orphan-webkit-processes.js";
export { checkProcessIdentity } from "./process-identity.js";
export { computeQueryTimeoutMs, selectStillRunningProcessIds, systemClock, waitForProcessExit } from "./wait-for-process-exit.js";
