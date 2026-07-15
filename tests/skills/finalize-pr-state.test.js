#!/usr/bin/env node
/**
 * Finalize Step 2 PR-state write — contract test.
 *
 * Guards against the NaN bug: the env assignments for the PR-state write must be
 * an env PREFIX before `node` (so process.env resolves), not a suffix after it
 * (which node reads as argv, leaving process.env.PR_NUMBER undefined → NaN).
 *
 * Run: node tests/skills/finalize-pr-state.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SKILL = path.join(REPO_ROOT, 'skills', 'finalize', 'SKILL.md');

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

section('finalize Step 2: PR-state write passes env correctly');

// Tolerate whitespace and either PR_NUMBER/PR_URL ordering — the contract is
// "env assignments are a prefix before node", not an exact byte sequence.
const envAssign = 'PR_(?:NUMBER|URL)="\\$PR_(?:NUMBER|URL)"';

test('uses an env prefix before node (process.env resolves)', () => {
  const prefixForm = new RegExp(`(?:${envAssign}\\s+){2}node\\s+-e`);
  assert.ok(
    prefixForm.test(md),
    'the PR-state write must set PR_NUMBER/PR_URL as an env prefix before `node -e`'
  );
});

test('does NOT place env assignments after node (which become argv → NaN)', () => {
  const buggySuffix = new RegExp(`node\\s+-e\\s+"[\\s\\S]*?"\\s*${envAssign}`);
  assert.ok(
    !buggySuffix.test(md),
    'env assignments after `node -e` are read as argv, not env — process.env.PR_NUMBER would be undefined → NaN'
  );
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
