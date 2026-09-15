#!/usr/bin/env node
/**
 * post-pr-poll — hot-path latency fix.
 *
 * Problem: PostToolUse[Bash] -> post-pr-poll fired a fresh `node` process on
 * EVERY Bash call in EVERY session, most of which have no finalize/PR
 * lifecycle active at all.
 *
 * Fix, two layers:
 *  1. hooks.json: the shell `command` string itself gates on the cheapest
 *     possible check (`[ -f .envoy/finalize/state.json ]`) before spawning
 *     node at all.
 *  2. post-pr-poll.js: even if node does spawn, it early-exits on the same
 *     check before parsing stdin / doing any other work, so a bare `node
 *     post-pr-poll.js` invocation with no finalize lifecycle active is
 *     near-instant.
 *
 * Also: the retired `/tmp/envoy-active-pr.txt` write is replaced with an
 * update to `.envoy/finalize/state.json` (CLAUDE.md: that tmp path is
 * retired and replaced by finalize/state.json).
 *
 * Run: node tests/hooks/post-pr-poll-gate.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOKS_JSON = path.join(REPO_ROOT, 'hooks', 'hooks.json');
const POST_PR_POLL = path.join(REPO_ROOT, 'hooks', 'post-pr-poll.js');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'post-pr-poll-gate-'));
}

function writeState(cwd, extra = {}) {
  const dir = path.join(cwd, '.envoy', 'finalize');
  fs.mkdirSync(dir, { recursive: true });
  const state = {
    $schemaVersion: '1',
    issueNumber: 74,
    branch: 'feat/x',
    prNumber: 0,
    baseBranch: 'main',
    ciStatus: 'unknown',
    coderabbitStatus: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...extra,
  };
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
  return path.join(dir, 'state.json');
}

function bashEvent(command, output) {
  return { tool_name: 'Bash', tool_input: { command }, tool_output: output };
}

function runHook(cwd, input) {
  return spawnSync('node', [POST_PR_POLL], {
    cwd,
    encoding: 'utf8',
    input: typeof input === 'string' ? input : JSON.stringify(input || {}),
  });
}

section('hooks.json: PostToolUse[Bash] -> post-pr-poll is gated by a cheap shell pre-check');

test('command string checks for .envoy/finalize/state.json before spawning node', () => {
  const hooksConfig = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));
  const post = hooksConfig.hooks.PostToolUse || [];
  const bashEntry = post.find(
    (e) => e.matcher === 'Bash' && e.hooks.some((h) => /post-pr-poll/.test(h.command))
  );
  assert.ok(bashEntry, 'no PostToolUse entry wired to post-pr-poll');
  const hookDef = bashEntry.hooks.find((h) => /post-pr-poll/.test(h.command));
  assert.ok(
    /\.envoy\/finalize\/state\.json/.test(hookDef.command),
    `command should gate on .envoy/finalize/state.json before invoking node: ${hookDef.command}`
  );
  assert.ok(
    /^\[\s*-f\s*\.envoy\/finalize\/state\.json\s*\]/.test(hookDef.command.trim()),
    `command should lead with the cheap [ -f ... ] test: ${hookDef.command}`
  );
});

section('post-pr-poll.js: early-exit gate when no finalize lifecycle is active');

test('no .envoy/finalize/state.json -> exits 0 immediately, no output, no writes', () => {
  const tmp = mkTmp();
  try {
    const r = runHook(tmp, bashEvent('gh pr create --title x', 'https://github.com/acme/widgets/pull/99'));
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    assert.strictEqual(r.stdout.trim(), '', 'expected no stdout output when gated out');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

section('post-pr-poll.js: when finalize lifecycle IS active, updates .envoy/finalize/state.json (not the retired tmp path)');

test('gh pr create output with PR number updates state.json prNumber/prUrl, no tmp file logic', () => {
  const tmp = mkTmp();
  try {
    const statePath = writeState(tmp);
    const r = runHook(tmp, bashEvent('gh pr create --title x', 'https://github.com/acme/widgets/pull/123'));
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.strictEqual(state.prNumber, 123, `expected prNumber updated to 123, got ${state.prNumber}`);
    assert.strictEqual(state.prUrl, 'https://github.com/acme/widgets/pull/123');
    assert.ok(/PR #123/.test(r.stdout), `expected hookSpecificOutput mentioning PR #123: ${r.stdout}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('non gh-pr-create Bash command with active state.json -> no state.json mutation', () => {
  const tmp = mkTmp();
  try {
    const statePath = writeState(tmp);
    const before = fs.readFileSync(statePath, 'utf8');
    const r = runHook(tmp, bashEvent('npm test', ''));
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    assert.strictEqual(fs.readFileSync(statePath, 'utf8'), before, 'state.json should be untouched');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

process.stdout.write(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
