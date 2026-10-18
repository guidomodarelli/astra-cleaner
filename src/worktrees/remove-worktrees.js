/** @module worktrees/remove-worktrees Removes git worktrees whose `git worktree remove` fails on long paths. */
import path from "node:path";
import process from "node:process";
import { REFUSAL_REASONS, WORKTREES_LOG_PREFIX } from "./constants.js";
import { decideWorktreeRemoval } from "./decide-worktree-removal.js";
import { gitWorktreeSystem } from "./git-worktree-system.js";

/** @typedef {import("./git-worktree-system.js").WorktreeSystem} WorktreeSystem */
/** @typedef {import("./decide-worktree-removal.js").RefusalReason} RefusalReason */

/**
 * @typedef {object} WorktreeRemovalResult
 * @property {string[]} removedPaths - Worktrees removed (or, in a dry run, that would be removed).
 * @property {{ path: string, reason: RefusalReason }[]} refused - Worktrees kept by a guard.
 * @property {{ path: string, error: string }[]} failed - Worktrees whose removal failed.
 */

/**
 * @typedef {object} WorktreeRemovalOptions
 * @property {string[]} paths - Worktree folders to remove.
 * @property {boolean} [force] - Remove even with uncommitted changes or an unreadable status.
 * @property {boolean} [dryRun] - Report what would be removed without removing it.
 * @property {string} [currentDirectory] - Working directory, which is never removed; defaults to the current one.
 * @property {string} [platform] - Platform name; defaults to the current one.
 * @property {WorktreeSystem} [system] - Git and file system access, replaceable for tests.
 * @property {(message: string) => void} [log] - Receives informational messages.
 * @property {(message: string) => void} [warn] - Receives refusals and failures.
 */

/** Explains each refusal, with what the person can do about it. */
const REFUSAL_EXPLANATIONS = {
  [REFUSAL_REASONS.NOT_A_WORKTREE]:
    "is not a linked worktree of a git repository, nor a leftover holding only node_modules",
  [REFUSAL_REASONS.MAIN_WORKTREE]: "is the main worktree, which holds the repository",
  [REFUSAL_REASONS.LOCKED]: "is locked; run `git worktree unlock` first",
  [REFUSAL_REASONS.CONTAINS_CURRENT_DIRECTORY]: "contains the current directory; run the cleanup from elsewhere",
  [REFUSAL_REASONS.UNCOMMITTED_CHANGES]: "has uncommitted changes; commit them or pass --force to discard them",
  [REFUSAL_REASONS.STATUS_UNKNOWN]: "has a status git could not read; pass --force to remove it anyway",
  [REFUSAL_REASONS.MISSING_DIRECTORY]: "does not exist; run `git worktree prune` in the repository to drop its record",
};

/**
 * Turns a caught value into a one-line reason, with its error code when there is one.
 * @param {unknown} error - Caught value.
 * @returns {string} Its code and message.
 */
function describeError(error) {
  if (!(error instanceof Error)) return String(error);
  const errorCode = "code" in error && error.code ? String(error.code) : undefined;
  return errorCode && !error.message.includes(errorCode) ? `${errorCode}: ${error.message}` : error.message;
}

/**
 * Tells whether a removal failed because a process keeps a file open, the usual cause on Windows.
 * @param {unknown} error - Caught value.
 * @returns {boolean} `true` for `EBUSY` and `EPERM`.
 */
function isBusyFolderError(error) {
  return error instanceof Error && "code" in error && (error.code === "EBUSY" || error.code === "EPERM");
}

/**
 * Removes linked git worktrees: deletes each folder with `fs.rmSync`, which survives Windows' long paths inside
 * `node_modules`, then lets git drop the record with `git worktree prune`. The branch and its commits stay. Guards
 * keep the main worktree, locked worktrees, the current directory and, unless `force`, worktrees with uncommitted
 * changes. Never throws: refusals and failures are reported through `warn` and in the result.
 * @param {WorktreeRemovalOptions} options - Worktrees to remove and how.
 * @returns {Promise<WorktreeRemovalResult>} What was removed, kept and failed.
 */
