/** @module playwright/global-hook Playwright `globalSetup` and `globalTeardown` entry for the orphan WebKit cleanup. */
import { cleanOrphanWebKitProcesses } from "./clean-orphan-webkit-processes.js";

/**
 * Builds a Playwright global hook around a cleanup. Playwright calls the hook with its full config, which is not a set
 * of cleanup options, so the hook never passes it on. There is no `exit` or `SIGINT` handler: an `exit` handler only
 * runs synchronous code, and neither runs when the runner is ended with `TerminateProcess`, the case this cleanup
 * exists for; the next run's `globalSetup` sweeps those leftovers instead.
 * @param {() => Promise<unknown>} cleanup - Cleanup to run with its defaults.
 * @returns {(config?: unknown) => Promise<void>} Hook for `globalSetup` or `globalTeardown`.
 */
export function createGlobalHook(cleanup) {
  return async function runCleanupHook() {
    await cleanup();
  };
}

/**
 * Sweeps orphan WebKit processes left by earlier aborted runs (as `globalSetup`) or by this run (as
 * `globalTeardown`). Never fails the run.
 */
export default createGlobalHook(cleanOrphanWebKitProcesses);
