#!/usr/bin/env node
/**
 * docs/model-selection.md — content contract test.
 *
 * Run: node tests/docs/model-selection.test.js
 *
 * Backs #76 task-4: an operator must be able to learn the one env var
 * (MOONSHOT_API_KEY), the install flow, and the security boundary
 * (Moonshot vars never touch the main session) from the docs alone, no
 * code reading required. This test also drift-guards the doc against the
 * real lib/model-dispatch.js exports so the doc can't silently go stale
 * (e.g. a KIMI_MODEL_ID rename in code without a doc update).
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

function section(name) {
  process.stdout.write(`\n${name}\n`);
}

const ROOT = path.join(__dirname, '..', '..');
const DOC_PATH = path.join(ROOT, 'docs', 'model-selection.md');
const README_PATH = path.join(ROOT, 'README.md');

const {
  ANTHROPIC_TIERS,
  KIMI_TIER,
  KIMI_MODEL_ID,
  KIMI_BASE_URL,
  KIMI_API_KEY_ENV,
} = require(path.join(ROOT, 'lib', 'model-dispatch'));

function readDoc() {
  return fs.readFileSync(DOC_PATH, 'utf8');
}

section('docs/model-selection.md exists');
test('file exists', () => {
  assert.ok(fs.existsSync(DOC_PATH), 'expected docs/model-selection.md to exist');
});

// Everything below reads the doc, so it only runs meaningfully once the
// file exists — but each test still asserts existence itself, so a
// missing file fails loudly per-test rather than throwing once and
// aborting the whole suite.

section('the one env var: MOONSHOT_API_KEY');
test('names the env var by its real constant value', () => {
  assert.ok(fs.existsSync(DOC_PATH), 'expected docs/model-selection.md to exist');
  const content = readDoc();
  assert.strictEqual(KIMI_API_KEY_ENV, 'MOONSHOT_API_KEY');
  assert.ok(content.includes(KIMI_API_KEY_ENV), 'expected doc to name MOONSHOT_API_KEY');
});

test('key source: platform.moonshot.ai', () => {
  const content = readDoc();
  assert.ok(/platform\.moonshot\.ai/.test(content), 'expected doc to point to platform.moonshot.ai for the key');
});

test('storage location: env block of ~/.claude/settings.json', () => {
  const content = readDoc();
  assert.ok(/~\/\.claude\/settings\.json/.test(content), 'expected doc to name ~/.claude/settings.json');
  assert.ok(/env/.test(content), 'expected doc to mention the env block');
});

test('mentions the shell-env alternative to settings.json', () => {
  const content = readDoc();
  assert.ok(/shell/i.test(content), 'expected doc to mention shell env var as an alternative to settings.json');
});

test('validated by a probe on every selection', () => {
  const content = readDoc();
  assert.ok(/checkKimi/.test(content), 'expected doc to name checkKimi()');
  assert.ok(/probe/i.test(content), 'expected doc to describe the auth probe');
});

test('install flow names installKimi()', () => {
  const content = readDoc();
  assert.ok(/installKimi/.test(content), 'expected doc to name installKimi()');
});

section('security boundary: Moonshot vars never touch the main session');
test('explicitly states ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN must never be set globally in settings.json', () => {
  const content = readDoc();
  assert.ok(content.includes('ANTHROPIC_BASE_URL'), 'expected doc to name ANTHROPIC_BASE_URL');
  assert.ok(content.includes('ANTHROPIC_AUTH_TOKEN'), 'expected doc to name ANTHROPIC_AUTH_TOKEN');
  assert.ok(
    /never\b[^.\n]*\b(set|write)[^.\n]*(global|~\/\.claude\/settings\.json)/i.test(content) ||
      /(global|~\/\.claude\/settings\.json)[^.\n]*\bnever\b/i.test(content),
    'expected an explicit "never set globally" statement covering ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN'
  );
});

test('describes the injection scope: kimi child-process command only', () => {
  const content = readDoc();
  assert.ok(/child process|background process|kimi worker/i.test(content), 'expected doc to describe the scoped injection point');
});

section('command-injection guard is documented (dispatch() mechanics)');
test('describes prompt-to-file + stdin redirection, not inline interpolation', () => {
  const content = readDoc();
  assert.ok(/promptFile|prompt file|scratch file/i.test(content), 'expected doc to mention the prompt scratch file');
  assert.ok(/stdin/i.test(content), 'expected doc to mention stdin redirection');
});

section('dispatch() routing: Anthropic tiers vs kimi');
test('names every Anthropic tier from the real ANTHROPIC_TIERS export', () => {
  assert.deepStrictEqual(ANTHROPIC_TIERS, ['fable', 'opus', 'sonnet', 'haiku']);
  const content = readDoc();
  for (const tier of ANTHROPIC_TIERS) {
    assert.ok(new RegExp(`\\b${tier}\\b`, 'i').test(content), `expected doc to mention the "${tier}" tier`);
  }
});

test('names the kimi tier and its real model id / base URL (drift guard)', () => {
  const content = readDoc();
  assert.strictEqual(KIMI_TIER, 'kimi');
  assert.ok(content.includes(KIMI_TIER), 'expected doc to mention "kimi"');
  assert.ok(content.includes(KIMI_MODEL_ID), `expected doc to include the real KIMI_MODEL_ID "${KIMI_MODEL_ID}"`);
  assert.ok(content.includes(KIMI_BASE_URL), `expected doc to include the real KIMI_BASE_URL "${KIMI_BASE_URL}"`);
});

section('where this applies: pickup + review');
test('references pickup Step 12.5', () => {
  const content = readDoc();
  assert.ok(/12\.5/.test(content), 'expected doc to reference pickup Step 12.5');
});

test('references the review Worker Model Selection step', () => {
  const content = readDoc();
  assert.ok(/Worker Model Selection/i.test(content), 'expected doc to reference the "Worker Model Selection" step');
});

test('describes that the choice persists (not re-asked on resume)', () => {
  const content = readDoc();
  assert.ok(/workerModel/.test(content), 'expected doc to name the workerModel session-state field');
  assert.ok(/not\s+(be\s+)?re-?ask(ed)?|without re-?asking|does not re-?ask/i.test(content), 'expected doc to say the choice is not re-asked');
});

section('README.md links to the new doc');
test('README.md exists', () => {
  assert.ok(fs.existsSync(README_PATH), 'expected README.md to exist');
});

test('links to docs/model-selection.md', () => {
  const content = fs.readFileSync(README_PATH, 'utf8');
  assert.ok(content.includes('docs/model-selection.md'), 'expected README.md to link to docs/model-selection.md');
});

test('the link appears inside the ## Commands section', () => {
  const content = fs.readFileSync(README_PATH, 'utf8');
  const start = content.indexOf('\n## Commands');
  assert.ok(start !== -1, 'expected a "## Commands" section in README.md');
  const nextSectionMatch = content.slice(start + 1).match(/\n## /);
  const end = nextSectionMatch ? start + 1 + nextSectionMatch.index : content.length;
  const commandsSection = content.slice(start, end);
  assert.ok(commandsSection.includes('docs/model-selection.md'), 'expected a docs/model-selection.md link inside the ## Commands section');
});

test('the link sits on (or near) the pickup and review command rows', () => {
  const content = fs.readFileSync(README_PATH, 'utf8');
  const pickupLine = content.split('\n').find((l) => l.includes('/envoy:pickup [issue]'));
  const reviewLine = content.split('\n').find((l) => l.includes('| `/envoy:review`'));
  assert.ok(pickupLine, 'expected to find the pickup command row');
  assert.ok(reviewLine, 'expected to find the review command row');
  assert.ok(pickupLine.includes('docs/model-selection.md'), 'expected the pickup row to link docs/model-selection.md');
  assert.ok(reviewLine.includes('docs/model-selection.md'), 'expected the review row to link docs/model-selection.md');
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
