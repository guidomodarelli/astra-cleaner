/** @module worktrees/constants Limits and identifiers of the worktree cleanup. */

/** Skips the uncommitted-changes guard; never the other guards. */
export const FORCE_FLAG = "--force";

/** Upper bound for each git command, so a stuck repository never stalls the cleanup. */
export const GIT_COMMAND_TIMEOUT_MS = 30_000;

/** Room for `git worktree list` and `git status` output in large repositories. */
export const GIT_COMMAND_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

/**
 * Attempts of `fs.rmSync` when Windows reports a file busy or not empty, which happens while an antivirus or an
 * indexer briefly holds a file inside `node_modules`.
 */
export const DIRECTORY_REMOVAL_MAX_RETRIES = 5;

/** Pause between those attempts; `fs.rmSync` grows it linearly on each retry. */
export const DIRECTORY_REMOVAL_RETRY_DELAY_MS = 200;

/**
 * Folders a failed `git worktree remove` leaves behind. Git deletes the worktree's `.git` file and its record before
 * it reaches the long paths, so what remains is an unregistered folder holding only these; they are rebuilt by an
 * install, so removing a folder that holds nothing else loses no work.
 */
export const LEFTOVER_ENTRY_NAMES = ["node_modules"];

/**
 * Variables that point git at a specific repository, index or work tree, as `git rev-parse --local-env-vars` lists
 * them. Inherited from a git hook or a git-aware wrapper, they would make git inspect another worktree than the one
 * asked for, so the safety checks run without them.
 */
export const LOCAL_GIT_ENVIRONMENT_VARIABLES = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
];

/** Folder inside a worktree's administrative directory where git keeps its initialized submodules. */
export const SUBMODULES_FOLDER_NAME = "modules";

/** Prefix of every message this cleanup prints. */
export const WORKTREES_LOG_PREFIX = "[@golfo/cleaner:worktrees]";

/**
 * Why a worktree is not removed.
 * @type {{
 *   NOT_A_WORKTREE: "not-a-worktree",
 *   MAIN_WORKTREE: "main-worktree",
 *   LOCKED: "locked",
 *   CONTAINS_CURRENT_DIRECTORY: "contains-current-directory",
 *   UNCOMMITTED_CHANGES: "uncommitted-changes",
 *   STATUS_UNKNOWN: "status-unknown",
 *   MISSING_DIRECTORY: "missing-directory",
 *   CONTAINS_SUBMODULES: "contains-submodules",
 * }}
 */
export const REFUSAL_REASONS = {
  NOT_A_WORKTREE: "not-a-worktree",
  MAIN_WORKTREE: "main-worktree",
  LOCKED: "locked",
  CONTAINS_CURRENT_DIRECTORY: "contains-current-directory",
  UNCOMMITTED_CHANGES: "uncommitted-changes",
  STATUS_UNKNOWN: "status-unknown",
  MISSING_DIRECTORY: "missing-directory",
  CONTAINS_SUBMODULES: "contains-submodules",
};
