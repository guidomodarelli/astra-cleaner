/**
 * @module playwright/wait-for-process-exit Waits until closed processes are really gone.
 *
 * On Windows `process.kill` calls TerminateProcess, which can return before the process ends when it has pending I/O:
 * the process lingers while terminating and keeps its working directory locked. The cleanup therefore confirms each
 * close by checking that the same instance (same id and start time) no longer runs.
 */
import { setTimeout as sleepFor } from "node:timers/promises";
import {
  PROCESS_SNAPSHOT_TIMEOUT_MS,
  TERMINATION_MIN_QUERY_TIMEOUT_MS,
  TERMINATION_POLL_INTERVAL_MS,
  TERMINATION_WAIT_TIMEOUT_MS,
} from "./constants.js";
import { checkProcessIdentity } from "./process-identity.js";

/** @typedef {import("./process-identity.js").ProcessInstance} ProcessInstance */

/**
 * @typedef {object} ProcessQueryOptions
 * @property {number} timeoutMs - Longest time the query may take.
 */

/**
 * @typedef {object} Clock
 * @property {() => number} now - Current time in milliseconds.
 * @property {(durationMs: number) => Promise<void>} sleep - Resolves after `durationMs`.
 */

/**
 * @typedef {object} ProcessExitWait
 * @property {number[]} exitedProcessIds - Processes confirmed gone.
 * @property {number[]} stillRunningProcessIds - Processes still running at the deadline, or whose exit could not be
 * confirmed.
 * @property {boolean} exitUnconfirmed - Whether a query failed, so the processes in `stillRunningProcessIds` may
 * have ended: their state is unknown rather than timed out.
 */

/** Real time, for production runs. */
export const systemClock = {
  now: () => Date.now(),
  /** @param {number} durationMs */
  sleep: async (durationMs) => {
    await sleepFor(durationMs);
  },
};

/**
 * Picks the processes whose same instance still runs. A running process with the same id but a later start time
 * reused the id, so the closed instance is gone. When either start time is unknown the instance is assumed to run, so
 * an unconfirmed close is never reported as done.
 * @param {ProcessInstance[]} closedProcesses - Processes that were asked to end.
 * @param {Map<number, number | null>} runningStartTimes - Start time of the running processes among them, by id.
 * @returns {number[]} Ids of the instances still running, in input order.
 */
export function selectStillRunningProcessIds(closedProcesses, runningStartTimes) {
  const { goneProcessIds } = checkProcessIdentity(closedProcesses, runningStartTimes);
  const goneProcessIdSet = new Set(goneProcessIds);
  return closedProcesses
    .map((closedProcess) => closedProcess.processId)
    .filter((processId) => !goneProcessIdSet.has(processId));
}

/**
 * Timeout of the next liveness query: the time left before the deadline, capped by the usual query timeout and never
 * below {@link TERMINATION_MIN_QUERY_TIMEOUT_MS}.
 * @param {number} remainingMs - Time left before the deadline.
 * @param {number} [queryTimeoutMs] - Usual timeout of a query.
 * @returns {number} Timeout for the query, in milliseconds.
 */
export function computeQueryTimeoutMs(remainingMs, queryTimeoutMs = PROCESS_SNAPSHOT_TIMEOUT_MS) {
  return Math.max(TERMINATION_MIN_QUERY_TIMEOUT_MS, Math.min(queryTimeoutMs, remainingMs));
}

/**
 * Polls in batches until every closed process is gone or the timeout passes. Each query is cut to the time left, and
 * once the deadline passes no further query runs. A failed query stops the wait and leaves the pending processes as
 * unconfirmed; it never throws.
 * @param {object} options - Processes to watch and how to watch them.
 * @param {ProcessInstance[]} options.closedProcesses - Processes that were asked to end.
 * @param {(processIds: number[], queryOptions: ProcessQueryOptions) => Promise<Map<number, number | null>>} options.readProcessStartTimes
 * - Reads the start time of the given processes that still run, within the query timeout.
 * @param {Clock} [options.clock] - Time source, replaceable for tests.
 * @param {number} [options.timeoutMs] - Longest wait.
 * @param {number} [options.pollIntervalMs] - Pause between queries.
 * @param {(error: unknown) => void} [options.onQueryError] - Receives a failed query.
 * @returns {Promise<ProcessExitWait>} Processes gone and processes still running.
 */
export async function waitForProcessExit({
  closedProcesses,
  readProcessStartTimes,
  clock = systemClock,
  timeoutMs = TERMINATION_WAIT_TIMEOUT_MS,
  pollIntervalMs = TERMINATION_POLL_INTERVAL_MS,
  onQueryError = () => {},
}) {
  const deadlineMs = clock.now() + timeoutMs;
  let pendingProcesses = closedProcesses;
  let exitUnconfirmed = false;

  while (pendingProcesses.length > 0) {
    const remainingMs = deadlineMs - clock.now();
    if (remainingMs <= 0) break;
    let runningStartTimes;
    try {
      runningStartTimes = await readProcessStartTimes(
        pendingProcesses.map((pendingProcess) => pendingProcess.processId),
        { timeoutMs: computeQueryTimeoutMs(remainingMs) },
      );
    } catch (error) {
      onQueryError(error);
      exitUnconfirmed = true;
      break;
    }
    const stillRunningProcessIds = new Set(selectStillRunningProcessIds(pendingProcesses, runningStartTimes));
    pendingProcesses = pendingProcesses.filter((pendingProcess) => stillRunningProcessIds.has(pendingProcess.processId));
    if (pendingProcesses.length === 0 || clock.now() >= deadlineMs) break;
    await clock.sleep(Math.min(pollIntervalMs, deadlineMs - clock.now()));
  }

  const stillRunningProcessIds = new Set(pendingProcesses.map((pendingProcess) => pendingProcess.processId));
  return {
    exitedProcessIds: closedProcesses
      .map((closedProcess) => closedProcess.processId)
      .filter((processId) => !stillRunningProcessIds.has(processId)),
    stillRunningProcessIds: [...stillRunningProcessIds],
    exitUnconfirmed: exitUnconfirmed && stillRunningProcessIds.size > 0,
  };
}
