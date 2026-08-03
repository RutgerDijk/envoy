#!/usr/bin/env node
/**
 * Main-drift check — pure logic + thin git-shelling wrapper.
 *
 * Catches breaking merges into origin/main before burning a full CI run.
 * finalize's Preconditions (Step 1) run this once at the start, and Step 6
 * (push, in the — possibly multi-cycle — remediation loop) re-runs it before
 * EVERY push, since drift can land mid-loop (e.g. a conflicting PR merges to
 * main while finalize is still looping through CodeRabbit cycles).
 *
 * Detection: find the branch point with `git merge-base`, count new commits
 * on origin/main since that point with `git rev-list --count`, and compare
 * the file lists changed on each side since the branch point (equivalent to
 * `comm -12` on two sorted-unique file lists — done here in plain JS since
 * the result is byte-identical and does not require juggling `comm`'s sort
 * preconditions).
 *
 * Drift with NO file overlap is informational only — print a note, do not
 * stop. Only overlapping-file drift stops finalize and offers:
 *   A) rebase
 *   B) merge main in
 *   C) proceed anyway
 */

const { execFileSync } = require('child_process');

/**
 * Set-intersection of two file-path lists — sorted, deduped, comm-equivalent.
 *
 * @param {string[]} listA
 * @param {string[]} listB
 * @returns {string[]} sorted unique files present in both lists
 */
function intersectFiles(listA, listB) {
  const setB = new Set(listB || []);
  const overlap = new Set();
  for (const file of listA || []) {
    if (setB.has(file)) {
      overlap.add(file);
    }
  }
  return Array.from(overlap).sort();
}

/**
 * Decide hasDrift + build the stop-and-ask message from a commit count and
 * an already-computed overlap list.
 *
 * @param {number} driftCommits - new commits on origin/main since the branch point
 * @param {string[]} overlappingFiles - files changed on both origin/main and this branch since the branch point
 * @returns {{hasDrift: boolean, driftCommits: number, overlappingFiles: string[], message: string}}
 */
function evaluateDrift(driftCommits, overlappingFiles) {
  const overlap = overlappingFiles || [];

  if (driftCommits <= 0) {
    return {
      hasDrift: false,
      driftCommits: 0,
      overlappingFiles: [],
      message: 'No new commits on origin/main since the branch point. No drift.',
    };
  }

  if (overlap.length === 0) {
    return {
      hasDrift: false,
      driftCommits,
      overlappingFiles: [],
      message: [
        `origin/main has ${driftCommits} new commit(s) since the branch point,`,
        `but none touch files also changed on this branch. Informational only`,
        `— no action needed.`,
      ].join(' '),
    };
  }

  const message = [
    `origin/main has ${driftCommits} new commit(s) since the branch point that`,
    `touch file(s) also changed on this branch:`,
    ``,
    ...overlap.map((f) => `  - ${f}`),
    ``,
    `Options:`,
    `  A) Rebase this branch onto origin/main`,
    `  B) Merge origin/main into this branch`,
    `  C) Proceed anyway`,
    ``,
    `Awaiting your decision.`,
  ].join('\n');

  return {
    hasDrift: true,
    driftCommits,
    overlappingFiles: overlap,
    message,
  };
}

/**
 * Run `cmd` in `cwd`, returning trimmed stdout, tolerating a nonzero exit
 * (e.g. when there is nothing to diff) by returning an empty string.
 */
function safeGit(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      .toString()
      .trim();
  } catch (err) {
    return '';
  }
}

function linesToList(output) {
  return output
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Compute drift between the current branch and origin/main since their
 * merge-base. Shells out to git; the decision logic itself is `evaluateDrift`
 * above (pure, unit-tested without git).
 *
 * @param {string} cwd - repo working directory
 * @param {string} [remoteRef='origin/main'] - the ref to check drift against
 * @returns {{hasDrift: boolean, driftCommits: number, overlappingFiles: string[], message: string}}
 */
function computeDrift(cwd, remoteRef = 'origin/main') {
  const branchPoint = safeGit(['merge-base', 'HEAD', remoteRef], cwd);
  if (!branchPoint) {
    // No common ancestor found (e.g. remote missing) — treat as no drift,
    // fail open rather than blocking finalize on an unrelated git error.
    return evaluateDrift(0, []);
  }

  const driftCommits = Number(
    safeGit(['rev-list', '--count', `${branchPoint}..${remoteRef}`], cwd) || '0'
  );

  if (driftCommits <= 0) {
    return evaluateDrift(0, []);
  }

  const mainFiles = linesToList(safeGit(['diff', '--name-only', `${branchPoint}..${remoteRef}`], cwd));
  const branchFiles = linesToList(safeGit(['diff', '--name-only', `${branchPoint}..HEAD`], cwd));
  const overlappingFiles = intersectFiles(mainFiles, branchFiles);

  return evaluateDrift(driftCommits, overlappingFiles);
}

module.exports = {
  intersectFiles,
  evaluateDrift,
  computeDrift,
};
