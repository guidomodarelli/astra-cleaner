import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listWorktreesWith } from "../../src/worktrees/git-worktree-system.js";

const PLAIN_PORCELAIN = "worktree /repos/app\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/main\n\nworktree /repos/app-feature\nHEAD 2222222222222222222222222222222222222222\nbranch refs/heads/feature\n\n";

describe("listWorktreesWith", () => {
  it("falls back to the plain format when git rejects -z, as git 2.35 and earlier do", async () => {
    /** @type {string[][]} */
    const calls = [];
    const worktrees = await listWorktreesWith(async (_folderPath, gitArguments) => {
      calls.push(gitArguments);
      if (gitArguments.includes("-z")) throw new Error("error: unknown switch `z'");
      return PLAIN_PORCELAIN;
    }, "/repos/app");
    assert.deepEqual(
      worktrees.map((worktree) => worktree.path),
      ["/repos/app", "/repos/app-feature"],
    );
    assert.deepEqual(calls, [
      ["worktree", "list", "--porcelain", "-z"],
      ["worktree", "list", "--porcelain"],
    ]);
  });

  it("throws when the folder is not in a repository, whatever the format", async () => {
    await assert.rejects(
      listWorktreesWith(async () => {
        throw new Error("fatal: not a git repository");
      }, "/tmp/plain"),
      /not a git repository/u,
    );
  });
});
