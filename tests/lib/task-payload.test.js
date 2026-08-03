#!/usr/bin/env node
/**
 * lib/task-payload.js — Test Suite
 *
 * Pure helpers for slimming agent prompt payloads: a one-line-per-task
 * sibling index instead of injecting every task's full spec.
 *
 * Run: node tests/lib/task-payload.test.js
 */

const assert = require('assert');
const path = require('path');

const { buildSiblingIndex, buildTaskSlice } = require(
  path.join(__dirname, '..', '..', 'lib', 'task-payload.js')
);

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
  process.stdout.write(`\n${name}\n`);
}

const TASKS = [
  { id: 'T1', title: 'Add login form', description: 'full spec text for T1 that is long' },
  { id: 'T2', title: 'Wire up auth API', description: 'full spec text for T2 that is long' },
  { id: 'T3', title: 'Add logout button', description: 'full spec text for T3 that is long' },
];

section('buildSiblingIndex');

test('produces one line per sibling task (excluding current)', () => {
  const index = buildSiblingIndex(TASKS, 'T2');
  const lines = index.split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 2);
});

test('each line contains only task id and title, not full spec', () => {
  const index = buildSiblingIndex(TASKS, 'T2');
  assert.ok(index.includes('T1'));
  assert.ok(index.includes('Add login form'));
  assert.ok(index.includes('T3'));
  assert.ok(index.includes('Add logout button'));
  assert.ok(!index.includes('full spec text'));
});

test('excludes the current task from the sibling list', () => {
  const index = buildSiblingIndex(TASKS, 'T2');
  assert.ok(!index.includes('Wire up auth API'));
});

test('marks current task distinctly when includeCurrent option is used', () => {
  const index = buildSiblingIndex(TASKS, 'T2', { includeCurrent: true });
  assert.ok(/T2.*\(current\)/.test(index) || /\(current\).*T2/.test(index));
});

test('handles empty task list', () => {
  assert.strictEqual(buildSiblingIndex([], 'T1'), '');
});

test('handles single-task list (no siblings)', () => {
  const index = buildSiblingIndex([TASKS[0]], 'T1');
  assert.strictEqual(index, '');
});

test('is a pure function — does not mutate input', () => {
  const copy = JSON.parse(JSON.stringify(TASKS));
  buildSiblingIndex(TASKS, 'T1');
  assert.deepStrictEqual(TASKS, copy);
});

section('buildTaskSlice');

const FULL_TASK = {
  id: 'T2',
  title: 'Wire up auth API',
  description: 'ignored legacy field',
  intent: 'Let users authenticate',
  behavior: ['Given a valid token, when login is called, then session is created'],
  contracts: ['POST /auth/login returns 200'],
  outOfScope: ['Password reset flow'],
  files: ['src/auth.js'],
  acceptance: ['Login succeeds with valid credentials'],
  dependsOn: ['T1'],
};

test('uses only intent/behavior/files/acceptance/contracts/outOfScope fields', () => {
  const slice = buildTaskSlice(FULL_TASK);
  assert.ok(slice.includes('Let users authenticate'));
  assert.ok(slice.includes('session is created'));
  assert.ok(slice.includes('src/auth.js'));
  assert.ok(slice.includes('Login succeeds with valid credentials'));
  assert.ok(slice.includes('POST /auth/login returns 200'));
  assert.ok(slice.includes('Password reset flow'));
});

test('does not include ad-hoc description field', () => {
  const slice = buildTaskSlice(FULL_TASK);
  assert.ok(!slice.includes('ignored legacy field'));
});

test('handles missing optional fields gracefully', () => {
  const slice = buildTaskSlice({ id: 'T9', title: 'Minimal task', files: ['a.js'], acceptance: ['works'] });
  assert.ok(slice.includes('Minimal task'));
  assert.ok(slice.includes('a.js'));
  assert.ok(slice.includes('works'));
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
