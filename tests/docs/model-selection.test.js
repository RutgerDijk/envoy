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

test('storage location: the dedicated key file, never the settings env block', () => {
  const content = readDoc();
  assert.ok(/moonshot-api-key/.test(content), 'expected doc to name the ~/.claude/moonshot-api-key key file');
  assert.ok(
    /`?env`? block/i.test(content) && /(every|all)\s+subprocess/i.test(content),
    'expected doc to explain WHY the env block is not the destination (it exports to every subprocess)'
  );
});

test('names ~/.claude/settings.json (the file installKimi migrates stale keys out of)', () => {
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

test('documents that the menu label itself never hits the network', () => {
  const content = readDoc();
  assert.ok(/isKimiConfigured/.test(content), 'expected doc to name isKimiConfigured(), the offline label check');
  assert.ok(
    /never makes a network call|no network call/i.test(content),
    'expected doc to state that computing the menu label makes no network call'
  );
});

test('documents that settings.json is locked down once it holds the key', () => {
  const content = readDoc();
  assert.ok(/0600/.test(content), 'expected doc to state the 0600 permissions installKimi() applies');
});

test('warns that a pasted key lands in the session transcript', () => {
  const content = readDoc();
  assert.ok(/transcript/i.test(content), 'expected doc to warn that a pasted key is stored in the session transcript');
  assert.ok(/export MOONSHOT_API_KEY|shell/i.test(content), 'expected doc to offer the shell env var as the lower-exposure route');
});

section('tool scoping: the headless kimi worker is mechanically bounded');
test('documents allowedTools and the --allowed-tools enforcement', () => {
  const content = readDoc();
  assert.ok(/allowedTools/.test(content), 'expected doc to name the allowedTools option');
  assert.ok(/--allowed-tools/.test(content), 'expected doc to name the claude CLI flag it becomes');
});

test('documents the fail-closed default', () => {
  const content = readDoc();
  assert.ok(/DEFAULT_ALLOWED_TOOLS/.test(content), 'expected doc to name DEFAULT_ALLOWED_TOOLS');
  assert.ok(/fails closed|fail closed/i.test(content), 'expected doc to state that omitting allowedTools fails closed (read-only)');
});

test('documents that contract.json agentInvariants do not cover the Bash-dispatched kimi path', () => {
  const content = readDoc();
  assert.ok(
    /agentInvariants|PreToolUse\[Agent\]|contract\.json/.test(content),
    'expected doc to note that the Agent-tool contract gate does not fire for kimi dispatches'
  );
});

section('kimi child hardening is documented');

test('documents the env -i allowlist and that ANTHROPIC_API_KEY cannot reach the child', () => {
  const content = readDoc();
  assert.ok(/env -i/.test(content), 'expected doc to name the env -i allowlist construction');
  assert.ok(/ANTHROPIC_API_KEY/.test(content), 'expected doc to state the parent ANTHROPIC_API_KEY never reaches the child');
});

test('documents the hard tool bound and MCP stripping', () => {
  const content = readDoc();
  assert.ok(/--tools/.test(content), 'expected doc to name the --tools availability bound');
  assert.ok(/--strict-mcp-config/.test(content), 'expected doc to name --strict-mcp-config');
});

test('documents the budget cap and wall-clock watchdog with their defaults', () => {
  const content = readDoc();
  assert.ok(/--max-budget-usd/.test(content), 'expected doc to name --max-budget-usd');
  assert.ok(/1800|30 min/i.test(content), 'expected doc to state the default wall-clock bound');
  assert.ok(/watchdog|wall.?clock|timeoutSeconds/i.test(content), 'expected doc to describe the wall-clock kill');
});

test('documents the dispatch-enforced contract gate on the kimi path', () => {
  const content = readDoc();
  assert.ok(/evaluateWorkerPrompt/.test(content), 'expected doc to name evaluateWorkerPrompt()');
  assert.ok(/throws|refus/i.test(content), 'expected doc to state that a violating prompt refuses to dispatch');
});

test('shows allowedTools in the dispatch() signature', () => {
  const content = readDoc();
  assert.ok(
    /dispatch\(\{ model, prompt, taskId, allowedTools/.test(content),
    'expected the shown dispatch() signature to include allowedTools'
  );
});

test('documents run-unique output files read from the descriptor', () => {
  const content = readDoc();
  assert.ok(/run-unique|descriptor\.outputFile/.test(content),
    'expected doc to state output paths are run-unique and read from the descriptor');
});

test('documents how to change the worker model mid-run', () => {
  const content = readDoc();
  assert.ok(/mid-run|change (the )?worker model|switch (the )?worker model/i.test(content),
    'expected doc to document changing the worker model after it was chosen');
});

section('residual risk: the kimi worker holds a live credential');
test('documents that a Bash-capable kimi worker can read and leak its own key', () => {
  const content = readDoc();
  assert.ok(
    /residual risk/i.test(content),
    'expected doc to name the residual risk explicitly, not only the parent/child env boundary'
  );
  assert.ok(
    /ANTHROPIC_AUTH_TOKEN/.test(content) && /agent-output/.test(content),
    'expected doc to explain that the worker can read its own credential and echo it into its report'
  );
  assert.ok(
    /rotate|dedicated|rate-limited/i.test(content),
    'expected doc to give at least one concrete mitigation'
  );
});

test('documents that the dispatched command fails closed on a missing key', () => {
  const content = readDoc();
  assert.ok(
    /refuses to run when `?MOONSHOT_API_KEY`? is\s+unset|refuses to run/i.test(content),
    'expected doc to state that a kimi dispatch with no key refuses to run'
  );
});

section('the caller must wait for the background process to exit');
test('names a concrete completion signal, not just "once it exits"', () => {
  const content = readDoc();
  assert.ok(/BashOutput|Monitor/.test(content), 'expected doc to name a concrete way to detect the background process finished');
  assert.ok(/truncat/i.test(content), 'expected doc to explain that an early read returns truncated output');
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
