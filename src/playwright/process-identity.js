/**
 * @module playwright/process-identity Pure checks of whether a process id still names the same process instance.
 *
 * Windows reuses process ids, so an id alone does not identify a process: the cleanup pairs it with the start time
 * read in the snapshot.
 */

/**
 * @typedef {object} ProcessInstance
 * @property {number} processId - Process id.
 * @property {number | null} startedAtMs - Start time in Unix milliseconds, or `null` when unknown.
 */

/**
 * @typedef {object} ProcessIdentityCheck
 * @property {number[]} sameInstanceProcessIds - Ids that still name the same instance.
 * @property {number[]} goneProcessIds - Ids that no longer run, or that a newer process reused.
 * @property {number[]} unverifiableProcessIds - Ids that still run but whose identity cannot be checked, because a
 * start time is unknown.
 */

/**
 * Sorts processes by whether their id still names the same instance.
 * @param {ProcessInstance[]} processInstances - Processes as seen earlier.
 * @param {Map<number, number | null>} runningStartTimes - Start time of the running processes among them, by id.
 * @returns {ProcessIdentityCheck} Ids grouped by identity, each in input order.
 */
export function checkProcessIdentity(processInstances, runningStartTimes) {
  /** @type {ProcessIdentityCheck} */
  const identityCheck = { sameInstanceProcessIds: [], goneProcessIds: [], unverifiableProcessIds: [] };
  for (const { processId, startedAtMs } of processInstances) {
    if (!runningStartTimes.has(processId)) {
      identityCheck.goneProcessIds.push(processId);
      continue;
    }
    const runningStartedAtMs = runningStartTimes.get(processId);
    if (runningStartedAtMs == null || startedAtMs == null) identityCheck.unverifiableProcessIds.push(processId);
    else if (runningStartedAtMs === startedAtMs) identityCheck.sameInstanceProcessIds.push(processId);
    else identityCheck.goneProcessIds.push(processId);
  }
  return identityCheck;
}
