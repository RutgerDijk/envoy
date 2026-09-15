#!/usr/bin/env node
/**
 * edit-guard-combined — PreToolUse[Edit|Write] hook that runs
 * config-protection (block linter/formatter config edits) ONLY.
 *
 * Task 15 originally also folded post-edit-accumulator's file-path
 * recording into this same Pre-hook spawn. That was found to be
 * incorrect: PreToolUse fires before the edit is attempted, so a failed
 * Edit (e.g. old_string not found) on a pre-existing file still queued
 * that file for `eslint --fix` / `dotnet format` at Stop time, even
 * though the edit never landed — a real (if latent) side effect on
 * files the session never actually touched.
 *
 * Investigation: Claude Code fires PostToolUse only on tool SUCCESS —
 * failed tool calls raise a distinct `PostToolUseFailure` event instead
 * (see hooks distributed with the Claude Code CLI). So the original,
 * pre-Task-15 post-edit-accumulator.js — registered on PostToolUse and
 * never itself checking a success/error field — was already correctly
 * gated on success, implicitly, via the event it was wired to. Moving
 * its recording onto PreToolUse (this module) is what broke that
 * guarantee. This is a regression Task 15 introduced, not a pre-existing
 * bug in post-edit-accumulator.js.
 *
 * Fix: keep config-protection on PreToolUse (must block BEFORE the edit
 * happens) but restore post-edit-accumulator as its own standalone
 * PostToolUse[Edit|Write] hook (unchanged file, unchanged logic) so it
 * only records paths for edits Claude Code confirms succeeded. This
 * costs back one `node` spawn per edit (2 total: Pre + Post) — accepted
 * as a narrow, documented exception to Task 15's "one spawn per
 * Edit/Write" criterion, because Pre and Post are different lifecycle
 * events and merging across them was never actually safe: correctness
 * (don't lint-fix files an edit never touched) outweighs the latency
 * win here. The single-spawn win from Task 15 elsewhere (e.g.
 * post-pr-poll gating) is unaffected.
 *
 * Behavior:
 *  - BLOCKED_PATTERNS (.eslintrc, etc.) -> exit 2, same block reason shape.
 *  - WARN_PATTERNS (tsconfig.json) -> exit 0, warns to stderr.
 *  - This module no longer touches the accumulator file at all — that is
 *    exclusively post-edit-accumulator.js's job now, run from PostToolUse.
 *  - Non-Edit/Write tool calls -> no-op, exit 0.
 *
 * Registration: hooks.json wires PreToolUse[Edit|Write] -> edit-guard-combined
 * (config-protection only) AND PostToolUse[Edit|Write] -> post-edit-accumulator
 * (standard/strict profiles, matching its original scoping).
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

section('registration: PreToolUse[Edit|Write] -> edit-guard-combined (config-protection only) + PostToolUse[Edit|Write] -> post-edit-accumulator (success-gated)');

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
    'edit-guard-combined (config-protection) must run in ALL profiles'
  );
});

test('hooks.json restores a standalone PostToolUse[Edit|Write] -> post-edit-accumulator entry, standard/strict only', () => {
  const hooksConfig = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));
  const post = hooksConfig.hooks.PostToolUse || [];
  const entries = post.filter(
    (e) => e.matcher === 'Edit|Write' && e.hooks.some((h) => /post-edit-accumulator/.test(h.command))
  );
  assert.strictEqual(entries.length, 1, `expected exactly one PostToolUse[Edit|Write] -> post-edit-accumulator entry, found ${entries.length}`);
  const hookDef = entries[0].hooks.find((h) => /post-edit-accumulator/.test(h.command));
  assert.ok(/hook-runner\.js" post-edit-accumulator/.test(hookDef.command), `not wired via hook-runner: ${hookDef.command}`);
  assert.deepStrictEqual(
    [...hookDef._profiles].sort(),
    ['standard', 'strict'],
    'post-edit-accumulator must keep its original standard/strict-only scoping'
  );
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

section('behavior: edit-guard-combined (PreToolUse) never writes the accumulator — that is post-edit-accumulator\'s job on PostToolUse now');

test('standard profile: code file edit through edit-guard-combined (Pre) does NOT write the accumulator', () => {
  const tmp = mkTmp();
  const sessionId = `combined-standard-${process.pid}`;
  const accPath = accumulatorPath(tmp, sessionId);
  try {
    if (fs.existsSync(accPath)) fs.rmSync(accPath);
    const r = runGate(tmp, editEvent('/repo/src/foo.js'), { CLAUDE_SESSION_ID: sessionId, ENVOY_HOOK_PROFILE: 'standard' });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    assert.ok(!fs.existsSync(accPath), 'edit-guard-combined (PreToolUse) must not record to the accumulator — recording only happens post-success via post-edit-accumulator on PostToolUse');
  } finally {
    if (fs.existsSync(accPath)) fs.rmSync(accPath);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('post-edit-accumulator (PostToolUse, standalone, unchanged) still records code file edits under standard profile', () => {
  const tmp = mkTmp();
  const sessionId = `postacc-standard-${process.pid}`;
  const accPath = accumulatorPath(tmp, sessionId);
  const POST_EDIT_ACCUMULATOR = path.join(REPO_ROOT, 'hooks', 'post-edit-accumulator.js');
  try {
    if (fs.existsSync(accPath)) fs.rmSync(accPath);
    const r = spawnSync('node', [POST_EDIT_ACCUMULATOR], {
      cwd: tmp,
      encoding: 'utf8',
      input: JSON.stringify(editEvent('/repo/src/foo.js')),
      env: { ...process.env, CLAUDE_SESSION_ID: sessionId },
    });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    assert.ok(fs.existsSync(accPath), 'expected accumulator file to be written by post-edit-accumulator on PostToolUse');
    assert.ok(fs.readFileSync(accPath, 'utf8').includes('/repo/src/foo.js'));
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
