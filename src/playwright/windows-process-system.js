/** @module playwright/windows-process-system Reads and ends Windows processes through PowerShell and `process.kill`. */
import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";
import {
  PROCESS_SNAPSHOT_MAX_BUFFER_BYTES,
  PROCESS_SNAPSHOT_TIMEOUT_MS,
  WEBKIT_EXECUTABLES,
} from "./constants.js";

/** @typedef {import("./select-orphan-webkit-process-ids.js").WebKitProcess} WebKitProcess */

/**
 * @typedef {object} ProcessSnapshot
 * @property {WebKitProcess[]} webKitProcesses - Running WebKit processes.
 * @property {Map<number, number | null>} livingProcesses - Start time of every running process, by id.
 */

/**
 * @typedef {object} ProcessSystem
 * @property {() => Promise<ProcessSnapshot>} readProcessSnapshot - Reads the running processes.
 * @property {(processId: number) => void} terminateProcess - Ends a process; throws when it cannot.
 */

const execFileAsync = promisify(execFile);

const WEBKIT_NAME_FILTER = WEBKIT_EXECUTABLES.map((executableName) => `Name='${executableName}'`).join(" OR ");

/**
 * Lists WebKit's processes first and every running process afterwards, in one PowerShell call: a parent that starts
 * after the first query is still seen alive, so a run starting in parallel is never mistaken for an orphan. Start
 * times travel as Unix milliseconds so they survive `ConvertTo-Json` the same way on Windows PowerShell 5.1 and
 * PowerShell 7.
 */
const PROCESS_SNAPSHOT_SCRIPT = [
  "function ConvertTo-UnixMilliseconds($date) { if ($date) { ([DateTimeOffset]$date).ToUnixTimeMilliseconds() } else { $null } }",
  `$webKitProcesses = @(Get-CimInstance Win32_Process -Filter "${WEBKIT_NAME_FILTER}" | ForEach-Object { @{ processId = $_.ProcessId; parentProcessId = $_.ParentProcessId; executablePath = $_.ExecutablePath; startedAtMs = ConvertTo-UnixMilliseconds $_.CreationDate } })`,
  "$livingProcesses = @(Get-CimInstance Win32_Process | ForEach-Object { @{ processId = $_.ProcessId; startedAtMs = ConvertTo-UnixMilliseconds $_.CreationDate } })",
  "ConvertTo-Json -Compress -Depth 4 @{ webKitProcesses = $webKitProcesses; livingProcesses = $livingProcesses }",
].join("; ");

/**
 * Reads a start time from a snapshot row.
 * @param {unknown} startedAtMs - Value printed for `startedAtMs`.
 * @returns {number | null} Start time in Unix milliseconds, or `null` when unknown.
 */
function parseStartedAtMs(startedAtMs) {
  return typeof startedAtMs === "number" ? startedAtMs : null;
}

/**
 * Normalizes a JSON value that PowerShell may print as a list, a single object or nothing.
 * @param {unknown} value - Parsed value.
 * @returns {unknown[]} The value as a list.
 */
function toList(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Parses the JSON printed by the PowerShell snapshot script.
 * @param {string} stdout - Output of the snapshot script.
 * @returns {ProcessSnapshot} Running WebKit processes and the start time of every running process.
 * @throws {SyntaxError} When the output is not JSON.
 */
export function parseProcessSnapshot(stdout) {
  const output = stdout.trim();
  const snapshot = output ? JSON.parse(output) : {};
  return {
    webKitProcesses: toList(snapshot.webKitProcesses).map((row) => {
      const { processId, parentProcessId, executablePath, startedAtMs } = /** @type {Record<string, unknown>} */ (row);
      return {
        processId: Number(processId),
        parentProcessId: Number(parentProcessId),
        executablePath: typeof executablePath === "string" ? executablePath : null,
        startedAtMs: parseStartedAtMs(startedAtMs),
      };
    }),
    livingProcesses: new Map(
      toList(snapshot.livingProcesses).map((row) => {
        const { processId, startedAtMs } = /** @type {Record<string, unknown>} */ (row);
        return [Number(processId), parseStartedAtMs(startedAtMs)];
      }),
    ),
  };
}

/** @type {ProcessSystem} */
export const windowsProcessSystem = {
  async readProcessSnapshot() {
    const { stdout } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", PROCESS_SNAPSHOT_SCRIPT],
      { maxBuffer: PROCESS_SNAPSHOT_MAX_BUFFER_BYTES, timeout: PROCESS_SNAPSHOT_TIMEOUT_MS, windowsHide: true },
    );
    return parseProcessSnapshot(stdout);
  },
  terminateProcess(processId) {
    // On Windows `process.kill` calls TerminateProcess.
    process.kill(processId);
  },
};
