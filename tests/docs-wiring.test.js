#!/usr/bin/env node
/**
 * docs-wiring — the docs name the real consumers of the context-efficiency
 * modules (#83). Each module's "Used By" entry must point at the preflight
 * script or hook that actually requires it.
 *
 * Run: node tests/docs-wiring.test.js
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

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** The overview-table row whose first cell names the given lib module. */
function overviewRow(content, lib) {
  const row = content.split('\n').find(l => l.startsWith(`| \`lib/${lib}\``));
  assert.ok(row, `expected an overview row for lib/${lib}`);
  return row;
}

const CE = 'docs/wiki/Context-Efficiency.md';

test('README hook table lists output-compress as a PostToolUse hook', () => {
  assert.ok(/^\| `output-compress` \| PostToolUse \|/m.test(read('README.md')));
});

test('Context-Efficiency overview has a Used By column', () => {
  assert.ok(/^\| Library \| Purpose \| Used By \|/m.test(read(CE)));
});

test('output-compressor row names hooks/output-compress.js', () => {
  assert.ok(overviewRow(read(CE), 'output-compressor.js').includes('hooks/output-compress.js'));
});

test('relevance-scorer row names skills/review/preflight.js and not pickup', () => {
  const row = overviewRow(read(CE), 'relevance-scorer.js');
  assert.ok(row.includes('skills/review/preflight.js'));
  assert.ok(!/pickup/.test(row), 'pickup does not use relevance-scorer');
});

test('context-budget and agent-scratchpad rows name skills/pickup/preflight.js', () => {
  const content = read(CE);
  assert.ok(overviewRow(content, 'context-budget.js').includes('skills/pickup/preflight.js'));
  assert.ok(overviewRow(content, 'agent-scratchpad.js').includes('skills/pickup/preflight.js'));
});

test('learning-loader row names the pickup and review preflights', () => {
  const row = overviewRow(read(CE), 'learning-loader.js');
  assert.ok(row.includes('skills/pickup/preflight.js') && row.includes('skills/review/preflight.js'));
});

test('compliance row names finalize and hotfix', () => {
  const row = overviewRow(read(CE), 'compliance.js');
  assert.ok(row.includes('skills/finalize/SKILL.md') && row.includes('skills/hotfix/SKILL.md'));
});

test('Context-Efficiency no longer claims score accumulates through import edges', () => {
  assert.ok(!read(CE).includes('Score accumulates through import edges'));
});

test('Token-Optimization names the output-compress hook, not review, as the compressor consumer', () => {
  const content = read('docs/wiki/Token-Optimization.md');
  assert.ok(content.includes('hooks/output-compress.js'));
  assert.ok(!content.includes('Used by `review` during build/test verification'));
});

test('CLAUDE.md names the output-compress hook', () => {
  assert.ok(read('CLAUDE.md').includes('hooks/output-compress.js'));
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
