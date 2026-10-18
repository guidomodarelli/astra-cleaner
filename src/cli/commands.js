/**
 * @module cli/commands Subcommands of the `cleaner` command, one per cleanup domain.
 *
 * Each cleanup is independent: a domain adds its own entry here and never depends on another domain's code.
 */
import { cleanOrphanWebKitProcesses, playwrightCleanupApplies } from "../playwright/index.js";

/**
 * @typedef {object} CommandContext
 * @property {boolean} dryRun - Report what would be cleaned without cleaning it.
 * @property {string} platform - Platform name, as `process.platform` reports it.
 * @property {(message: string) => void} log - Receives informational messages.
 * @property {(message: string) => void} warn - Receives failure messages.
 */

/**
 * @typedef {object} CleanupCommand
 * @property {string} description - One-line summary for the usage message.
 * @property {(platform: string) => boolean} appliesTo - Whether the cleanup acts on a platform.
 * @property {(context: CommandContext) => Promise<void>} run - Runs the cleanup; never throws.
 */

/** @type {Record<string, CleanupCommand>} */
export const CLEANUP_COMMANDS = {
  playwright: {
    description: "Cierra procesos huérfanos de WebKit de Playwright (solo Windows).",
    appliesTo: playwrightCleanupApplies,
    async run({ dryRun, platform, log, warn }) {
      await cleanOrphanWebKitProcesses({ dryRun, platform, log, warn, reportClean: true });
    },
  },
};
