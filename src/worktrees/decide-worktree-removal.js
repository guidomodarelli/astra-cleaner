/** @module worktrees/decide-worktree-removal Pure decision of whether a worktree may be removed. */
import path from "node:path";
import { LEFTOVER_ENTRY_NAMES, REFUSAL_REASONS } from "./constants.js";

/**
 * @typedef {object} WorktreeEntry
 * @property {string} path - Worktree folder, as `git worktree list --porcelain` prints it.
 * @property {boolean} isMain - Whether it is the main worktree, the one that holds the repository.
 * @property {boolean} locked - Whether `git worktree lock` protects it.
 */

/**
 * @typedef {"not-a-worktree" | "main-worktree" | "locked" | "contains-current-directory" | "uncommitted-changes" |
 *   "status-unknown" | "missing-directory" | "contains-submodules"} RefusalReason
 */

/**
 * @typedef {{ action: "remove", worktreePath: string, mainWorktreePath: string } |
 *   { action: "remove-leftover", worktreePath: string } |
 *   { action: "refuse", reason: RefusalReason }} WorktreeRemovalDecision
 */

/**
 * @typedef {object} WorktreeRemovalInput
 * @property {string} targetPath - Folder the person asked to remove.
 * @property {boolean} targetExists - Whether that folder exists.
 * @property {string[] | null} folderEntries - Names directly inside the folder, or `null` when unreadable.
 * @property {WorktreeEntry[]} worktrees - Worktrees of the repository the folder belongs to.
 * @property {boolean | null} hasUncommittedChanges - Whether the worktree has changes git would lose (including
 * untracked files), or `null` when its status could not be read.
 * @property {boolean | null} hasInitializedSubmodules - Whether the worktree has initialized submodules, whose local
 * branches and commits live only in its administrative directory, or `null` when that could not be read.
 * @property {string} currentDirectory - Working directory of the cleanup, which must survive it.
 * @property {boolean} force - Remove even with uncommitted changes or an unreadable status.
 * @property {string} platform - Platform name, as `process.platform` reports it; paths compare case-insensitively on
 * Windows.
 */

/**
 * Turns a path into a comparable form: absolute, without a trailing separator, with the platform's separators and,
 * on Windows, lowercased because its file system ignores case.
 * @param {string} folderPath - Path to normalize.
 * @param {string} platform - Platform name.
 * @returns {string} Comparable path.
 */
export function toComparablePath(folderPath, platform) {
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  const resolvedPath = platformPath.resolve(folderPath);
  const trimmedPath =
    resolvedPath.length > platformPath.parse(resolvedPath).root.length
      ? resolvedPath.replace(/[\\/]+$/u, "")
      : resolvedPath;
  return platform === "win32" ? trimmedPath.toLowerCase() : trimmedPath;
}

/**
 * Tells whether `innerPath` is `outerPath` or lies inside it.
 * @param {string} innerPath - Comparable path that may be inside.
 * @param {string} outerPath - Comparable folder.
 * @param {string} platform - Platform name.
 * @returns {boolean} `true` when `innerPath` is within `outerPath`.
 */
function isWithin(innerPath, outerPath, platform) {
  const separator = platform === "win32" ? path.win32.sep : path.posix.sep;
  return innerPath === outerPath || innerPath.startsWith(`${outerPath}${separator}`);
}

/**
 * Tells whether a folder only holds what a failed `git worktree remove` leaves behind.
 * @param {string[] | null} folderEntries - Names directly inside the folder, or `null` when unreadable.
 * @param {string} platform - Platform name; names compare case-insensitively on Windows.
 * @returns {boolean} `true` when the folder is not empty and every entry is a rebuildable leftover; an empty folder
 * is not a leftover a failed removal would leave.
 */
function holdsOnlyLeftovers(folderEntries, platform) {
  if (folderEntries === null || folderEntries.length === 0) return false;
  const normalize = (/** @type {string} */ entryName) => (platform === "win32" ? entryName.toLowerCase() : entryName);
  const leftoverNames = new Set(LEFTOVER_ENTRY_NAMES.map(normalize));
  return folderEntries.every((entryName) => leftoverNames.has(normalize(entryName)));
}

/**
 * Decides whether a worktree folder may be removed. Every guard errs on the side of keeping the folder: only an
 * unlocked, linked worktree of the repository, outside the current directory and without changes git would lose, is
 * removed. `force` lifts only the uncommitted-changes guards; a worktree with initialized submodules is always kept,
 * as git itself does, because removing it would delete commits that exist nowhere else. An unregistered folder that holds only what a failed
 * `git worktree remove` leaves behind (`node_modules`) is removed as a leftover, since nothing in it is lost.
 * @param {WorktreeRemovalInput} input - What is known about the folder.
 * @returns {WorktreeRemovalDecision} Whether to remove it, and why not otherwise.
 */
export function decideWorktreeRemoval({
  targetPath,
  targetExists,
  folderEntries,
  worktrees,
  hasUncommittedChanges,
  hasInitializedSubmodules,
  currentDirectory,
  force,
  platform,
}) {
  if (!targetExists) return { action: "refuse", reason: REFUSAL_REASONS.MISSING_DIRECTORY };
  const comparableTargetPath = toComparablePath(targetPath, platform);
  const worktree = worktrees.find((entry) => toComparablePath(entry.path, platform) === comparableTargetPath);
  if (worktree?.isMain) return { action: "refuse", reason: REFUSAL_REASONS.MAIN_WORKTREE };
  if (worktree?.locked) return { action: "refuse", reason: REFUSAL_REASONS.LOCKED };
  if (isWithin(toComparablePath(currentDirectory, platform), comparableTargetPath, platform)) {
    return { action: "refuse", reason: REFUSAL_REASONS.CONTAINS_CURRENT_DIRECTORY };
  }
  if (!worktree) {
    return holdsOnlyLeftovers(folderEntries, platform)
      ? { action: "remove-leftover", worktreePath: targetPath }
      : { action: "refuse", reason: REFUSAL_REASONS.NOT_A_WORKTREE };
  }
  if (hasInitializedSubmodules) return { action: "refuse", reason: REFUSAL_REASONS.CONTAINS_SUBMODULES };
  if (!force && (hasUncommittedChanges === null || hasInitializedSubmodules === null)) {
    return { action: "refuse", reason: REFUSAL_REASONS.STATUS_UNKNOWN };
  }
  if (!force && hasUncommittedChanges) return { action: "refuse", reason: REFUSAL_REASONS.UNCOMMITTED_CHANGES };
  const mainWorktree = worktrees.find((entry) => entry.isMain);
  if (!mainWorktree) return { action: "refuse", reason: REFUSAL_REASONS.NOT_A_WORKTREE };
  return { action: "remove", worktreePath: worktree.path, mainWorktreePath: mainWorktree.path };
}
