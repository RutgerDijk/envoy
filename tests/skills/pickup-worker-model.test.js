#!/usr/bin/env node
/**
 * pickup skill — worker-model dispatch contract tests (#76 task-2).
 *
 * The mirror of tests/skills/review-worker-model.test.js, for the other
 * half of the feature. skills/pickup/steps/tdd.md (Step 12.5 selection,
 * Step 13 dispatch) and steps/prompts.md (the implementer prompt) must:
 *
 *   - choose the worker model ONCE per run, persisted via session-state's
 *     workerModel field, and never re-ask on resume;
 *   - label the kimi menu option from the OFFLINE isKimiConfigured()
 *     check, so a run that never selects kimi produces no Moonshot
 *     traffic (task-2 acceptance), probing only on actual selection;
 *   - route dispatch through lib/model-dispatch.js rather than naming a
 *     model literal, handling both descriptor kinds;
 *   - bound the worker's tool surface via allowedTools; and
 *   - wait for the headless process to exit before reading its report.
 *
 * These are content contracts over executable markdown — the same
 * enforcement style review-worker-model.test.js uses, so a future edit
 * that silently re-hardcodes a model or drops the kimi branch fails CI.
 *
 * Run: node tests/skills/pickup-worker-model.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..', '..');
const TDD = path.join(REPO_ROOT, 'skills', 'pickup', 'steps', 'tdd.md');
const PROMPTS = path.join(REPO_ROOT, 'skills', 'pickup', 'steps', 'prompts.md');

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

const tddMd = fs.readFileSync(TDD, 'utf8');
const promptsMd = fs.readFileSync(PROMPTS, 'utf8');

const HARDCODED_MODEL = /model:\s*["'](sonnet|opus|haiku|fable)["']/;

// ═══════════════════════════════════════════════════════════════════
section('No hardcoded model literal in pickup dispatch');
// ═══════════════════════════════════════════════════════════════════

test('tdd.md does not hardcode a model literal', () => {
  assert.ok(!HARDCODED_MODEL.test(tddMd), 'tdd.md must not name a model literal — the model comes from state.workerModel');
});

test('prompts.md does not hardcode a model literal', () => {
  assert.ok(!HARDCODED_MODEL.test(promptsMd), 'prompts.md must not name a model literal — the model comes from state.workerModel');
});

// ═══════════════════════════════════════════════════════════════════
section('Pickup dispatches through lib/model-dispatch.js');
// ═══════════════════════════════════════════════════════════════════

test('prompts.md requires lib/model-dispatch and calls dispatch()', () => {
  assert.ok(
    /require\(['"]\.\.\/\.\.\/lib\/model-dispatch['"]\)/.test(promptsMd),
    'prompts.md must require ../../lib/model-dispatch'
  );
  assert.ok(
    /dispatch\(\{[\s\S]{0,120}model:\s*state\.workerModel/.test(promptsMd),
    'prompts.md must call dispatch({ model: state.workerModel, ... })'
  );
});

test('tdd.md Step 13 routes the implementer through dispatch()', () => {
  assert.ok(/model-dispatch/.test(tddMd), 'tdd.md must reference lib/model-dispatch.js');
  assert.ok(
    /dispatch\(\{[\s\S]{0,120}model:\s*state\.workerModel/.test(tddMd),
    'tdd.md must show dispatch({ model: state.workerModel, ... }) as the dispatch call'
  );
});

// ═══════════════════════════════════════════════════════════════════
section('Both dispatch kinds are handled (agent + kimi bash headless path)');
// ═══════════════════════════════════════════════════════════════════

test('prompts.md branches on descriptor.kind and reads .envoy/agent-output on the bash path', () => {
  assert.ok(/descriptor\.kind === ['"]agent['"]/.test(promptsMd), 'prompts.md must branch on the agent-tool dispatch kind');
  assert.ok(/descriptor\.kind === ['"]bash['"]|else \{/.test(promptsMd), 'prompts.md must handle the kimi bash-dispatch kind');
  assert.ok(/\.envoy\/agent-output/.test(promptsMd), 'prompts.md must read the report back from .envoy/agent-output/ on the headless path');
});

test('tdd.md documents both dispatch kinds for Step 13', () => {
  assert.ok(/descriptor\.kind === ['"]agent['"]/.test(tddMd), 'tdd.md must describe the agent-tool dispatch kind');
  assert.ok(/descriptor\.kind === ['"]bash['"]/.test(tddMd), 'tdd.md must describe the kimi bash-dispatch kind');
});

test('pickup never builds the kimi shell command by hand', () => {
  for (const [name, md] of [['tdd.md', tddMd], ['prompts.md', promptsMd]]) {
    const bashCalls = md.match(/Bash\(\{[\s\S]*?\}\)/g) || [];
    for (const call of bashCalls) {
      assert.ok(
        /command:\s*descriptor\.command/.test(call),
        `${name}: Bash({...}) dispatch must use descriptor.command, never a hand-built string`
      );
    }
  }
});

// ═══════════════════════════════════════════════════════════════════
section('Kimi workers are tool-scoped by the command, not just by prompt text');
// ═══════════════════════════════════════════════════════════════════

test('prompts.md declares a write-capable allowedTools surface for implementers', () => {
  const match = promptsMd.match(/allowedTools:\s*\[([^\]]*)\]/);
  assert.ok(match, 'prompts.md must pass allowedTools to dispatch() — omitting it silently downgrades the kimi worker to a prompt-only restriction');
  const tools = match[1].split(',').map((t) => t.trim().replace(/['"]/g, '')).filter(Boolean);
  for (const needed of ['Read', 'Edit', 'Write', 'Bash']) {
    assert.ok(tools.includes(needed), `an implementer writes code and commits, so it needs ${needed}`);
  }
});

test('tdd.md instructs Step 13 to always name allowedTools', () => {
  assert.ok(/allowedTools/.test(tddMd), 'tdd.md Step 13 must tell the orchestrator to pass allowedTools');
});

// ═══════════════════════════════════════════════════════════════════
section('The headless path waits for process exit before reading output');
// ═══════════════════════════════════════════════════════════════════

test('both files name a concrete completion signal for the background process', () => {
  for (const [name, md] of [['tdd.md', tddMd], ['prompts.md', promptsMd]]) {
    assert.ok(
      /BashOutput|Monitor/.test(md),
      `${name}: the kimi path must name a concrete completion signal (BashOutput/Monitor), not just "once the process exits" — the output file is written incrementally`
    );
    assert.ok(
      /truncat/i.test(md),
      `${name}: must state why an early read is wrong (truncated report)`
    );
  }
});

// ═══════════════════════════════════════════════════════════════════
section('Step 12.5 asks once, persists, and never re-asks on resume');
// ═══════════════════════════════════════════════════════════════════

test('tdd.md has a Worker Model Selection step before dispatch', () => {
  assert.ok(/Worker Model Selection/.test(tddMd), 'tdd.md must add a Worker Model Selection step');
  assert.ok(
    tddMd.indexOf('Worker Model Selection') < tddMd.indexOf('Step 13: Execute Tasks'),
    'the selection step must come before Step 13 dispatches anything'
  );
});

test('tdd.md persists the choice via session-state.setWorkerModel', () => {
  assert.ok(
    /require\(['"]\.\.\/\.\.\/lib\/session-state['"]\)/.test(tddMd),
    'tdd.md must require ../../lib/session-state'
  );
  assert.ok(/session\.setWorkerModel\(/.test(tddMd), 'tdd.md must call session.setWorkerModel()');
  assert.ok(/state\.workerModel/.test(tddMd), 'tdd.md must read/write state.workerModel');
});

test('tdd.md does not re-ask when state.workerModel is already set (resume check)', () => {
  assert.ok(
    /if\s*\(\s*state\.workerModel\s*\)/.test(tddMd),
    'tdd.md must guard the AskUserQuestion prompt behind `if (state.workerModel)` so a resumed choice is reused, not re-asked'
  );
});

test('tdd.md offers every model option including kimi', () => {
  for (const tier of ['fable', 'opus', 'sonnet', 'haiku', 'kimi']) {
    assert.ok(new RegExp(`\`${tier}\``).test(tddMd), `tdd.md's menu must offer ${tier}`);
  }
});

// ═══════════════════════════════════════════════════════════════════
section('Opening the menu produces no Moonshot traffic');
// ═══════════════════════════════════════════════════════════════════

test('tdd.md labels the kimi option from the offline isKimiConfigured() check', () => {
  assert.ok(
    /isKimiConfigured\(/.test(tddMd),
    'tdd.md must label the kimi option from isKimiConfigured() — the offline check — so a run that never selects kimi reaches Moonshot zero times'
  );
  assert.ok(/needs setup/.test(tddMd), 'tdd.md must offer the "Kimi (needs setup)" label when kimi is unconfigured');
});

test('tdd.md still probes with checkKimi() when kimi is actually selected', () => {
  assert.ok(/checkKimi\(/.test(tddMd), 'tdd.md must call checkKimi() on selection — a revoked key must surface at selection time');
});

test('tdd.md states the label path makes no network call', () => {
  const menuSection = tddMd.slice(
    tddMd.indexOf('Ask once, kimi is opt-in'),
    tddMd.indexOf('Persist the choice'),
  );
  assert.ok(menuSection.length > 0, 'expected the worker-model menu section in tdd.md');
  assert.ok(
    /no network call/i.test(menuSection),
    'tdd.md must state that computing the menu label makes no network call — the acceptance criterion is zero Moonshot traffic for runs that never select kimi'
  );
});

// ═══════════════════════════════════════════════════════════════════
section('The prompt itself is model-independent');
// ═══════════════════════════════════════════════════════════════════

test('prompts.md states the prompt text is identical across worker models', () => {
  assert.ok(
    /identical regardless of which worker model|identical\s+text whether/i.test(promptsMd),
    'prompts.md must state the TDD/scope laws and prompt template are unchanged by the model choice'
  );
});

test('the TDD and scope laws are still injected into the implementer prompt', () => {
  for (const law of ['${EXECUTION_ANNOUNCE}', '${SCOPE_LAW}', '${TDD_LAW}', '${BLOCKER_PROTOCOL}']) {
    assert.ok(promptsMd.includes(law), `prompts.md must still inject ${law} — the model choice must not weaken discipline`);
  }
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
