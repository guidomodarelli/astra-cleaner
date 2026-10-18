/** Builds a Playwright global hook around a cleanup; the Playwright config it receives is never passed on. */
export declare function createGlobalHook(cleanup: () => Promise<unknown>): (config?: unknown) => Promise<void>;

/** Playwright `globalSetup` and `globalTeardown` entry: sweeps orphan WebKit processes; never fails the run. */
declare const cleanOrphanWebKitProcessesHook: (config?: unknown) => Promise<void>;
export default cleanOrphanWebKitProcessesHook;
