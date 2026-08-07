'use strict';

/**
 * Repo hygiene decision logic for the /envoy:doctor skill.
 *
 * Consumer repos onboarded before #71/#72 may still track
 * `.envoy-tasks/*.json` and `.envoy/**` files in git — those paths weren't
 * gitignored until #71/#72 landed in the envoy repo itself. This module finds
 * such tracked files, checks whether the consuming repo's .gitignore has the
 * required entries, and plans (without executing) the `--fix` remediation.
 *
 * Design: git-mutating side effects (git ls-files, git rm --cached, writing
 * .gitignore) are kept in thin wrappers (findTrackedEnvoyFiles,
 * executeFix) so the actual decision logic (checkGitignoreEntries, planFix,
 * parseIssueNumberFromTaskFile) stays pure/near-pure and unit-testable
 * without a real git repo.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REQUIRED_GITIGNORE_ENTRIES = ['.envoy/', '.envoy-tasks/'];

// Patterns of tracked paths we care about: .envoy-tasks/<n>.json and anything
// under .envoy/.
function isEnvoyRuntimePath(relPath) {
  return /^\.envoy-tasks\/.*\.json$/.test(relPath) || /^\.envoy\//.test(relPath);
}

/**
 * Tracked files under .envoy-tasks/ or .envoy/ in the given git repo.
 * Shells out to `git ls-files` — integration-style, needs a real git repo.
 * @param {string} cwd
 * @returns {string[]}
 */
function findTrackedEnvoyFiles(cwd) {
  let out;
  try {
    out = execFileSync('git', ['ls-files'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (_err) {
    return [];
  }
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter(isEnvoyRuntimePath);
}

/**
 * Which of the required .gitignore entries are missing.
 * Pure w.r.t. the fixture .gitignore contents at cwd (fs read only, no git).
 * @param {string} cwd
 * @returns {string[]} the missing entries, e.g. ['.envoy/', '.envoy-tasks/']
 */
function checkGitignoreEntries(cwd) {
  const gitignorePath = path.join(cwd, '.gitignore');
  let content = '';
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf8');
  }
  const lines = new Set(content.split('\n').map((l) => l.trim()).filter(Boolean));
  return REQUIRED_GITIGNORE_ENTRIES.filter((entry) => !lines.has(entry));
}

/**
 * Extract the issue number from a task filename like `.envoy-tasks/42.json`
 * or `42.json`. Returns null when the filename doesn't match the pattern.
 * @param {string} filePath
 * @returns {number|null}
 */
function parseIssueNumberFromTaskFile(filePath) {
  const base = path.basename(filePath);
  const m = base.match(/^(\d+)\.json$/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Build the --fix remediation plan WITHOUT executing it.
 * @param {string[]} trackedFiles - tracked paths from findTrackedEnvoyFiles
 * @param {string[]} gitignoreGaps - missing entries from checkGitignoreEntries
 * @returns {{rmCached: string[], gitignoreAppend: string[]}}
 */
function planFix(trackedFiles, gitignoreGaps) {
  return {
    rmCached: [...trackedFiles],
    gitignoreAppend: [...gitignoreGaps],
  };
}

/**
 * Execute a fix plan: `git rm --cached -r` for each tracked file, then append
 * missing entries to .gitignore. Never commits. Thin wrapper — the actual
 * decisions were already made by planFix.
 * @param {string} cwd
 * @param {{rmCached: string[], gitignoreAppend: string[]}} plan
 */
function executeFix(cwd, plan) {
  if (plan.rmCached.length > 0) {
    execFileSync('git', ['rm', '--cached', '-r', '--', ...plan.rmCached], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  if (plan.gitignoreAppend.length > 0) {
    const gitignorePath = path.join(cwd, '.gitignore');
    let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
    if (content.length > 0 && !content.endsWith('\n')) content += '\n';
    content += plan.gitignoreAppend.join('\n') + '\n';
    fs.writeFileSync(gitignorePath, content);
  }
}

module.exports = {
  findTrackedEnvoyFiles,
  checkGitignoreEntries,
  parseIssueNumberFromTaskFile,
  planFix,
  executeFix,
};
