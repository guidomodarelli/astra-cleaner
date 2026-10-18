/** Running WebKit process, as read from Windows. */
export interface WebKitProcess {
  /** Process id. */
  processId: number;
  /** Id of the process that started it; it may no longer exist. */
  parentProcessId: number;
  /** Executable path, or `null` when Windows denies it. */
  executablePath: string | null;
  /** Start time in Unix milliseconds, or `null` when unknown. */
  startedAtMs: number | null;
}

/** Running processes read in one snapshot. */
export interface ProcessSnapshot {
  /** Running WebKit processes. */
  webKitProcesses: WebKitProcess[];
  /** Start time of every running process, by id. */
  livingProcesses: Map<number, number | null>;
}

/** Access to the operating system's processes. */
export interface ProcessSystem {
  /** Reads the running processes. */
  readProcessSnapshot(): Promise<ProcessSnapshot>;
  /** Ends a process; throws when it cannot. */
  terminateProcess(processId: number): void;
}

/** Outcome of one cleanup run. */
export interface CleanupResult {
  /** Whether the cleanup runs on this platform. */
  applies: boolean;
  /** Orphan Playwright WebKit processes found. */
  orphanProcessIds: number[];
  /** Orphans that were closed. */
  terminatedProcessIds: number[];
  /** Orphans that could not be closed. */
  failedProcessIds: number[];
}

/** Behavior and system access of a cleanup run. */
export interface CleanupOptions {
  /** Platform to act on; defaults to the current one. */
  platform?: string;
  /** Process access; defaults to Windows' PowerShell and `process.kill`. */
  system?: ProcessSystem;
  /** Report the orphans without closing them. */
  dryRun?: boolean;
  /** Also log when no orphan is found, for manual runs. */
  reportClean?: boolean;
  /** Receives informational messages. */
  log?: (message: string) => void;
  /** Receives failure messages. */
  warn?: (message: string) => void;
}

export declare const ORPHAN_CLEANUP_PLATFORM: "win32";
export declare const PLAYWRIGHT_BROWSERS_FOLDER: "ms-playwright";
export declare const WEBKIT_EXECUTABLES: readonly string[];

export declare function isPlaywrightExecutable(executablePath: string | null): boolean;
export declare function isParentAlive(
  webKitProcess: WebKitProcess,
  livingProcesses: Map<number, number | null>,
): boolean;
export declare function selectOrphanWebKitProcessIds(
  webKitProcesses: WebKitProcess[],
  livingProcesses: Map<number, number | null>,
): number[];
export declare function parseProcessSnapshot(stdout: string): ProcessSnapshot;
export declare const windowsProcessSystem: ProcessSystem;
export declare function playwrightCleanupApplies(platform: string): boolean;
export declare function cleanOrphanWebKitProcesses(options?: CleanupOptions): Promise<CleanupResult>;
