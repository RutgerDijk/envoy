#!/usr/bin/env node
/**
 * SessionStart Hook Output Shape — Test Suite
 *
 * Run: node tests/hooks/session-start-output.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOK = path.join(REPO_ROOT, 'hooks', 'session-start.sh');

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

function runHook() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'session-start-'));
  const stdout = execFileSync('bash', [HOOK], {
    cwd,
    encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'test', cwd }),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO_ROOT }
  });
  fs.rmSync(cwd, { recursive: true, force: true });
  return stdout;
}

test('hook emits valid JSON', () => {
  const parsed = JSON.parse(runHook());
  assert.ok(parsed && typeof parsed === 'object');
});

test('hookSpecificOutput is the required object shape, not a string', () => {
  const parsed = JSON.parse(runHook());
  const hso = parsed.hookSpecificOutput;
  assert.strictEqual(typeof hso, 'object', 'hookSpecificOutput must be an object');
  assert.ok(!Array.isArray(hso), 'hookSpecificOutput must not be an array');
  assert.strictEqual(hso.hookEventName, 'SessionStart');
});

test('additionalContext carries the bootstrap content', () => {
  const parsed = JSON.parse(runHook());
  const ctx = parsed.hookSpecificOutput.additionalContext;
  assert.strictEqual(typeof ctx, 'string');
  assert.ok(ctx.includes('EXTREMELY_IMPORTANT'), 'bootstrap wrapper must be present');
  assert.ok(ctx.includes('Envoy'), 'bootstrap must mention Envoy');
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
