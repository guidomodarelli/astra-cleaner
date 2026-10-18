/** @module worktrees/git-worktree-system Reads worktrees through git and removes their folders with `fs.rmSync`. */
import { execFile } from "node:child_process";
import { existsSync, readdirSync, realpathSync, rmSync } from "node:fs";
import process from "node:process";
import path from "node:path";
import { promisify } from "node:util";
import {
  DIRECTORY_REMOVAL_MAX_RETRIES,
  DIRECTORY_REMOVAL_RETRY_DELAY_MS,
  GIT_COMMAND_MAX_BUFFER_BYTES,
  GIT_COMMAND_TIMEOUT_MS,
  LOCAL_GIT_ENVIRONMENT_VARIABLES,
  SUBMODULES_FOLDER_NAME,
} from "./constants.js";
import { parseWorktreeList } from "./parse-worktree-list.js";

/** @typedef {import("./decide-worktree-removal.js").WorktreeEntry} WorktreeEntry */

/**
 * @typedef {object} WorktreeSystem
 * @property {(folderPath: string) => boolean} folderExists - Whether a folder exists.
 * @property {(folderPath: string) => string} toCanonicalPath - The folder's real path, with Windows short (8.3)
 * names, symbolic links and junctions resolved, so two spellings of one folder compare equal; the absolute path when
 * the folder does not exist.
 * @property {(folderPath: string) => string[]} listFolderEntries - Names directly inside a folder; throws when it
 * cannot read them.
 * @property {(folderPath: string) => Promise<WorktreeEntry[]>} listWorktrees - Worktrees of the repository the folder
 * belongs to; throws when it is not inside a repository.
 * @property {(worktreePath: string) => Promise<boolean>} hasUncommittedChanges - Whether the worktree has changes git
 * would lose, untracked files included; throws when its status cannot be read.
 * @property {(worktreePath: string) => Promise<boolean>} hasInitializedSubmodules - Whether the worktree has
 * initialized submodules; throws when its administrative directory cannot be found.
 * @property {(folderPath: string) => void} removeFolder - Deletes a folder and everything in it; throws when it cannot.
 * @property {(mainWorktreePath: string) => Promise<void>} pruneWorktrees - Drops the records of worktrees whose
 * folder no longer exists.
 */

const execFileAsync = promisify(execFile);

/**
 * The environment without the variables that would point git at another repository, index or work tree.
 * @returns {NodeJS.ProcessEnv} Environment for git commands.
 */
function createIsolatedGitEnvironment() {
  const environment = { ...process.env };
  for (const variableName of LOCAL_GIT_ENVIRONMENT_VARIABLES) delete environment[variableName];
  return environment;
}

/**
 * Runs git in a folder, hidden, bounded by a timeout and isolated from inherited repository variables.
 * @param {string} folderPath - Folder git runs in (`git -C`).
 * @param {string[]} gitArguments - Arguments after `-C <folder>`.
 * @returns {Promise<string>} Standard output.
 */
async function runGit(folderPath, gitArguments) {
  const { stdout } = await execFileAsync("git", ["-C", folderPath, ...gitArguments], {
    env: createIsolatedGitEnvironment(),
    maxBuffer: GIT_COMMAND_MAX_BUFFER_BYTES,
    timeout: GIT_COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
  return stdout;
}

/**
 * Lists the worktrees of the repository a folder belongs to. Asks for the NUL-delimited format first, which keeps any
 * path intact; git 2.35 and earlier reject `-z`, so on failure it asks again for the plain format, whose only limit is
 * a path with a newline. A folder outside a repository fails both and throws.
 * @param {(folderPath: string, gitArguments: string[]) => Promise<string>} runGitCommand - Runs git in a folder.
 * @param {string} folderPath - Folder inside the repository.
 * @returns {Promise<WorktreeEntry[]>} Worktrees, main first.
 */
export async function listWorktreesWith(runGitCommand, folderPath) {
  try {
    return parseWorktreeList(await runGitCommand(folderPath, ["worktree", "list", "--porcelain", "-z"]));
  } catch {
    // Either `-z` is unknown to this git or the folder is not in a repository; the plain format tells them apart.
    return parseWorktreeList(await runGitCommand(folderPath, ["worktree", "list", "--porcelain"]));
  }
}

/** @type {WorktreeSystem} */
export const gitWorktreeSystem = {
  folderExists: (folderPath) => existsSync(folderPath),
  toCanonicalPath(folderPath) {
    try {
      // The native variant asks the operating system, which expands short names such as `RUNNER~1`; the JavaScript
      // variant does not.
      return realpathSync.native(folderPath);
    } catch {
      // A missing folder has no real path; its absolute path is the best spelling to compare.
      return path.resolve(folderPath);
    }
  },
  listFolderEntries: (folderPath) => readdirSync(folderPath),
  listWorktrees: (folderPath) => listWorktreesWith(runGit, folderPath),
  async hasUncommittedChanges(worktreePath) {
    const statusOutput = await runGit(worktreePath, ["status", "--porcelain", "--untracked-files=all"]);
    return statusOutput.trim().length > 0;
  },
  async hasInitializedSubmodules(worktreePath) {
    // A linked worktree keeps its submodules' repositories, with their local branches and commits, under its own
    // administrative directory (`.git/worktrees/<name>/modules`), which `git worktree prune` deletes.
    const administrativeDirectory = (
      await runGit(worktreePath, ["rev-parse", "--path-format=absolute", "--git-dir"])
    ).trim();
    const submodulesFolder = path.join(administrativeDirectory, SUBMODULES_FOLDER_NAME);
    return existsSync(submodulesFolder) && readdirSync(submodulesFolder).length > 0;
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
