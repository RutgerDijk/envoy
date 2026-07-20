/**
 * Worktree State
 *
 * Fixes the #1560 worktree-state race: when a feature worktree is created,
 * Envoy runtime state (.envoy/) must live inside that worktree, not in the
 * main checkout where a concurrent session could read or clobber it.
 *
 * Provides migrateEnvoyState (relocate .envoy/ main -> worktree) and
 * assertInWorktree (guard that the process is running in the expected,
 * git-registered worktree). Zero dependencies — node builtins only.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Move the `.envoy/` directory from `mainDir` into `worktreeDir`.
 *
 * - If `mainDir/.envoy` exists, it is relocated so that `worktreeDir/.envoy`
 *   holds its contents and `mainDir/.envoy` no longer exists.
 * - Pre-existing-target policy: **replace**. If `worktreeDir/.envoy` already
 *   exists it is removed first, then the source directory takes its place.
 *   This is the simplest correct behavior — the worktree's freshly-migrated
 *   state is authoritative for that worktree; a stale target would otherwise
 *   reintroduce exactly the cross-checkout leakage this function prevents.
 * - If `mainDir/.envoy` does not exist, this is a no-op and does not throw.
 * - Uses `fs.renameSync`; on a cross-device error (EXDEV) it falls back to a
 *   recursive copy followed by `fs.rmSync` of the source.
 *
 * @param {string} mainDir - Path to the main checkout.
 * @param {string} worktreeDir - Path to the target worktree.
 * @returns {void}
 */
function migrateEnvoyState(mainDir, worktreeDir) {
  const source = path.join(mainDir, '.envoy');
  const target = path.join(worktreeDir, '.envoy');

  if (!fs.existsSync(source)) return;

  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });

  try {
    fs.renameSync(source, target);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.cpSync(source, target, { recursive: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
}

/**
 * List absolute paths of all git-registered worktrees.
 * Parses `git worktree list --porcelain` from the given directory.
 * @param {string} cwd - Directory to run git from.
 * @returns {string[]} Worktree root paths (as reported by git).
 */
function gitWorktreePaths(cwd) {
  const out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd,
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim());
}

/**
 * Resolve a path to its absolute, symlink-free real path when it exists,
 * falling back to a plain absolute resolution when it does not.
 * @param {string} p
 * @returns {string}
 */
function realAbs(p) {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch (_err) {
    return abs;
  }
}

/**
 * Assert that the current process is running inside `expectedWorktree`.
 *
 * Contract: returns normally on a match; throws an Error on any mismatch.
 * Callers that want a hard stop can wrap the call and `process.exit(1)` in the
 * catch — this function never exits the process itself, which keeps it unit
 * testable.
 *
 * Two conditions must both hold:
 *   1. `cwd` resolves to the same real path as `expectedWorktree`.
 *   2. `expectedWorktree` is a git-registered worktree per `listWorktrees()`.
 *
 * Paths are compared after resolving to absolute real paths so symlinked
 * temp/worktree roots compare equal.
 *
 * @param {string} expectedWorktree - Path the process is expected to run in.
 * @param {object} [options]
 * @param {string} [options.cwd=process.cwd()] - Current directory to check.
 * @param {() => string[]} [options.listWorktrees] - Returns registered
 *   worktree paths. Defaults to parsing `git worktree list --porcelain`.
 *   Injectable so tests need not touch the real repo.
 * @returns {void}
 * @throws {Error} When cwd is not the expected worktree, or the expected
 *   worktree is not registered.
 */
function assertInWorktree(expectedWorktree, options = {}) {
  const cwd = options.cwd || process.cwd();
  const listWorktrees = options.listWorktrees || (() => gitWorktreePaths(cwd));

  const expected = realAbs(expectedWorktree);
  const actual = realAbs(cwd);

  if (actual !== expected) {
    throw new Error(
      `Not in expected worktree: cwd is ${actual}, expected ${expected}`
    );
  }

  const registered = listWorktrees().map(realAbs);
  if (!registered.includes(expected)) {
    throw new Error(
      `${expected} is not a registered git worktree`
    );
  }
}

module.exports = { migrateEnvoyState, assertInWorktree };
