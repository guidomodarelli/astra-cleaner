import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isParentAlive,
  isPlaywrightWebKitExecutable,
  selectOrphanWebKitProcessIds,
} from "../../src/playwright/select-orphan-webkit-process-ids.js";

const PLAYWRIGHT_WEBKIT_FOLDER = String.raw`C:\Users\dev\AppData\Local\ms-playwright\webkit-2200\Playwright`;
const BROWSER_STARTED_AT_MS = 1_000;
const HELPER_STARTED_AT_MS = 2_000;

/**
 * Builds a WebKit process under Playwright's browsers folder.
 * @param {Partial<import("../../src/playwright/select-orphan-webkit-process-ids.js").WebKitProcess>} overrides
 */
function createWebKitProcess(overrides) {
  return {
    processId: 100,
    parentProcessId: 10,
    executablePath: `${PLAYWRIGHT_WEBKIT_FOLDER}\\WebKitWebProcess.exe`,
    startedAtMs: HELPER_STARTED_AT_MS,
    ...overrides,
  };
}

describe("isPlaywrightWebKitExecutable", () => {
  it("accepts executables under ms-playwright whatever the case or separator", () => {
    assert.equal(isPlaywrightWebKitExecutable(`${PLAYWRIGHT_WEBKIT_FOLDER}\\Playwright.exe`), true);
    assert.equal(isPlaywrightWebKitExecutable("C:/Users/dev/AppData/Local/MS-PLAYWRIGHT/webkit/Playwright.exe"), true);
  });

  it("accepts every WebKit executable, whatever its case", () => {
    for (const executableName of ["Playwright.exe", "WebKitGPUProcess.exe", "webkitnetworkprocess.EXE", "WebKitWebProcess.exe"]) {
      assert.equal(isPlaywrightWebKitExecutable(`${PLAYWRIGHT_WEBKIT_FOLDER}\\${executableName}`), true, executableName);
    }
  });

  it("rejects other executables under ms-playwright", () => {
    assert.equal(isPlaywrightWebKitExecutable(`${PLAYWRIGHT_WEBKIT_FOLDER}\\MiniBrowser.exe`), false);
    assert.equal(isPlaywrightWebKitExecutable(String.raw`C:\ms-playwright\chromium-1200\chrome-win\chrome.exe`), false);
  });

  it("rejects executables outside ms-playwright, look-alike folders and unknown paths", () => {
    assert.equal(isPlaywrightWebKitExecutable(String.raw`C:\Program Files\Safari\WebKitWebProcess.exe`), false);
    assert.equal(isPlaywrightWebKitExecutable(String.raw`C:\tools\ms-playwright-old\WebKitWebProcess.exe`), false);
    assert.equal(isPlaywrightWebKitExecutable(null), false);
  });
});

/** Child whose parent is process 10, as `isParentAlive` reads it. */
const CHILD_OF_PROCESS_10 = { parentProcessId: 10, startedAtMs: HELPER_STARTED_AT_MS };

describe("isParentAlive", () => {
  it("is false when the parent no longer runs", () => {
    assert.equal(isParentAlive(CHILD_OF_PROCESS_10, new Map()), false);
  });

  it("is true when the parent started before the child", () => {
    assert.equal(isParentAlive(CHILD_OF_PROCESS_10, new Map([[10, BROWSER_STARTED_AT_MS]])), true);
  });

  it("is false when a newer process reused the parent id", () => {
    const reusedParentStartedAtMs = HELPER_STARTED_AT_MS + 1;
    assert.equal(isParentAlive(CHILD_OF_PROCESS_10, new Map([[10, reusedParentStartedAtMs]])), false);
  });

  it("assumes the parent alive when either start time is unknown", () => {
    assert.equal(isParentAlive(CHILD_OF_PROCESS_10, new Map([[10, null]])), true);
    assert.equal(
      isParentAlive({ ...CHILD_OF_PROCESS_10, startedAtMs: null }, new Map([[10, BROWSER_STARTED_AT_MS]])),
      true,
    );
  });
});

describe("selectOrphanWebKitProcessIds", () => {
  it("selects Playwright processes whose parent is gone", () => {
    const webKitProcesses = [createWebKitProcess({ processId: 100, parentProcessId: 10 })];
    assert.deepEqual(selectOrphanWebKitProcessIds(webKitProcesses, new Map()), [100]);
  });

  it("never selects a process whose parent is alive", () => {
    const webKitProcesses = [createWebKitProcess({ processId: 100, parentProcessId: 10 })];
    assert.deepEqual(selectOrphanWebKitProcessIds(webKitProcesses, new Map([[10, BROWSER_STARTED_AT_MS]])), []);
  });

  it("selects a process whose parent id was reused by a newer process", () => {
    const webKitProcesses = [createWebKitProcess({ processId: 100, parentProcessId: 10 })];
    const livingProcesses = new Map([[10, HELPER_STARTED_AT_MS + 1]]);
    assert.deepEqual(selectOrphanWebKitProcessIds(webKitProcesses, livingProcesses), [100]);
  });

  it("keeps a process whose start time is unknown while its parent id is in use", () => {
    const webKitProcesses = [createWebKitProcess({ processId: 100, parentProcessId: 10, startedAtMs: null })];
    assert.deepEqual(selectOrphanWebKitProcessIds(webKitProcesses, new Map([[10, BROWSER_STARTED_AT_MS]])), []);
  });

  it("keeps processes whose id or parent id is unknown", () => {
    const webKitProcesses = [
      createWebKitProcess({ processId: null }),
      createWebKitProcess({ processId: 101, parentProcessId: null }),
    ];
    assert.deepEqual(selectOrphanWebKitProcessIds(webKitProcesses, new Map()), []);
  });

  it("ignores WebKit processes outside ms-playwright even when orphaned", () => {
    const webKitProcesses = [
      createWebKitProcess({ processId: 100, executablePath: String.raw`C:\Program Files\Safari\WebKitWebProcess.exe` }),
      createWebKitProcess({ processId: 101, executablePath: null }),
    ];
    assert.deepEqual(selectOrphanWebKitProcessIds(webKitProcesses, new Map()), []);
  });

  it("selects the helpers of an orphaned browser, whose parent is about to be closed", () => {
    const orphanedBrowser = createWebKitProcess({
      processId: 50,
      parentProcessId: 5,
      executablePath: `${PLAYWRIGHT_WEBKIT_FOLDER}\\Playwright.exe`,
      startedAtMs: BROWSER_STARTED_AT_MS,
    });
    const helper = createWebKitProcess({ processId: 100, parentProcessId: 50 });
    const livingProcesses = new Map([[50, BROWSER_STARTED_AT_MS]]);
    assert.deepEqual(selectOrphanWebKitProcessIds([helper, orphanedBrowser], livingProcesses), [100, 50]);
  });

  it("keeps the whole tree of a browser whose test runner is alive", () => {
    const browser = createWebKitProcess({
      processId: 50,
      parentProcessId: 5,
      executablePath: `${PLAYWRIGHT_WEBKIT_FOLDER}\\Playwright.exe`,
      startedAtMs: BROWSER_STARTED_AT_MS,
    });
    const helper = createWebKitProcess({ processId: 100, parentProcessId: 50 });
    const livingProcesses = new Map([
      [5, 0],
      [50, BROWSER_STARTED_AT_MS],
    ]);
    assert.deepEqual(selectOrphanWebKitProcessIds([browser, helper], livingProcesses), []);
  });
});
