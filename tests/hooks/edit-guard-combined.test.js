#!/usr/bin/env node
/**
 * edit-guard-combined — merges config-protection (block linter/formatter
 * config edits) and post-edit-accumulator (record edited files for batched
 * lint) into ONE PreToolUse[Edit|Write] hook, so a single `node` process
 * spawns per edit instead of two.
 *
 * Behavior must be identical to the two standalone hooks:
 *  - BLOCKED_PATTERNS (.eslintrc, etc.) -> exit 2, same block reason shape.
 *  - WARN_PATTERNS (tsconfig.json) -> exit 0, warns to stderr.
 *  - Code-extension files -> accumulated to the per-session accumulator
 *    file, but ONLY when profile is standard/strict (post-edit-accumulator
 *    is not registered under minimal).
 *  - Non-Edit/Write tool calls -> no-op, exit 0.
 *
 * Registration: hooks.json must wire ONE PreToolUse[Edit|Write] entry to
 * edit-guard-combined via hook-runner, and must NOT have a separate
 * PostToolUse[Edit|Write] entry for post-edit-accumulator anymore.
 *
 * Run: node tests/hooks/edit-guard-combined.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOKS_JSON = path.join(REPO_ROOT, 'hooks', 'hooks.json');
const EDIT_GUARD_COMBINED = path.join(REPO_ROOT, 'hooks', 'edit-guard-combined.js');

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

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'edit-guard-combined-'));
}

function editEvent(filePath, toolName = 'Edit') {
  return { tool_name: toolName, tool_input: { file_path: filePath } };
}

function runGate(cwd, input, env = {}) {
  return spawnSync('node', [EDIT_GUARD_COMBINED], {
    cwd,
    encoding: 'utf8',
    input: typeof input === 'string' ? input : JSON.stringify(input || {}),
    env: { ...process.env, CLAUDE_SESSION_ID: 'test-session', ...env },
  });
}

function accumulatorPath(cwd, sessionId = 'test-session') {
  // Matches post-edit-accumulator's getAccumulatorPath(): os.tmpdir(), not cwd.
  return path.join(os.tmpdir(), `envoy-edited-${sessionId}.txt`);
}

section('registration: single PreToolUse[Edit|Write] -> edit-guard-combined, no leftover PostToolUse[Edit|Write]');

test('hooks.json registers exactly one PreToolUse matcher "Edit|Write" wired to edit-guard-combined via hook-runner, all profiles', () => {
  const hooksConfig = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));
  const pre = hooksConfig.hooks.PreToolUse || [];
  const entries = pre.filter((e) => e.matcher === 'Edit|Write');
  assert.strictEqual(entries.length, 1, `expected exactly one PreToolUse[Edit|Write] entry, found ${entries.length}`);
  const hookDef = entries[0].hooks.find((h) => /edit-guard-combined/.test(h.command));
  assert.ok(hookDef, 'no hook wired to edit-guard-combined');
  assert.ok(/hook-runner\.js" edit-guard-combined/.test(hookDef.command), `not wired via hook-runner: ${hookDef.command}`);
  assert.deepStrictEqual(
    [...hookDef._profiles].sort(),
    ['minimal', 'standard', 'strict'],
    'edit-guard-combined must be registered in ALL profiles (it internally gates the accumulator half)'
  );
});

test('hooks.json no longer has a standalone PostToolUse[Edit|Write] -> post-edit-accumulator entry', () => {
  const hooksConfig = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));
  const post = hooksConfig.hooks.PostToolUse || [];
  const stale = post.find(
    (e) => e.matcher === 'Edit|Write' && e.hooks.some((h) => /post-edit-accumulator/.test(h.command))
  );
  assert.strictEqual(stale, undefined, 'stale PostToolUse[Edit|Write] -> post-edit-accumulator entry still present');
});

section('behavior: BLOCKED_PATTERNS still block, exit 2, same reason shape as config-protection');

test('.eslintrc.json edit blocked (exit 2)', () => {
  const tmp = mkTmp();
  try {
    const r = runGate(tmp, editEvent('/repo/.eslintrc.json'));
    assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
    assert.ok(/BLOCKED/.test(r.stderr), `stderr should carry BLOCKED reason: ${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

section('behavior: WARN_PATTERNS still warn, exit 0');

test('tsconfig.json edit warns but does not block', () => {
  const tmp = mkTmp();
  try {
    const r = runGate(tmp, editEvent('/repo/tsconfig.json'));
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    assert.ok(/WARNING/.test(r.stderr), `stderr should carry WARNING: ${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

section('behavior: accumulator half runs for code files, gated by profile like the original post-edit-accumulator');

test('standard profile: code file edit is recorded to the accumulator', () => {
  const tmp = mkTmp();
  const sessionId = `combined-standard-${process.pid}`;
  const accPath = accumulatorPath(tmp, sessionId);
  try {
    if (fs.existsSync(accPath)) fs.rmSync(accPath);
    const r = runGate(tmp, editEvent('/repo/src/foo.js'), { CLAUDE_SESSION_ID: sessionId, ENVOY_HOOK_PROFILE: 'standard' });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    assert.ok(fs.existsSync(accPath), 'expected accumulator file to be written under standard profile');
    assert.ok(fs.readFileSync(accPath, 'utf8').includes('/repo/src/foo.js'));
  } finally {
    if (fs.existsSync(accPath)) fs.rmSync(accPath);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('minimal profile: code file edit is NOT recorded to the accumulator (matches original profile scoping)', () => {
  const tmp = mkTmp();
  const sessionId = `combined-minimal-${process.pid}`;
  const accPath = accumulatorPath(tmp, sessionId);
  try {
    if (fs.existsSync(accPath)) fs.rmSync(accPath);
    const r = runGate(tmp, editEvent('/repo/src/foo.js'), { CLAUDE_SESSION_ID: sessionId, ENVOY_HOOK_PROFILE: 'minimal' });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    assert.ok(!fs.existsSync(accPath), 'accumulator file should NOT be written under minimal profile');
  } finally {
    if (fs.existsSync(accPath)) fs.rmSync(accPath);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

section('behavior: non-matching tool calls are no-ops');

test('non-Edit/Write tool_name -> exit 0, no block, no accumulation', () => {
  const tmp = mkTmp();
  try {
    const r = runGate(tmp, { tool_name: 'Bash', tool_input: { command: 'ls' } });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('malformed stdin -> exit 0, no crash', () => {
  const tmp = mkTmp();
  try {
    const r = runGate(tmp, 'not json {{{');
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

process.stdout.write(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