export async function removeWorktrees({
  paths,
  force = false,
  dryRun = false,
  currentDirectory = process.cwd(),
  platform = process.platform,
  system = gitWorktreeSystem,
  log = console.log,
  warn = console.warn,
}) {
  /** @type {WorktreeRemovalResult} */
  const result = { removedPaths: [], refused: [], failed: [] };

  for (const requestedPath of paths) {
    const targetPath = path.resolve(requestedPath);
    const targetExists = system.folderExists(targetPath);

    /** @type {import("./decide-worktree-removal.js").WorktreeEntry[]} */
    let worktrees = [];
    /** @type {boolean | null} */
    let hasUncommittedChanges = null;
    /** @type {string[] | null} */
    let folderEntries = null;
    if (targetExists) {
      try {
        folderEntries = system.listFolderEntries(targetPath);
      } catch {
        // An unreadable folder is never treated as a leftover; the decision keeps it.
        folderEntries = null;
      }
      try {
        worktrees = await system.listWorktrees(targetPath);
      } catch {
        // Outside a repository git fails; with no worktrees the decision keeps the folder as "not a worktree" and the
        // refusal below reports it.
        worktrees = [];
      }
      try {
        hasUncommittedChanges = await system.hasUncommittedChanges(targetPath);
      } catch {
        // An unreadable status is kept as unknown; the decision refuses it unless `force`, and the refusal reports it.
        hasUncommittedChanges = null;
      }
    }

    const decision = decideWorktreeRemoval({
      targetPath,
      targetExists,
      folderEntries,
      worktrees,
      hasUncommittedChanges,
      currentDirectory,
      force,
      platform,
    });
    if (decision.action === "refuse") {
      result.refused.push({ path: targetPath, reason: decision.reason });
      warn(`${WORKTREES_LOG_PREFIX} Kept ${targetPath}: it ${REFUSAL_EXPLANATIONS[decision.reason]}.`);
      continue;
    }

    const isLeftover = decision.action === "remove-leftover";
    const removedDescription = isLeftover ? "leftover of a failed git worktree remove" : "worktree";
    if (dryRun) {
      result.removedPaths.push(targetPath);
      log(`${WORKTREES_LOG_PREFIX} Dry run: would remove ${removedDescription} ${targetPath}.`);
      continue;
    }

    try {
      system.removeFolder(targetPath);
    } catch (error) {
      const hint = isBusyFolderError(error)
        ? " A process keeps a file open; close it (for orphan Playwright WebKit processes, run `cleaner playwright`) and retry."
        : "";
      result.failed.push({ path: targetPath, error: describeError(error) });
      warn(`${WORKTREES_LOG_PREFIX} removeFolder failed for ${targetPath}: ${describeError(error)}.${hint}`);
      continue;
    }

    if (isLeftover) {
      // Git already dropped the record of a leftover; there is nothing to prune.
      result.removedPaths.push(targetPath);
      log(`${WORKTREES_LOG_PREFIX} Removed ${removedDescription} ${targetPath}.`);
      continue;
    }

    try {
      await system.pruneWorktrees(decision.mainWorktreePath);
    } catch (error) {
      warn(
        `${WORKTREES_LOG_PREFIX} Removed ${targetPath}, but git worktree prune failed in ${decision.mainWorktreePath}: ${describeError(error)}. Run it by hand to drop the record.`,
      );
    }
    result.removedPaths.push(targetPath);
    log(`${WORKTREES_LOG_PREFIX} Removed worktree ${targetPath}.`);
  }

  return result;
}

/**
 * Tells whether the worktree cleanup acts on a platform. Long paths break `git worktree remove` mostly on Windows, but
 * the cleanup is safe everywhere.
 * @returns {boolean} Always `true`.
 */
export function worktreesCleanupApplies() {
  return true;
}
