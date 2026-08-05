#!/usr/bin/env node
/**
 * issue-create-guard — physically prevents unilateral/duplicate `gh issue create`
 * calls during a brainstorm run.
 *
 * Two behaviors:
 *  1. ARMED (unconditional, ignores ENVOY_HOOK_PROFILE): a second `gh issue create`
 *     (or `gh api repos/*\/issues -X POST` bypass) after one issue was already
 *     created this run (.envoy/brainstorm/session.json exists) always blocks
 *     (exit 2) with a corrective stderr message naming the existing issue.
 *  2. Observe/strict toggle: `gh issue create` without
 *     .envoy/brainstorm/issue-plan-approved.json logs a would-block record and
 *     exits 0 in observe (default) mode, exits 2 under ENVOY_HOOK_PROFILE=strict.
 *
 * Run: node tests/hooks/issue-create-guard.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOKS_JSON = path.join(REPO_ROOT, 'hooks', 'hooks.json');
const ISSUE_CREATE_GUARD = path.join(REPO_ROOT, 'hooks', 'issue-create-guard.js');
const OBSERVE_LOG = path.join('.envoy', 'observe-log.jsonl');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'issue-create-guard-'));
}

function writeSession(cwd, issueNumber) {
  const dir = path.join(cwd, '.envoy', 'brainstorm');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'session.json'),
    JSON.stringify({ $schemaVersion: '1', issueNumber, createdAt: new Date().toISOString() })
  );
}

function writeApproval(cwd) {
  const dir = path.join(cwd, '.envoy', 'brainstorm');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'issue-plan-approved.json'), JSON.stringify({ $schemaVersion: '1', approved: true }));
}

function bashEvent(command) {
  return { tool_name: 'Bash', tool_input: { command } };
}

function runGate(cwd, input, env = {}) {
  return spawnSync('node', [ISSUE_CREATE_GUARD], {
    cwd,
    encoding: 'utf8',
    input: typeof input === 'string' ? input : JSON.stringify(input || {}),
    env: { ...process.env, ...env },
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

section('registration: PreToolUse[Bash] -> issue-create-guard, all profiles');

test('hooks.json registers matcher "Bash" -> issue-create-guard via hook-runner in all profiles', () => {
  const hooksConfig = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));
  const pre = hooksConfig.hooks.PreToolUse || [];
  const bashEntry = pre.find(
    (e) => e.matcher === 'Bash' && e.hooks.some((h) => /issue-create-guard/.test(h.command))
  );
  assert.ok(bashEntry, 'no PreToolUse entry with matcher "Bash" wired to issue-create-guard');
  const hookDef = bashEntry.hooks.find((h) => /issue-create-guard/.test(h.command));
  assert.ok(/hook-runner\.js" issue-create-guard/.test(hookDef.command), `not wired via hook-runner: ${hookDef.command}`);
  assert.deepStrictEqual(
    [...hookDef._profiles].sort(),
    ['minimal', 'standard', 'strict'],
    'issue-create-guard must be registered in ALL profiles (unconditional duplicate case is not profile-gated)'
  );
});

section('ARMED: duplicate gh issue create always blocks, ignoring profile');

for (const profile of [undefined, 'standard', 'strict', 'minimal']) {
  test(`gh issue create blocked when session.json exists (profile=${profile || 'default'})`, () => {
    const tmp = mkTmp();
    try {
      writeSession(tmp, 42);
      const env = profile ? { ENVOY_HOOK_PROFILE: profile } : {};
      const r = runGate(tmp, bashEvent('gh issue create --title "x" --body "y"'), env);
      assert.strictEqual(r.status, 2, `expected exit 2 (unconditional block), got ${r.status}\n${r.stderr}`);
      assert.ok(/#42|42/.test(r.stderr), `stderr should reference existing issue number: ${r.stderr}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}

test('gh api repos/*/issues -X POST bypass also blocked when session.json exists', () => {
  const tmp = mkTmp();
  try {
    writeSession(tmp, 7);
    const r = runGate(tmp, bashEvent('gh api repos/acme/widgets/issues -X POST -f title="dup"'));
    assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
    assert.ok(/7/.test(r.stderr), `stderr should reference existing issue #7: ${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('gh api /repos/OWNER/REPO/issues --method POST equivalent also blocked', () => {
  const tmp = mkTmp();
  try {
    writeSession(tmp, 7);
    const r = runGate(tmp, bashEvent('gh api /repos/acme/widgets/issues --method POST -f title="dup"'));
    assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

section('observe/strict toggle: gh issue create without approval file');

test('no issue-plan-approved.json → observe mode (default) logs would-block and exits 0', () => {
  const tmp = mkTmp();
  try {
    const r = runGate(tmp, bashEvent('gh issue create --title "x" --body "y"'));
    assert.strictEqual(r.status, 0, `expected exit 0 (observe mode), got ${r.status}\n${r.stderr}`);
    const log = readLog(tmp);
    assert.ok(log && log.length === 1, 'expected exactly one observe-log record');
    assert.strictEqual(log[0].gate, 'issue-create-guard');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('no issue-plan-approved.json → strict mode blocks (exit 2)', () => {
  const tmp = mkTmp();
  try {
    const r = runGate(tmp, bashEvent('gh issue create --title "x" --body "y"'), { ENVOY_HOOK_PROFILE: 'strict' });
    assert.strictEqual(r.status, 2, `expected exit 2 (strict), got ${r.status}\n${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('issue-plan-approved.json present, no session.json → allowed, exit 0, no log', () => {
  const tmp = mkTmp();
  try {
    writeApproval(tmp);
    const r = runGate(tmp, bashEvent('gh issue create --title "x" --body "y"'));
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    assert.strictEqual(readLog(tmp), null, 'no observe-log expected when approved');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

section('non-matching commands and malformed input never block');

test('unrelated Bash command → exit 0, no log', () => {
  const tmp = mkTmp();
  try {
    const r = runGate(tmp, bashEvent('npm test'));
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    assert.strictEqual(readLog(tmp), null, 'no observe-log expected for unrelated command');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('non-Bash tool_name → exit 0, no log even with session.json present', () => {
  const tmp = mkTmp();
  try {
    writeSession(tmp, 1);
    const r = runGate(tmp, { tool_name: 'Edit', tool_input: {} });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('malformed stdin → exit 0, no crash', () => {
  const tmp = mkTmp();
  try {
    const r = runGate(tmp, 'not json {{{');
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

section('regex scope: collection endpoint only, not existing-issue operations (PR #75 review)');

test('POST to /issues/<n>/comments (existing issue) is NOT treated as issue-create, even with session.json present', () => {
  const tmp = mkTmp();
  try {
    writeSession(tmp, 42);
    const r = runGate(tmp, bashEvent('gh api repos/acme/widgets/issues/42/comments -X POST -f body="hi"'));
    assert.strictEqual(r.status, 0, `expected exit 0 (unrelated command), got ${r.status}\n${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('POST to /issues/<n>/labels (existing issue) is NOT treated as issue-create', () => {
  const tmp = mkTmp();
  try {
    writeSession(tmp, 7);
    const r = runGate(tmp, bashEvent('gh api repos/acme/widgets/issues/7/labels -X POST -f labels[]=bug'));
    assert.strictEqual(r.status, 0, `expected exit 0 (unrelated command), got ${r.status}\n${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('POST to the bare /issues collection endpoint is still blocked (regression guard)', () => {
  const tmp = mkTmp();
  try {
    writeSession(tmp, 7);
    const r = runGate(tmp, bashEvent('gh api repos/acme/widgets/issues -X POST -f title="dup"'));
    assert.strictEqual(r.status, 2, `expected exit 2 (collection endpoint), got ${r.status}\n${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

section('corrective message robustness: malformed session.json (PR #75 review)');

test('malformed session.json still blocks, but never prints literal "#undefined" in the corrective message', () => {
  const tmp = mkTmp();
  try {
    const dir = path.join(tmp, '.envoy', 'brainstorm');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'session.json'), 'not valid json {{{');
    const r = runGate(tmp, bashEvent('gh issue create --title "x" --body "y"'));
    assert.strictEqual(r.status, 2, `expected exit 2 (still unconditional block), got ${r.status}\n${r.stderr}`);
    assert.ok(!r.stderr.includes('#undefined'), `stderr must not leak "#undefined": ${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('session.json missing issueNumber field still blocks, no "#undefined" leak', () => {
  const tmp = mkTmp();
  try {
    const dir = path.join(tmp, '.envoy', 'brainstorm');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ $schemaVersion: '1' }));
    const r = runGate(tmp, bashEvent('gh issue create --title "x" --body "y"'));
    assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
    assert.ok(!r.stderr.includes('#undefined'), `stderr must not leak "#undefined": ${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

process.stdout.write(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
