#!/usr/bin/env node
/**
 * Strict-profile enforcement for the plugin observe-mode gates.
 *
 * The gates (agent-guard, stop-audit) stay observe-only by default: a would-block
 * decision is logged and the gate exits 0. Under ENVOY_HOOK_PROFILE=strict the
 * same would-block decision ENFORCES — the gate exits 2 with the reason on stderr
 * (the PreToolUse/Stop block contract) while STILL logging. Fail-open is absolute:
 * any thrown error in the gate path exits 0 even under strict.
 *
 * Run: node tests/hooks/strict-gate.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const AGENT_GUARD = path.join(REPO_ROOT, 'hooks', 'agent-guard.js');
const STOP_AUDIT = path.join(REPO_ROOT, 'hooks', 'stop-audit.js');
const HOOK_RUNNER = path.join(REPO_ROOT, 'hooks', 'hook-runner.js');
const OBSERVE_LOG = path.join('.envoy', 'observe-log.jsonl');

const SESSION = 'strict-gate-test-session';

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'strict-gate-'));
}

/** Write a fresh, non-stale active-skill marker for `skill` under `cwd`. */
function writeMarker(cwd, skill) {
  fs.mkdirSync(path.join(cwd, '.envoy'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, '.envoy', 'active-skill.json'),
    JSON.stringify({
      $schemaVersion: '1',
      skill,
      startedAt: new Date().toISOString(),
      branch: 'unknown', // temp dir is not a git repo → currentBranch() === 'unknown'
      session: SESSION,
      pid: process.pid,
    })
  );
}

/** Spawn the gate script directly, merging `env` over a base that sets the session. */
function runGate(gateScript, cwd, input, env = {}) {
  return spawnSync('node', [gateScript], {
    cwd,
    encoding: 'utf8',
    input: typeof input === 'string' ? input : JSON.stringify(input || {}),
    env: { ...process.env, CLAUDE_SESSION_ID: SESSION, ...env },
  });
}

/** Spawn the hook through hook-runner (the real CLI dispatch path). */
function runViaRunner(hookName, cwd, input, env = {}) {
  return spawnSync('node', [HOOK_RUNNER, hookName], {
    cwd,
    encoding: 'utf8',
    input: typeof input === 'string' ? input : JSON.stringify(input || {}),
    env: { ...process.env, CLAUDE_SESSION_ID: SESSION, ...env },
  });
}

