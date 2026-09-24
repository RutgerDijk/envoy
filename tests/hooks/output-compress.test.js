#!/usr/bin/env node
/**
 * Output Compress Hook — Test Suite
 *
 * PostToolUse[Bash] hook that runs lib/output-compressor.js over the
 * command's stdout and hands Claude Code the compressed version via
 * hookSpecificOutput.updatedToolOutput (object form, shaped like
 * tool_response — a bare string is ignored for built-in Bash).
 *
 * Fixtures are real `dotnet build` / `dotnet test` logs (.NET 10.0.300,
 * paths normalized to /home/dev/Fx).
 *
 * Run: node tests/hooks/output-compress.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOKS = path.join(REPO_ROOT, 'hooks');
const RUNNER = path.join(HOOKS, 'hook-runner.js');
const FIXTURES = path.join(__dirname, 'fixtures');

const { compress } = require(path.join(REPO_ROOT, 'lib', 'output-compressor'));

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

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function bashEvent(command, stdout, extra = {}) {
  return {
    session_id: 'test-session',
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: { stdout, stderr: 'some stderr', interrupted: false, isImage: false, ...extra },
  };
}

/**
 * Invoke hook.run(rawInput) in-process, capturing everything written to stdout.
 * @returns {{ code: any, out: string }}
 */
function runHook(hook, rawInput) {
  const chunks = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  const origLog = console.log;
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
  console.log = (...args) => { chunks.push(args.join(' ') + '\n'); };
  let code;
  try {
    code = hook.run(rawInput);
  } finally {
    process.stdout.write = origWrite;
    console.log = origLog;
  }
  return { code, out: chunks.join('') };
}

function runViaRunner(input, env = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.ENVOY_DISABLED_HOOKS;
  delete childEnv.ENVOY_HOOK_PROFILE;
  Object.assign(childEnv, env);
  return spawnSync('node', [RUNNER, 'output-compress'], {
    input,
    env: childEnv,
    encoding: 'utf8',
  });
}

// ═══════════════════════════════════════════════════════════════════
// Load module
// ═══════════════════════════════════════════════════════════════════

let hook;
try {
  hook = require(path.join(HOOKS, 'output-compress'));
} catch (err) {
  hook = null;
}

section('output-compress: module');

test('hooks/output-compress.js exports run()', () => {
  assert.ok(hook, 'hooks/output-compress.js should exist');
  assert.strictEqual(typeof hook.run, 'function');
});

// ═══════════════════════════════════════════════════════════════════
// Real dotnet build log
// ═══════════════════════════════════════════════════════════════════

section('output-compress: dotnet build (real fixture)');

const buildLog = readFixture('dotnet-build-failed.log');
const expectedErrors = [...new Set(buildLog.split('\n').filter(l => /: error /.test(l)))];

test('fixture contains error lines to check', () => {
  assert.ok(expectedErrors.length >= 3, `expected >=3 distinct error lines, got ${expectedErrors.length}`);
});

test('emits updatedToolOutput object with compressed stdout and original other fields', () => {
  const event = bashEvent('dotnet build', buildLog, { stderr: 'build-stderr', interrupted: true, isImage: false });
  const { code, out } = runHook(hook, JSON.stringify(event));
  assert.ok(code === undefined || code === 0, `exit code should be 0, got ${code}`);
  const parsed = JSON.parse(out);
  const hso = parsed.hookSpecificOutput;
  assert.strictEqual(hso.hookEventName, 'PostToolUse');
  const u = hso.updatedToolOutput;
  assert.strictEqual(typeof u, 'object', 'updatedToolOutput must be an object, not a string');
  assert.strictEqual(u.stderr, 'build-stderr');
  assert.strictEqual(u.interrupted, true);
  assert.strictEqual(u.isImage, false);
  assert.ok(u.stdout.length < buildLog.length, `compressed (${u.stdout.length}) should be shorter than original (${buildLog.length})`);
});

test('every error line survives compression', () => {
  const { out } = runHook(hook, JSON.stringify(bashEvent('dotnet build', buildLog)));
  const stdout = JSON.parse(out).hookSpecificOutput.updatedToolOutput.stdout;
  for (const line of expectedErrors) {
    assert.ok(stdout.includes(line), `missing error line: ${line}`);
  }
});

// ═══════════════════════════════════════════════════════════════════
// Real dotnet test log
// ═══════════════════════════════════════════════════════════════════

section('output-compress: dotnet test (real fixture)');

const testLog = readFixture('dotnet-test-failed.log');
const failedNames = testLog.split('\n')
  .map(l => l.match(/^\s*Failed\s+([\w.]+)/))
  .filter(m => m && m[1].includes('.'))
  .map(m => m[1]);

