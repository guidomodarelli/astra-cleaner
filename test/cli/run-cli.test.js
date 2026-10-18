import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import process from "node:process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { EXIT_CODE_CLEANUP_INCOMPLETE, EXIT_CODE_SUCCESS, EXIT_CODE_USAGE_ERROR } from "../../src/cli/constants.js";
import { runCli } from "../../src/cli/run-cli.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../../bin/cleaner.js", import.meta.url));

/** Builds a fake subcommand that only acts on Windows and records its runs. */
function createWindowsOnlyCommand() {
  /** @type {import("../../src/cli/commands.js").CommandContext[]} */
  const runs = [];
  return {
    runs,
    command: {
      description: "Limpieza de prueba.",
      /** @param {string} platform */
      appliesTo: (platform) => platform === "win32",
      /** @param {import("../../src/cli/commands.js").CommandContext} context */
      async run(context) {
        runs.push(context);
      },
    },
  };
}

/** Collects messages sent to `log` and `warn`. */
function createOutput() {
  /** @type {string[]} */
  const logs = [];
  /** @type {string[]} */
  const warnings = [];
  return {
    logs,
    warnings,
    /** @param {string} message */
    log: (message) => logs.push(message),
    /** @param {string} message */
    warn: (message) => warnings.push(message),
  };
}

describe("runCli", () => {
  it("runs the subcommand on a platform it applies to", async () => {
    const { runs, command } = createWindowsOnlyCommand();
    const exitCode = await runCli(["sample"], { platform: "win32", commands: { sample: command }, ...createOutput() });
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].dryRun, false);
    assert.equal(runs[0].platform, "win32");
  });

  it("passes --dry-run to the subcommand", async () => {
    const { runs, command } = createWindowsOnlyCommand();
    await runCli(["sample", "--dry-run"], { platform: "win32", commands: { sample: command }, ...createOutput() });
    assert.equal(runs[0].dryRun, true);
  });

  it("ignores the -- separator that pnpm forwards from a script", async () => {
    const { runs, command } = createWindowsOnlyCommand();
    const exitCode = await runCli(["sample", "--", "--dry-run"], {
      platform: "win32",
      commands: { sample: command },
      ...createOutput(),
    });
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
    assert.equal(runs[0].dryRun, true);
  });

  it("does nothing and succeeds where the subcommand does not apply", async () => {
    const { runs, command } = createWindowsOnlyCommand();
    const output = createOutput();
    const exitCode = await runCli(["sample", "--dry-run"], {
      platform: "darwin",
      commands: { sample: command },
      ...output,
    });
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
    assert.equal(runs.length, 0);
    assert.match(output.logs.join("\n"), /no aplica en darwin/u);
  });

  it("rejects unknown subcommands, inherited property names and unknown flags", async () => {
    const { runs, command } = createWindowsOnlyCommand();
    for (const argv of [["unknown"], ["toString"], ["sample", "--force"]]) {
      const output = createOutput();
      const exitCode = await runCli(argv, { platform: "win32", commands: { sample: command }, ...output });
      assert.equal(exitCode, EXIT_CODE_USAGE_ERROR, argv.join(" "));
      assert.match(output.warnings.join("\n"), /Uso: cleaner/u);
    }
    assert.equal(runs.length, 0);
  });

  it("prints usage on --help and fails without arguments", async () => {
    const { command } = createWindowsOnlyCommand();
    const helpOutput = createOutput();
    assert.equal(await runCli(["--help"], { commands: { sample: command }, ...helpOutput }), EXIT_CODE_SUCCESS);
    assert.match(helpOutput.logs.join("\n"), /sample\s+Limpieza de prueba\./u);

    const emptyOutput = createOutput();
    assert.equal(await runCli([], { commands: { sample: command }, ...emptyOutput }), EXIT_CODE_USAGE_ERROR);
    assert.match(emptyOutput.warnings.join("\n"), /Uso: cleaner/u);
  });

  it("lists the playwright cleanup in the real binary", async () => {
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "--help"]);
    assert.match(stdout, /playwright\s+Cierra procesos huérfanos de WebKit/u);
  });

  it("exits with the usage error code from the real binary", async () => {
    await assert.rejects(execFileAsync(process.execPath, [CLI_PATH, "unknown"]), (error) => {
      assert.equal(/** @type {{ code?: number }} */ (error).code, EXIT_CODE_USAGE_ERROR);
      return true;
    });
  });
});

