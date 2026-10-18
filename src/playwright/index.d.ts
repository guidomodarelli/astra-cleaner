/** Running WebKit process, as read from Windows. */
export interface WebKitProcess {
  /** Process id, or `null` when Windows does not report it. */
  processId: number | null;
  /** Id of the process that started it, which may no longer exist, or `null` when unknown. */
  parentProcessId: number | null;
  /** Executable path, or `null` when Windows denies it. */
  executablePath: string | null;
  /** Start time in Unix milliseconds, or `null` when unknown. */
  startedAtMs: number | null;
}

/** Running processes read in one snapshot. */
export interface ProcessSnapshot {
  /** Running WebKit processes. */
  webKitProcesses: WebKitProcess[];
  /** Start time of the living processes among their parents, by id; a parent missing from it no longer runs. */
  livingProcesses: Map<number, number | null>;
}

/** Access to the operating system's processes. */
export interface ProcessSystem {
  /** Reads the running processes. */
  readProcessSnapshot(): Promise<ProcessSnapshot>;
  /** Reads the start time of the given processes that still run, by id. */
  readProcessStartTimes(processIds: number[], queryOptions?: { timeoutMs?: number }): Promise<Map<number, number | null>>;
  /** Asks a process to end; throws when it cannot. The process may still be terminating when it returns. */
  terminateProcess(processId: number): void;
}

/** Outcome of one cleanup run. */
export interface CleanupResult {
  /** Whether the cleanup runs on this platform. */
  applies: boolean;
  /** Orphan Playwright WebKit processes found. */
  orphanProcessIds: number[];
  /** Orphans closed and confirmed gone. */
  terminatedProcessIds: number[];
  /** Orphans that did not end within the wait, or whose end could not be confirmed; they may keep their folder locked. */
  stillRunningProcessIds: number[];
  /** Orphans left running: they could not be asked to end, or their identity could not be checked before closing. */
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
  /** Time source for the wait after closing, replaceable for tests. */
  clock?: Clock;
  /** Longest wait for closed processes to really end. */
  terminationTimeoutMs?: number;
}

/** Time source. */
export interface Clock {
  /** Current time in milliseconds. */
  now(): number;
  /** Resolves after `durationMs`. */
  sleep(durationMs: number): Promise<void>;
}

/** Process identified by its id and start time, so a reused id is not mistaken for it. */
export interface ProcessInstance {
  processId: number;
  startedAtMs: number | null;
}

/** Ids grouped by whether they still name the same process instance. */
export interface ProcessIdentityCheck {
  sameInstanceProcessIds: number[];
  goneProcessIds: number[];
  unverifiableProcessIds: number[];
}

/** Outcome of waiting for closed processes to end. */
export interface ProcessExitWait {
  exitedProcessIds: number[];
  stillRunningProcessIds: number[];
}

export declare const ORPHAN_CLEANUP_PLATFORM: "win32";
export declare const PLAYWRIGHT_BROWSERS_FOLDER: "ms-playwright";
export declare const WEBKIT_EXECUTABLES: readonly string[];
export declare const TERMINATION_WAIT_TIMEOUT_MS: number;
export declare const TERMINATION_POLL_INTERVAL_MS: number;
export declare const TERMINATION_MIN_QUERY_TIMEOUT_MS: number;
export declare function checkProcessIdentity(
  processInstances: ProcessInstance[],
  runningStartTimes: Map<number, number | null>,
): ProcessIdentityCheck;
export declare function computeQueryTimeoutMs(remainingMs: number, queryTimeoutMs?: number): number;

export declare function isPlaywrightWebKitExecutable(executablePath: string | null): boolean;
export declare function isParentAlive(
  webKitProcess: { parentProcessId: number; startedAtMs: number | null },
  livingProcesses: Map<number, number | null>,
): boolean;
export declare function selectOrphanWebKitProcessIds(
  webKitProcesses: WebKitProcess[],
  livingProcesses: Map<number, number | null>,
): number[];
export declare function parseProcessSnapshot(stdout: string): ProcessSnapshot;
export declare function parseProcessStartTimes(rows: unknown): Map<number, number | null>;
export declare const systemClock: Clock;
export declare function selectStillRunningProcessIds(
  closedProcesses: ProcessInstance[],
  runningStartTimes: Map<number, number | null>,
): number[];
export declare function waitForProcessExit(options: {
  closedProcesses: ProcessInstance[];
  readProcessStartTimes: (processIds: number[], queryOptions: { timeoutMs: number }) => Promise<Map<number, number | null>>;
  clock?: Clock;
  timeoutMs?: number;
  pollIntervalMs?: number;
  onQueryError?: (error: unknown) => void;
}): Promise<ProcessExitWait>;
export declare const windowsProcessSystem: ProcessSystem;
export declare function describeError(error: unknown): string;
export declare function playwrightCleanupApplies(platform: string): boolean;
export declare function cleanOrphanWebKitProcesses(options?: CleanupOptions): Promise<CleanupResult>;
