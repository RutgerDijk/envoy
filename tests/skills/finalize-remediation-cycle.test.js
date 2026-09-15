#!/usr/bin/env node
/**
 * Finalize remediation cycle — contract tests (Task 7).
 *
 * Guards the batch-remediation redesign: CodeRabbit findings AND CI failure
 * diagnoses are collected together, fixed together, and land in exactly ONE
 * commit + ONE push per cycle (max 3 cycles), instead of the old per-finding
 * commit loop plus a separately-looping /envoy:fix-ci delegation.
 *
 * Run: node tests/skills/finalize-remediation-cycle.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CODERABBIT_STEP = path.join(REPO_ROOT, 'skills', 'finalize', 'steps', 'coderabbit.md');
const CI_STEP = path.join(REPO_ROOT, 'skills', 'finalize', 'steps', 'ci.md');
const SKILL_MD = path.join(REPO_ROOT, 'skills', 'finalize', 'SKILL.md');
const CONTRACT = path.join(REPO_ROOT, 'skills', 'finalize', 'contract.json');

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

const coderabbitMd = fs.readFileSync(CODERABBIT_STEP, 'utf8');
const ciMd = fs.readFileSync(CI_STEP, 'utf8');
const skillMd = fs.readFileSync(SKILL_MD, 'utf8');
const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));

section('one combined remediation cycle (not per-finding commits)');

test('coderabbit.md no longer commits per finding ("For each CodeRabbit comment ... commit")', () => {
  assert.ok(
    !/For each CodeRabbit comment:[\s\S]{0,80}3\. Commit/.test(coderabbitMd),
    'the old per-finding commit loop must be removed'
  );
});

test('coderabbit.md describes gathering CodeRabbit findings and CI diagnoses into one combined fix list', () => {
  assert.ok(/combined fix list/i.test(coderabbitMd), 'collect phase must produce one combined fix list');
});

test('coderabbit.md states exactly ONE commit and ONE push per cycle', () => {
  assert.ok(/ONE commit/.test(coderabbitMd));
  assert.ok(/ONE push/.test(coderabbitMd));
});

test('ci.md no longer invokes /envoy:fix-ci as an independent commit/push loop', () => {
  assert.ok(
    !/\/envoy:fix-ci \$PR_NUMBER/.test(ciMd),
    'ci.md must stop delegating to the standalone fix-ci skill for commit/push'
  );
});

test('ci.md is framed as a diagnosis helper folded into the collect phase', () => {
  assert.ok(/diagnos/i.test(ciMd));
});

section('commit message enumerates findings + thread URLs');

test('coderabbit.md commit step references thread URLs in the commit body', () => {
  assert.ok(/thread url/i.test(coderabbitMd) || /threadUrl/.test(coderabbitMd));
});

test('coderabbit.md references the shared remediation-cycle helper module', () => {
  assert.ok(/remediation-cycle\.js/.test(coderabbitMd));
});

section('reply/resolve cites the single commit SHA');

test('replies cite the one commit SHA from the commit step', () => {
  assert.ok(/COMMIT=\$\(git rev-parse --short HEAD\)/.test(coderabbitMd));
});

section('cycle cap: verbatim escalation message at cycle 3/3');

test('escalation message uses the locked verbatim framing', () => {
  assert.ok(/Remediation cycle limit reached \(3\/3\)/.test(coderabbitMd));
  assert.ok(/A\) Run another cycle/.test(coderabbitMd));
  assert.ok(/B\) Finish with these left open/.test(coderabbitMd));
  assert.ok(/C\) Abort/.test(coderabbitMd));
  assert.ok(/Awaiting your decision\./.test(coderabbitMd));
});

test('escalation covers both CodeRabbit threads and CI failures remaining', () => {
  assert.ok(/CodeRabbit thread \/ CI failure/.test(coderabbitMd));
});

section('SKILL.md reflects the unified cycle');

test('process table describes Steps 3-8 as a single remediation cycle', () => {
  assert.ok(/remediation cycle/i.test(skillMd));
});

section('contract.json loop signal is unified');

test('loopSignals collapses coderabbit + fix-ci into one remediation-cycle signal', () => {
  assert.deepStrictEqual(contract.loopSignals, ['remediation-cycle']);
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
