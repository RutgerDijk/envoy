#!/usr/bin/env node
/**
 * /envoy:prs — contract test.
 *
 * Run: node tests/skills/prs.test.js
 *
 * prs is the read-only sibling of babysit: same lib/pr-status.js engine,
 * rendered as a status table across open PRs. It takes NO actions.
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

const ROOT = path.join(__dirname, '..', '..');
const SKILL = path.join(ROOT, 'skills', 'prs', 'SKILL.md');

test('skill file exists', () => {
  assert.ok(fs.existsSync(SKILL), 'skills/prs/SKILL.md must exist');
});

test('skill frontmatter registers /envoy:prs (no commands/ wrapper needed)', () => {
  const skillContent = fs.readFileSync(SKILL, 'utf8');
  assert.ok(
    /^---[\s\S]*?\nname:\s*prs\b/.test(skillContent),
    'skill frontmatter name: prs produces /envoy:prs'
  );
});

const skill = fs.existsSync(SKILL) ? fs.readFileSync(SKILL, 'utf8') : '';

test('has required frontmatter (name + description)', () => {
  assert.ok(/^---[\s\S]*?\nname:\s*prs\b/.test(skill), 'frontmatter name: prs');
  assert.ok(/\ndescription:\s*\S/.test(skill), 'frontmatter has a description');
});

test('reads the pr-status engine', () => {
  assert.ok(/lib\/pr-status\.js/.test(skill), 'must consume lib/pr-status.js');
});

test('read-only: no mutating tools granted', () => {
  const fm = skill.match(/^---([\s\S]*?)---/);
  assert.ok(fm, 'has frontmatter');
  assert.ok(!/\bWrite\b/.test(fm[1]), 'must not grant Write');
  assert.ok(!/\bEdit\b/.test(fm[1]), 'must not grant Edit');
});

test('states it takes no actions', () => {
  assert.ok(/read[- ]only|no actions|takes no action|zero action/i.test(skill),
    'must declare it is read-only / takes no actions');
});

test('renders a status table with the key columns', () => {
  assert.ok(/CI/.test(skill), 'shows CI');
  assert.ok(/CodeRabbit/i.test(skill), 'shows CodeRabbit');
  assert.ok(/unresolved/i.test(skill), 'shows unresolved threads');
  assert.ok(/idle/i.test(skill), 'shows idle');
  assert.ok(/next action|suggested/i.test(skill), 'shows a suggested next action');
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
