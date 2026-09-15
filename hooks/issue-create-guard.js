#!/usr/bin/env node
'use strict';

/**
 * ABOUTME: Plugin-level PreToolUse[Bash] gate — physically prevents unilateral
 * ABOUTME: or duplicate `gh issue create` calls during a brainstorm run.
 *
 * Duplicate-issue blocking is ARMED unconditionally (ignores
 * ENVOY_HOOK_PROFILE) — see hooks/observe-gate.js `guardIssueCreate`.
 * The "no approved plan yet" case follows the standard observe/strict toggle.
 */

const { guardIssueCreate } = require('./observe-gate');

/**
 * Entry point invoked by hook-runner with the raw stdin payload.
 * @param {string} data
 * @returns {number} exit code (0 allow, 2 block)
 */
function run(data) {
  return guardIssueCreate(process.cwd(), data);
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
    code = 0; // belt-and-suspenders: never block on gate failure
  }
  process.exit(code === 2 ? 2 : 0);
}

module.exports = { run };
