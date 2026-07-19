#!/usr/bin/env node
/**
 * Aggregate test runner — Test Suite.
 *
 * Run: node tests/scripts/run-tests.test.js
 *
 * run-tests.js discovers <dir>/**\/*.test.js, runs each in a child process,
 * and exits non-zero if any file fails or errors. It accepts a target dir
 * (default: tests) so it can be pointed at fixtures here.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

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

const RUNNER = path.join(__dirname, '..', '..', 'scripts', 'run-tests.js');
const tmpRoots = [];

function fixtureDir(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tests-'));
  tmpRoots.push(root);
  const nested = path.join(root, 'nested');
  fs.mkdirSync(nested, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

function run(dir) {
  return spawnSync('node', [RUNNER, dir], { encoding: 'utf8' });
}

const PASS = 'process.exit(0);\n';
const FAIL = 'process.exit(1);\n';

test('exits 0 when all discovered test files pass', () => {
  const dir = fixtureDir({ 'a.test.js': PASS, 'nested/b.test.js': PASS });
  const r = run(dir);
  assert.strictEqual(r.status, 0, `expected 0, got ${r.status}\n${r.stdout}${r.stderr}`);
});

test('exits non-zero when any test file fails', () => {
  const dir = fixtureDir({ 'a.test.js': PASS, 'nested/b.test.js': FAIL });
  const r = run(dir);
  assert.notStrictEqual(r.status, 0, 'a failing file must make the runner exit non-zero');
});

test('discovers nested *.test.js recursively', () => {
  const dir = fixtureDir({ 'nested/deep.test.js': PASS });
  const r = run(dir);
  assert.ok(/deep\.test\.js/.test(r.stdout), 'output should mention the nested test file');
});

test('ignores non-test files', () => {
  const dir = fixtureDir({ 'a.test.js': PASS, 'helper.js': FAIL });
  const r = run(dir);
  assert.strictEqual(r.status, 0, 'helper.js (not *.test.js) must not be run');
});

test('prints a total summary', () => {
  const dir = fixtureDir({ 'a.test.js': PASS, 'nested/b.test.js': PASS });
  const r = run(dir);
  assert.ok(/2/.test(r.stdout) && /(pass|total)/i.test(r.stdout), 'summary should report the count');
});

for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
