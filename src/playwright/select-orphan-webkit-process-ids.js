/**
 * @module playwright/select-orphan-webkit-process-ids Pure decision of which Playwright WebKit processes are orphans.
 */
import { PLAYWRIGHT_BROWSERS_FOLDER, WEBKIT_EXECUTABLES } from "./constants.js";

/**
 * @typedef {object} WebKitProcess
 * @property {number | null} processId - Process id, or `null` when Windows does not report it.
 * @property {number | null} parentProcessId - Id of the process that started it, which may no longer exist, or `null`
 * when unknown.
 * @property {string | null} executablePath - Executable path, or `null` when Windows denies it.
 * @property {number | null} startedAtMs - Start time in Unix milliseconds, or `null` when unknown.
 */

/**
 * @typedef {WebKitProcess & { processId: number, parentProcessId: number, executablePath: string }} IdentifiedWebKitProcess
 */

/** {@link WEBKIT_EXECUTABLES} lowercased, for case-insensitive matching. */
const WEBKIT_EXECUTABLES_LOWERCASE = new Set(WEBKIT_EXECUTABLES.map((executableName) => executableName.toLowerCase()));

/**
 * Tells whether an executable is one of WebKit's, installed by Playwright: its file name is a WebKit executable and
 * one of its folders is exactly `ms-playwright`, whatever the case or path separator.
 * @param {string | null} executablePath - Executable path reported by Windows.
 * @returns {boolean} `true` for a Playwright WebKit executable.
 */
export function isPlaywrightWebKitExecutable(executablePath) {
  if (!executablePath) return false;
  const pathSegments = executablePath.toLowerCase().split(/[\\/]+/u);
  return (
    pathSegments.includes(PLAYWRIGHT_BROWSERS_FOLDER) && WEBKIT_EXECUTABLES_LOWERCASE.has(pathSegments.at(-1) ?? "")
  );
}

/**
 * Former name of {@link isPlaywrightWebKitExecutable}, kept so 0.1 callers keep loading. Since 0.2 it also requires the
 * file name to be one of WebKit's executables.
 * @deprecated Use `isPlaywrightWebKitExecutable`.
 */
export const isPlaywrightExecutable = isPlaywrightWebKitExecutable;

/**
 * Tells whether a process can be judged: its id, parent id and executable are known, and the executable is a
 * Playwright WebKit one. Anything unknown keeps the process out, so the decision errs on the side of closing nothing.
 * @param {WebKitProcess} webKitProcess - Process read from Windows.
 * @returns {webKitProcess is IdentifiedWebKitProcess} `true` for an identified Playwright WebKit process.
 */
function isIdentifiedPlaywrightWebKitProcess(webKitProcess) {
  return (
    webKitProcess.processId !== null &&
    webKitProcess.parentProcessId !== null &&
    isPlaywrightWebKitExecutable(webKitProcess.executablePath)
  );
}

/**
 * Tells whether the process that started `webKitProcess` is still running. Windows reuses process ids, so a living
 * process that started after `webKitProcess` cannot be its parent. When either start time is unknown the parent is
 * assumed alive, so the process is kept.
 * @param {{ parentProcessId: number, startedAtMs: number | null }} webKitProcess - Running WebKit process.
 * @param {Map<number, number | null>} livingProcesses - Start time of the living processes among the parents, by id.
 * @returns {boolean} `true` when its parent is running.
 */
export function isParentAlive(webKitProcess, livingProcesses) {
  if (!livingProcesses.has(webKitProcess.parentProcessId)) return false;
  const parentStartedAtMs = livingProcesses.get(webKitProcess.parentProcessId);
  if (parentStartedAtMs == null || webKitProcess.startedAtMs == null) return true;
  return parentStartedAtMs <= webKitProcess.startedAtMs;
}

/**
 * Decides which WebKit processes to close: Playwright's whose parent no longer exists (or whose parent id was reused
 * by a newer process), plus their Playwright descendants in the same pass, whose parent is about to be closed too. A
 * process whose parent is alive belongs to a run in progress, possibly from another session, and is never selected.
 * @param {WebKitProcess[]} webKitProcesses - Running WebKit processes.
 * @param {Map<number, number | null>} livingProcesses - Start time of the living processes among their parents, by id.
 * @returns {number[]} Ids to close, in the order of `webKitProcesses`.
 */
export function selectOrphanWebKitProcessIds(webKitProcesses, livingProcesses) {
  const playwrightProcesses = webKitProcesses.filter(isIdentifiedPlaywrightWebKitProcess);
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
