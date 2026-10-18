/** Worktree as `git worktree list --porcelain` reports it. */
export interface WorktreeEntry {
  /** Worktree folder. */
  path: string;
  /** Whether it is the main worktree, the one that holds the repository. */
  isMain: boolean;
  /** Whether `git worktree lock` protects it. */
  locked: boolean;
}

/** Why a worktree is not removed. */
export type RefusalReason =
  | "not-a-worktree"
  | "main-worktree"
  | "locked"
  | "contains-current-directory"
  | "uncommitted-changes"
  | "status-unknown"
  | "missing-directory";

/** Whether a worktree may be removed, and why not otherwise. */
export type WorktreeRemovalDecision =
  | { action: "remove"; worktreePath: string; mainWorktreePath: string }
  | { action: "remove-leftover"; worktreePath: string }
  | { action: "refuse"; reason: RefusalReason };

/** What is known about the folder to remove. */
export interface WorktreeRemovalInput {
  targetPath: string;
  targetExists: boolean;
  /** Names directly inside the folder, or `null` when unreadable. */
  folderEntries: string[] | null;
  worktrees: WorktreeEntry[];
  /** `null` when the status could not be read. */
  hasUncommittedChanges: boolean | null;
  currentDirectory: string;
  force: boolean;
  platform: string;
}

/** Git and file system access. */
export interface WorktreeSystem {
  folderExists(folderPath: string): boolean;
  toCanonicalPath(folderPath: string): string;
  listFolderEntries(folderPath: string): string[];
  listWorktrees(folderPath: string): Promise<WorktreeEntry[]>;
  hasUncommittedChanges(worktreePath: string): Promise<boolean>;
  removeFolder(folderPath: string): void;
  pruneWorktrees(mainWorktreePath: string): Promise<void>;
}

/** Outcome of a removal run. */
export interface WorktreeRemovalResult {
  /** Worktrees removed (or, in a dry run, that would be removed). */
  removedPaths: string[];
  /** Worktrees kept by a guard. */
  refused: { path: string; reason: RefusalReason }[];
  /** Worktrees whose removal failed. */
  failed: { path: string; error: string }[];
}

/** Worktrees to remove and how. */
export interface WorktreeRemovalOptions {
  paths: string[];
  /** Remove even with uncommitted changes or an unreadable status. */
  force?: boolean;
  /** Report what would be removed without removing it. */
  dryRun?: boolean;
  /** Working directory, which is never removed; defaults to the current one. */
  currentDirectory?: string;
  platform?: string;
  system?: WorktreeSystem;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

export declare const FORCE_FLAG: "--force";
export declare const LEFTOVER_ENTRY_NAMES: readonly string[];
export declare const REFUSAL_REASONS: {
  NOT_A_WORKTREE: "not-a-worktree";
  MAIN_WORKTREE: "main-worktree";
  LOCKED: "locked";
  CONTAINS_CURRENT_DIRECTORY: "contains-current-directory";
  UNCOMMITTED_CHANGES: "uncommitted-changes";
  STATUS_UNKNOWN: "status-unknown";
  MISSING_DIRECTORY: "missing-directory";
};
export declare function toComparablePath(folderPath: string, platform: string): string;
export declare function decideWorktreeRemoval(input: WorktreeRemovalInput): WorktreeRemovalDecision;
export declare function parseWorktreeList(porcelainOutput: string): WorktreeEntry[];
export declare const gitWorktreeSystem: WorktreeSystem;
export declare function removeWorktrees(options: WorktreeRemovalOptions): Promise<WorktreeRemovalResult>;
export declare function worktreesCleanupApplies(): boolean;
