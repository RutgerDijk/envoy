#!/usr/bin/env node
/**
 * ABOUTME: Tests the PreCompact ledger hook and SessionStart tail injection.
 * ABOUTME: pre-compact appends a diary event (fail-open); session-start injects the tail.
 *
 * Run: node tests/hooks/ledger-hooks.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync, execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOKS_JSON = path.join(REPO_ROOT, 'hooks', 'hooks.json');
const PRE_COMPACT = path.join(REPO_ROOT, 'hooks', 'pre-compact.js');
const HOOK_RUNNER = path.join(REPO_ROOT, 'hooks', 'hook-runner.js');
const SESSION_START = path.join(REPO_ROOT, 'hooks', 'session-start.sh');
const { appendEvent, readLedger } = require(path.join(REPO_ROOT, 'lib', 'ledger'));
const { writeActiveSkill } = require(path.join(REPO_ROOT, 'lib', 'active-skill'));

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-hooks-'));
}

function runPreCompact(cwd, script) {
  return spawnSync('node', [script], {
    cwd,
    encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'auto', cwd }),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO_ROOT },
  });
}

function runSessionStart(cwd, source) {
  return execFileSync('bash', [SESSION_START], {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: source || 'startup', session_id: 'test', cwd }),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO_ROOT },
  });
}

section('registration: PreCompact wired in hooks/hooks.json');

const hooksConfig = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));

test('PreCompact registers pre-compact via hook-runner', () => {
  const pre = hooksConfig.hooks.PreCompact || [];
  assert.ok(pre.length > 0, 'no PreCompact entries in hooks.json');
  const cmd = pre.flatMap((e) => e.hooks.map((h) => h.command)).join(' ');
  assert.ok(/hook-runner\.js" pre-compact/.test(cmd), `pre-compact not wired via hook-runner: ${cmd}`);
});

section('pre-compact appends a diary event');

test('running pre-compact appends a pre-compact event', () => {
  const tmp = mkTmp();
  try {
    const r = runPreCompact(tmp, PRE_COMPACT);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    const events = readLedger(tmp);
    assert.ok(events.length >= 1, 'expected at least one ledger event');
    assert.ok(events.some((e) => e.type === 'pre-compact'), 'no pre-compact event appended');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('hook-runner dispatches pre-compact', () => {
  const tmp = mkTmp();
  try {
    const r2 = spawnSync('node', [HOOK_RUNNER, 'pre-compact'], {
      cwd: tmp,
      encoding: 'utf8',
      input: JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'auto', cwd: tmp }),
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO_ROOT },
    });
    assert.strictEqual(r2.status, 0, `expected exit 0, got ${r2.status}\n${r2.stderr}`);
    const events = readLedger(tmp);
    assert.ok(events.some((e) => e.type === 'pre-compact'), 'hook-runner did not dispatch pre-compact');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('pre-compact is fail-open when the ledger dir is unwritable', () => {
  const tmp = mkTmp();
  try {
    // Make .envoy a regular file so mkdir/append fails inside appendEvent.
    fs.writeFileSync(path.join(tmp, '.envoy'), 'not a directory');
    const r = runPreCompact(tmp, PRE_COMPACT);
    assert.strictEqual(r.status, 0, `PreCompact must never break compaction; got ${r.status}\n${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

section('session-start injects the ledger tail with framing');

test('seeded ledger → additionalContext carries the tail + framing', () => {
  const tmp = mkTmp();
  try {
    appendEvent(tmp, { type: 'skill-started', skill: 'pickup-marker-abc' });
    const parsed = JSON.parse(runSessionStart(tmp));
    const ctx = parsed.hookSpecificOutput.additionalContext;
    assert.strictEqual(typeof ctx, 'string');
    assert.ok(/Recent workflow record/.test(ctx), 'framing header missing');
    assert.ok(/trust/i.test(ctx), 'trust-the-record framing missing');
    assert.ok(ctx.includes('pickup-marker-abc'), 'seeded tail event missing from context');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('no ledger → output is still valid JSON and unchanged (no framing)', () => {
  const tmp = mkTmp();
  try {
    const raw = runSessionStart(tmp);
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'SessionStart');
    const ctx = parsed.hookSpecificOutput.additionalContext;
    assert.ok(!/Recent workflow record/.test(ctx), 'framing must be absent when no ledger exists');
    assert.ok(ctx.includes('EXTREMELY_IMPORTANT'), 'bootstrap wrapper must still be present');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

section('pre-compact records the active skill from .envoy/active-skill.json');

test('pre-compact event includes activeSkill + issueNumber when marker present', () => {
  const tmp = mkTmp();
  try {
    writeActiveSkill(tmp, { skill: 'pickup', issueNumber: 74 }, { branch: 'unknown', session: 'pid-1' });
    const r = runPreCompact(tmp, PRE_COMPACT);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    const events = readLedger(tmp);
    const evt = events.find((e) => e.type === 'pre-compact');
    assert.ok(evt, 'no pre-compact event appended');
    assert.strictEqual(evt.activeSkill, 'pickup', 'activeSkill not recorded');
    assert.strictEqual(evt.issueNumber, 74, 'issueNumber not recorded');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('pre-compact event omits activeSkill when no marker present', () => {
  const tmp = mkTmp();
  try {
    const r = runPreCompact(tmp, PRE_COMPACT);
    assert.strictEqual(r.status, 0);
    const events = readLedger(tmp);
    const evt = events.find((e) => e.type === 'pre-compact');
    assert.ok(evt, 'no pre-compact event appended');
    assert.strictEqual(evt.activeSkill, undefined, 'activeSkill should be absent without a marker');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

section('session-start nudges re-invocation after a compaction on resume');

test('resume trigger + pre-compact ledger event with activeSkill → nudge printed', () => {
  const tmp = mkTmp();
  try {
    appendEvent(tmp, { type: 'pre-compact', activeSkill: 'pickup', issueNumber: 74 });
    const parsed = JSON.parse(runSessionStart(tmp, 'resume'));
    const ctx = parsed.hookSpecificOutput.additionalContext;
    assert.ok(/Resuming after compaction/i.test(ctx), 'resume nudge missing');
    assert.ok(ctx.includes('envoy:pickup'), 'nudge must name the active skill');
    assert.ok(ctx.includes('74'), 'nudge must include the issue number');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('startup trigger (not resume) → no nudge even with a pre-compact event', () => {
  const tmp = mkTmp();
  try {
    appendEvent(tmp, { type: 'pre-compact', activeSkill: 'pickup', issueNumber: 74 });
    const parsed = JSON.parse(runSessionStart(tmp, 'startup'));
    const ctx = parsed.hookSpecificOutput.additionalContext;
    assert.ok(!/Resuming after compaction/i.test(ctx), 'nudge must not fire on plain startup');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('resume trigger but no pre-compact event → no nudge', () => {
  const tmp = mkTmp();
  try {
    appendEvent(tmp, { type: 'skill-started', skill: 'pickup' });
    const parsed = JSON.parse(runSessionStart(tmp, 'resume'));
    const ctx = parsed.hookSpecificOutput.additionalContext;
    assert.ok(!/Resuming after compaction/i.test(ctx), 'nudge must not fire without a pre-compact event');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

process.stdout.write(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
