/** @module worktrees/git-worktree-system Reads worktrees through git and removes their folders with `fs.rmSync`. */
import { execFile } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { promisify } from "node:util";
import {
  DIRECTORY_REMOVAL_MAX_RETRIES,
  DIRECTORY_REMOVAL_RETRY_DELAY_MS,
  GIT_COMMAND_MAX_BUFFER_BYTES,
  GIT_COMMAND_TIMEOUT_MS,
} from "./constants.js";
import { parseWorktreeList } from "./parse-worktree-list.js";

/** @typedef {import("./decide-worktree-removal.js").WorktreeEntry} WorktreeEntry */

/**
 * @typedef {object} WorktreeSystem
 * @property {(folderPath: string) => boolean} folderExists - Whether a folder exists.
 * @property {(folderPath: string) => string[]} listFolderEntries - Names directly inside a folder; throws when it
 * cannot read them.
 * @property {(folderPath: string) => Promise<WorktreeEntry[]>} listWorktrees - Worktrees of the repository the folder
 * belongs to; throws when it is not inside a repository.
 * @property {(worktreePath: string) => Promise<boolean>} hasUncommittedChanges - Whether the worktree has changes git
 * would lose, untracked files included; throws when its status cannot be read.
 * @property {(folderPath: string) => void} removeFolder - Deletes a folder and everything in it; throws when it cannot.
 * @property {(mainWorktreePath: string) => Promise<void>} pruneWorktrees - Drops the records of worktrees whose
 * folder no longer exists.
 */

const execFileAsync = promisify(execFile);

/**
 * Runs git in a folder, hidden and bounded by a timeout.
 * @param {string} folderPath - Folder git runs in (`git -C`).
 * @param {string[]} gitArguments - Arguments after `-C <folder>`.
 * @returns {Promise<string>} Standard output.
 */
async function runGit(folderPath, gitArguments) {
  const { stdout } = await execFileAsync("git", ["-C", folderPath, ...gitArguments], {
    maxBuffer: GIT_COMMAND_MAX_BUFFER_BYTES,
    timeout: GIT_COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
  return stdout;
}

/** @type {WorktreeSystem} */
export const gitWorktreeSystem = {
  folderExists: (folderPath) => existsSync(folderPath),
  listFolderEntries: (folderPath) => readdirSync(folderPath),
  async listWorktrees(folderPath) {
    return parseWorktreeList(await runGit(folderPath, ["worktree", "list", "--porcelain"]));
  },
  async hasUncommittedChanges(worktreePath) {
    const statusOutput = await runGit(worktreePath, ["status", "--porcelain", "--untracked-files=all"]);
    return statusOutput.trim().length > 0;
  },
  removeFolder(folderPath) {
    // `fs.rmSync` handles paths beyond Windows' 260-character limit, deep inside `node_modules`, where
    // `git worktree remove` fails with "Filename too long".
    rmSync(folderPath, {
      recursive: true,
      force: true,
      maxRetries: DIRECTORY_REMOVAL_MAX_RETRIES,
      retryDelay: DIRECTORY_REMOVAL_RETRY_DELAY_MS,
    });
  },
  async pruneWorktrees(mainWorktreePath) {
    await runGit(mainWorktreePath, ["worktree", "prune"]);
  },
};
