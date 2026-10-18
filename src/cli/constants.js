/** @module cli/constants Flags and exit codes of the `cleaner` command. */

/** Name of the binary, as printed in usage messages. */
export const CLI_NAME = "cleaner";

/** Reports what a cleanup would do without doing it. */
export const DRY_RUN_FLAG = "--dry-run";

/** Separator that package managers may forward from `pnpm <script> -- <flags>`; it carries no meaning here. */
export const ARGUMENT_SEPARATOR = "--";

/** Prints the usage message. */
export const HELP_FLAGS = ["--help", "-h"];

/** Exit code of a run that finished: everything was cleaned, or the cleanup does not apply to the platform. */
export const EXIT_CODE_SUCCESS = 0;

/** Exit code of a run whose subcommand or flags were not recognized. */
export const EXIT_CODE_USAGE_ERROR = 2;

/** Exit code of a cleanup that kept or failed to clean part of what it was asked to clean. */
export const EXIT_CODE_CLEANUP_INCOMPLETE = 1;

/** Arguments that start with it are flags; the rest are positional paths. */
export const FLAG_PREFIX = "-";
