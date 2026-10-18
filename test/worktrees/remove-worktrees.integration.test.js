import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";
import { REFUSAL_REASONS } from "../../src/worktrees/constants.js";
import { removeWorktrees } from "../../src/worktrees/remove-worktrees.js";

const execFileAsync = promisify(execFile);
/** Deeper than Windows' 260-character MAX_PATH once joined to the temporary folder. */
const LONG_PATH_MIN_LENGTH = 300;
/** Identity for the fixture commits, so the test does not depend on the machine's git config. */
const GIT_IDENTITY = ["-c", "user.name=astra-cleaner test", "-c", "user.email=test@example.invalid"];

/**
 * Runs git in a folder.
 * @param {string} folderPath - Folder git runs in.
 * @param {string[]} gitArguments - Arguments after `-C <folder>`.
 * @returns {Promise<string>} Standard output.
 */
async function git(folderPath, gitArguments) {
  const { stdout } = await execFileAsync("git", [...GIT_IDENTITY, "-C", folderPath, ...gitArguments]);
  return stdout;
}

/** Collects messages sent to `log` and `warn`. */
function createOutput() {
  /** @type {string[]} */
  const warnings = [];
  return {
    warnings,
    log: () => {},
    /** @param {string} message */
    warn: (message) => warnings.push(message),
  };
}

describe("removeWorktrees with real git", () => {
  /** @type {string} */
  let fixtureFolder;
  /** @type {string} */
  let mainPath;

  before(async () => {
    // The native real path expands short (8.3) names, such as the Windows runner's RUNNER~1, into the long path git
    // and the cleanup report.
    fixtureFolder = realpathSync.native(mkdtempSync(path.join(tmpdir(), "astra-cleaner-worktrees-")));
    mainPath = path.join(fixtureFolder, "app");
    mkdirSync(mainPath);
    await git(mainPath, ["init", "--initial-branch=main"]);
    writeFileSync(path.join(mainPath, ".gitignore"), "node_modules/\n");
    await git(mainPath, ["add", ".gitignore"]);
    await git(mainPath, ["commit", "-m", "initial commit"]);
  });

  after(() => {
    rmSync(fixtureFolder, { recursive: true, force: true, maxRetries: 5 });
  });

  /**
   * Adds a linked worktree on its own branch.
   * @param {string} name - Folder and branch name.
   * @returns {Promise<string>} Worktree folder.
   */
  async function addWorktree(name) {
    const worktreePath = path.join(fixtureFolder, name);
    await git(mainPath, ["worktree", "add", "-b", name, worktreePath]);
    return worktreePath;
  }

  it("removes a worktree whose node_modules goes beyond Windows' path limit and keeps its branch", async () => {
    const worktreePath = await addWorktree("feature-long-paths");
    let deepFolder = path.join(worktreePath, "node_modules");
    while (deepFolder.length < LONG_PATH_MIN_LENGTH) deepFolder = path.join(deepFolder, "nested-package-folder");
    mkdirSync(deepFolder, { recursive: true });
    writeFileSync(path.join(deepFolder, "index.js"), "module.exports = {};\n");

    const output = createOutput();
    const result = await removeWorktrees({ paths: [worktreePath], currentDirectory: fixtureFolder, ...output });

    assert.deepEqual(result, { removedPaths: [worktreePath], refused: [], failed: [] }, output.warnings.join("\n"));
    assert.equal(existsSync(worktreePath), false);
    const worktreeList = await git(mainPath, ["worktree", "list", "--porcelain"]);
    assert.doesNotMatch(worktreeList, /feature-long-paths/u);
    assert.match(await git(mainPath, ["branch", "--list", "feature-long-paths"]), /feature-long-paths/u);
  });

  it("removes the folder a failed git worktree remove leaves behind, holding only node_modules", async () => {
    // Reproduces what `git worktree remove` leaves on Windows after "Filename too long": git already dropped the
    // record and the .git file, so only node_modules remains in an unregistered folder.
    const worktreePath = await addWorktree("feature-failed-remove");
    mkdirSync(path.join(worktreePath, "node_modules", "some-package"), { recursive: true });
    await git(mainPath, ["worktree", "remove", "--force", worktreePath]).catch(() => {});
    if (existsSync(worktreePath)) rmSync(path.join(worktreePath, ".git"), { force: true });
    mkdirSync(path.join(worktreePath, "node_modules", "some-package"), { recursive: true });
    await git(mainPath, ["worktree", "prune"]);

    const result = await removeWorktrees({ paths: [worktreePath], currentDirectory: fixtureFolder, ...createOutput() });
    assert.deepEqual(result.removedPaths, [worktreePath]);
    assert.equal(existsSync(worktreePath), false);
  });

  it("keeps a worktree with an untracked file unless forced", async () => {
    const worktreePath = await addWorktree("feature-untracked");
    writeFileSync(path.join(worktreePath, "notes.txt"), "work in progress\n");

    const kept = await removeWorktrees({ paths: [worktreePath], currentDirectory: fixtureFolder, ...createOutput() });
    assert.deepEqual(kept.refused, [{ path: worktreePath, reason: REFUSAL_REASONS.UNCOMMITTED_CHANGES }]);
    assert.equal(existsSync(path.join(worktreePath, "notes.txt")), true);

    const forced = await removeWorktrees({
      paths: [worktreePath],
      force: true,
      currentDirectory: fixtureFolder,
      ...createOutput(),
    });
    assert.deepEqual(forced.removedPaths, [worktreePath]);
    assert.equal(existsSync(worktreePath), false);
  });

  it("keeps a locked worktree and the main worktree", async () => {
    const worktreePath = await addWorktree("feature-locked");
    await git(mainPath, ["worktree", "lock", worktreePath]);

    const result = await removeWorktrees({
      paths: [worktreePath, mainPath],
      force: true,
      currentDirectory: fixtureFolder,
      ...createOutput(),
    });
    assert.deepEqual(result.refused, [
      { path: worktreePath, reason: REFUSAL_REASONS.LOCKED },
      { path: mainPath, reason: REFUSAL_REASONS.MAIN_WORKTREE },
    ]);
    assert.equal(existsSync(worktreePath), true);
    assert.equal(existsSync(path.join(mainPath, ".git")), true);
    await git(mainPath, ["worktree", "unlock", worktreePath]);
  });

  it(
    "matches a worktree given by its Windows short (8.3) name",
    { skip: process.platform !== "win32" && "only Windows has short names" },
    async (testContext) => {
      const worktreePath = await addWorktree("feature-short-name");
      const shortPath = (
        await execFileAsync("powershell", [
          "-NoProfile",
          "-Command",
          `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${worktreePath}').ShortPath`,
        ])
      ).stdout.trim();
      if (shortPath.toLowerCase() === worktreePath.toLowerCase()) {
        testContext.skip("this volume does not generate short names");
        return;
      }
      const result = await removeWorktrees({ paths: [shortPath], currentDirectory: fixtureFolder, ...createOutput() });
      assert.deepEqual(result.refused, []);
      assert.equal(existsSync(worktreePath), false);
    },
  );

  it("refuses a plain folder that is not a worktree", async () => {
    const plainFolder = path.join(fixtureFolder, "plain-folder");
    mkdirSync(plainFolder);
    const result = await removeWorktrees({ paths: [plainFolder], currentDirectory: fixtureFolder, ...createOutput() });
    assert.deepEqual(result.refused, [{ path: plainFolder, reason: REFUSAL_REASONS.NOT_A_WORKTREE }]);
    assert.equal(existsSync(plainFolder), true);
  });
});
