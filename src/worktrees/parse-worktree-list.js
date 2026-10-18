/** @module worktrees/parse-worktree-list Parses `git worktree list --porcelain -z`. */

/** @typedef {import("./decide-worktree-removal.js").WorktreeEntry} WorktreeEntry */

/**
 * Parses the NUL-delimited porcelain output of `git worktree list -z`: every attribute ends with a NUL and an empty
 * attribute closes each worktree, so paths keep any character, newlines included. The main worktree comes first. A
 * bare repository has no main worktree folder, so its record is marked as main but never matches a folder to remove.
 * @param {string} porcelainOutput - Output of `git worktree list --porcelain -z`.
 * @returns {WorktreeEntry[]} Worktrees, main first.
 */
export function parseWorktreeList(porcelainOutput) {
  /** @type {string[][]} */
  const records = [];
  /** @type {string[]} */
  let attributes = [];
  for (const attribute of porcelainOutput.split("\0")) {
    if (attribute === "") {
      if (attributes.length > 0) records.push(attributes);
      attributes = [];
    } else {
      attributes.push(attribute);
    }
  }
  if (attributes.length > 0) records.push(attributes);

  return records
    .filter((recordAttributes) => recordAttributes.some((attribute) => attribute.startsWith("worktree ")))
    .map((recordAttributes, recordIndex) => {
      const worktreeAttribute = recordAttributes.find((attribute) => attribute.startsWith("worktree ")) ?? "";
      return {
        path: worktreeAttribute.slice("worktree ".length),
        isMain: recordIndex === 0,
        locked: recordAttributes.some((attribute) => attribute === "locked" || attribute.startsWith("locked ")),
      };
    });
}
