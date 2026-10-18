import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REFUSAL_REASONS } from "../../src/worktrees/constants.js";
import { decideWorktreeRemoval, toComparablePath } from "../../src/worktrees/decide-worktree-removal.js";

const MAIN_WORKTREE = { path: "C:/repos/app", isMain: true, locked: false };
const FEATURE_WORKTREE = { path: "C:/repos/app-feature", isMain: false, locked: false };

/**
 * Builds a decision input for the feature worktree on Windows, clean and outside the current directory.
 * @param {Partial<import("../../src/worktrees/decide-worktree-removal.js").WorktreeRemovalInput>} overrides
 */
function createInput(overrides = {}) {
  return {
    targetPath: String.raw`C:\repos\app-feature`,
    targetExists: true,
    folderEntries: ["package.json", "src", "node_modules"],
    worktrees: [MAIN_WORKTREE, FEATURE_WORKTREE],
    hasUncommittedChanges: false,
    currentDirectory: String.raw`C:\repos\app`,
    force: false,
    platform: "win32",
    ...overrides,
  };
}

describe("toComparablePath", () => {
  it("ignores case, separators and a trailing separator on Windows", () => {
    assert.equal(toComparablePath("C:/Repos/App-Feature/", "win32"), toComparablePath(String.raw`c:\repos\app-feature`, "win32"));
  });

  it("keeps case on POSIX", () => {
    assert.notEqual(toComparablePath("/repos/App", "linux"), toComparablePath("/repos/app", "linux"));
  });

  it("keeps a root path intact", () => {
    assert.equal(toComparablePath("/", "linux"), "/");
  });
});

describe("decideWorktreeRemoval", () => {
  it("removes a clean linked worktree, matching the path whatever its case or separators", () => {
    assert.deepEqual(decideWorktreeRemoval(createInput({ targetPath: "c:/REPOS/app-feature/" })), {
      action: "remove",
      worktreePath: FEATURE_WORKTREE.path,
      mainWorktreePath: MAIN_WORKTREE.path,
    });
  });

  it("refuses a folder that does not exist", () => {
    assert.deepEqual(decideWorktreeRemoval(createInput({ targetExists: false })), {
      action: "refuse",
      reason: REFUSAL_REASONS.MISSING_DIRECTORY,
    });
  });

  it("refuses a folder that is not a worktree of the repository", () => {
    assert.deepEqual(decideWorktreeRemoval(createInput({ targetPath: String.raw`C:\repos\other` })), {
      action: "refuse",
      reason: REFUSAL_REASONS.NOT_A_WORKTREE,
    });
    assert.deepEqual(decideWorktreeRemoval(createInput({ worktrees: [] })), {
      action: "refuse",
      reason: REFUSAL_REASONS.NOT_A_WORKTREE,
    });
  });

  it("removes an unregistered folder holding only node_modules as a leftover of a failed git worktree remove", () => {
    const input = createInput({ targetPath: String.raw`C:\repos\app-gone`, folderEntries: ["Node_Modules"] });
    assert.deepEqual(decideWorktreeRemoval(input), { action: "remove-leftover", worktreePath: String.raw`C:\repos\app-gone` });
  });

  it("keeps an unregistered folder that is empty, holds anything besides node_modules, or is unreadable", () => {
    for (const folderEntries of [["node_modules", "notes.txt"], [], null]) {
      const input = createInput({ targetPath: String.raw`C:\repos\app-gone`, folderEntries });
      assert.deepEqual(decideWorktreeRemoval(input), { action: "refuse", reason: REFUSAL_REASONS.NOT_A_WORKTREE });
    }
  });

  it("never removes a leftover that contains the current directory", () => {
    const input = createInput({
      targetPath: String.raw`C:\repos\app-gone`,
      folderEntries: ["node_modules"],
      currentDirectory: String.raw`C:\repos\app-gone\node_modules`,
    });
    assert.deepEqual(decideWorktreeRemoval(input), { action: "refuse", reason: REFUSAL_REASONS.CONTAINS_CURRENT_DIRECTORY });
  });

  it("never removes the main worktree, even with force", () => {
    const input = createInput({ targetPath: String.raw`C:\repos\app`, currentDirectory: String.raw`D:\elsewhere`, force: true });
    assert.deepEqual(decideWorktreeRemoval(input), { action: "refuse", reason: REFUSAL_REASONS.MAIN_WORKTREE });
  });

  it("never removes a locked worktree, even with force", () => {
    const input = createInput({ worktrees: [MAIN_WORKTREE, { ...FEATURE_WORKTREE, locked: true }], force: true });
    assert.deepEqual(decideWorktreeRemoval(input), { action: "refuse", reason: REFUSAL_REASONS.LOCKED });
  });

  it("never removes the current directory or a folder that contains it, even with force", () => {
    for (const currentDirectory of [String.raw`C:\repos\app-feature`, String.raw`C:\Repos\App-Feature\src\lib`]) {
      assert.deepEqual(decideWorktreeRemoval(createInput({ currentDirectory, force: true })), {
        action: "refuse",
        reason: REFUSAL_REASONS.CONTAINS_CURRENT_DIRECTORY,
      });
    }
  });

  it("does not mistake a sibling folder with a longer name for the current directory", () => {
    const input = createInput({ currentDirectory: String.raw`C:\repos\app-feature-2` });
    assert.equal(decideWorktreeRemoval(input).action, "remove");
  });

  it("keeps a worktree with uncommitted changes unless forced", () => {
    assert.deepEqual(decideWorktreeRemoval(createInput({ hasUncommittedChanges: true })), {
      action: "refuse",
      reason: REFUSAL_REASONS.UNCOMMITTED_CHANGES,
    });
    assert.equal(decideWorktreeRemoval(createInput({ hasUncommittedChanges: true, force: true })).action, "remove");
  });

  it("keeps a worktree whose status is unknown unless forced", () => {
    assert.deepEqual(decideWorktreeRemoval(createInput({ hasUncommittedChanges: null })), {
      action: "refuse",
      reason: REFUSAL_REASONS.STATUS_UNKNOWN,
    });
    assert.equal(decideWorktreeRemoval(createInput({ hasUncommittedChanges: null, force: true })).action, "remove");
  });
});
