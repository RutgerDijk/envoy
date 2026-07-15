#!/usr/bin/env node
/**
 * Finalize CodeRabbit step — contract tests.
 *
 * Guards the #25 fix: finalize's CodeRabbit poll/advance gates must route through
 * lib/pr-status.js (GraphQL unresolved-thread count + rate-limit), NOT a REST-only
 * comment count that misses inline review threads.
 *
 * Run: node tests/skills/finalize-coderabbit.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..', '..');
const STEP = path.join(REPO_ROOT, 'skills', 'finalize', 'steps', 'coderabbit.md');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
  } catch (err) {
    failed++;
    process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n    ${err.message}\n`);
  }
}

function section(name) {
  process.stdout.write(`\n\x1b[1m${name}\x1b[0m\n`);
}

const md = fs.readFileSync(STEP, 'utf8');

section('finalize CodeRabbit step routes through pr-status.js (#25)');

test('references lib/pr-status.js as the status source', () => {
  assert.ok(
    /pr-status\.js/.test(md),
    'coderabbit.md must invoke lib/pr-status.js for the CodeRabbit signal'
  );
});

test('gates on GraphQL-derived unresolvedThreads', () => {
  assert.ok(
    /unresolvedThreads/.test(md),
    'the advance/poll gate must use the unresolvedThreads snapshot field'
  );
});

test('honors CodeRabbit rate-limit state from the snapshot', () => {
  assert.ok(
    /rateLimit/.test(md),
    'polling must consult the rateLimit snapshot so a rate-limited review is not read as "clean"'
  );
});

test('no REST-only coderabbit comment-count is the sole advance signal', () => {
  assert.ok(
    !/select\(\s*\.user\.login\s*==\s*"coderabbitai"\s*\)\]\s*\|\s*length/.test(md),
    'the REST comment-count poll expression must be removed as the advance signal'
  );
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
