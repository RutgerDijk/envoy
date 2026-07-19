#!/usr/bin/env node
/**
 * CI workflow — contract test.
 *
 * Run: node tests/ci-workflow.test.js
 *
 * Guards that the GitHub Actions workflow triggers on PRs + pushes to main and
 * gates on the aggregate test runner.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

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

const WF = path.join(__dirname, '..', '.github', 'workflows', 'ci.yml');

test('workflow file exists', () => {
  assert.ok(fs.existsSync(WF), '.github/workflows/ci.yml must exist');
});

const wf = fs.existsSync(WF) ? fs.readFileSync(WF, 'utf8') : '';

test('triggers on pull_request', () => {
  assert.ok(/pull_request/.test(wf), 'must trigger on pull_request');
});

test('triggers on push to main', () => {
  assert.ok(/push:/.test(wf), 'must have a push trigger');
  assert.ok(/branches:[\s\S]*main/.test(wf), 'push must target main');
});

test('sets up Node', () => {
  assert.ok(/actions\/setup-node/.test(wf), 'uses actions/setup-node');
});

test('runs the aggregate test runner as the gating step', () => {
  assert.ok(/node scripts\/run-tests\.js/.test(wf), 'runs node scripts/run-tests.js');
});

test('runs on ubuntu', () => {
  assert.ok(/runs-on:\s*ubuntu/.test(wf), 'runs-on ubuntu-*');
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
