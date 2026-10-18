/**
 * @module cli/commands Subcommands of the `cleaner` command, one per cleanup domain.
 *
 * Each cleanup is independent: a domain adds its own entry here and never depends on another domain's code.
 */
import { cleanOrphanWebKitProcesses, playwrightCleanupApplies } from "../playwright/index.js";
import { FORCE_FLAG, removeWorktrees, worktreesCleanupApplies } from "../worktrees/index.js";
import { EXIT_CODE_CLEANUP_INCOMPLETE, EXIT_CODE_SUCCESS } from "./constants.js";

/**
 * @typedef {object} CommandContext
 * @property {boolean} dryRun - Report what would be cleaned without cleaning it.
 * @property {string[]} paths - Positional arguments, for subcommands that accept paths.
 * @property {Set<string>} flags - Subcommand-specific flags present in the arguments.
 * @property {string} platform - Platform name, as `process.platform` reports it.
 * @property {(message: string) => void} log - Receives informational messages.
 * @property {(message: string) => void} warn - Receives failure messages.
 */

/**
 * @typedef {object} CleanupCommand
 * @property {string} description - One-line summary for the usage message.
 * @property {string} [argumentsUsage] - Arguments it takes, as shown in the usage message.
 * @property {string[]} [flags] - Flags it accepts besides `--dry-run`.
 * @property {boolean} [requiresPaths] - Whether it needs at least one positional path.
 * @property {(platform: string) => boolean} appliesTo - Whether the cleanup acts on a platform.
 * @property {(context: CommandContext) => Promise<number | void>} run - Runs the cleanup and returns its exit code
 * (success when nothing is returned); never throws.
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
  worktrees: {
    description: "Borra worktrees de git aunque tengan rutas largas en node_modules.",
    argumentsUsage: `<ruta>... [${FORCE_FLAG}]`,
    flags: [FORCE_FLAG],
    requiresPaths: true,
    appliesTo: worktreesCleanupApplies,
    async run({ dryRun, paths, flags, platform, log, warn }) {
      const result = await removeWorktrees({ paths, dryRun, force: flags.has(FORCE_FLAG), platform, log, warn });
      return result.refused.length + result.failed.length > 0 ? EXIT_CODE_CLEANUP_INCOMPLETE : EXIT_CODE_SUCCESS;
    },
  },
};
