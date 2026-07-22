#!/usr/bin/env node
/**
 * Stack ↔ Copilot Instruction Drift Guard — Test Suite
 *
 * Asserts a bidirectional 1:1 between stacks/*.md profiles and the Copilot
 * adapter's instruction templates, so a new stack (or instruction) can't land
 * without its counterpart. Also checks each instruction file carries an
 * applyTo frontmatter glob and no stack Detection block.
 *
 * Run: node tests/adapters/stack-instruction-drift.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const STACKS_DIR = path.join(ROOT, 'stacks');
const INSTRUCTIONS_DIR = path.join(ROOT, 'adapters', 'copilot', 'templates', 'instructions');

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

const stackNames = fs
  .readdirSync(STACKS_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''));

const instructionNames = fs
  .readdirSync(INSTRUCTIONS_DIR)
  .filter((f) => f.endsWith('.instructions.md'))
  .map((f) => f.replace(/\.instructions\.md$/, ''));

test('every stack profile has a Copilot instruction template', () => {
  const missing = stackNames.filter((s) => !instructionNames.includes(s));
  assert.deepStrictEqual(
    missing,
    [],
    `stacks without an instruction template: ${missing.join(', ')}`
  );
});

test('every instruction template has a stack profile', () => {
  const orphaned = instructionNames.filter((i) => !stackNames.includes(i));
  assert.deepStrictEqual(
    orphaned,
    [],
    `instruction templates without a stack profile: ${orphaned.join(', ')}`
  );
});

test('every instruction template has applyTo frontmatter and no Detection block', () => {
  const problems = [];
  for (const name of instructionNames) {
    const content = fs.readFileSync(path.join(INSTRUCTIONS_DIR, `${name}.instructions.md`), 'utf8');
    if (!/^---\napplyTo: /.test(content)) {
      problems.push(`${name}: missing applyTo frontmatter`);
    }
    if (/^## Detection$/m.test(content)) {
      problems.push(`${name}: contains a stack Detection block`);
    }
  }
  assert.deepStrictEqual(problems, [], problems.join('; '));
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
