/** @module cli/run-cli Parses the `cleaner` arguments and runs one cleanup subcommand. */
import process from "node:process";
import { CLEANUP_COMMANDS } from "./commands.js";
import {
  ARGUMENT_SEPARATOR,
  CLI_NAME,
  DRY_RUN_FLAG,
  EXIT_CODE_SUCCESS,
  EXIT_CODE_USAGE_ERROR,
  FLAG_PREFIX,
  HELP_FLAGS,
} from "./constants.js";

/** @typedef {import("./commands.js").CleanupCommand} CleanupCommand */

/**
 * @typedef {object} CliOptions
 * @property {string} [platform] - Platform to act on; defaults to the current one.
 * @property {Record<string, CleanupCommand>} [commands] - Available subcommands, replaceable for tests.
 * @property {(message: string) => void} [log] - Receives informational messages.
 * @property {(message: string) => void} [warn] - Receives failure and usage messages.
 */

/** Width of the first column of the usage message. */
const USAGE_COLUMN_WIDTH = 12;

/**
 * Builds the usage message from the available subcommands.
 * @param {Record<string, CleanupCommand>} commands - Available subcommands.
 * @returns {string} Usage message.
 */
export function formatUsage(commands) {
  const commandLines = Object.entries(commands).flatMap(([commandName, command]) => [
    `  ${commandName.padEnd(USAGE_COLUMN_WIDTH)}${command.description}`,
    ...(command.argumentsUsage
      ? [`  ${"".padEnd(USAGE_COLUMN_WIDTH)}${CLI_NAME} ${commandName} ${command.argumentsUsage} [${DRY_RUN_FLAG}]`]
      : []),
  ]);
  return [
    `Uso: ${CLI_NAME} <limpieza> [argumentos] [${DRY_RUN_FLAG}]`,
    "",
    "Limpiezas:",
    ...commandLines,
    "",
    "Opciones:",
    `  ${DRY_RUN_FLAG.padEnd(USAGE_COLUMN_WIDTH)}Muestra qué limpiaría sin cambiar nada.`,
    `  ${HELP_FLAGS.join(", ").padEnd(USAGE_COLUMN_WIDTH)}Muestra esta ayuda.`,
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

  const [commandName, ...commandArguments] = argv;
  const command = Object.hasOwn(commands, commandName) ? commands[commandName] : undefined;
  if (!command) {
    warn(`${CLI_NAME}: limpieza desconocida "${commandName}".\n\n${formatUsage(commands)}`);
    return EXIT_CODE_USAGE_ERROR;
  }

  const acceptedFlags = new Set([DRY_RUN_FLAG, ...(command.flags ?? [])]);
  const flags = commandArguments.filter((argument) => argument.startsWith(FLAG_PREFIX));
  const paths = commandArguments.filter((argument) => !argument.startsWith(FLAG_PREFIX));
  const unknownFlags = flags.filter((flag) => !acceptedFlags.has(flag));
  if (unknownFlags.length > 0) {
    warn(`${CLI_NAME} ${commandName}: opción desconocida ${unknownFlags.join(", ")}.\n\n${formatUsage(commands)}`);
    return EXIT_CODE_USAGE_ERROR;
  }
  if (!command.requiresPaths && paths.length > 0) {
    warn(`${CLI_NAME} ${commandName}: no acepta argumentos (${paths.join(", ")}).\n\n${formatUsage(commands)}`);
    return EXIT_CODE_USAGE_ERROR;
  }
  if (command.requiresPaths && paths.length === 0) {
    warn(`${CLI_NAME} ${commandName}: indicá al menos una ruta.\n\n${formatUsage(commands)}`);
    return EXIT_CODE_USAGE_ERROR;
  }

  if (!command.appliesTo(platform)) {
    log(`${CLI_NAME} ${commandName}: no aplica en ${platform}; no hay nada que limpiar.`);
    return EXIT_CODE_SUCCESS;
  }

  const exitCode = await command.run({
    dryRun: flags.includes(DRY_RUN_FLAG),
    paths,
    flags: new Set(flags.filter((flag) => flag !== DRY_RUN_FLAG)),
    platform,
    log,
    warn,
  });
  return exitCode ?? EXIT_CODE_SUCCESS;
}
