/** @module worktrees/parse-worktree-list Parses `git worktree list --porcelain`. */

/** @typedef {import("./decide-worktree-removal.js").WorktreeEntry} WorktreeEntry */

/**
 * Parses the porcelain output of `git worktree list`: one block per worktree, separated by a blank line, the main
 * worktree first. A bare repository has no main worktree folder, so its block is marked as main but never matches a
 * folder to remove.
 * @param {string} porcelainOutput - Output of `git worktree list --porcelain`.
 * @returns {WorktreeEntry[]} Worktrees, main first.
 */
export function parseWorktreeList(porcelainOutput) {
  return porcelainOutput
    .replace(/\r\n/gu, "\n")
    .split(/\n\n+/u)
    .map((block) => block.split("\n").filter(Boolean))
    .filter((lines) => lines.some((line) => line.startsWith("worktree ")))
    .map((lines, blockIndex) => {
      const worktreeLine = lines.find((line) => line.startsWith("worktree ")) ?? "";
      return {
        path: worktreeLine.slice("worktree ".length),
        isMain: blockIndex === 0,
        locked: lines.some((line) => line === "locked" || line.startsWith("locked ")),
      };
    });
}
