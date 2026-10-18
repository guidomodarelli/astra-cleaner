import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGlobalHook } from "../../src/playwright/global-hook.js";

describe("createGlobalHook", () => {
  it("runs the cleanup with its defaults, never with the Playwright config", async () => {
    /** @type {unknown[][]} */
    const cleanupCalls = [];
    const hook = createGlobalHook(async (...cleanupArguments) => {
      cleanupCalls.push(cleanupArguments);
    });
    const playwrightConfig = { rootDir: "/repo", workers: 4, projects: [] };
    await hook(playwrightConfig);
    await hook();
    assert.deepEqual(cleanupCalls, [[], []]);
  });
});
