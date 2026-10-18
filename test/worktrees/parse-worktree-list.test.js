import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWorktreeList } from "../../src/worktrees/parse-worktree-list.js";

describe("parseWorktreeList", () => {
  it("reads the main worktree first and the linked ones with their lock state", () => {
    const porcelainOutput = [
      "worktree C:/repos/app",
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      "worktree C:/repos/app-feature",
      "HEAD 2222222222222222222222222222222222222222",
      "branch refs/heads/feature",
      "",
      "worktree C:/repos/app-locked",
      "HEAD 3333333333333333333333333333333333333333",
      "detached",
      "locked kept for a release",
      "",
      "worktree C:/repos/app-locked-no-reason",
      "HEAD 4444444444444444444444444444444444444444",
      "branch refs/heads/other",
      "locked",
      "",
    ].join("\r\n");
    assert.deepEqual(parseWorktreeList(porcelainOutput), [
      { path: "C:/repos/app", isMain: true, locked: false },
      { path: "C:/repos/app-feature", isMain: false, locked: false },
      { path: "C:/repos/app-locked", isMain: false, locked: true },
      { path: "C:/repos/app-locked-no-reason", isMain: false, locked: true },
    ]);
  });

  it("keeps paths with spaces whole", () => {
    assert.deepEqual(parseWorktreeList("worktree /home/dev/my repo\nbare\n"), [
      { path: "/home/dev/my repo", isMain: true, locked: false },
    ]);
  });

  it("returns nothing for empty output", () => {
    assert.deepEqual(parseWorktreeList(""), []);
  });
});
