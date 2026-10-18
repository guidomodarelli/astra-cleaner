/** @module cli/run-cli Parses the `cleaner` arguments and runs one cleanup subcommand. */
import process from "node:process";
import { CLEANUP_COMMANDS } from "./commands.js";
import { ARGUMENT_SEPARATOR, CLI_NAME, DRY_RUN_FLAG, EXIT_CODE_SUCCESS, EXIT_CODE_USAGE_ERROR, HELP_FLAGS } from "./constants.js";

/** @typedef {import("./commands.js").CleanupCommand} CleanupCommand */

/**
 * @typedef {object} CliOptions
 * @property {string} [platform] - Platform to act on; defaults to the current one.
 * @property {Record<string, CleanupCommand>} [commands] - Available subcommands, replaceable for tests.
 * @property {(message: string) => void} [log] - Receives informational messages.
 * @property {(message: string) => void} [warn] - Receives failure and usage messages.
 */

/**
 * Builds the usage message from the available subcommands.
 * @param {Record<string, CleanupCommand>} commands - Available subcommands.
 * @returns {string} Usage message.
 */
export function formatUsage(commands) {
  const commandLines = Object.entries(commands).map(
    ([commandName, command]) => `  ${commandName.padEnd(12)}${command.description}`,
  );
  return [
    `Uso: ${CLI_NAME} <limpieza> [${DRY_RUN_FLAG}]`,
    "",
    "Limpiezas:",
    ...commandLines,
    "",
    "Opciones:",
    `  ${DRY_RUN_FLAG.padEnd(12)}Muestra qué limpiaría sin cambiar nada.`,
    `  ${HELP_FLAGS.join(", ").padEnd(12)}Muestra esta ayuda.`,
  ].join("\n");
}

/**
 * Runs the `cleaner` command. A subcommand that does not apply to the platform does nothing and succeeds.
 * @param {string[]} rawArgv - Arguments after the binary name; a bare `--` separator is ignored.
 * @param {CliOptions} [options] - Platform, subcommands and output, replaceable for tests.
 * @returns {Promise<number>} Process exit code.
 */
export async function runCli(
  rawArgv,
  { platform = process.platform, commands = CLEANUP_COMMANDS, log = console.log, warn = console.error } = {},
) {
  const argv = rawArgv.filter((argument) => argument !== ARGUMENT_SEPARATOR);
  if (argv.length === 0 || argv.some((argument) => HELP_FLAGS.includes(argument))) {
    (argv.length === 0 ? warn : log)(formatUsage(commands));
    return argv.length === 0 ? EXIT_CODE_USAGE_ERROR : EXIT_CODE_SUCCESS;
  }

  const [commandName, ...flags] = argv;
  const command = Object.hasOwn(commands, commandName) ? commands[commandName] : undefined;
  if (!command) {
    warn(`${CLI_NAME}: limpieza desconocida "${commandName}".\n\n${formatUsage(commands)}`);
    return EXIT_CODE_USAGE_ERROR;
  }

  const unknownFlags = flags.filter((flag) => flag !== DRY_RUN_FLAG);
  if (unknownFlags.length > 0) {
    warn(`${CLI_NAME} ${commandName}: opción desconocida ${unknownFlags.join(", ")}.\n\n${formatUsage(commands)}`);
    return EXIT_CODE_USAGE_ERROR;
  }

  if (!command.appliesTo(platform)) {
    log(`${CLI_NAME} ${commandName}: no aplica en ${platform}; no hay nada que limpiar.`);
    return EXIT_CODE_SUCCESS;
  }

  await command.run({ dryRun: flags.includes(DRY_RUN_FLAG), platform, log, warn });
  return EXIT_CODE_SUCCESS;
}
