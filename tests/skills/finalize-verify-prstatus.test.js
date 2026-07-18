#!/usr/bin/env node
/**
 * Finalize verify.md conversation gate — contract tests.
 *
 * Guards #49 task-2: the finalize verification step's single conversation gate
 * (Step 9) must read from lib/pr-status.js (single source), NOT the inline
 * GraphQL reviewThreads count with $OWNER/$REPO-interpolated repository().
 *
 * - Conversation gate reads .threads.unresolved (all-author) via pr-status.js
 * - Probe is non-fatal + guarded by -z "$SNAP" before jq
 *
 * Run: node tests/skills/finalize-verify-prstatus.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..', '..');
const STEP = path.join(REPO_ROOT, 'skills', 'finalize', 'steps', 'verify.md');

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

section('finalize verify conversation gate routes through pr-status.js (#49)');

test('references lib/pr-status.js as the status source', () => {
  assert.ok(
    /pr-status\.js/.test(md),
    'verify.md conversation gate must invoke lib/pr-status.js'
  );
});

test('all-author gate reads .threads.unresolved', () => {
  assert.ok(
    /\.threads\.unresolved/.test(md),
    'the conversation gate must read the all-author .threads.unresolved snapshot field'
  );
});

test('no inline GraphQL reviewThreads query remains', () => {
  assert.ok(
    !/reviewThreads\(first:\s*\d+\)/.test(md),
    'the inline GraphQL reviewThreads(first: N) query must be removed'
  );
});

test('no $OWNER/$REPO string-interpolated repository() query remains', () => {
  assert.ok(
    !/repository\(owner:\s*"'\$OWNER'"/.test(md),
    'the $OWNER/$REPO-interpolated GraphQL query must be removed'
  );
});

test('probe is non-fatal (2>/dev/null || true)', () => {
  assert.ok(
    /\$PR_STATUS "\$PR_NUMBER" 2>\/dev\/null \|\| true/.test(md),
    'the pr-status probe must be non-fatal so it does not abort under set -e/pipefail'
  );
});

test('empty-snapshot guard before jq (-z "$SNAP")', () => {
  assert.ok(
    /if \[ -z "\$SNAP" \]/.test(md),
    'jq must be gated behind an explicit -z "$SNAP" guard'
  );
});

test('reads the field with a // empty fallback (matches sibling idiom)', () => {
  assert.ok(
    /\.threads\.unresolved \/\/ empty/.test(md),
    'the gate must use the // empty jq fallback like the other pr-status gates, not a bare read that prints null'
  );
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
