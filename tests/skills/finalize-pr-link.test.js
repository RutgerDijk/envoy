#!/usr/bin/env node
/**
 * Finalize — PR link after every step (Task 9).
 *
 * Every `Running Step N: ...` announcement for a step that runs AFTER the PR
 * exists (Step 2 onward, once PR_URL is known) must be followed by a plain-text
 * print of the PR URL, sourced from .envoy/finalize/state.json's `prUrl` field.
 * No OSC 8 hyperlink escapes — just the plain https:// string.
 *
 * Run: node tests/skills/finalize-pr-link.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SKILL = path.join(REPO_ROOT, 'skills', 'finalize', 'SKILL.md');
const CODERABBIT = path.join(REPO_ROOT, 'skills', 'finalize', 'steps', 'coderabbit.md');
const VERIFY = path.join(REPO_ROOT, 'skills', 'finalize', 'steps', 'verify.md');
const WIKI = path.join(REPO_ROOT, 'skills', 'finalize', 'steps', 'wiki.md');

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

const skillMd = fs.readFileSync(SKILL, 'utf8');
const coderabbitMd = fs.readFileSync(CODERABBIT, 'utf8');
const verifyMd = fs.readFileSync(VERIFY, 'utf8');
const wikiMd = fs.readFileSync(WIKI, 'utf8');

// Plain PR: <url> print line — no OSC 8 escape sequences (\x1b]8;; ... \x1b\)
const PRINT_LINE = /echo "PR: \$PR_URL"/g;
const OSC8 = /\x1b\]8;/;

section('Task 9: PR link after every finalize step');

test('SKILL.md Step 1 (pre-PR) does not fabricate a PR URL print', () => {
  const step1 = skillMd.split('### Step 1:')[1].split('### Step 2:')[0];
  assert.ok(
    !PRINT_LINE.test(step1),
    'Step 1 runs before the PR exists — it must not print a PR URL'
  );
});

test('SKILL.md Step 2 prints the PR URL right after PR_URL is computed', () => {
  const step2 = skillMd.split('### Step 2:')[1];
  assert.ok(
    /PR_URL=\$\(gh pr view --json url -q \.url\)[\s\S]*?echo "PR: \$PR_URL"/.test(step2),
    'Step 2 must echo "PR: $PR_URL" after computing PR_URL via gh pr view'
  );
});

test('coderabbit.md: Steps 3, 4, 5, 6, 7, 8 each print the PR URL from state.json', () => {
  const matches = coderabbitMd.match(PRINT_LINE) || [];
  assert.strictEqual(
    matches.length,
    6,
    `expected 6 PR-URL print lines (Steps 3-8), found ${matches.length}`
  );
});

test('coderabbit.md: each PR-URL print reads prUrl from .envoy/finalize/state.json', () => {
  const reads = coderabbitMd.match(/jq -r '\.prUrl \/\/ empty' \.envoy\/finalize\/state\.json/g) || [];
  assert.ok(
    reads.length >= 6,
    `expected at least 6 prUrl reads from state.json, found ${reads.length}`
  );
});

test('verify.md: Step 9 prints the PR URL', () => {
  const matches = verifyMd.match(PRINT_LINE) || [];
  assert.strictEqual(matches.length, 1, `expected 1 PR-URL print line in Step 9, found ${matches.length}`);
});

test('wiki.md: Step 10 prints the PR URL', () => {
  const matches = wikiMd.match(PRINT_LINE) || [];
  assert.strictEqual(matches.length, 1, `expected 1 PR-URL print line in Step 10, found ${matches.length}`);
});

test('no OSC 8 hyperlink escape sequences anywhere — plain URL only', () => {
  assert.ok(!OSC8.test(skillMd), 'SKILL.md must not use OSC 8 hyperlink escapes');
  assert.ok(!OSC8.test(coderabbitMd), 'coderabbit.md must not use OSC 8 hyperlink escapes');
  assert.ok(!OSC8.test(verifyMd), 'verify.md must not use OSC 8 hyperlink escapes');
  assert.ok(!OSC8.test(wikiMd), 'wiki.md must not use OSC 8 hyperlink escapes');
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
