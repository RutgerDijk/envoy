#!/usr/bin/env node
/**
 * agents/ frontmatter — contract test.
 *
 * Run: node tests/agents-frontmatter.test.js
 *
 * Claude Code loads every agents/*.md as an agent definition. A file
 * without a leading frontmatter block carrying `name` and `description`
 * shows up as a nameless agent (e.g. "envoy:README") that Claude cannot
 * select meaningfully. Every agents/*.md must therefore declare a
 * non-empty `name` equal to its basename and a non-empty `description`.
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

const AGENTS_DIR = path.join(__dirname, '..', 'agents');

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return fields;
}

const agentFiles = fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md')).sort();

test('agents/ contains at least one agent definition', () => {
  assert.ok(agentFiles.length > 0, 'expected agents/*.md files');
});

for (const file of agentFiles) {
  const base = path.basename(file, '.md');
  test(`agents/${file} has name (= "${base}") and description frontmatter`, () => {
    const content = fs.readFileSync(path.join(AGENTS_DIR, file), 'utf8');
    const fm = parseFrontmatter(content);
    assert.ok(fm, `agents/${file} must open with a --- frontmatter block`);
    assert.ok(fm.name, `agents/${file} frontmatter must have a non-empty name`);
    assert.ok(fm.description, `agents/${file} frontmatter must have a non-empty description`);
    assert.strictEqual(fm.name, base, `agents/${file} name must equal file basename "${base}"`);
  });
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
