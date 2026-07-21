#!/usr/bin/env node
'use strict';

/**
 * ABOUTME: Plugin-level Stop observe gate — logs would-block Stop events.
 * ABOUTME: Never blocks; delegates the decision to the active skill's contract.
 */

const { observe } = require('./observe-gate');

/**
 * Entry point invoked by hook-runner with the raw stdin payload.
 * @param {string} data
 * @returns {number} exit code from the gate (0 allow, 2 block under strict)
 */
function run(data) {
  return observe('stop-audit', data);
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
