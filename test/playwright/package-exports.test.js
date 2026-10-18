import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);

describe("package exports", () => {
  it("resolves the Playwright hooks the way Playwright resolves globalSetup and globalTeardown", () => {
    // Playwright resolves a non-local `globalSetup` with `require.resolve(id, { paths: [configDir] })`.
    for (const hookPath of ["@astra-kit/cleaner/playwright/global-setup", "@astra-kit/cleaner/playwright/global-teardown"]) {
      assert.match(require.resolve(hookPath), /global-(setup|teardown)\.js$/u);
    }
  });

  it("exposes runnable hooks and the cleanup API through the public entry points", async () => {
    const { default: globalSetup } = await import("@astra-kit/cleaner/playwright/global-setup");
    const { default: globalTeardown } = await import("@astra-kit/cleaner/playwright/global-teardown");
    const playwrightCleanup = await import("@astra-kit/cleaner/playwright");
    assert.equal(typeof globalSetup, "function");
    assert.equal(globalSetup, globalTeardown);
    assert.equal(typeof playwrightCleanup.cleanOrphanWebKitProcesses, "function");
    assert.equal(typeof playwrightCleanup.selectOrphanWebKitProcessIds, "function");
  });
});

describe("0.1 compatibility", () => {
  it("keeps isPlaywrightExecutable as an alias of isPlaywrightWebKitExecutable", async () => {
    const playwrightCleanup = await import("@astra-kit/cleaner/playwright");
    assert.equal(playwrightCleanup.isPlaywrightExecutable, playwrightCleanup.isPlaywrightWebKitExecutable);
  });
});
