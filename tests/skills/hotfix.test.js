#!/usr/bin/env node
/**
 * /envoy:hotfix — contract test.
 *
 * Run: node tests/skills/hotfix.test.js
 *
 * hotfix is the sanctioned fast-path: it skips brainstorm/design-issue/tasks-
 * file/multi-layer-review but KEEPS worktree isolation, TDD, verification, the
 * normal PR gates, a lightweight issue for traceability, and a one-defect
 * scope rule. It records itself as the active skill for compliance visibility.
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
const SKILL = path.join(ROOT, 'skills', 'hotfix', 'SKILL.md');

test('skill file exists', () => {
  assert.ok(fs.existsSync(SKILL), 'skills/hotfix/SKILL.md must exist');
});

test('skill frontmatter registers /envoy:hotfix (no commands/ wrapper needed)', () => {
  const skillContent = fs.readFileSync(SKILL, 'utf8');
  assert.ok(
    /^---[\s\S]*?\nname:\s*hotfix\b/.test(skillContent),
    'skill frontmatter name: hotfix produces /envoy:hotfix'
  );
});

const skill = fs.existsSync(SKILL) ? fs.readFileSync(SKILL, 'utf8') : '';

test('has required frontmatter (name + description)', () => {
  assert.ok(/^---[\s\S]*?\nname:\s*hotfix\b/.test(skill), 'frontmatter name: hotfix');
  assert.ok(/\ndescription:\s*\S/.test(skill), 'frontmatter has a description');
});

test('files a lightweight issue for traceability when none passed', () => {
  assert.ok(/gh issue create/.test(skill), 'creates a lightweight issue when none passed');
  assert.ok(/Closes #/.test(skill), 'PR closes the issue (Closes #n)');
});

test('keeps worktree isolation, anchored-first (no premature .envoy write)', () => {
  assert.ok(/git worktree add/.test(skill), 'creates a worktree');
  assert.ok(/hotfix\//.test(skill), 'uses a hotfix/<slug> branch');
  assert.ok(/anchor|before.*\.envoy|worktree exists/i.test(skill),
    'defers state writes until the worktree exists (the #1560 ordering fix)');
});

test('keeps TDD and verification gates', () => {
  assert.ok(/test-driven-development/.test(skill), 'invokes envoy:test-driven-development');
  assert.ok(/failing test/i.test(skill), 'failing repro test first');
  assert.ok(/verification/.test(skill), 'invokes envoy:verification before PR');
});

test('enforces one-defect scope (routes sprawl to pickup)', () => {
  assert.ok(/one defect|single defect|one[- ]defect/i.test(skill), 'one-defect scope rule');
  assert.ok(/pickup/.test(skill), 'routes sprawl to normal pickup');
});

test('records itself as the active skill for compliance visibility', () => {
  assert.ok(/active-skill\.json/.test(skill), 'records .envoy/active-skill.json');
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
