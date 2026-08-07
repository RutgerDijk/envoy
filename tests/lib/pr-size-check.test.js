#!/usr/bin/env node
/**
 * PR-split advisory — Test Suite
 *
 * Pure logic for the >150 changed-files advisory (finalize Step 1) and the
 * countUniqueFiles helper reused by pickup's plan viability check.
 * No network, no git — counts/lists are passed in.
 * Run: node tests/lib/pr-size-check.test.js
 */

const assert = require('assert');
const path = require('path');

const prSizeCheck = require(path.join(__dirname, '..', '..', 'lib', 'pr-size-check.js'));

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

// ═══════════════════════════════════════════════════════════════════
// DEFAULT_THRESHOLD
// ═══════════════════════════════════════════════════════════════════

section('DEFAULT_THRESHOLD');

test('is 150', () => {
  assert.strictEqual(prSizeCheck.DEFAULT_THRESHOLD, 150);
});

// ═══════════════════════════════════════════════════════════════════
// proposeSplit
// ═══════════════════════════════════════════════════════════════════

section('proposeSplit: advisory proposal for oversized diffs');

test('returns null (no advisory) when file count is at the threshold', () => {
  assert.strictEqual(prSizeCheck.proposeSplit(150), null);
});

test('returns null when file count is well under the threshold', () => {
  assert.strictEqual(prSizeCheck.proposeSplit(10), null);
});

test('returns an advisory object when file count exceeds the threshold', () => {
  const result = prSizeCheck.proposeSplit(200);
  assert.ok(result);
  assert.strictEqual(result.fileCount, 200);
  assert.strictEqual(result.threshold, 150);
});

test('advisory message mentions the count and CodeRabbit degradation', () => {
  const result = prSizeCheck.proposeSplit(151);
  assert.match(result.message, /151/);
  assert.match(result.message, /CodeRabbit/i);
});

test('advisory message presents proceed-as-one vs split options, ask-only', () => {
  const result = prSizeCheck.proposeSplit(300);
  assert.match(result.message, /proceed/i);
  assert.match(result.message, /split/i);
  assert.match(result.message, /awaiting|approval|decision/i);
});

test('advisory never mentions automatic branch creation (ask-only, no automation)', () => {
  const result = prSizeCheck.proposeSplit(300);
  assert.doesNotMatch(result.message, /automatically creat/i);
});

test('custom threshold is respected', () => {
  assert.strictEqual(prSizeCheck.proposeSplit(60, 50).fileCount, 60);
  assert.strictEqual(prSizeCheck.proposeSplit(40, 50), null);
});

test('throws on negative file counts', () => {
  assert.throws(() => prSizeCheck.proposeSplit(-1), /non-negative/);
});

// ═══════════════════════════════════════════════════════════════════
// prLinkedIssueLine
// ═══════════════════════════════════════════════════════════════════

section('prLinkedIssueLine: Closes vs Part of for stacked PRs');

test('final (or only) PR in a split gets "Closes #N"', () => {
  assert.strictEqual(prSizeCheck.prLinkedIssueLine(42, true), 'Closes #42');
});

test('non-final PR in a stacked split gets "Part of #N", not Closes', () => {
  assert.strictEqual(prSizeCheck.prLinkedIssueLine(42, false), 'Part of #42');
});

test('defaults isFinalPr to true (single-PR case keeps existing Closes behavior)', () => {
  assert.strictEqual(prSizeCheck.prLinkedIssueLine(7), 'Closes #7');
});

test('throws on non-numeric issue number', () => {
  assert.throws(() => prSizeCheck.prLinkedIssueLine('abc', true), /issue number/);
});

// ═══════════════════════════════════════════════════════════════════
// countUniqueFiles
// ═══════════════════════════════════════════════════════════════════

section('countUniqueFiles: dedupe file paths across task list (pickup plan check)');

test('counts unique file paths across multiple tasks', () => {
  const tasks = [
    { files: ['a.js', 'b.js'] },
    { files: ['b.js', 'c.js'] },
  ];
  assert.strictEqual(prSizeCheck.countUniqueFiles(tasks), 3);
});

test('handles tasks with missing/empty files arrays', () => {
  const tasks = [{ files: [] }, {}, { files: ['a.js'] }];
  assert.strictEqual(prSizeCheck.countUniqueFiles(tasks), 1);
});

test('returns 0 for an empty task list', () => {
  assert.strictEqual(prSizeCheck.countUniqueFiles([]), 0);
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