function readLog(cwd) {
  const p = path.join(cwd, OBSERVE_LOG);
  if (!fs.existsSync(p)) return null;
  return fs
    .readFileSync(p, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const blockingAgentEvent = {
  tool_name: 'Agent',
  tool_input: {
    subagent_type: 'general-purpose',
    description: 'Implement Task 1',
    prompt: 'Implement Task 1: add feature\n\n(missing both Iron Law tokens)',
  },
};

section('strict profile: would-block ENFORCES (exit 2 + stderr) and still logs');

test('agent-guard strict + would-block → exit 2, reason on stderr, block logged', () => {
  const tmp = mkTmp();
  try {
    writeMarker(tmp, 'pickup');
    const r = runGate(AGENT_GUARD, tmp, blockingAgentEvent, { ENVOY_HOOK_PROFILE: 'strict' });
    assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
    assert.ok(r.stderr && r.stderr.trim().length > 0, 'block reason must be on stderr');
    const log = readLog(tmp);
    assert.ok(log && log.length === 1, 'block must still be logged under strict');
    assert.strictEqual(log[0].gate, 'agent-guard');
    assert.strictEqual(log[0].tool, 'Agent');
    assert.ok(r.stderr.includes(log[0].reason), 'stderr should carry the logged reason');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop-audit strict + would-block → exit 2, reason on stderr, block logged', () => {
  const tmp = mkTmp();
  try {
    writeMarker(tmp, 'pickup'); // pickup requires session.json + handoff which are absent
    const r = runGate(STOP_AUDIT, tmp, {}, { ENVOY_HOOK_PROFILE: 'strict' });
    assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
    assert.ok(r.stderr && r.stderr.trim().length > 0, 'block reason must be on stderr');
    const log = readLog(tmp);
    assert.ok(log && log.length === 1, 'block must still be logged under strict');
    assert.strictEqual(log[0].gate, 'stop-audit');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

section('non-strict profile: would-block stays observe-only (exit 0 + log)');

test('agent-guard unset profile + would-block → exit 0, block logged, no stderr', () => {
  const tmp = mkTmp();
  try {
    writeMarker(tmp, 'pickup');
    const r = runGate(AGENT_GUARD, tmp, blockingAgentEvent); // ENVOY_HOOK_PROFILE unset
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    assert.ok(!r.stderr || r.stderr.trim().length === 0, 'observe mode must not emit block stderr');
    const log = readLog(tmp);
    assert.ok(log && log.length === 1, 'observe mode still logs the would-block record');
    assert.strictEqual(log[0].tool, 'Agent');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('agent-guard non-strict profile ("standard") + would-block → exit 0, logged', () => {
  const tmp = mkTmp();
  try {
    writeMarker(tmp, 'pickup');
    const r = runGate(AGENT_GUARD, tmp, blockingAgentEvent, { ENVOY_HOOK_PROFILE: 'standard' });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    const log = readLog(tmp);
    assert.ok(log && log.length === 1, 'standard profile still logs the would-block record');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

section('fail-open is absolute: a throwing gate exits 0 even under strict');

test('agent-guard strict + append throws → exit 0 (fail-open beats enforcement)', () => {
  const tmp = mkTmp();
  try {
    writeMarker(tmp, 'pickup');
    // Make the observe-log path a directory so appendObserveLog throws EISDIR
    // AFTER the block decision — the whole path must fail open to exit 0.
    fs.mkdirSync(path.join(tmp, '.envoy', 'observe-log.jsonl'), { recursive: true });
    const r = runGate(AGENT_GUARD, tmp, blockingAgentEvent, { ENVOY_HOOK_PROFILE: 'strict' });
    assert.strictEqual(r.status, 0, `strict must still fail open on throw, got ${r.status}\n${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

section('no active skill: exit 0, no log, all profiles');

test('agent-guard strict + no active skill → exit 0 and no observe-log', () => {
  const tmp = mkTmp();
  try {
    // no marker written
    const r = runGate(AGENT_GUARD, tmp, blockingAgentEvent, { ENVOY_HOOK_PROFILE: 'strict' });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    assert.strictEqual(readLog(tmp), null, 'no observe-log should exist when no skill is active');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop-audit strict + no active skill → exit 0 and no observe-log', () => {
  const tmp = mkTmp();
  try {
    const r = runGate(STOP_AUDIT, tmp, {}, { ENVOY_HOOK_PROFILE: 'strict' });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    assert.strictEqual(readLog(tmp), null, 'no observe-log should exist when no skill is active');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

section('logged override escape hatch: ENVOY_OVERRIDE lets a strict block through');

test('agent-guard strict + would-block + ENVOY_OVERRIDE=1 → exit 0, override logged', () => {
  const tmp = mkTmp();
  try {
    writeMarker(tmp, 'pickup');
    const r = runGate(AGENT_GUARD, tmp, blockingAgentEvent, {
      ENVOY_HOOK_PROFILE: 'strict',
      ENVOY_OVERRIDE: '1',
    });
    assert.strictEqual(r.status, 0, `override must allow, got ${r.status}\n${r.stderr}`);
    const log = readLog(tmp);
    assert.ok(log && log.length >= 1, 'override must be logged');
    const override = log.find((rec) => rec.kind === 'override');
    assert.ok(override, 'an override record must exist in the observe-log');
    assert.strictEqual(override.gate, 'agent-guard');
    assert.strictEqual(override.tool, 'Agent');
    assert.strictEqual(override.skill, 'pickup');
    assert.ok(override.reason && override.ts, 'override record carries reason + ts');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('agent-guard strict + would-block, no override → exit 2, stderr names ENVOY_OVERRIDE', () => {
  const tmp = mkTmp();
  try {
    writeMarker(tmp, 'pickup');
    const r = runGate(AGENT_GUARD, tmp, blockingAgentEvent, { ENVOY_HOOK_PROFILE: 'strict' });
    assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
    assert.ok(r.stderr.includes('ENVOY_OVERRIDE'), 'stderr must name the override mechanism');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('ENVOY_OVERRIDE=0 does NOT override (still blocks under strict)', () => {
  const tmp = mkTmp();
  try {
    writeMarker(tmp, 'pickup');
    const r = runGate(AGENT_GUARD, tmp, blockingAgentEvent, { ENVOY_HOOK_PROFILE: 'strict', ENVOY_OVERRIDE: '0' });
    assert.strictEqual(r.status, 2, `ENVOY_OVERRIDE=0 must not enable override; expected exit 2, got ${r.status}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

section('end-to-end through hook-runner: exit code propagates (the whole point)');

test('hook-runner agent-guard strict + would-block → exit 2', () => {
  const tmp = mkTmp();
  try {
    writeMarker(tmp, 'pickup');
    const r = runViaRunner('agent-guard', tmp, blockingAgentEvent, { ENVOY_HOOK_PROFILE: 'strict' });
    assert.strictEqual(r.status, 2, `hook-runner must propagate exit 2, got ${r.status}\n${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('hook-runner stop-audit strict + would-block → exit 2', () => {
  const tmp = mkTmp();
  try {
    writeMarker(tmp, 'pickup');
    const r = runViaRunner('stop-audit', tmp, {}, { ENVOY_HOOK_PROFILE: 'strict' });
    assert.strictEqual(r.status, 2, `hook-runner must propagate exit 2, got ${r.status}\n${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('hook-runner agent-guard strict + would-block + ENVOY_OVERRIDE=1 → exit 0', () => {
  const tmp = mkTmp();
  try {
    writeMarker(tmp, 'pickup');
    const r = runViaRunner('agent-guard', tmp, blockingAgentEvent, {
      ENVOY_HOOK_PROFILE: 'strict',
      ENVOY_OVERRIDE: '1',
    });
    assert.strictEqual(r.status, 0, `override through hook-runner must allow, got ${r.status}\n${r.stderr}`);
    const log = readLog(tmp);
    assert.ok(log && log.some((rec) => rec.kind === 'override'), 'override logged through hook-runner');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('hook-runner backward compat: undefined-returning hook → exit 0', () => {
  const tmp = mkTmp();
  try {
    // post-edit-accumulator.run() returns undefined for a non-Edit/Write event.
    const r = runViaRunner('post-edit-accumulator', tmp, { tool_name: 'Read', tool_input: {} }, {
      ENVOY_HOOK_PROFILE: 'strict',
    });
    assert.strictEqual(r.status, 0, `undefined-return hook must exit 0, got ${r.status}\n${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('hook-runner fail-open: throwing gate path → exit 0 even under strict', () => {
  const tmp = mkTmp();
  try {
    writeMarker(tmp, 'pickup');
    fs.mkdirSync(path.join(tmp, '.envoy', 'observe-log.jsonl'), { recursive: true });
    const r = runViaRunner('agent-guard', tmp, blockingAgentEvent, { ENVOY_HOOK_PROFILE: 'strict' });
    assert.strictEqual(r.status, 0, `hook-runner must fail open on throw, got ${r.status}\n${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

process.stdout.write(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
