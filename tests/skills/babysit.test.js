#!/usr/bin/env node
/**
 * /envoy:babysit — contract test.
 *
 * Run: node tests/skills/babysit.test.js
 *
 * babysit is a one-pass PR shepherd: it reads lib/pr-status.js per open PR,
 * takes at most one action, reports, and suggests a re-run cadence. It must
 * NOT sleep in-session (it composes with /loop).
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
const SKILL = path.join(ROOT, 'skills', 'babysit', 'SKILL.md');

test('skill file exists', () => {
  assert.ok(fs.existsSync(SKILL), 'skills/babysit/SKILL.md must exist');
});

test('skill frontmatter registers /envoy:babysit (no commands/ wrapper needed)', () => {
  const skillContent = fs.readFileSync(SKILL, 'utf8');
  assert.ok(
    /^---[\s\S]*?\nname:\s*babysit\b/.test(skillContent),
    'skill frontmatter name: babysit produces /envoy:babysit'
  );
});

const skill = fs.existsSync(SKILL) ? fs.readFileSync(SKILL, 'utf8') : '';

test('has required frontmatter (name + description)', () => {
  assert.ok(/^---[\s\S]*?\nname:\s*babysit\b/.test(skill), 'frontmatter name: babysit');
  assert.ok(/\ndescription:\s*\S/.test(skill), 'frontmatter has a description');
});

test('reads the pr-status engine', () => {
  assert.ok(/lib\/pr-status\.js/.test(skill), 'must consume lib/pr-status.js');
});

test('one-pass, never sleeps in-session (composes with /loop)', () => {
  assert.ok(/one[- ]pass/i.test(skill), 'documents the one-pass model');
  assert.ok(/\/loop/.test(skill), 'documents composing with /loop');
  assert.ok(/never sleep|does not sleep|no sleep|not sleep/i.test(skill), 'states it does not sleep in-session');
});

test('decision table covers the four actions', () => {
  assert.ok(/rate[- ]limit/i.test(skill), 'handles CodeRabbit rate-limit re-trigger');
  assert.ok(/@coderabbitai/.test(skill), 'documents the @coderabbitai re-trigger comment');
  assert.ok(/fix-ci/.test(skill), 'invokes fix-ci on red CI');
  assert.ok(/coderabbit-pr-review/.test(skill), 'invokes coderabbit-pr-review on unresolved threads');
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
