#!/usr/bin/env node
/**
 * PR-split advisory — pure logic.
 *
 * CodeRabbit's review quality degrades on very large diffs. When a branch
 * touches more than DEFAULT_THRESHOLD changed files vs origin/main, finalize
 * Step 1 (preconditions) surfaces a stacked-PR split proposal and pauses for
 * explicit user approval. This module never creates branches, splits diffs,
 * or rebases — detection + informational proposal + pause only. Actual
 * stacked-branch creation is explicitly out of scope.
 *
 * Also used by pickup's plan-viability check (Step 7) to give an early
 * warning at planning time, before implementation starts, when a task
 * list's combined `files` touch more than the threshold.
 */

const DEFAULT_THRESHOLD = 150;

/**
 * Build the ask-only split proposal for an oversized diff.
 *
 * @param {number} fileCount - Number of changed files vs origin/main
 * @param {number} [threshold=DEFAULT_THRESHOLD]
 * @returns {{fileCount: number, threshold: number, message: string} | null}
 *   null when fileCount is at or below the threshold (no advisory needed)
 */
function proposeSplit(fileCount, threshold = DEFAULT_THRESHOLD) {
  if (typeof fileCount !== 'number' || fileCount < 0) {
    throw new Error('fileCount must be a non-negative number');
  }
  if (fileCount <= threshold) {
    return null;
  }

  const message = [
    `This branch touches ${fileCount} changed files vs origin/main (threshold: ${threshold}).`,
    `CodeRabbit's review quality degrades on very large diffs.`,
    ``,
    `Proposed split rationale: consider breaking this into a stacked series of`,
    `smaller PRs (e.g. by task/module boundary), so each PR stays reviewable.`,
    ``,
    `Options:`,
    `  A) Proceed as one PR anyway`,
    `  B) Split — stop here; only the FINAL PR in the stack should carry`,
    `     "Closes #<issue>", earlier PRs reference the issue without closing it`,
    `     (e.g. "Part of #<issue>"). Actual stacked-branch creation and rebase`,
    `     handling are out of scope for this check — awaiting your guidance`,
    `     on how to proceed.`,
    ``,
    `This is informational only — nothing is split automatically.`,
    `Awaiting your decision.`,
  ].join('\n');

  return { fileCount, threshold, message };
}

/**
 * Choose the PR-body linked-issue line. Only the final (or only) PR in a
 * split closes the issue; earlier PRs in a stacked split must not, so the
 * issue doesn't auto-close prematurely.
 *
 * @param {number} issueNumber
 * @param {boolean} [isFinalPr=true]
 * @returns {string} "Closes #N" or "Part of #N"
 */
function prLinkedIssueLine(issueNumber, isFinalPr = true) {
  if (typeof issueNumber !== 'number' || Number.isNaN(issueNumber)) {
    throw new Error('issue number must be numeric');
  }
  return isFinalPr ? `Closes #${issueNumber}` : `Part of #${issueNumber}`;
}

/**
 * Count unique file paths across a task list (as produced by
 * lib/schemas/tasks.json). Used by pickup's plan-viability check to warn
 * early — before implementation starts — when a plan's combined footprint
 * is large enough to trigger the finalize split advisory later.
 *
 * @param {Array<{files?: string[]}>} tasks
 * @returns {number}
 */
function countUniqueFiles(tasks) {
  const seen = new Set();
  for (const task of tasks || []) {
    for (const file of (task && task.files) || []) {
      seen.add(file);
    }
  }
  return seen.size;
}

module.exports = {
  DEFAULT_THRESHOLD,
  proposeSplit,
  prLinkedIssueLine,
  countUniqueFiles,
};
