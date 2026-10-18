import assert from "node:assert/strict";
import process from "node:process";
import { describe, it } from "node:test";
import { windowsProcessSystem } from "../../src/playwright/windows-process-system.js";

const isWindows = process.platform === "win32";

describe("windowsProcessSystem.readProcessSnapshot", { skip: !isWindows && "only Windows exposes Win32_Process" }, () => {
  it("reads the real process list, including this test process with its start time", async () => {
    const snapshot = await windowsProcessSystem.readProcessSnapshot();
    assert.ok(snapshot.livingProcesses.has(process.pid));
    assert.equal(typeof snapshot.livingProcesses.get(process.pid), "number");
    for (const webKitProcess of snapshot.webKitProcesses) {
      assert.equal(Number.isInteger(webKitProcess.processId), true);
      assert.equal(Number.isInteger(webKitProcess.parentProcessId), true);
    }
  });
});
