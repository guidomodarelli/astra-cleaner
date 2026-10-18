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
 * @property {Map<number, number | null>} livingProcesses - Start time of the living processes among their parents, by
 * id. A parent missing from it no longer runs.
 */

/**
 * @typedef {object} ProcessSystem
 * @property {() => Promise<ProcessSnapshot>} readProcessSnapshot - Reads the running processes.
 * @property {(processId: number) => void} terminateProcess - Ends a process; throws when it cannot.
 */

const execFileAsync = promisify(execFile);

/** WQL filter that selects WebKit's processes by name, built from the single list of executables. */
const WEBKIT_NAME_FILTER = WEBKIT_EXECUTABLES.map((executableName) => `Name='${executableName}'`).join(" OR ");

/**
 * Reads WebKit's processes first and then only their parents, both with the minimal CIM properties, in one PowerShell
 * call. The usual run finds no WebKit process and skips the parent query. Reading the parents after the children means
 * a parent that starts in between is still seen alive, so a run starting in parallel is never mistaken for an orphan.
 * Start times travel as Unix milliseconds so they survive `ConvertTo-Json` the same way on Windows PowerShell 5.1 and
 * PowerShell 7.
 */
const PROCESS_SNAPSHOT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$startedAtMs = @{ Name = 'startedAtMs'; Expression = { if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { $null } } }",
  `$webKitProcesses = @(Get-CimInstance Win32_Process -Filter "${WEBKIT_NAME_FILTER}" -Property ProcessId,ParentProcessId,ExecutablePath,CreationDate | Select-Object @{ Name = 'processId'; Expression = { $_.ProcessId } },@{ Name = 'parentProcessId'; Expression = { $_.ParentProcessId } },@{ Name = 'executablePath'; Expression = { $_.ExecutablePath } },$startedAtMs)`,
  "$parentFilter = @($webKitProcesses | ForEach-Object { 'ProcessId=' + $_.parentProcessId } | Sort-Object -Unique) -join ' OR '",
  "$livingProcesses = if ($parentFilter) { @(Get-CimInstance Win32_Process -Filter $parentFilter -Property ProcessId,CreationDate | Select-Object @{ Name = 'processId'; Expression = { $_.ProcessId } },$startedAtMs) } else { @() }",
  "ConvertTo-Json -Compress -Depth 3 -InputObject @{ webKitProcesses = $webKitProcesses; livingProcesses = $livingProcesses }",
].join("; ");

/**
 * Reads an integer field (process id or start time), keeping anything else as unknown.
 * @param {unknown} value - Raw field value.
 * @returns {number | null} The integer, or `null` when it is not one.
 */
function toInteger(value) {
  return Number.isInteger(value) ? /** @type {number} */ (value) : null;
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
 * Parses the JSON printed by {@link PROCESS_SNAPSHOT_SCRIPT}. Unknown ids, paths and times stay `null`, so the
 * decision keeps those processes.
 * @param {string} stdout - Output of the snapshot script.
 * @returns {ProcessSnapshot} Running WebKit processes and the start time of their living parents.
 * @throws {SyntaxError} When the output is not JSON.
 */
export function parseProcessSnapshot(stdout) {
  const output = stdout.trim();
  const snapshot = output ? JSON.parse(output) : {};
  /** @type {Map<number, number | null>} */
  const livingProcesses = new Map();
  for (const row of toList(snapshot?.livingProcesses)) {
    const { processId, startedAtMs } = /** @type {Record<string, unknown>} */ (row ?? {});
    const livingProcessId = toInteger(processId);
    if (livingProcessId !== null) livingProcesses.set(livingProcessId, toInteger(startedAtMs));
  }
  return {
    webKitProcesses: toList(snapshot?.webKitProcesses).map((row) => {
      const { processId, parentProcessId, executablePath, startedAtMs } = /** @type {Record<string, unknown>} */ (
        row ?? {}
      );
      return {
        processId: toInteger(processId),
        parentProcessId: toInteger(parentProcessId),
        executablePath: typeof executablePath === "string" ? executablePath : null,
        startedAtMs: toInteger(startedAtMs),
      };
    }),
    livingProcesses,
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
