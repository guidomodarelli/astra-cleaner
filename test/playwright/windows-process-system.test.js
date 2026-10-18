import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseProcessSnapshot } from "../../src/playwright/windows-process-system.js";

const PLAYWRIGHT_EXECUTABLE_PATH = String.raw`C:\ms-playwright\webkit-2200\Playwright.exe`;

describe("parseProcessSnapshot", () => {
  it("reads WebKit processes and the start time of every running process", () => {
    const snapshot = parseProcessSnapshot(
      JSON.stringify({
        webKitProcesses: [
          { processId: 100, parentProcessId: 10, executablePath: PLAYWRIGHT_EXECUTABLE_PATH, startedAtMs: 2000 },
        ],
        livingProcesses: [
          { processId: 10, startedAtMs: 1000 },
          { processId: 4, startedAtMs: null },
        ],
      }),
    );
    assert.deepEqual(snapshot.webKitProcesses, [
      { processId: 100, parentProcessId: 10, executablePath: PLAYWRIGHT_EXECUTABLE_PATH, startedAtMs: 2000 },
    ]);
    assert.deepEqual(
      [...snapshot.livingProcesses],
      [
        [10, 1000],
        [4, null],
      ],
    );
  });

  it("accepts a single object where PowerShell prints no list, and missing paths and times", () => {
    const snapshot = parseProcessSnapshot(
      JSON.stringify({
        webKitProcesses: { processId: 100, parentProcessId: 10, executablePath: null },
        livingProcesses: { processId: 10 },
      }),
    );
    assert.deepEqual(snapshot.webKitProcesses, [
      { processId: 100, parentProcessId: 10, executablePath: null, startedAtMs: null },
    ]);
    assert.deepEqual([...snapshot.livingProcesses], [[10, null]]);
  });

  it("treats empty output as no processes", () => {
    const snapshot = parseProcessSnapshot("  \r\n");
    assert.deepEqual(snapshot.webKitProcesses, []);
    assert.equal(snapshot.livingProcesses.size, 0);
  });

  it("throws on output that is not JSON", () => {
    assert.throws(() => parseProcessSnapshot("Get-CimInstance : Access denied"), SyntaxError);
  });
});
