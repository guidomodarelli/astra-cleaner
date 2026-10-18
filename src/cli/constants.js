/** @module cli/constants Flags and exit codes of the `cleaner` command. */

/** Name of the binary, as printed in usage messages. */
export const CLI_NAME = "cleaner";

/** Reports what a cleanup would do without doing it. */
export const DRY_RUN_FLAG = "--dry-run";

/** Prints the usage message. */
export const HELP_FLAGS = ["--help", "-h"];

/** Exit code of a run that finished, including cleanups that do not apply to the platform or that warned. */
export const EXIT_CODE_SUCCESS = 0;

/** Exit code of a run whose subcommand or flags were not recognized. */
export const EXIT_CODE_USAGE_ERROR = 2;
