import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { REFUSAL_REASONS } from "../../src/worktrees/constants.js";
import { removeWorktrees } from "../../src/worktrees/remove-worktrees.js";

const MAIN_PATH = path.resolve("repos-fixture/app");
const FEATURE_PATH = path.resolve("repos-fixture/app-feature");
const DIRTY_PATH = path.resolve("repos-fixture/app-dirty");

/**
 * Builds a fake git and file system with a main worktree, a clean feature worktree and a dirty one, recording what it
 * removes and prunes.
 * @param {Partial<import("../../src/worktrees/git-worktree-system.js").WorktreeSystem>} [overrides]
 */
function createSystem(overrides = {}) {
  /** @type {string[]} */
  const removedFolders = [];
  /** @type {string[]} */
  const prunedRepositories = [];
  return {
    removedFolders,
    prunedRepositories,
    /** @param {string} folderPath */
    folderExists: (folderPath) => [MAIN_PATH, FEATURE_PATH, DIRTY_PATH].includes(folderPath),
    listFolderEntries: () => ["package.json", "node_modules"],
    /** @param {string} folderPath */
    toCanonicalPath: (folderPath) => path.resolve(folderPath),
    listWorktrees: async () => [
      { path: MAIN_PATH, isMain: true, locked: false },
      { path: FEATURE_PATH, isMain: false, locked: false },
      { path: DIRTY_PATH, isMain: false, locked: false },
    ],
    /** @param {string} worktreePath */
    hasUncommittedChanges: async (worktreePath) => worktreePath === DIRTY_PATH,
    hasInitializedSubmodules: async () => false,
    /** @param {string} folderPath */
    removeFolder(folderPath) {
      removedFolders.push(folderPath);
    },
    /** @param {string} mainWorktreePath */
    async pruneWorktrees(mainWorktreePath) {
      prunedRepositories.push(mainWorktreePath);
    },
    ...overrides,
  };
}

/** Collects messages sent to `log` and `warn`. */
function createOutput() {
  /** @type {string[]} */
  const logs = [];
  /** @type {string[]} */
  const warnings = [];
  return {
    logs,
    warnings,
    /** @param {string} message */
    log: (message) => logs.push(message),
    /** @param {string} message */
    warn: (message) => warnings.push(message),
  };
}

/** Options shared by every run: outside the fixture repository, on the current platform. */
const BASE_OPTIONS = { currentDirectory: path.resolve("elsewhere") };

describe("removeWorktrees", () => {
  it("removes the folder, then prunes the record from the main worktree", async () => {
    const system = createSystem();
    const output = createOutput();
    const result = await removeWorktrees({ ...BASE_OPTIONS, paths: [FEATURE_PATH], system, ...output });
    assert.deepEqual(result, { removedPaths: [FEATURE_PATH], refused: [], failed: [] });
    assert.deepEqual(system.removedFolders, [FEATURE_PATH]);
    assert.deepEqual(system.prunedRepositories, [MAIN_PATH]);
    assert.match(output.logs.join("\n"), /Removed worktree/u);
  });

  it("only reports in a dry run", async () => {
    const system = createSystem();
    const output = createOutput();
    const result = await removeWorktrees({ ...BASE_OPTIONS, paths: [FEATURE_PATH], dryRun: true, system, ...output });
    assert.deepEqual(result.removedPaths, [FEATURE_PATH]);
    assert.deepEqual(system.removedFolders, []);
    assert.deepEqual(system.prunedRepositories, []);
    assert.match(output.logs.join("\n"), /Dry run: would remove worktree/u);
  });

  it("keeps a dirty worktree with an actionable warning, and removes it with force", async () => {
    const system = createSystem();
    const output = createOutput();
    const result = await removeWorktrees({ ...BASE_OPTIONS, paths: [DIRTY_PATH, FEATURE_PATH], system, ...output });
    assert.deepEqual(result.refused, [{ path: DIRTY_PATH, reason: REFUSAL_REASONS.UNCOMMITTED_CHANGES }]);
    assert.deepEqual(result.removedPaths, [FEATURE_PATH]);
    assert.match(output.warnings.join("\n"), /uncommitted changes; commit them or pass --force/u);

    const forcedSystem = createSystem();
    const forced = await removeWorktrees({ ...BASE_OPTIONS, paths: [DIRTY_PATH], force: true, system: forcedSystem, ...createOutput() });
    assert.deepEqual(forced.removedPaths, [DIRTY_PATH]);
  });

  it("refuses a folder outside a repository when git cannot list worktrees", async () => {
    const system = createSystem({
      listWorktrees: async () => {
        throw new Error("fatal: not a git repository");
      },
    });
    const result = await removeWorktrees({ ...BASE_OPTIONS, paths: [FEATURE_PATH], system, ...createOutput() });
    assert.deepEqual(result.refused, [{ path: FEATURE_PATH, reason: REFUSAL_REASONS.NOT_A_WORKTREE }]);
    assert.deepEqual(system.removedFolders, []);
  });

  it("treats an unreadable status as unknown and keeps the worktree", async () => {
    const system = createSystem({
      hasUncommittedChanges: async () => {
        throw new Error("fatal: unable to read index");
      },
    });
    const result = await removeWorktrees({ ...BASE_OPTIONS, paths: [FEATURE_PATH], system, ...createOutput() });
    assert.deepEqual(result.refused, [{ path: FEATURE_PATH, reason: REFUSAL_REASONS.STATUS_UNKNOWN }]);
  });

  it("keeps a worktree with initialized submodules, even with force", async () => {
    const system = createSystem({ hasInitializedSubmodules: async () => true });
    const output = createOutput();
    const result = await removeWorktrees({ ...BASE_OPTIONS, paths: [FEATURE_PATH], force: true, system, ...output });
    assert.deepEqual(result.refused, [{ path: FEATURE_PATH, reason: REFUSAL_REASONS.CONTAINS_SUBMODULES }]);
    assert.deepEqual(system.removedFolders, []);
    assert.match(output.warnings.join("\n"), /initialized submodules/u);
  });

  it("reports a busy folder with a hint and keeps going with the next one", async () => {
    const system = createSystem({
      removeFolder: (folderPath) => {
        if (folderPath === FEATURE_PATH) throw Object.assign(new Error("resource busy or locked"), { code: "EBUSY" });
      },
    });
    const output = createOutput();
    const result = await removeWorktrees({
      ...BASE_OPTIONS,
      paths: [FEATURE_PATH, DIRTY_PATH],
      force: true,
      system,
      ...output,
    });
    assert.deepEqual(result.failed, [{ path: FEATURE_PATH, error: "EBUSY: resource busy or locked" }]);
    assert.deepEqual(result.removedPaths, [DIRTY_PATH]);
    assert.match(output.warnings.join("\n"), /removeFolder failed.*EBUSY.*cleaner playwright/u);
  });

  it("still counts the folder as removed when only the prune fails, and says how to finish", async () => {
    const system = createSystem({
      pruneWorktrees: async () => {
        throw new Error("fatal: index.lock exists");
      },
    });
    const output = createOutput();
    const result = await removeWorktrees({ ...BASE_OPTIONS, paths: [FEATURE_PATH], system, ...output });
    assert.deepEqual(result.removedPaths, [FEATURE_PATH]);
    assert.match(output.warnings.join("\n"), /git worktree prune failed.*Run it by hand/u);
  });
});
