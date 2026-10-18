/** Playwright `globalSetup` and `globalTeardown` entry: sweeps orphan WebKit processes; never fails the run. */
export default function cleanOrphanWebKitProcessesHook(): Promise<void>;
