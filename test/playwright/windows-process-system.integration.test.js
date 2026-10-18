import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { after, before, describe, it } from "node:test";
import { cleanOrphanWebKitProcesses } from "../../src/playwright/clean-orphan-webkit-processes.js";
import { windowsProcessSystem } from "../../src/playwright/windows-process-system.js";

const isWindows = process.platform === "win32";
/** Keeps the fake WebKit helper alive until the test ends it. */
const KEEP_ALIVE_SCRIPT = "setInterval(() => {}, 1000)";

describe("windowsProcessSystem on Windows", { skip: !isWindows && "only Windows exposes Win32_Process" }, () => {
  /** @type {string} */
  let temporaryFolder;
  /** @type {import("node:child_process").ChildProcess} */
  let fakeWebKitHelper;

  before(async () => {
    // A copy of node.exe named like a WebKit helper under an `ms-playwright` folder, started by this test process.
    temporaryFolder = await mkdtemp(path.join(tmpdir(), "astra-cleaner-"));
    const webKitFolder = path.join(temporaryFolder, "ms-playwright", "webkit-0000", "Playwright");
    await mkdir(webKitFolder, { recursive: true });
    const fakeHelperPath = path.join(webKitFolder, "WebKitWebProcess.exe");
    await copyFile(process.execPath, fakeHelperPath);
    fakeWebKitHelper = spawn(fakeHelperPath, ["-e", KEEP_ALIVE_SCRIPT], { stdio: "ignore", windowsHide: true });
    await once(fakeWebKitHelper, "spawn");
  });

  after(async () => {
    if (fakeWebKitHelper.exitCode === null) {
      fakeWebKitHelper.kill();
      await once(fakeWebKitHelper, "exit");
    }
    await rm(temporaryFolder, { recursive: true, force: true, maxRetries: 5 });
  });

  it("reads the WebKit helper and only its living parent, with start times", async () => {
    const snapshot = await windowsProcessSystem.readProcessSnapshot();
    const fakeHelper = snapshot.webKitProcesses.find((webKitProcess) => webKitProcess.processId === fakeWebKitHelper.pid);
    assert.ok(fakeHelper, "the fake WebKit helper is listed");
    assert.equal(fakeHelper.parentProcessId, process.pid);
    assert.equal(typeof fakeHelper.startedAtMs, "number");
    assert.match(fakeHelper.executablePath ?? "", /ms-playwright/u);
    assert.equal(typeof snapshot.livingProcesses.get(process.pid), "number");

    const parentProcessIds = new Set(snapshot.webKitProcesses.map((webKitProcess) => webKitProcess.parentProcessId));
    for (const livingProcessId of snapshot.livingProcesses.keys()) {
      assert.equal(parentProcessIds.has(livingProcessId), true, `process ${livingProcessId} is not a WebKit parent`);
    }
  });

  it("closes a helper whose parent exited, and only that one", async () => {
    const launcherScript = [
      "const { spawn } = require('node:child_process');",
      "const helper = spawn(process.argv[1], ['-e', process.argv[2]], { detached: true, stdio: 'ignore', windowsHide: true });",
      "helper.unref();",
      "console.log(helper.pid);",
    ].join(" ");
    const launcher = spawn(process.execPath, ["-e", launcherScript, fakeWebKitHelper.spawnfile, KEEP_ALIVE_SCRIPT], {
      stdio: ["ignore", "pipe", "inherit"],
      windowsHide: true,
    });
    let launcherOutput = "";
    launcher.stdout?.on("data", (chunk) => {
      launcherOutput += chunk;
    });
    await once(launcher, "exit");
    const orphanProcessId = Number(launcherOutput.trim());
    assert.equal(Number.isInteger(orphanProcessId), true, "the launcher printed the orphan pid");

    /** @type {number[]} */
    const otherOrphanProcessIds = [];
    try {
      const result = await cleanOrphanWebKitProcesses({
        system: {
          readProcessSnapshot: windowsProcessSystem.readProcessSnapshot,
          // Real orphans of other runs on this machine are only recorded, never closed by the test.
          terminateProcess(processId) {
            if (processId === orphanProcessId) windowsProcessSystem.terminateProcess(processId);
            else otherOrphanProcessIds.push(processId);
          },
        },
        log: () => {},
        warn: assert.fail,
      });
      assert.equal(result.terminatedProcessIds.includes(orphanProcessId), true);
      assert.equal(result.orphanProcessIds.includes(/** @type {number} */ (fakeWebKitHelper.pid)), false);
    } finally {
      try {
        process.kill(orphanProcessId);
      } catch {
        // Already closed by the cleanup, which is the expected outcome.
      }
    }
    const snapshotAfterCleanup = await windowsProcessSystem.readProcessSnapshot();
    const orphanStillRuns = snapshotAfterCleanup.webKitProcesses.some(
      (webKitProcess) => webKitProcess.processId === orphanProcessId,
    );
    assert.equal(orphanStillRuns, false);
  });

  it("never closes a helper whose parent is alive", async () => {
    const result = await cleanOrphanWebKitProcesses({ dryRun: true, log: () => {}, warn: assert.fail });
    assert.equal(result.orphanProcessIds.includes(/** @type {number} */ (fakeWebKitHelper.pid)), false);
    assert.equal(fakeWebKitHelper.exitCode, null);
  });
});
