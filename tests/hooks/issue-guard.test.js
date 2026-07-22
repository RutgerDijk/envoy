#!/usr/bin/env node
/**
 * ABOUTME: Tests the issue-guard PreToolUse hook: gh issue create must
 * ABOUTME: trigger a permissionDecision "ask"; everything else stays silent.
 *
 * Run: node tests/hooks/issue-guard.test.js
 */

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOKS = path.join(__dirname, '..', '..', 'hooks');

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

// ═══════════════════════════════════════════════════════════════════
// Load module
// ═══════════════════════════════════════════════════════════════════

const hook = require(path.join(HOOKS, 'issue-guard'));

/**
 * Run hook.run(input) capturing console.log output.
 * @param {string} input raw stdin payload
 * @returns {{code: number, lines: string[]}}
 */
function runCaptured(input) {
  const lines = [];
  const original = console.log;
  console.log = (msg) => lines.push(String(msg));
  let code;
  try {
    code = hook.run(input);
  } finally {
    console.log = original;
  }
  return { code: typeof code === 'number' ? code : 0, lines };
}

function bashEvent(command) {
  return JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

section('asks on gh issue create');

test('plain gh issue create emits permissionDecision ask', () => {
  const { code, lines } = runCaptured(bashEvent('gh issue create --title "x" --body "y"'));
  assert.strictEqual(code, 0, 'must exit 0 so the ask decision is honored');
  assert.strictEqual(lines.length, 1, 'exactly one JSON line on stdout');
  const out = JSON.parse(lines[0]);
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'ask');
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.length > 0);
});

test('gh issue create inside a compound command still asks', () => {
  const { lines } = runCaptured(bashEvent('cd /tmp && gh issue create --title t'));
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(JSON.parse(lines[0]).hookSpecificOutput.permissionDecision, 'ask');
});

section('stays silent otherwise');

test('unrelated command produces no output', () => {
  const { code, lines } = runCaptured(bashEvent('ls -la'));
  assert.strictEqual(code, 0);
  assert.strictEqual(lines.length, 0);
});

test('other gh subcommands produce no output', () => {
  for (const cmd of ['gh issue list', 'gh issue edit 12', 'gh pr create --title t']) {
    const { lines } = runCaptured(bashEvent(cmd));
    assert.strictEqual(lines.length, 0, `expected silence for: ${cmd}`);
  }
});

test('non-Bash tool event produces no output', () => {
  const { lines } = runCaptured(JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: '/tmp/gh issue create.md' },
  }));
  assert.strictEqual(lines.length, 0);
});

section('fails open');

test('malformed JSON input is silent and exits 0', () => {
  const { code, lines } = runCaptured('not json at all');
  assert.strictEqual(code, 0);
  assert.strictEqual(lines.length, 0);
});

test('empty input is silent and exits 0', () => {
  const { code, lines } = runCaptured('');
  assert.strictEqual(code, 0);
  assert.strictEqual(lines.length, 0);
});

section('runs through hook-runner in every profile');

for (const profile of ['minimal', 'standard', 'strict']) {
  test(`profile ${profile}: ask decision reaches stdout, exit 0`, () => {
    const res = spawnSync('node', [path.join(HOOKS, 'hook-runner.js'), 'issue-guard'], {
      input: bashEvent('gh issue create --title t'),
      env: { ...process.env, ENVOY_HOOK_PROFILE: profile },
      encoding: 'utf8',
    });
    assert.strictEqual(res.status, 0);
    const out = JSON.parse(res.stdout.trim());
    assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'ask');
  });
}

// ═══════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
