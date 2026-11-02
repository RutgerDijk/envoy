#!/usr/bin/env node
'use strict';

/**
 * PreToolUse[Bash] hook: issue-create-guard + config-protection in ONE spawn.
 *
 * Mirrors edit-guard-combined (PreToolUse[Edit|Write]): one `node` process
 * per Bash call instead of one per guard.
 *
 *  - issue-create-guard: observe-gate.js guardIssueCreate, unchanged (runs
 *    first so its observe-log side effects are exactly as before).
 *  - config-protection: configProtection.runBash — blocks commands that write
 *    a protected linter/formatter config basename (see the parser notes in
 *    config-protection.js for supported forms and known limits).
 *
 * Both guards always run; the hook blocks (exit 2) if either returns 2.
 * Each honours ENVOY_DISABLED_HOOKS / ENVOY_HOOK_PROFILE by its own name via
 * hook-runner's shouldRun, so disabling one never disables the other.
 */

const { guardIssueCreate } = require('./observe-gate');
const configProtection = require('./config-protection');

// Resolved lazily: when hook-runner.js is the main module it requires this
// file before assigning its own module.exports, so a top-level destructure
// would capture undefined (circular require).
function shouldRun(name) {
  return require('./hook-runner').shouldRun(name);
}

/**
 * @param {string} data raw stdin payload
 * @returns {number} exit code (0 allow, 2 block)
 */
function run(data) {
  let code = 0;

  if (shouldRun('issue-create-guard')) {
    try {
      if (guardIssueCreate(process.cwd(), data) === 2) code = 2;
    } catch {
      // never block on gate failure
    }
  }

  if (shouldRun('config-protection')) {
    try {
      if (configProtection.runBash(data) === 2) code = 2;
    } catch {
      // never block on gate failure
    }
  }

  return code;
}

if (require.main === module) {
  let input = '';
  try {
    input = require('fs').readFileSync(0, 'utf8');
  } catch {
    input = '';
  }
  let code = 0;
  try {
    code = run(input);
  } catch {
    code = 0;
  }
  process.exit(code === 2 ? 2 : 0);
}

module.exports = { run };
