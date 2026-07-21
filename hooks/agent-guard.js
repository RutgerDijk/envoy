#!/usr/bin/env node
'use strict';

/**
 * ABOUTME: Plugin-level PreToolUse[Agent] observe gate — logs would-block Agent dispatches.
 * ABOUTME: Never blocks; delegates the decision to the active skill's contract.
 */

const { observe } = require('./observe-gate');

/**
 * Entry point invoked by hook-runner with the raw stdin payload.
 * @param {string} data
 */
function run(data) {
  observe('agent-guard', data);
}

if (require.main === module) {
  let input = '';
  try {
    input = require('fs').readFileSync(0, 'utf8');
  } catch {
    input = '';
  }
  run(input);
  process.exit(0);
}

module.exports = { run };
