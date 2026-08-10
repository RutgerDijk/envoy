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
section('Kimi workers are tool-scoped by the command, not just by prompt text');
// ═══════════════════════════════════════════════════════════════════

test('ai-review.md declares a read-only allowedTools surface', () => {
  const match = aiReviewMd.match(/allowedTools:\s*\[([^\]]*)\]/);
  assert.ok(match, 'ai-review.md must pass allowedTools to dispatch() — omitting it silently downgrades the kimi worker to a prompt-only restriction');
  const tools = match[1].split(',').map((t) => t.trim().replace(/['"]/g, '')).filter(Boolean);
  assert.deepStrictEqual(tools, ['Read', 'Grep', 'Glob'], 'Layer 1 is a read-only review');
});

test('cleanup.md declares a write-capable allowedTools surface', () => {
  const match = cleanupMd.match(/allowedTools:\s*\[([^\]]*)\]/);
  assert.ok(match, 'cleanup.md must pass allowedTools to dispatch()');
  const tools = match[1].split(',').map((t) => t.trim().replace(/['"]/g, '')).filter(Boolean);
  for (const needed of ['Read', 'Edit', 'Write', 'Bash']) {
    assert.ok(tools.includes(needed), `cleanup edits and commits, so it needs ${needed}`);
  }
});

// ═══════════════════════════════════════════════════════════════════
section('The headless path waits for process exit before reading output');
// ═══════════════════════════════════════════════════════════════════

test('both layers tell the orchestrator how to detect the background process finished', () => {
  for (const [name, md] of [['ai-review.md', aiReviewMd], ['cleanup.md', cleanupMd]]) {
    assert.ok(
      /BashOutput|Monitor/.test(md),
      `${name}: the kimi path must name a concrete completion signal (BashOutput/Monitor), not just "once the process exits" — the output file is written incrementally`
    );
    assert.ok(
      /truncat/i.test(md),
      `${name}: must state why an early read is wrong (truncated output)`
    );
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

test('SKILL.md offers kimi with a "needs setup" fallback label', () => {
  assert.ok(
    /isKimiConfigured\(/.test(skillMd),
    'SKILL.md must label the kimi option from isKimiConfigured() — the offline check — so merely opening the menu never reaches Moonshot'
  );
  assert.ok(
    /checkKimi\(/.test(skillMd),
    'SKILL.md must still probe with checkKimi() when kimi is actually selected'
  );
  assert.ok(
    /needs setup/.test(skillMd),
    'SKILL.md must offer the "Kimi (needs setup)" label when kimi is not yet configured'
  );
});

test('SKILL.md keeps the network probe out of the menu-label path', () => {
  const menuSection = skillMd.slice(
    skillMd.indexOf('Ask once, kimi is opt-in'),
    skillMd.indexOf('Persist the choice'),
  );
  assert.ok(menuSection.length > 0, 'expected the worker-model menu section in SKILL.md');
  assert.ok(
    /no network call/i.test(menuSection),
    'SKILL.md must state that computing the menu label makes no network call — the acceptance criterion is zero Moonshot traffic for runs that never select kimi'
  );
});

test('SKILL.md states the prompt runs once and applies to both AI layers', () => {
  assert.ok(
    /ai-review[\s\S]{0,120}cleanup|cleanup[\s\S]{0,120}ai-review|both.{0,40}layers|Layer 0\.5.{0,60}Layer 1|Layer 1.{0,60}Layer 0\.5/i.test(skillMd),
    'SKILL.md must state the worker-model prompt applies to both the cleanup and ai-review layers'
  );
});

// ═══════════════════════════════════════════════════════════════════
section('AskUserQuestion respects the 4-option cap (two-step menu)');
// ═══════════════════════════════════════════════════════════════════

function extractSection(md, startMarker, endMarker) {
  const start = md.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}"`);
  const end = md.indexOf(endMarker, start);
  assert.ok(end !== -1, `expected to find "${endMarker}" after "${startMarker}"`);
  return md.slice(start, end);
}

function extractOptionTables(md) {
  const lines = md.split('\n');
  const tables = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const isHeaderLike = /^\s*\|.+\|\s*$/.test(lines[i]);
    const isSeparator = /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1]) && /-/.test(lines[i + 1]);
    if (isHeaderLike && isSeparator && /option/i.test(lines[i])) {
      let j = i + 2;
      const rows = [];
      while (j < lines.length && /^\s*\|.+\|\s*$/.test(lines[j])) {
        rows.push(lines[j]);
        j++;
      }
      tables.push({ header: lines[i], rows });
    }
  }
  return tables;
}

test('SKILL.md never lists more than 4 rows in a single AskUserQuestion option table', () => {
  const section = extractSection(skillMd, '### 6. Worker Model Selection', '## Layers');
  const tables = extractOptionTables(section);
  assert.ok(tables.length > 0, 'expected at least one Option/Label table in the Worker Model Selection step');
  for (const t of tables) {
    assert.ok(
      t.rows.length <= 4,
      `AskUserQuestion's options array caps at maxItems: 4 (min 2) — found a table with ${t.rows.length} option rows: ${t.header}`
    );
  }
});

test('SKILL.md structures selection as two AskUserQuestion calls: Anthropic-tier-vs-Kimi, then a 4-option tier pick', () => {
  const section = extractSection(skillMd, '### 6. Worker Model Selection', '## Layers');
  const tables = extractOptionTables(section);

  const decisionTable = tables.find(
    (t) => t.rows.length === 2 && /kimi/i.test(t.rows.join('\n')) && /anthropic/i.test(t.rows.join('\n'))
  );
  assert.ok(
    decisionTable,
    'expected a 2-option AskUserQuestion table deciding between an Anthropic tier and Kimi (Step 1)'
  );

  const tierTable = tables.find(
    (t) =>
      t.rows.length === 4 &&
      ['fable', 'opus', 'sonnet', 'haiku'].every((tier) => new RegExp('`' + tier + '`').test(t.rows.join('\n')))
  );
  assert.ok(
    tierTable,
    'expected a 4-option AskUserQuestion table listing fable/opus/sonnet/haiku, with kimi promoted out of it (Step 2)'
  );
  assert.ok(
    !/kimi/i.test(tierTable.rows.join('\n')),
    'the 4-option tier table must not also include kimi — that would be back to 5 options'
  );
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
