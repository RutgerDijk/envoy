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
 */
function run(data) {
  observe('stop-audit', data);
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
