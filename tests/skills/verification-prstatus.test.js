#!/usr/bin/env node
/**
 * Verification skill conversation checks — contract tests.
 *
 * Guards #44 task-2: the verification skill's two conversation checks must read
 * from lib/pr-status.js (single source), NOT inline GraphQL reviewThreads /
 * REST coderabbit comment counts.
 *
 * - PR Conversation Check reads .threads.unresolved (all-author)
 * - New CodeRabbit Comments Check reads .coderabbit.unresolvedThreads
 *
 * Run: node tests/skills/verification-prstatus.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SKILL = path.join(REPO_ROOT, 'skills', 'verification', 'SKILL.md');

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

const md = fs.readFileSync(SKILL, 'utf8');

section('verification conversation checks route through pr-status.js (#44)');

test('references lib/pr-status.js as the status source', () => {
  assert.ok(
    /pr-status\.js/.test(md),
    'SKILL.md conversation checks must invoke lib/pr-status.js'
  );
});

test('all-author check reads .threads.unresolved', () => {
  assert.ok(
    /\.threads\.unresolved/.test(md),
    'PR Conversation Check must read the all-author .threads.unresolved snapshot field'
  );
});

test('CodeRabbit check reads .coderabbit.unresolvedThreads', () => {
  assert.ok(
    /\.coderabbit\.unresolvedThreads/.test(md),
    'New CodeRabbit Comments Check must read the .coderabbit.unresolvedThreads snapshot field'
  );
});

test('no inline GraphQL reviewThreads query remains', () => {
  assert.ok(
    !/reviewThreads\(first:\s*100\)/.test(md),
    'the inline GraphQL reviewThreads(first: 100) query must be removed'
  );
});

test('no $OWNER/$REPO string-interpolated repository() query remains', () => {
  assert.ok(
    !/repository\(owner:\s*"'\$OWNER'"/.test(md),
    'the $OWNER/$REPO-interpolated GraphQL query must be removed'
  );
});

test('no REST coderabbit comment-count expression remains', () => {
  assert.ok(
    !/select\(\.user\.login\s*==\s*\\?"coderabbitai\\?"\)[\s\S]*?\|\s*length/.test(md),
    'the REST coderabbitai comment-count (select ... | length) must be removed'
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

test('no stale "new comments since last push" evidence phrasing remains', () => {
  assert.ok(
    !/new CodeRabbit comments since last push/i.test(md),
    'the check now measures unresolved threads, not new comments since last push — stale phrasing must be gone'
  );
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
