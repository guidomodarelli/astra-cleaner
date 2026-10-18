/** @module worktrees/parse-worktree-list Parses `git worktree list --porcelain`, with or without `-z`. */

/** @typedef {import("./decide-worktree-removal.js").WorktreeEntry} WorktreeEntry */

/** Ends each attribute in the `-z` format, where an empty attribute closes each worktree. */
const NUL_DELIMITER = "\0";

/**
 * Splits porcelain output into the attributes of each worktree. The `-z` format (git 2.36 and later) ends every
 * attribute with a NUL, so paths keep any character, newlines included; the plain format, which older git prints,
 * ends attributes with a newline and worktrees with a blank line.
 * @param {string} porcelainOutput - Output of `git worktree list --porcelain`, with or without `-z`.
 * @returns {string[][]} Attributes of each worktree.
 */
function splitRecords(porcelainOutput) {
  const isNulDelimited = porcelainOutput.includes(NUL_DELIMITER);
  const attributeList = isNulDelimited
    ? porcelainOutput.split(NUL_DELIMITER)
    : porcelainOutput.replace(/\r\n/gu, "\n").split("\n");
  /** @type {string[][]} */
  const records = [];
  /** @type {string[]} */
  let attributes = [];
  for (const attribute of attributeList) {
    if (attribute === "") {
      if (attributes.length > 0) records.push(attributes);
      attributes = [];
    } else {
      attributes.push(attribute);
    }
  }
  if (attributes.length > 0) records.push(attributes);
  return records;
}

/**
 * Parses the porcelain output of `git worktree list`. The main worktree comes first. A bare repository has no main
 * worktree folder, so its record is marked as main but never matches a folder to remove.
 * @param {string} porcelainOutput - Output of `git worktree list --porcelain`, with or without `-z`.
 * @returns {WorktreeEntry[]} Worktrees, main first.
 */
export function parseWorktreeList(porcelainOutput) {
  return splitRecords(porcelainOutput)
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
