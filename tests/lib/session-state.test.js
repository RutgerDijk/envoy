#!/usr/bin/env node
/**
 * session-state — Test Suite (worker-model persistence).
 *
 * Run: node tests/lib/session-state.test.js
 *
 * Backs per-step worker model selection in pickup (#76): the model chosen
 * at Step 12.5 (fable/opus/sonnet/haiku/kimi) must survive a save() ->
 * load() round trip so a resumed session (after compaction or restart)
 * does not re-prompt. Only the workerModel surface is covered here —
 * the rest of session-state.js already has coverage in
 * tests/envoy-2.1.test.js.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const LIB = path.join(__dirname, '..', '..', 'lib');

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

function makeTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

const session = require(path.join(LIB, 'session-state'));

// ═══════════════════════════════════════════════════════════════════
// exports
// ═══════════════════════════════════════════════════════════════════

section('exports');

test('setWorkerModel is exported', () => {
  assert.strictEqual(typeof session.setWorkerModel, 'function');
});

// ═══════════════════════════════════════════════════════════════════
// createEmpty()
// ═══════════════════════════════════════════════════════════════════

section('createEmpty(): workerModel defaults to null');

test('a fresh session has no worker model chosen yet', () => {
  const state = session.createEmpty();
  assert.strictEqual(state.workerModel, null);
});

// ═══════════════════════════════════════════════════════════════════
// setWorkerModel()
// ═══════════════════════════════════════════════════════════════════

section('setWorkerModel(): records the choice on state');

test('sets workerModel to an Anthropic tier', () => {
  const state = session.createEmpty();
  session.setWorkerModel(state, 'sonnet');
  assert.strictEqual(state.workerModel, 'sonnet');
});

test('overwrites a previously chosen worker model', () => {
  const state = session.createEmpty();
  session.setWorkerModel(state, 'haiku');
  session.setWorkerModel(state, 'opus');
  assert.strictEqual(state.workerModel, 'opus');
});

test('does not touch any other field on state', () => {
  const state = session.createEmpty();
  session.updateTask(state, 'task-1', 'pending');
  session.setWorkerModel(state, 'fable');
  assert.strictEqual(state.tasks.length, 1);
  assert.strictEqual(state.tasks[0].id, 'task-1');
});

// ═══════════════════════════════════════════════════════════════════
// persistence: save() -> load() round trip
// ═══════════════════════════════════════════════════════════════════

section('persistence: workerModel survives save() -> load()');

test('a chosen worker model is read back after save/load', () => {
  const dir = makeTmp('session-state-model-');
  const state = session.createEmpty();
  session.setWorkerModel(state, 'kimi');
  session.save(state, dir);

  const loaded = session.load(dir);
  assert.strictEqual(loaded.workerModel, 'kimi');
  cleanup(dir);
});

test('a session file predating workerModel loads without throwing (backward compat)', () => {
  const dir = makeTmp('session-state-model-');
  const legacy = {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    branch: 'feature/legacy',
    plan: null,
    tasks: [],
    decisions: [],
    filesModified: [],
    testResults: null,
    nextSteps: [],
  };
  fs.writeFileSync(path.join(dir, '.envoy-session.json'), JSON.stringify(legacy), 'utf8');

  const loaded = session.load(dir);
  assert.strictEqual(loaded.branch, 'feature/legacy');
  assert.strictEqual(loaded.workerModel, undefined);
  cleanup(dir);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
