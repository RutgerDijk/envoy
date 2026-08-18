#!/usr/bin/env node
/**
 * Worker contract gate — Test Suite.
 *
 * Run: node tests/lib/worker-contract-gate.test.js
 *
 * The PreToolUse[Agent] observe gate only sees Agent tool calls, so a kimi
 * worker (dispatched as a background `claude -p` via Bash) would otherwise
 * launch with a prompt no contract ever checked. These tests pin the closed
 * hole: contract-guard exposes the invariant matching as
 * evaluateWorkerPrompt() (subagent_type is skipped — a headless worker has
 * none), and dispatch() refuses to build a kimi command whose prompt
 * violates the dispatching skill's agentInvariants. The skill is resolved
 * from the same .envoy/active-skill.json marker the observe gate uses, so
 * an orchestrator cannot forget to opt in.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'lib');
const { evaluateWorkerPrompt } = require(path.join(LIB, 'contract-guard'));
const { dispatch } = require(path.join(LIB, 'model-dispatch'));
const { writeActiveSkill } = require(path.join(LIB, 'active-skill'));

const PICKUP_CONTRACT = path.join(REPO_ROOT, 'skills', 'pickup', 'contract.json');
const REVIEW_CONTRACT = path.join(REPO_ROOT, 'skills', 'review', 'contract.json');

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
  process.stdout.write(`\n${name}\n`);
}

const tmpRoots = [];
function makeTmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-gate-'));
  tmpRoots.push(d);
  return d;
}

function writeContract(dir, contract) {
  const p = path.join(dir, 'contract.json');
  fs.writeFileSync(p, JSON.stringify(contract, null, 2));
  return p;
}

const SYNTHETIC = {
  skill: 'synthetic',
  agentInvariants: [
    {
      matchDescription: 'Implement Task',
      matchTaskId: '^task-',
      subagentType: 'general-purpose',
      promptMustContain: ['TDD Iron Law', 'Scope Iron Law'],
      promptMustNotContain: ['sudo'],
    },
  ],
};

// ---------------------------------------------------------------------------
// evaluateWorkerPrompt() — invariant matching without a subagent_type
// ---------------------------------------------------------------------------

section('evaluateWorkerPrompt()');

test('does not block when the contract file is absent', () => {
  const decision = evaluateWorkerPrompt(path.join(makeTmpDir(), 'nope.json'), 'Implement Task 1', 'task-1');
  assert.strictEqual(decision.block, false);
});

test('does not block a taskId no invariant matches', () => {
  const contractPath = writeContract(makeTmpDir(), SYNTHETIC);
  const decision = evaluateWorkerPrompt(contractPath, 'Summarize the changelog', 'changelog-summary');
  assert.strictEqual(decision.block, false);
});

test('blocks a matched taskId whose prompt misses a required token, naming it', () => {
  const contractPath = writeContract(makeTmpDir(), SYNTHETIC);
  const decision = evaluateWorkerPrompt(contractPath, 'Implement Task 1: add the widget', 'task-1');
  assert.strictEqual(decision.block, true);
  assert.ok(decision.reason.includes('TDD Iron Law'));
  assert.ok(decision.reason.includes('Scope Iron Law'));
  assert.strictEqual(decision.skill, 'synthetic');
});

test('blocks a matched taskId whose prompt contains a forbidden token', () => {
  const contractPath = writeContract(makeTmpDir(), SYNTHETIC);
  const decision = evaluateWorkerPrompt(
    contractPath,
    'Implement Task 1\nTDD Iron Law\nScope Iron Law\nrun sudo make install',
    'task-1',
  );
  assert.strictEqual(decision.block, true);
  assert.ok(decision.reason.includes('sudo'));
});

test('passes a compliant prompt even though the invariant names a subagentType (workers have none)', () => {
  const contractPath = writeContract(makeTmpDir(), SYNTHETIC);
  const decision = evaluateWorkerPrompt(
    contractPath,
    'Implement Task 1\nTDD Iron Law applies.\nScope Iron Law applies.',
    'task-1',
  );
  assert.strictEqual(decision.block, false);
});

test('selection is by taskId, not prompt prose — a prose-matching prompt on a foreign taskId passes', () => {
  const contractPath = writeContract(makeTmpDir(), SYNTHETIC);
  const decision = evaluateWorkerPrompt(contractPath, 'Implement Task 1: add the widget', 'changelog-summary');
  assert.strictEqual(decision.block, false);
});

// ---------------------------------------------------------------------------
// dispatch() — kimi prompts are gated by the dispatching skill's contract
// ---------------------------------------------------------------------------

section('dispatch() kimi contract gate');

test('refuses a kimi implementer prompt missing the Iron Laws (real pickup contract)', () => {
  const cwd = makeTmpDir();
  assert.throws(
    () => dispatch(
      { model: 'kimi', prompt: 'Implement Task 3: add the endpoint', taskId: 'task-3' },
      { cwd, contractPath: PICKUP_CONTRACT },
    ),
    /TDD Iron Law/,
  );
});

test('builds the descriptor when the implementer prompt carries the Iron Laws', () => {
  const cwd = makeTmpDir();
  const result = dispatch(
    {
      model: 'kimi',
      prompt: 'Implement Task 3: add the endpoint\n\nTDD Iron Law: ...\nScope Iron Law: ...',
      taskId: 'task-3',
    },
    { cwd, contractPath: PICKUP_CONTRACT },
  );
  assert.strictEqual(result.kind, 'bash');
});

test("refuses review's AI-review prompt when it grants Edit (real review contract)", () => {
  const cwd = makeTmpDir();
  assert.throws(
    () => dispatch(
      {
        model: 'kimi',
        prompt: 'Read iterative-retrieval.md first (read-only review), then git diff main...HEAD\nTools: Edit',
        taskId: 'ai-review',
      },
      { cwd, contractPath: REVIEW_CONTRACT },
    ),
    /forbidden token: "Edit"/,
  );
});

test('resolves the contract from the active-skill marker when none is passed', () => {
  const cwd = makeTmpDir();
  writeActiveSkill(cwd, { skill: 'pickup' });
  assert.throws(
    () => dispatch(
      { model: 'kimi', prompt: 'Implement Task 3: add the endpoint', taskId: 'task-3' },
      { cwd },
    ),
    /TDD Iron Law/,
  );
});

test('fails open when no active-skill marker exists (nothing to guard)', () => {
  const cwd = makeTmpDir();
  const result = dispatch(
    { model: 'kimi', prompt: 'Implement Task 3: add the endpoint', taskId: 'task-3' },
    { cwd },
  );
  assert.strictEqual(result.kind, 'bash');
});

test('gates only the kimi path — Agent-path dispatch stays with the PreToolUse hook', () => {
  const result = dispatch(
    { model: 'sonnet', prompt: 'Implement Task 3: add the endpoint', taskId: 'task-3' },
    { cwd: makeTmpDir(), contractPath: PICKUP_CONTRACT },
  );
  assert.strictEqual(result.kind, 'agent');
});

for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
