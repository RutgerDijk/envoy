#!/usr/bin/env node
/**
 * Plugin-level observe-mode gates — agent-guard and stop-audit.
 *
 * Proves the gates register at plugin level (hooks/hooks.json) and run in
 * OBSERVE mode: they resolve the active skill's contract, log a would-block
 * decision to .envoy/observe-log.jsonl, and ALWAYS exit 0 (fail-open on any
 * error, no-op when no rigid skill is active).
 *
 * Run: node tests/hooks/observe-gates.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOKS_JSON = path.join(REPO_ROOT, 'hooks', 'hooks.json');
const AGENT_GUARD = path.join(REPO_ROOT, 'hooks', 'agent-guard.js');
const STOP_AUDIT = path.join(REPO_ROOT, 'hooks', 'stop-audit.js');
const OBSERVE_LOG = path.join('.envoy', 'observe-log.jsonl');

const SESSION = 'observe-gates-test-session';

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'observe-gates-'));
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

function runGate(gateScript, cwd, input) {
  return spawnSync('node', [gateScript], {
    cwd,
    encoding: 'utf8',
    input: typeof input === 'string' ? input : JSON.stringify(input || {}),
    env: { ...process.env, CLAUDE_SESSION_ID: SESSION },
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

section('registration: plugin-level gates in hooks/hooks.json');

const hooksConfig = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));

test('PreToolUse registers matcher "Agent" → agent-guard via hook-runner', () => {
  const pre = hooksConfig.hooks.PreToolUse || [];
  const agentEntry = pre.find((e) => e.matcher === 'Agent');
  assert.ok(agentEntry, 'no PreToolUse entry with matcher "Agent"');
  const cmd = agentEntry.hooks.map((h) => h.command).join(' ');
  assert.ok(/hook-runner\.js" agent-guard/.test(cmd), `agent-guard not wired via hook-runner: ${cmd}`);
});

test('Stop registers stop-audit via hook-runner', () => {
  const stop = hooksConfig.hooks.Stop || [];
  const cmd = stop.flatMap((e) => e.hooks.map((h) => h.command)).join(' ');
  assert.ok(/hook-runner\.js" stop-audit/.test(cmd), `stop-audit not wired via hook-runner: ${cmd}`);
});

section('observe mode: would-block scenarios log and exit 0');

test('agent-guard logs a would-block record and exits 0', () => {
  const tmp = mkTmp();
  try {
    writeMarker(tmp, 'pickup');
    const r = runGate(AGENT_GUARD, tmp, blockingAgentEvent);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    const log = readLog(tmp);
    assert.ok(log && log.length === 1, 'expected exactly one observe-log record');
    const rec = log[0];
    assert.strictEqual(rec.skill, 'pickup');
    assert.strictEqual(rec.gate, 'agent-guard');
    assert.strictEqual(rec.tool, 'Agent');
    assert.ok(typeof rec.ts === 'string' && rec.ts.length > 0, 'ts must be present');
    assert.ok(typeof rec.reason === 'string' && rec.reason.length > 0, 'reason must be present');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop-audit logs a would-block record and exits 0', () => {
  const tmp = mkTmp();
  try {
    writeMarker(tmp, 'pickup'); // pickup requires session.json + handoff which are absent
    const r = runGate(STOP_AUDIT, tmp, {});
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    const log = readLog(tmp);
    assert.ok(log && log.length === 1, 'expected exactly one observe-log record');
    assert.strictEqual(log[0].skill, 'pickup');
    assert.strictEqual(log[0].gate, 'stop-audit');
    assert.ok(/session\.json|handoff-to-review/.test(log[0].reason), 'reason must name missing artifacts');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

section('fail-open and no-op paths always exit 0');

test('malformed stdin → exit 0, no crash', () => {
  const tmp = mkTmp();
  try {
    writeMarker(tmp, 'pickup');
    const r = runGate(AGENT_GUARD, tmp, 'not json {{{');
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('no active skill → exit 0 and no observe-log written', () => {
  const tmp = mkTmp();
  try {
    // no marker written
    const r = runGate(AGENT_GUARD, tmp, blockingAgentEvent);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    assert.strictEqual(readLog(tmp), null, 'no observe-log should exist when no skill is active');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop-audit with no active skill → exit 0 and no log', () => {
  const tmp = mkTmp();
  try {
    const r = runGate(STOP_AUDIT, tmp, {});
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    assert.strictEqual(readLog(tmp), null, 'no observe-log should exist when no skill is active');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

section('cleanup: dead per-skill hooks frontmatter removed');

for (const skill of ['cleanup', 'finalize', 'coderabbit-pr-review', 'fix-ci', 'pickup', 'review', 'wiki-sync']) {
  test(`${skill}/SKILL.md has no hooks: frontmatter block`, () => {
    const md = fs.readFileSync(path.join(REPO_ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
    const fm = md.split(/^---$/m)[1] || '';
    assert.ok(!/^hooks:/m.test(fm), `${skill}/SKILL.md still declares a hooks: frontmatter block`);
  });
}

process.stdout.write(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
