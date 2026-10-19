import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);

describe("package exports", () => {
  it("resolves the Playwright hooks the way Playwright resolves globalSetup and globalTeardown", () => {
    // Playwright resolves a non-local `globalSetup` with `require.resolve(id, { paths: [configDir] })`.
    for (const hookPath of ["@golfo/cleaner/playwright/global-setup", "@golfo/cleaner/playwright/global-teardown"]) {
      assert.match(require.resolve(hookPath), /global-(setup|teardown)\.js$/u);
    }
  });

  it("exposes runnable hooks and the cleanup API through the public entry points", async () => {
    const { default: globalSetup } = await import("@golfo/cleaner/playwright/global-setup");
    const { default: globalTeardown } = await import("@golfo/cleaner/playwright/global-teardown");
    const playwrightCleanup = await import("@golfo/cleaner/playwright");
    assert.equal(typeof globalSetup, "function");
    assert.equal(globalSetup, globalTeardown);
    assert.equal(typeof playwrightCleanup.cleanOrphanWebKitProcesses, "function");
    assert.equal(typeof playwrightCleanup.selectOrphanWebKitProcessIds, "function");
  });
});

describe("0.1 compatibility", () => {
  it("keeps isPlaywrightExecutable as an alias of isPlaywrightWebKitExecutable", async () => {
    const playwrightCleanup = await import("@golfo/cleaner/playwright");
    assert.equal(playwrightCleanup.isPlaywrightExecutable, playwrightCleanup.isPlaywrightWebKitExecutable);
  });
});

describe("worktrees export", () => {
  it("exposes the worktree cleanup through its own entry point", async () => {
    const worktreesCleanup = await import("@golfo/cleaner/worktrees");
    assert.equal(typeof worktreesCleanup.removeWorktrees, "function");
    assert.equal(typeof worktreesCleanup.decideWorktreeRemoval, "function");
  });
});
