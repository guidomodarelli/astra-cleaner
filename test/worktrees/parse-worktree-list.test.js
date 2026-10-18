import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWorktreeList } from "../../src/worktrees/parse-worktree-list.js";

/**
 * Builds `git worktree list --porcelain -z` output: every attribute ends with a NUL, and an empty one closes each
 * worktree.
 * @param {string[][]} records - Attributes of each worktree.
 * @returns {string} Porcelain output.
 */
function toPorcelain(records) {
  return records.map((attributes) => attributes.map((attribute) => `${attribute}\0`).join("") + "\0").join("");
}

describe("parseWorktreeList", () => {
  it("reads the main worktree first and the linked ones with their lock state", () => {
    const porcelainOutput = toPorcelain([
      ["worktree C:/repos/app", "HEAD 1111111111111111111111111111111111111111", "branch refs/heads/main"],
      ["worktree C:/repos/app-feature", "HEAD 2222222222222222222222222222222222222222", "branch refs/heads/feature"],
      ["worktree C:/repos/app-locked", "HEAD 3333333333333333333333333333333333333333", "detached", "locked kept for a release"],
      ["worktree C:/repos/app-locked-no-reason", "HEAD 4444444444444444444444444444444444444444", "locked"],
    ]);
    assert.deepEqual(parseWorktreeList(porcelainOutput), [
      { path: "C:/repos/app", isMain: true, locked: false },
      { path: "C:/repos/app-feature", isMain: false, locked: false },
      { path: "C:/repos/app-locked", isMain: false, locked: true },
      { path: "C:/repos/app-locked-no-reason", isMain: false, locked: true },
    ]);
  });

  it("keeps paths with spaces and newlines whole", () => {
    const porcelainOutput = toPorcelain([
      ["worktree /home/dev/my repo", "bare"],
      ["worktree /home/dev/odd\nname", "HEAD 5555555555555555555555555555555555555555", "detached"],
    ]);
    assert.deepEqual(parseWorktreeList(porcelainOutput), [
      { path: "/home/dev/my repo", isMain: true, locked: false },
      { path: "/home/dev/odd\nname", isMain: false, locked: false },
    ]);
  });

  it("also reads the plain format that git 2.35 and earlier print", () => {
    const porcelainOutput = "worktree C:/repos/app\r\nbare\r\n\r\nworktree C:/repos/app-locked\r\ndetached\r\nlocked\r\n\r\n";
    assert.deepEqual(parseWorktreeList(porcelainOutput), [
      { path: "C:/repos/app", isMain: true, locked: false },
      { path: "C:/repos/app-locked", isMain: false, locked: true },
    ]);
  });

  it("returns nothing for empty output", () => {
    assert.deepEqual(parseWorktreeList(""), []);
  });
});
