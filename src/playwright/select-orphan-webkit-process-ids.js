/**
 * @module playwright/select-orphan-webkit-process-ids Pure decision of which Playwright WebKit processes are orphans.
 */
import { PLAYWRIGHT_BROWSERS_FOLDER } from "./constants.js";

/**
 * @typedef {object} WebKitProcess
 * @property {number} processId - Process id.
 * @property {number} parentProcessId - Id of the process that started it; it may no longer exist.
 * @property {string | null} executablePath - Executable path, or `null` when Windows denies it.
 * @property {number | null} startedAtMs - Start time in Unix milliseconds, or `null` when unknown.
 */

/**
 * Tells whether an executable belongs to a browser build installed by Playwright, whatever the case or separator.
 * @param {string | null} executablePath - Executable path reported by Windows.
 * @returns {boolean} `true` when one of its folders is exactly `ms-playwright`.
 */
export function isPlaywrightExecutable(executablePath) {
  if (!executablePath) return false;
  return executablePath
    .toLowerCase()
    .split(/[\\/]/u)
    .includes(PLAYWRIGHT_BROWSERS_FOLDER);
}

/**
 * Tells whether the process that started `webKitProcess` is still running. Windows reuses process ids, so a living
 * process that started after `webKitProcess` cannot be its parent. When either start time is unknown the parent is
 * assumed alive, so the process is kept.
 * @param {WebKitProcess} webKitProcess - Running WebKit process.
 * @param {Map<number, number | null>} livingProcesses - Start time of every running process, by id.
 * @returns {boolean} `true` when its parent is running.
 */
export function isParentAlive(webKitProcess, livingProcesses) {
  if (!livingProcesses.has(webKitProcess.parentProcessId)) return false;
  const parentStartedAtMs = livingProcesses.get(webKitProcess.parentProcessId);
  if (parentStartedAtMs == null || webKitProcess.startedAtMs == null) return true;
  return parentStartedAtMs <= webKitProcess.startedAtMs;
}

/**
 * Decides which WebKit processes to close: those installed by Playwright whose parent no longer exists, plus their
 * Playwright descendants, whose parent is about to be closed too. A process whose parent is alive belongs to a run in
 * progress, possibly from another session, and is never selected.
 * @param {WebKitProcess[]} webKitProcesses - Running WebKit processes.
 * @param {Map<number, number | null>} livingProcesses - Start time of every running process, by id.
 * @returns {number[]} Ids to close, in the order of `webKitProcesses`.
 */
export function selectOrphanWebKitProcessIds(webKitProcesses, livingProcesses) {
  const playwrightProcesses = webKitProcesses.filter((webKitProcess) =>
    isPlaywrightExecutable(webKitProcess.executablePath),
  );
  const orphanProcessIds = new Set();
  let foundNewOrphan = true;

  while (foundNewOrphan) {
    foundNewOrphan = false;
    for (const playwrightProcess of playwrightProcesses) {
      if (orphanProcessIds.has(playwrightProcess.processId)) continue;
      const parentIsGone =
        orphanProcessIds.has(playwrightProcess.parentProcessId) || !isParentAlive(playwrightProcess, livingProcesses);
      if (parentIsGone) {
        orphanProcessIds.add(playwrightProcess.processId);
        foundNewOrphan = true;
      }
    }
  }

  return playwrightProcesses
    .map((playwrightProcess) => playwrightProcess.processId)
    .filter((processId) => orphanProcessIds.has(processId));
}
