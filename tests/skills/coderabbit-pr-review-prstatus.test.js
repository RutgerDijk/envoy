#!/usr/bin/env node
/**
 * coderabbit-pr-review skill Step 8 count-gate — contract tests.
 *
 * Guards #49 task-1: the skill's Step 8 verify-resolution count gate must read
 * from lib/pr-status.js (single source), NOT an inline GraphQL reviewThreads
 * count. Step 5 comment-body fetch and Step 6 thread-ID GraphQL are PRESERVED;
 * Step 6 must use -F typed GraphQL variables (no $OWNER/$REPO interpolation).
 *
 * Run: node tests/skills/coderabbit-pr-review-prstatus.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SKILL = path.join(REPO_ROOT, 'skills', 'coderabbit-pr-review', 'SKILL.md');

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

section('coderabbit-pr-review Step 8 routes through pr-status.js (#49)');

test('Step 8 reads .threads.unresolved via lib/pr-status.js', () => {
  assert.ok(
    /pr-status\.js/.test(md),
    'Step 8 must invoke lib/pr-status.js as the status source'
  );
  assert.ok(
    /\.threads\.unresolved/.test(md),
    'Step 8 must read the all-author .threads.unresolved snapshot field'
  );
});

test('no coderabbit REST select ... | length count-gate remains', () => {
  assert.ok(
    !/select\([^)]*coderabbitai[\s\S]*?\|\s*length/.test(md),
    'the REST coderabbitai select(...) | length count expression must be gone'
  );
});

test('no reviewThreads isResolved==false ... | length count-gate remains', () => {
  assert.ok(
    !/reviewThreads[\s\S]*?isResolved\s*==\s*false[\s\S]*?\|\s*length/.test(md),
    'the inline reviewThreads count-gate (map(select(.isResolved==false)) | length) must be gone from Step 8'
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

section('coderabbit-pr-review preserves Step 5 + Step 6 fetches (#49)');

test('Step 5 comment-body fetch line still present', () => {
  assert.ok(
    /pulls\/<pr-number>\/comments\b/.test(md) &&
      /\{id,\s*path,\s*line,\s*body/.test(md),
    'the REST comment-body fetch (pulls/<pr-number>/comments → {id, path, line, body,...}) must be preserved'
  );
});

test('Step 6 thread-ID GraphQL query still present', () => {
  assert.ok(
    /reviewThreads\(first:\s*100\)/.test(md),
    'the Step 6 reviewThreads(first: 100) thread-ID query must be preserved'
  );
});

test('no $OWNER/$REPO-interpolated repository() query remains anywhere', () => {
  assert.ok(
    !/owner:\s*"'\$OWNER'"/.test(md),
    'GraphQL queries must use -F typed vars, not $OWNER string interpolation'
  );
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
