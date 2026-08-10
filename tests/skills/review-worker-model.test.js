#!/usr/bin/env node
/**
 * review skill — worker-model dispatch contract tests (#76 task-3).
 *
 * Guards: skills/review/layers/ai-review.md and layers/cleanup.md must no
 * longer hardcode `model: "sonnet"` in their Agent-tool dispatch calls —
 * both must route through lib/model-dispatch.js's dispatch(), keyed off
 * the per-run worker model chosen once in skills/review/SKILL.md (the
 * same session-state field/mechanism task-2 added for pickup —
 * state.workerModel / session.setWorkerModel — reused here, not a second
 * field). Kimi's headless bash path must be handled (descriptor.kind ===
 * 'bash') alongside the Agent-tool path (descriptor.kind === 'agent'),
 * with findings read back from .envoy/agent-output/.
 *
 * Run: node tests/skills/review-worker-model.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..', '..');
const AI_REVIEW = path.join(REPO_ROOT, 'skills', 'review', 'layers', 'ai-review.md');
const CLEANUP = path.join(REPO_ROOT, 'skills', 'review', 'layers', 'cleanup.md');
const SKILL = path.join(REPO_ROOT, 'skills', 'review', 'SKILL.md');

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

const aiReviewMd = fs.readFileSync(AI_REVIEW, 'utf8');
const cleanupMd = fs.readFileSync(CLEANUP, 'utf8');
const skillMd = fs.readFileSync(SKILL, 'utf8');

const HARDCODED_SONNET = /model:\s*["']sonnet["']/;

// ═══════════════════════════════════════════════════════════════════
section('No hardcoded model: "sonnet" remains in review layers');
// ═══════════════════════════════════════════════════════════════════

test('ai-review.md no longer hardcodes model: "sonnet"', () => {
  assert.ok(
    !HARDCODED_SONNET.test(aiReviewMd),
    'layers/ai-review.md must not hardcode model: "sonnet" in its Agent dispatch call'
  );
});

test('cleanup.md no longer hardcodes model: "sonnet"', () => {
  assert.ok(
    !HARDCODED_SONNET.test(cleanupMd),
    'layers/cleanup.md must not hardcode model: "sonnet" in its Agent dispatch call'
  );
});

// ═══════════════════════════════════════════════════════════════════
section('Layers dispatch through lib/model-dispatch.js');
// ═══════════════════════════════════════════════════════════════════

test('ai-review.md requires lib/model-dispatch and calls dispatch()', () => {
  assert.ok(
    /require\(['"]\.\.\/\.\.\/lib\/model-dispatch['"]\)/.test(aiReviewMd),
    'ai-review.md must require ../../lib/model-dispatch'
  );
  assert.ok(
    /dispatch\(\{\s*model:\s*state\.workerModel/.test(aiReviewMd),
    'ai-review.md must call dispatch({ model: state.workerModel, ... })'
  );
});

test('cleanup.md requires lib/model-dispatch and calls dispatch()', () => {
  assert.ok(
    /require\(['"]\.\.\/\.\.\/lib\/model-dispatch['"]\)/.test(cleanupMd),
    'cleanup.md must require ../../lib/model-dispatch'
  );
  assert.ok(
    /dispatch\(\{\s*model:\s*state\.workerModel/.test(cleanupMd),
    'cleanup.md must call dispatch({ model: state.workerModel, ... })'
  );
});

// ═══════════════════════════════════════════════════════════════════
section('Both dispatch kinds are handled (agent + kimi bash headless path)');
// ═══════════════════════════════════════════════════════════════════

test('ai-review.md branches on descriptor.kind and reads .envoy/agent-output on the bash path', () => {
  assert.ok(
    /descriptor\.kind === ['"]agent['"]/.test(aiReviewMd),
    'ai-review.md must branch on the agent-tool dispatch kind'
  );
  assert.ok(
    /descriptor\.kind === ['"]bash['"]|else \{/.test(aiReviewMd),
    'ai-review.md must handle the kimi bash-dispatch kind'
  );
  assert.ok(
    /\.envoy\/agent-output/.test(aiReviewMd),
    'ai-review.md must read findings back from .envoy/agent-output/ for the headless kimi path'
  );
});

test('cleanup.md branches on descriptor.kind and reads .envoy/agent-output on the bash path', () => {
  assert.ok(
    /descriptor\.kind === ['"]agent['"]/.test(cleanupMd),
    'cleanup.md must branch on the agent-tool dispatch kind'
  );
  assert.ok(
    /descriptor\.kind === ['"]bash['"]|else \{/.test(cleanupMd),
    'cleanup.md must handle the kimi bash-dispatch kind'
  );
  assert.ok(
    /\.envoy\/agent-output/.test(cleanupMd),
    'cleanup.md must read findings back from .envoy/agent-output/ for the headless kimi path'
  );
});

test('neither layer builds the kimi shell command by hand (no run_in_background without descriptor.command)', () => {
  for (const [name, md] of [['ai-review.md', aiReviewMd], ['cleanup.md', cleanupMd]]) {
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
section('SKILL.md adds the "ask once, applies to both layers" worker-model step');
// ═══════════════════════════════════════════════════════════════════

test('SKILL.md has a Worker Model Selection step', () => {
  assert.ok(
    /Worker Model Selection/.test(skillMd),
    'SKILL.md must add a Worker Model Selection step (mirroring pickup Step 12.5)'
  );
});

test('SKILL.md reuses session-state\'s workerModel field, not a second field', () => {
  assert.ok(
    /require\(['"]\.\.\/\.\.\/lib\/session-state['"]\)/.test(skillMd),
    'SKILL.md must require ../../lib/session-state'
  );
  assert.ok(
    /state\.workerModel/.test(skillMd),
    'SKILL.md must read/write state.workerModel — the same field task-2 added for pickup'
  );
  assert.ok(
    /session\.setWorkerModel\(/.test(skillMd),
    'SKILL.md must call session.setWorkerModel(), the same setter task-2 added'
  );
  assert.ok(
    !/reviewModel/.test(skillMd),
    'SKILL.md must not invent a second field (e.g. reviewModel) for the same concept'
  );
});

test('SKILL.md does not re-ask when state.workerModel is already set (resume check)', () => {
  assert.ok(
    /if\s*\(\s*state\.workerModel\s*\)/.test(skillMd),
    'SKILL.md must guard the AskUserQuestion prompt behind `if (state.workerModel)` so a resumed/inherited choice is reused, not re-asked'
  );
});

test('SKILL.md offers kimi via checkKimi() with "needs setup" fallback label', () => {
  assert.ok(
    /checkKimi\(/.test(skillMd),
    'SKILL.md must call checkKimi() from lib/model-dispatch.js to compute the kimi menu label'
  );
  assert.ok(
    /needs setup/.test(skillMd),
    'SKILL.md must offer the "Kimi (needs setup)" label when kimi is not yet configured'
  );
});

test('SKILL.md states the prompt runs once and applies to both AI layers', () => {
  assert.ok(
    /ai-review[\s\S]{0,120}cleanup|cleanup[\s\S]{0,120}ai-review|both.{0,40}layers|Layer 0\.5.{0,60}Layer 1|Layer 1.{0,60}Layer 0\.5/i.test(skillMd),
    'SKILL.md must state the worker-model prompt applies to both the cleanup and ai-review layers'
  );
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
