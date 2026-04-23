#!/usr/bin/env node
/**
 * Per-skill hook tests — agent-guard and stop-audit for rigid skills.
 *
 * Run: node tests/skills/hooks.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');

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

function runHook(hookScript, cwd, input, env) {
  return spawnSync('node', [hookScript], {
    cwd,
    encoding: 'utf8',
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...process.env, ...env, ENVOY_REPO_ROOT: REPO_ROOT },
  });
}

section('agent-guard: pickup — allows matching implementer prompt');

test('implementer prompt with required tokens passes (exit 0)', () => {
  const tmp = mkTmp();
  const hook = path.join(REPO_ROOT, 'skills', 'pickup', 'hooks', 'agent-guard.js');
  const input = {
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'general-purpose',
      description: 'Implement Task 1',
      prompt: 'Implement Task 1: add feature\n\nScope Iron Law applies.\nTDD Iron Law applies.',
    },
  };
  const r = runHook(hook, tmp, input);
  assert.strictEqual(r.status, 0, `expected 0, got ${r.status}\n${r.stderr}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('implementer prompt missing TDD Iron Law fails (exit 2)', () => {
  const tmp = mkTmp();
  const hook = path.join(REPO_ROOT, 'skills', 'pickup', 'hooks', 'agent-guard.js');
  const input = {
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'general-purpose',
      description: 'Implement Task 1',
      prompt: 'Implement Task 1: add feature\n\nScope Iron Law applies.\n(missing TDD rule)',
    },
  };
  const r = runHook(hook, tmp, input);
  assert.strictEqual(r.status, 2, `expected 2, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.ok(/TDD Iron Law/.test(r.stderr + r.stdout));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('implementer prompt with wrong subagent type fails', () => {
  const tmp = mkTmp();
  const hook = path.join(REPO_ROOT, 'skills', 'pickup', 'hooks', 'agent-guard.js');
  const input = {
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'envoy:code-reviewer',
      description: 'Implement Task 1',
      prompt: 'Implement Task 1: add feature\n\nScope Iron Law, TDD Iron Law.',
    },
  };
  const r = runHook(hook, tmp, input);
  assert.strictEqual(r.status, 2, `expected 2, got ${r.status}`);
  assert.ok(/subagent_type|subagentType|general-purpose/.test(r.stderr + r.stdout));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('non-Agent tool calls pass through without inspection', () => {
  const tmp = mkTmp();
  const hook = path.join(REPO_ROOT, 'skills', 'pickup', 'hooks', 'agent-guard.js');
  const input = { tool_name: 'Bash', tool_input: { command: 'ls' } };
  const r = runHook(hook, tmp, input);
  assert.strictEqual(r.status, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Agent prompt with no matching invariant passes through', () => {
  const tmp = mkTmp();
  const hook = path.join(REPO_ROOT, 'skills', 'pickup', 'hooks', 'agent-guard.js');
  const input = {
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'general-purpose',
      description: 'Random utility task',
      prompt: 'Look up a fact for me — not an implementer prompt',
    },
  };
  const r = runHook(hook, tmp, input);
  assert.strictEqual(r.status, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});

section('agent-guard: review — code-reviewer must read iterative-retrieval');

test('code-reviewer prompt missing iterative-retrieval fails', () => {
  const tmp = mkTmp();
  const hook = path.join(REPO_ROOT, 'skills', 'review', 'hooks', 'agent-guard.js');
  const input = {
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'envoy:code-reviewer',
      description: 'AI code review',
      prompt: 'Run AI code review\n\ngit diff main...HEAD\n(no mention of iterative-retrieval.md)',
    },
  };
  const r = runHook(hook, tmp, input);
  assert.strictEqual(r.status, 2, `expected 2, got ${r.status}\nstdout: ${r.stdout}`);
  assert.ok(/iterative-retrieval/.test(r.stderr + r.stdout));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('code-reviewer prompt with all required tokens passes', () => {
  const tmp = mkTmp();
  const hook = path.join(REPO_ROOT, 'skills', 'review', 'hooks', 'agent-guard.js');
  const input = {
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'envoy:code-reviewer',
      description: 'AI code review',
      prompt: 'Read contexts/iterative-retrieval.md first. Read-only review. Run git diff main...HEAD.',
    },
  };
  const r = runHook(hook, tmp, input);
  assert.strictEqual(r.status, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});

section('stop-audit: pickup — requires session.json and handoff');

test('stop-audit fails when required artifacts are missing', () => {
  const tmp = mkTmp();
  const hook = path.join(REPO_ROOT, 'skills', 'pickup', 'hooks', 'stop-audit.js');
  const r = runHook(hook, tmp, {});
  assert.strictEqual(r.status, 2, `expected 2, got ${r.status}`);
  assert.ok(/session\.json|handoff-to-review/.test(r.stderr + r.stdout));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('stop-audit passes when all required artifacts exist', () => {
  const tmp = mkTmp();
  fs.mkdirSync(path.join(tmp, '.envoy', 'pickup'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.envoy', 'active-skill.json'), '{}');
  fs.writeFileSync(path.join(tmp, '.envoy', 'pickup', 'session.json'), '{}');
  fs.writeFileSync(path.join(tmp, '.envoy', 'pickup', 'handoff-to-review.json'), '{}');
  const hook = path.join(REPO_ROOT, 'skills', 'pickup', 'hooks', 'stop-audit.js');
  const r = runHook(hook, tmp, {});
  assert.strictEqual(r.status, 0, `expected 0, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

section('stop-audit: fix-ci — checks loop status via loop-safeguards');

test('stop-audit exits 2 when fix-ci loop has no confirmation', () => {
  const tmp = mkTmp();
  fs.mkdirSync(path.join(tmp, '.envoy', 'loops'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.envoy', 'active-skill.json'), '{}');
  fs.writeFileSync(path.join(tmp, '.envoy', 'loops', 'fix-ci.json'), JSON.stringify({
    loop: 'fix-ci', confirmed: 1, maxCycles: 3, cyclesSeen: 1, history: [],
  }));
  const hook = path.join(REPO_ROOT, 'skills', 'fix-ci', 'hooks', 'stop-audit.js');
  const r = runHook(hook, tmp, {});
  assert.strictEqual(r.status, 2, `expected 2, got ${r.status}\n${r.stdout}`);
  assert.ok(/fix-ci|loop|pending/i.test(r.stderr + r.stdout));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('stop-audit exits 0 when fix-ci loop reached 3 confirmations', () => {
  const tmp = mkTmp();
  fs.mkdirSync(path.join(tmp, '.envoy', 'loops'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.envoy', 'active-skill.json'), '{}');
  fs.writeFileSync(path.join(tmp, '.envoy', 'loops', 'fix-ci.json'), JSON.stringify({
    loop: 'fix-ci', confirmed: 3, maxCycles: 3, cyclesSeen: 3, history: [],
  }));
  const hook = path.join(REPO_ROOT, 'skills', 'fix-ci', 'hooks', 'stop-audit.js');
  const r = runHook(hook, tmp, {});
  assert.strictEqual(r.status, 0, `expected 0, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

process.stdout.write(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
