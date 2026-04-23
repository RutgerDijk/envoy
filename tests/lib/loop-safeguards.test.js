#!/usr/bin/env node
/**
 * loop-safeguards CLI — Test Suite
 *
 * Run: node tests/lib/loop-safeguards.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', '..', 'lib', 'loop-safeguards.js');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loop-safeguards-test-'));
}

function run(args, cwd) {
  return spawnSync('node', [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env },
  });
}

section('Module exports backwards-compatible constants');

test('module still exports COMPLETION_SIGNAL', () => {
  const mod = require(CLI);
  assert.strictEqual(mod.COMPLETION_SIGNAL, 'ENVOY_LOOP_COMPLETE');
});

test('module still exports REQUIRED_CONSECUTIVE', () => {
  const mod = require(CLI);
  assert.strictEqual(mod.REQUIRED_CONSECUTIVE, 3);
});

test('module still exports PROTOCOL string', () => {
  const mod = require(CLI);
  assert.strictEqual(typeof mod.PROTOCOL, 'string');
  assert.ok(mod.PROTOCOL.includes('ENVOY_LOOP_COMPLETE'));
});

section('CLI: status on unknown loop');

test('status on fresh loop exits 1 with count 0', () => {
  const tmp = mkTmp();
  const r = run(['status', 'fix-ci-test'], tmp);
  assert.strictEqual(r.status, 1, `expected exit 1, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.ok(/0\/3/.test(r.stdout) || /count:\s*0/i.test(r.stdout));
  fs.rmSync(tmp, { recursive: true, force: true });
});

section('CLI: confirm 3× triggers completion');

test('confirm three times reaches confirmed state', () => {
  const tmp = mkTmp();
  let r;
  r = run(['confirm', 'fix-ci-test'], tmp);
  assert.strictEqual(r.status, 1, `1st confirm should exit 1 (still counting) — got ${r.status}`);
  r = run(['confirm', 'fix-ci-test'], tmp);
  assert.strictEqual(r.status, 1, `2nd confirm should exit 1`);
  r = run(['confirm', 'fix-ci-test'], tmp);
  assert.strictEqual(r.status, 0, `3rd confirm should exit 0 (confirmed) — got ${r.status}\nstdout: ${r.stdout}`);

  const statusR = run(['status', 'fix-ci-test'], tmp);
  assert.strictEqual(statusR.status, 0, `status after 3 confirms should exit 0`);
  assert.ok(/3\/3|confirmed/i.test(statusR.stdout));
  fs.rmSync(tmp, { recursive: true, force: true });
});

section('CLI: state persisted under .envoy/loops/');

test('confirm writes .envoy/loops/<name>.json', () => {
  const tmp = mkTmp();
  run(['confirm', 'mytest'], tmp);
  const stateFile = path.join(tmp, '.envoy', 'loops', 'mytest.json');
  assert.ok(fs.existsSync(stateFile), `expected ${stateFile} to exist`);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.strictEqual(state.loop, 'mytest');
  assert.strictEqual(state.confirmed, 1);
  assert.ok(Array.isArray(state.history));
  assert.ok(state.history.length === 1);
  fs.rmSync(tmp, { recursive: true, force: true });
});

section('CLI: reset clears counter');

test('reset brings counter back to 0 and records reason', () => {
  const tmp = mkTmp();
  run(['confirm', 'l1'], tmp);
  run(['confirm', 'l1'], tmp);
  const resetR = run(['reset', 'l1', '--reason', 'CI re-ran'], tmp);
  assert.strictEqual(resetR.status, 0, `reset exit: ${resetR.status} — ${resetR.stderr}`);
  const statusR = run(['status', 'l1'], tmp);
  assert.strictEqual(statusR.status, 1);
  assert.ok(/0\/3/.test(statusR.stdout));
  const state = JSON.parse(fs.readFileSync(path.join(tmp, '.envoy', 'loops', 'l1.json'), 'utf8'));
  assert.strictEqual(state.confirmed, 0);
  assert.ok(state.history.some(e => e.action === 'reset' && /CI re-ran/.test(e.reason || '')));
  fs.rmSync(tmp, { recursive: true, force: true });
});

section('CLI: max-cycles exceeded → exit 2');

test('exceeding maxCycles blocks confirm with exit 2', () => {
  const tmp = mkTmp();
  // Pre-seed state with maxCycles = 2 and already 2 confirmations happened
  const stateDir = path.join(tmp, '.envoy', 'loops');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, 'bounded.json'),
    JSON.stringify({
      loop: 'bounded',
      confirmed: 0,
      maxCycles: 2,
      cyclesSeen: 2,
      history: [],
    })
  );
  const r = run(['confirm', 'bounded'], tmp);
  assert.strictEqual(r.status, 2, `expected exit 2 on max cycles, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

section('CLI: history subcommand');

test('history prints confirm events in order', () => {
  const tmp = mkTmp();
  run(['confirm', 'h1'], tmp);
  run(['confirm', 'h1'], tmp);
  const r = run(['history', 'h1'], tmp);
  assert.strictEqual(r.status, 0);
  // two entries should appear
  const lines = r.stdout.split('\n').filter(l => l.includes('confirm'));
  assert.ok(lines.length >= 2, `expected 2+ history lines, got: ${r.stdout}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

section('CLI: cleanup removes state');

test('cleanup deletes the loop state file', () => {
  const tmp = mkTmp();
  run(['confirm', 'c1'], tmp);
  const stateFile = path.join(tmp, '.envoy', 'loops', 'c1.json');
  assert.ok(fs.existsSync(stateFile));
  const r = run(['cleanup', 'c1'], tmp);
  assert.strictEqual(r.status, 0);
  assert.ok(!fs.existsSync(stateFile));
  fs.rmSync(tmp, { recursive: true, force: true });
});

section('CLI: unknown subcommand');

test('unknown subcommand exits non-zero with usage', () => {
  const tmp = mkTmp();
  const r = run(['bogus', 'x'], tmp);
  assert.notStrictEqual(r.status, 0);
  assert.ok(/usage|unknown|invalid/i.test(r.stdout + r.stderr));
  fs.rmSync(tmp, { recursive: true, force: true });
});

process.stdout.write(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