describe("runCli with subcommands that take paths and flags", () => {
  /**
   * Builds a fake subcommand that takes paths and `--force`, records its runs and returns a fixed exit code.
   * @param {number | undefined} exitCode - Exit code the run returns.
   */
  function createPathsCommand(exitCode) {
    /** @type {import("../../src/cli/commands.js").CommandContext[]} */
    const runs = [];
    return {
      runs,
      command: {
        description: "Limpieza con rutas.",
        argumentsUsage: "<ruta>... [--force]",
        flags: ["--force"],
        requiresPaths: true,
        appliesTo: () => true,
        /** @param {import("../../src/cli/commands.js").CommandContext} context */
        async run(context) {
          runs.push(context);
          return exitCode;
        },
      },
    };
  }

  it("passes the paths and the subcommand flags apart from --dry-run", async () => {
    const { runs, command } = createPathsCommand(undefined);
    const exitCode = await runCli(["paths", "a", "--force", "b", "--dry-run"], {
      commands: { paths: command },
      ...createOutput(),
    });
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
    assert.deepEqual(runs[0].paths, ["a", "b"]);
    assert.deepEqual([...runs[0].flags], ["--force"]);
    assert.equal(runs[0].dryRun, true);
  });

  it("returns the exit code of an incomplete cleanup", async () => {
    const { command } = createPathsCommand(EXIT_CODE_CLEANUP_INCOMPLETE);
    assert.equal(await runCli(["paths", "a"], { commands: { paths: command }, ...createOutput() }), EXIT_CODE_CLEANUP_INCOMPLETE);
  });

  it("requires a path where the subcommand needs one, and rejects paths where it takes none", async () => {
    const { runs, command } = createPathsCommand(undefined);
    const { command: noPathsCommand } = createWindowsOnlyCommand();
    const missingPathOutput = createOutput();
    assert.equal(
      await runCli(["paths", "--force"], { commands: { paths: command }, ...missingPathOutput }),
      EXIT_CODE_USAGE_ERROR,
    );
    assert.match(missingPathOutput.warnings.join("\n"), /indicá al menos una ruta/u);
    const extraPathOutput = createOutput();
    assert.equal(
      await runCli(["sample", "extra"], { platform: "win32", commands: { sample: noPathsCommand }, ...extraPathOutput }),
      EXIT_CODE_USAGE_ERROR,
    );
    assert.match(extraPathOutput.warnings.join("\n"), /no acepta argumentos \(extra\)/u);
    assert.equal(runs.length, 0);
  });

  it("rejects a flag another subcommand accepts", async () => {
    const { command: noFlagsCommand } = createWindowsOnlyCommand();
    const output = createOutput();
    assert.equal(
      await runCli(["sample", "--force"], { platform: "win32", commands: { sample: noFlagsCommand }, ...output }),
      EXIT_CODE_USAGE_ERROR,
    );
  });

  it("shows each subcommand's arguments in the usage", async () => {
    const { command } = createPathsCommand(undefined);
    const output = createOutput();
    await runCli(["--help"], { commands: { paths: command }, ...output });
    assert.match(output.logs.join("\n"), /cleaner paths <ruta>\.\.\. \[--force\] \[--dry-run\]/u);
  });

  it("lists the worktrees cleanup in the real binary", async () => {
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "--help"]);
    assert.match(stdout, /worktrees\s+Borra worktrees de git/u);
  });
});