test('fixture contains failed test names to check', () => {
  assert.ok(failedNames.length >= 2, `expected >=2 failed tests, got ${failedNames.length}`);
});

test('every failed test name survives compression and output is shorter', () => {
  const { out } = runHook(hook, JSON.stringify(bashEvent('dotnet test', testLog)));
  const u = JSON.parse(out).hookSpecificOutput.updatedToolOutput;
  assert.ok(u.stdout.length < testLog.length, `compressed (${u.stdout.length}) should be shorter than original (${testLog.length})`);
  for (const name of failedNames) {
    assert.ok(u.stdout.includes(name), `missing failed test: ${name}`);
  }
  assert.strictEqual(u.stderr, 'some stderr');
});

// ═══════════════════════════════════════════════════════════════════
// Pass-through cases
// ═══════════════════════════════════════════════════════════════════

section('output-compress: pass-through');

test('no matching pattern → no output, exit 0', () => {
  const cmd = 'echo hello-world-unmatched';
  const stdout = 'hello world\n'.repeat(50);
  assert.strictEqual(compress(stdout, cmd).savings.pattern, null, 'precondition: no pattern matches');
  const { code, out } = runHook(hook, JSON.stringify(bashEvent(cmd, stdout)));
  assert.ok(code === undefined || code === 0);
  assert.strictEqual(out, '');
});

test('safeguard ratio tripped → output left unchanged (no output)', () => {
  const cmd = 'dotnet build';
  const stdout = '  Restoring packages and compiling many projects...\n'.repeat(200) + 'Build succeeded.\n    0 Warning(s)\n    0 Error(s)\n';
  const pattern = compress(stdout, cmd).savings.pattern;
  assert.ok(pattern && pattern.endsWith('(safeguard)'), `precondition: safeguard trips, got ${pattern}`);
  const { code, out } = runHook(hook, JSON.stringify(bashEvent(cmd, stdout)));
  assert.ok(code === undefined || code === 0);
  assert.strictEqual(out, '');
});

test('malformed stdin → no output, exit 0 (fail-open)', () => {
  for (const raw of ['{not json', '', 'null', '42', JSON.stringify({ tool_name: 'Bash' }),
    JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'dotnet build' }, tool_response: { stdout: 123 } })]) {
    const { code, out } = runHook(hook, raw);
    assert.ok(code === undefined || code === 0, `code for ${raw}: ${code}`);
    assert.strictEqual(out, '', `output for ${raw}`);
  }
});

test('non-Bash tool → no output', () => {
  const event = { ...bashEvent('dotnet build', buildLog), tool_name: 'Read' };
  const { out } = runHook(hook, JSON.stringify(event));
  assert.strictEqual(out, '');
});

// ═══════════════════════════════════════════════════════════════════
// End-to-end through hook-runner
// ═══════════════════════════════════════════════════════════════════

section('output-compress: via hook-runner');

const buildEventJson = JSON.stringify(bashEvent('dotnet build', buildLog));

test('standard profile → emits compressed JSON', () => {
  const r = runViaRunner(buildEventJson);
  assert.strictEqual(r.status, 0, r.stderr);
  const u = JSON.parse(r.stdout).hookSpecificOutput.updatedToolOutput;
  assert.ok(u.stdout.length < buildLog.length);
});

test('ENVOY_DISABLED_HOOKS=output-compress → exit 0, no output', () => {
  const r = runViaRunner(buildEventJson, { ENVOY_DISABLED_HOOKS: 'foo, output-compress' });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

test('minimal profile → exit 0, no output', () => {
  const r = runViaRunner(buildEventJson, { ENVOY_HOOK_PROFILE: 'minimal' });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

test('malformed stdin via runner → exit 0, no output', () => {
  const r = runViaRunner('{garbage');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

// ═══════════════════════════════════════════════════════════════════
// Registration
// ═══════════════════════════════════════════════════════════════════

section('output-compress: registration');

test('HOOK_PROFILES lists output-compress for standard and strict', () => {
  const { HOOK_PROFILES } = require(RUNNER);
  assert.deepStrictEqual(HOOK_PROFILES['output-compress'], ['standard', 'strict']);
});

test('hooks.json registers output-compress under PostToolUse matcher Bash', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(HOOKS, 'hooks.json'), 'utf8'));
  const entries = (cfg.hooks.PostToolUse || [])
    .filter(g => g.matcher === 'Bash')
    .flatMap(g => g.hooks)
    .filter(h => /hook-runner\.js"? output-compress\b/.test(h.command));
  assert.strictEqual(entries.length, 1, 'expected exactly one output-compress registration');
  assert.deepStrictEqual(entries[0]._profiles, ['standard', 'strict']);
});

// ═══════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
