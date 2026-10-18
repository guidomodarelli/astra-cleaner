/**
 * @module @astra-kit/cleaner/worktrees Removes git worktrees whose `git worktree remove` fails on Windows' long paths.
 *
 * Inside `node_modules`, paths easily pass Windows' 260-character limit and `git worktree remove` stops with
 * "Filename too long", leaving a half-deleted folder still registered. `fs.rmSync` handles those paths, and
 * `git worktree prune` then drops the record. The branch and its commits are kept. A folder left behind by a failed
 * `git worktree remove` (unregistered, holding only `node_modules`) is removed too.
 */
export { FORCE_FLAG, LEFTOVER_ENTRY_NAMES, REFUSAL_REASONS } from "./constants.js";
export { decideWorktreeRemoval, toComparablePath } from "./decide-worktree-removal.js";
export { parseWorktreeList } from "./parse-worktree-list.js";
export { gitWorktreeSystem } from "./git-worktree-system.js";
export { removeWorktrees, worktreesCleanupApplies } from "./remove-worktrees.js";
