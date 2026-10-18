import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkProcessIdentity } from "../../src/playwright/process-identity.js";

const STARTED_AT_MS = 5_000;

describe("checkProcessIdentity", () => {
  it("sorts ids into same instance, gone or reused, and unverifiable", () => {
    const processInstances = [
      { processId: 100, startedAtMs: STARTED_AT_MS },
      { processId: 101, startedAtMs: STARTED_AT_MS },
      { processId: 102, startedAtMs: STARTED_AT_MS },
      { processId: 103, startedAtMs: null },
      { processId: 104, startedAtMs: STARTED_AT_MS },
    ];
    const runningStartTimes = new Map([
      [100, STARTED_AT_MS],
      [101, STARTED_AT_MS + 1],
      [103, STARTED_AT_MS],
      [104, null],
    ]);
    assert.deepEqual(checkProcessIdentity(processInstances, runningStartTimes), {
      sameInstanceProcessIds: [100],
      goneProcessIds: [101, 102],
      unverifiableProcessIds: [103, 104],
    });
  });
});
