/** @module playwright/global-hook Playwright `globalSetup` and `globalTeardown` entry for the orphan WebKit cleanup. */
import { cleanOrphanWebKitProcesses } from "./clean-orphan-webkit-processes.js";

/**
 * Sweeps orphan WebKit processes left by earlier aborted runs (as `globalSetup`) or by this run (as
 * `globalTeardown`). Playwright passes its config, which the cleanup does not need. Never fails the run.
 * @returns {Promise<void>}
 */
export default async function cleanOrphanWebKitProcessesHook() {
  await cleanOrphanWebKitProcesses();
}
