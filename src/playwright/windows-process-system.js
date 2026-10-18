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
 * @property {(processIds: number[], queryOptions?: { timeoutMs?: number }) => Promise<Map<number, number | null>>} readProcessStartTimes
 * - Reads the start time of the given processes that still run, by id, within an optional query timeout.
 * @property {(processId: number) => void} terminateProcess - Asks a process to end; throws when it cannot. The process
 * may still be terminating when it returns.
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
 * Builds the PowerShell command that prints, as JSON, the id and start time of the given processes that still run.
 * @param {number[]} processIds - Processes to look up; integers only, so the WQL filter cannot be injected.
 * @returns {string} PowerShell command.
 */
function buildStartTimesScript(processIds) {
  const processFilter = processIds.map((processId) => `ProcessId=${processId}`).join(" OR ");
  return [
    "$ErrorActionPreference = 'Stop'",
    `@(Get-CimInstance Win32_Process -Filter "${processFilter}" -Property ProcessId,CreationDate | Select-Object @{ Name = 'processId'; Expression = { $_.ProcessId } },@{ Name = 'startedAtMs'; Expression = { if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { $null } } }) | ConvertTo-Json -Compress -Depth 2`,
  ].join("; ");
}

/**
 * Runs a PowerShell command hidden and bounded by a timeout.
 * @param {string} command - PowerShell command.
 * @param {number} [timeoutMs] - Longest time the command may take.
 * @returns {Promise<string>} Its standard output.
 */
async function runPowerShell(command, timeoutMs = PROCESS_SNAPSHOT_TIMEOUT_MS) {
  const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], {
    maxBuffer: PROCESS_SNAPSHOT_MAX_BUFFER_BYTES,
    timeout: timeoutMs,
    windowsHide: true,
  });
  return stdout;
}

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
 * Reads the id and start time of process rows, dropping rows without an id.
 * @param {unknown} rows - Rows printed by PowerShell: a list, a single object or nothing.
 * @returns {Map<number, number | null>} Start time by id.
 */
export function parseProcessStartTimes(rows) {
  /** @type {Map<number, number | null>} */
  const startTimes = new Map();
  for (const row of toList(rows)) {
    const { processId, startedAtMs } = /** @type {Record<string, unknown>} */ (row ?? {});
    const knownProcessId = toInteger(processId);
    if (knownProcessId !== null) startTimes.set(knownProcessId, toInteger(startedAtMs));
  }
  return startTimes;
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
  const livingProcesses = parseProcessStartTimes(snapshot?.livingProcesses);
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
    return parseProcessSnapshot(await runPowerShell(PROCESS_SNAPSHOT_SCRIPT));
  },
  async readProcessStartTimes(processIds, { timeoutMs = PROCESS_SNAPSHOT_TIMEOUT_MS } = {}) {
    const safeProcessIds = processIds.filter((processId) => Number.isInteger(processId));
    if (safeProcessIds.length === 0) return new Map();
    const output = (await runPowerShell(buildStartTimesScript(safeProcessIds), timeoutMs)).trim();
    return parseProcessStartTimes(output ? JSON.parse(output) : null);
  },
  terminateProcess(processId) {
    // On Windows `process.kill` calls TerminateProcess.
    process.kill(processId);
  },
};
