#!/usr/bin/env node
/**
 * lib/remediation-cycle.js — pure-function tests for the unified
 * finalize remediation cycle (Task 7: batch CodeRabbit + CI fixes into
 * ONE commit/push per cycle, cap at 3 cycles).
 *
 * Run: node tests/lib/remediation-cycle.test.js
 */

const assert = require('assert');
const path = require('path');

const MODULE = path.join(__dirname, '..', '..', 'lib', 'remediation-cycle.js');
const { buildCommitMessage, shouldEscalate } = require(MODULE);

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

section('buildCommitMessage(findings)');

test('enumerates each CodeRabbit finding with its thread URL', () => {
  const msg = buildCommitMessage([
    { type: 'coderabbit', summary: 'null check on parseUser', threadUrl: 'https://github.com/o/r/pull/1#discussion_r1' },
  ]);
  assert.ok(/null check on parseUser/.test(msg));
  assert.ok(/https:\/\/github\.com\/o\/r\/pull\/1#discussion_r1/.test(msg));
});

test('enumerates each CI failure diagnosis without requiring a thread URL', () => {
  const msg = buildCommitMessage([
    { type: 'ci', summary: 'fix flaky test in UserServiceTests' },
  ]);
  assert.ok(/fix flaky test in UserServiceTests/.test(msg));
});

test('combines CodeRabbit and CI findings into one message', () => {
  const msg = buildCommitMessage([
    { type: 'coderabbit', summary: 'finding A', threadUrl: 'https://x/1' },
    { type: 'ci', summary: 'finding B' },
  ]);
  assert.ok(/finding A/.test(msg));
  assert.ok(/finding B/.test(msg));
});

test('subject line stays a single line (git commit -m friendly)', () => {
  const msg = buildCommitMessage([
    { type: 'coderabbit', summary: 'finding A', threadUrl: 'https://x/1' },
  ]);
  const firstLine = msg.split('\n')[0];
  assert.ok(firstLine.length > 0 && !firstLine.includes('\n'));
});

test('throws on empty findings list — nothing to commit', () => {
  assert.throws(() => buildCommitMessage([]));
});

section('shouldEscalate(cycleCount, remaining)');

test('does not escalate before cap when issues remain', () => {
  assert.strictEqual(shouldEscalate(1, { coderabbit: ['t1'], ci: [] }), false);
  assert.strictEqual(shouldEscalate(2, { coderabbit: [], ci: ['check-x'] }), false);
});

test('escalates once cycle 3 completes with issues still remaining', () => {
  assert.strictEqual(shouldEscalate(3, { coderabbit: ['t1'], ci: [] }), true);
  assert.strictEqual(shouldEscalate(3, { coderabbit: [], ci: ['check-x'] }), true);
});

test('does not escalate at cap when nothing remains (clean)', () => {
  assert.strictEqual(shouldEscalate(3, { coderabbit: [], ci: [] }), false);
});

test('never escalates past cap incorrectly for cycle counts beyond 3 with nothing remaining', () => {
  assert.strictEqual(shouldEscalate(4, { coderabbit: [], ci: [] }), false);
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
