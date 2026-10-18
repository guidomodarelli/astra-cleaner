/** @module playwright/constants Identifies the Playwright WebKit processes that can outlive a killed run. */

/** Only Windows leaves these processes behind: ending a process there does not end its children. */
export const ORPHAN_CLEANUP_PLATFORM = "win32";

/**
 * Executables of Playwright's WebKit build on Windows: the browser (`Playwright.exe`) and the helpers it starts.
 * The browser is included because an orphaned one stays alive as its helpers' parent and keeps them from being closed.
 */
export const WEBKIT_EXECUTABLES = [
  "Playwright.exe",
  "WebKitGPUProcess.exe",
  "WebKitNetworkProcess.exe",
  "WebKitWebProcess.exe",
];

/** Folder that holds the browsers Playwright downloads (`%LOCALAPPDATA%\ms-playwright` by default). */
export const PLAYWRIGHT_BROWSERS_FOLDER = "ms-playwright";

/** Upper bound for the PowerShell snapshot, so a stuck CIM query never stalls the test run. */
export const PROCESS_SNAPSHOT_TIMEOUT_MS = 30_000;

/** Room for the JSON list of every running process, which grows with the machine's process count. */
export const PROCESS_SNAPSHOT_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

/** Prefix of every message this cleanup prints, so its output is easy to find in a test log. */
export const PLAYWRIGHT_LOG_PREFIX = "[@astra-kit/cleaner:playwright]";

/**
 * Longest wait for closed processes to really end. TerminateProcess can return while a process with pending I/O is
 * still terminating, and until it ends it keeps its working directory locked.
 */
export const TERMINATION_WAIT_TIMEOUT_MS = 10_000;

/** Pause between the batch queries that check whether closed processes ended. */
export const TERMINATION_POLL_INTERVAL_MS = 250;

/**
 * Shortest timeout for a liveness query during the termination wait. Each query is cut to the time left before the
 * deadline, so a stalled CIM query cannot stretch the wait, but never below this floor so a healthy query can finish.
 */
export const TERMINATION_MIN_QUERY_TIMEOUT_MS = 250;
