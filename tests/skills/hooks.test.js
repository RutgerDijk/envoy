#!/usr/bin/env node
/**
 * Contract-guard decision tests — evaluateAgentGuard and evaluateStopAudit
 * for rigid skills. These exercise the pure decision logic directly (no
 * process spawning / exit codes); the plugin observe-gate and future
 * strict-mode consume the same functions.
 *
 * Run: node tests/skills/hooks.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO_ROOT = path.join(__dirname, '..', '..');
process.env.ENVOY_REPO_ROOT = REPO_ROOT;

const { evaluateAgentGuard, evaluateStopAudit } = require(path.join(REPO_ROOT, 'lib', 'contract-guard'));

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-test-'));
}

function contractPath(skill) {
  return path.join(REPO_ROOT, 'skills', skill, 'contract.json');
}

section('evaluateAgentGuard: pickup — allows matching implementer prompt');

test('implementer prompt with required tokens is not blocked', () => {
  const event = {
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'general-purpose',
      description: 'Implement Task 1',
      prompt: 'Implement Task 1: add feature\n\nScope Iron Law applies.\nTDD Iron Law applies.',
    },
  };
  const d = evaluateAgentGuard(contractPath('pickup'), event);
  assert.strictEqual(d.block, false, JSON.stringify(d));
});

test('implementer prompt missing TDD Iron Law is blocked', () => {
  const event = {
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'general-purpose',
      description: 'Implement Task 1',
      prompt: 'Implement Task 1: add feature\n\nScope Iron Law applies.\n(missing TDD rule)',
    },
  };
  const d = evaluateAgentGuard(contractPath('pickup'), event);
  assert.strictEqual(d.block, true, JSON.stringify(d));
  assert.ok(/TDD Iron Law/.test(d.reason), d.reason);
});

test('implementer prompt with wrong subagent type is blocked', () => {
  const event = {
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'envoy:code-reviewer',
      description: 'Implement Task 1',
      prompt: 'Implement Task 1: add feature\n\nScope Iron Law, TDD Iron Law.',
    },
  };
  const d = evaluateAgentGuard(contractPath('pickup'), event);
  assert.strictEqual(d.block, true, JSON.stringify(d));
  assert.ok(/subagent_type|subagentType|general-purpose/.test(d.reason), d.reason);
});

test('non-Agent tool calls are not blocked', () => {
  const event = { tool_name: 'Bash', tool_input: { command: 'ls' } };
  const d = evaluateAgentGuard(contractPath('pickup'), event);
  assert.strictEqual(d.block, false, JSON.stringify(d));
});

test('Agent prompt with no matching invariant is not blocked', () => {
  const event = {
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'general-purpose',
      description: 'Random utility task',
      prompt: 'Look up a fact for me — not an implementer prompt',
    },
  };
  const d = evaluateAgentGuard(contractPath('pickup'), event);
  assert.strictEqual(d.block, false, JSON.stringify(d));
});

section('evaluateAgentGuard: review — code-reviewer must read iterative-retrieval');

test('code-reviewer prompt missing iterative-retrieval is blocked', () => {
  const event = {
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'envoy:code-reviewer',
      description: 'AI code review',
      prompt: 'Run AI code review\n\ngit diff main...HEAD\n(retrieval protocol not referenced)',
    },
  };
  const d = evaluateAgentGuard(contractPath('review'), event);
  assert.strictEqual(d.block, true, JSON.stringify(d));
  assert.ok(/iterative-retrieval/.test(d.reason), d.reason);
});

test('code-reviewer prompt with all required tokens is not blocked', () => {
  const event = {
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'envoy:code-reviewer',
      description: 'AI code review',
      prompt: 'Read contexts/iterative-retrieval.md first. Read-only review. Run git diff main...HEAD.',
    },
  };
  const d = evaluateAgentGuard(contractPath('review'), event);
  assert.strictEqual(d.block, false, JSON.stringify(d));
});

section('evaluateStopAudit: pickup — requires session.json and handoff');

test('stop-audit blocks when required artifacts are missing', () => {
  const tmp = mkTmp();
  const d = evaluateStopAudit(contractPath('pickup'), tmp);
  assert.strictEqual(d.block, true, JSON.stringify(d));
  assert.ok(/session\.json|handoff-to-review/.test(d.reason), d.reason);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('stop-audit does not block when all required artifacts exist', () => {
  const tmp = mkTmp();
  fs.mkdirSync(path.join(tmp, '.envoy', 'pickup'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.envoy', 'active-skill.json'), '{}');
  fs.writeFileSync(path.join(tmp, '.envoy', 'pickup', 'session.json'), '{}');
  fs.writeFileSync(path.join(tmp, '.envoy', 'pickup', 'handoff-to-review.json'), '{}');
  const d = evaluateStopAudit(contractPath('pickup'), tmp);
  assert.strictEqual(d.block, false, JSON.stringify(d));
  fs.rmSync(tmp, { recursive: true, force: true });
});

section('evaluateStopAudit: fix-ci — checks loop status via loop-safeguards');

test('stop-audit blocks when fix-ci loop has no confirmation', () => {
  const tmp = mkTmp();
  fs.mkdirSync(path.join(tmp, '.envoy', 'loops'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.envoy', 'active-skill.json'), '{}');
  fs.writeFileSync(path.join(tmp, '.envoy', 'loops', 'fix-ci.json'), JSON.stringify({
    loop: 'fix-ci', confirmed: 1, maxCycles: 3, cyclesSeen: 1, history: [],
  }));
  const d = evaluateStopAudit(contractPath('fix-ci'), tmp);
  assert.strictEqual(d.block, true, JSON.stringify(d));
  assert.ok(/fix-ci|loop|pending/i.test(d.reason), d.reason);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('stop-audit does not block when fix-ci loop reached 3 confirmations', () => {
  const tmp = mkTmp();
  fs.mkdirSync(path.join(tmp, '.envoy', 'loops'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.envoy', 'active-skill.json'), '{}');
  fs.writeFileSync(path.join(tmp, '.envoy', 'loops', 'fix-ci.json'), JSON.stringify({
    loop: 'fix-ci', confirmed: 3, maxCycles: 3, cyclesSeen: 3, history: [],
  }));
  const d = evaluateStopAudit(contractPath('fix-ci'), tmp);
  assert.strictEqual(d.block, false, JSON.stringify(d));
  fs.rmSync(tmp, { recursive: true, force: true });
});

process.stdout.write(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
