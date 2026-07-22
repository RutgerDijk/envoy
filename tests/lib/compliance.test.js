#!/usr/bin/env node
/**
 * ABOUTME: Tests the per-PR skill-compliance trail (lib/compliance.js): pure
 * ABOUTME: buildTrail/renderTrail over fixtures + compliance(dir) IO over temp dirs.
 *
 * Run: node tests/lib/compliance.test.js
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

function writeLines(dir, rel, lines) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
}

const compliance = require(path.join(LIB, 'compliance'));

// Fixtures ──────────────────────────────────────────────────────────

function fullFlowLedger() {
  const b = 'feature/41-compliance';
  return [
    { ts: '2026-07-21T10:00:00.000Z', branch: b, issue: 41, type: 'skill-started', skill: 'pickup' },
    { ts: '2026-07-21T10:30:00.000Z', branch: b, issue: 41, type: 'handoff-written', from: 'pickup', to: 'review' },
    { ts: '2026-07-21T11:00:00.000Z', branch: b, issue: 41, type: 'skill-started', skill: 'review' },
    { ts: '2026-07-21T11:30:00.000Z', branch: b, issue: 41, type: 'handoff-written', from: 'review', to: 'finalize' },
    { ts: '2026-07-21T12:00:00.000Z', branch: b, issue: 41, type: 'skill-started', skill: 'finalize' },
    { ts: '2026-07-21T13:00:00.000Z', branch: b, issue: 41, type: 'skill-started', skill: 'cleanup' },
  ];
}

// ═══════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════

section('exports');

test('buildTrail is exported', () => {
  assert.strictEqual(typeof compliance.buildTrail, 'function');
});

test('renderTrail is exported', () => {
  assert.strictEqual(typeof compliance.renderTrail, 'function');
});

test('compliance is exported', () => {
  assert.strictEqual(typeof compliance.compliance, 'function');
});

// ═══════════════════════════════════════════════════════════════════
// buildTrail — pure, over already-parsed arrays
// ═══════════════════════════════════════════════════════════════════

section('buildTrail: full flow → all rigid steps ran');

test('marks pickup/review/finalize/cleanup ran with their ts', () => {
  const m = compliance.buildTrail({ ledger: fullFlowLedger(), observeLog: [] });
  const byName = Object.fromEntries(m.steps.map((s) => [s.skill, s]));
  assert.strictEqual(byName.pickup.ran, true);
  assert.strictEqual(byName.pickup.ts, '2026-07-21T10:00:00.000Z');
  assert.strictEqual(byName.review.ran, true);
  assert.strictEqual(byName.finalize.ran, true);
  assert.strictEqual(byName.cleanup.ran, true);
});

test('carries branch + issue label from ledger events', () => {
  const m = compliance.buildTrail({ ledger: fullFlowLedger(), observeLog: [] });
  assert.strictEqual(m.branch, 'feature/41-compliance');
  assert.strictEqual(m.issue, 41);
});

test('surfaces handoffs from handoff-written events', () => {
  const m = compliance.buildTrail({ ledger: fullFlowLedger(), observeLog: [] });
  assert.strictEqual(m.handoffs.length, 2);
  assert.deepStrictEqual(
    m.handoffs.map((h) => `${h.from}->${h.to}`),
    ['pickup->review', 'review->finalize']
  );
});

test('not empty when events present', () => {
  const m = compliance.buildTrail({ ledger: fullFlowLedger(), observeLog: [] });
  assert.strictEqual(m.empty, false);
});

section('buildTrail: skipped-step flow');

test('marks finalize + cleanup skipped when no skill-started for them', () => {
  const ledger = fullFlowLedger().filter(
    (e) => !(e.type === 'skill-started' && (e.skill === 'finalize' || e.skill === 'cleanup'))
  );
  const m = compliance.buildTrail({ ledger, observeLog: [] });
  const byName = Object.fromEntries(m.steps.map((s) => [s.skill, s]));
  assert.strictEqual(byName.pickup.ran, true);
  assert.strictEqual(byName.review.ran, true);
  assert.strictEqual(byName.finalize.ran, false);
  assert.strictEqual(byName.finalize.ts, null);
  assert.strictEqual(byName.cleanup.ran, false);
});

section('buildTrail: brainstorm only surfaced when present');

test('brainstorm absent from steps when no skill-started for it', () => {
  const m = compliance.buildTrail({ ledger: fullFlowLedger(), observeLog: [] });
  assert.ok(!m.steps.some((s) => s.skill === 'brainstorm'));
});

test('brainstorm surfaced (ran) when a skill-started exists', () => {
  const ledger = [
    { ts: '2026-07-21T09:00:00.000Z', branch: 'b', type: 'skill-started', skill: 'brainstorm' },
    ...fullFlowLedger(),
  ];
  const m = compliance.buildTrail({ ledger, observeLog: [] });
  const brainstorm = m.steps.find((s) => s.skill === 'brainstorm');
  assert.ok(brainstorm, 'brainstorm step should be present');
  assert.strictEqual(brainstorm.ran, true);
});

// ═══════════════════════════════════════════════════════════════════
// buildTrail — gate overrides (false-positive evidence)
// ═══════════════════════════════════════════════════════════════════

section('buildTrail: override + would-block counts');

test('counts override records and plain would-block events separately', () => {
  const observeLog = [
    { ts: '2026-07-21T11:10:00.000Z', skill: 'review', gate: 'stop-audit', reason: 'unmet' },
    { kind: 'override', ts: '2026-07-21T11:10:00.000Z', skill: 'review', gate: 'stop-audit', reason: 'unmet' },
    { ts: '2026-07-21T11:20:00.000Z', skill: 'pickup', gate: 'agent-guard', reason: 'guard', tool: 'Agent' },
  ];
  const m = compliance.buildTrail({ ledger: fullFlowLedger(), observeLog });
  assert.strictEqual(m.overrides, 1);
  assert.strictEqual(m.wouldBlock, 2);
});

test('zero overrides + zero would-block on empty observe-log', () => {
  const m = compliance.buildTrail({ ledger: fullFlowLedger(), observeLog: [] });
  assert.strictEqual(m.overrides, 0);
  assert.strictEqual(m.wouldBlock, 0);
});

// ═══════════════════════════════════════════════════════════════════
// buildTrail — hotfix as sanctioned fast-path
// ═══════════════════════════════════════════════════════════════════

section('buildTrail: hotfix sanctioned fast-path');

test('flags hotfix as ran when a hotfix skill-started exists', () => {
  const ledger = [
    { ts: '2026-07-22T08:00:00.000Z', branch: 'hotfix/99-crash', issue: 99, type: 'skill-started', skill: 'hotfix' },
  ];
  const m = compliance.buildTrail({ ledger, observeLog: [] });
  assert.ok(m.hotfix, 'hotfix should be present');
  assert.strictEqual(m.hotfix.ran, true);
  assert.strictEqual(m.hotfix.ts, '2026-07-22T08:00:00.000Z');
});

test('hotfix null when no hotfix activity', () => {
  const m = compliance.buildTrail({ ledger: fullFlowLedger(), observeLog: [] });
  assert.strictEqual(m.hotfix, null);
});

test('review/brainstorm skips marked sanctioned when hotfix ran', () => {
  const ledger = [
    { ts: '2026-07-22T08:00:00.000Z', branch: 'hotfix/99-crash', issue: 99, type: 'skill-started', skill: 'hotfix' },
  ];
  const m = compliance.buildTrail({ ledger, observeLog: [] });
  const review = m.steps.find((s) => s.skill === 'review');
  assert.strictEqual(review.ran, false);
  assert.strictEqual(review.sanctionedSkip, true);
});

test('review skip NOT sanctioned when hotfix did not run', () => {
  const ledger = fullFlowLedger().filter((e) => !(e.type === 'skill-started' && e.skill === 'review'));
  const m = compliance.buildTrail({ ledger, observeLog: [] });
  const review = m.steps.find((s) => s.skill === 'review');
  assert.strictEqual(review.ran, false);
  assert.ok(!review.sanctionedSkip);
});

// ═══════════════════════════════════════════════════════════════════
// buildTrail — empty
// ═══════════════════════════════════════════════════════════════════

section('buildTrail: empty inputs');

test('empty flag true, no branch/issue, when both inputs empty', () => {
  const m = compliance.buildTrail({ ledger: [], observeLog: [] });
  assert.strictEqual(m.empty, true);
  assert.strictEqual(m.branch, null);
  assert.strictEqual(m.issue, null);
});

test('does not throw when called with no argument', () => {
  assert.doesNotThrow(() => compliance.buildTrail());
});

// ═══════════════════════════════════════════════════════════════════
// renderTrail — prose string
// ═══════════════════════════════════════════════════════════════════

section('renderTrail: prose output');

test('full flow render shows branch, ran steps, handoffs', () => {
  const m = compliance.buildTrail({ ledger: fullFlowLedger(), observeLog: [] });
  const out = compliance.renderTrail(m);
  assert.strictEqual(typeof out, 'string');
  assert.ok(out.includes('feature/41-compliance'), 'branch label');
  assert.ok(out.includes('#41'), 'issue label');
  assert.ok(/✓\s+pickup/.test(out), 'pickup ran');
  assert.ok(/✓\s+finalize/.test(out), 'finalize ran');
  assert.ok(out.includes('pickup') && out.includes('review'), 'handoff mention');
});

test('skipped steps rendered with ✗', () => {
  const ledger = fullFlowLedger().filter(
    (e) => !(e.type === 'skill-started' && (e.skill === 'finalize' || e.skill === 'cleanup'))
  );
  const out = compliance.renderTrail(compliance.buildTrail({ ledger, observeLog: [] }));
  assert.ok(/✗\s+finalize/.test(out), 'finalize skipped shown');
  assert.ok(/✗\s+cleanup/.test(out), 'cleanup skipped shown');
});

test('override count rendered', () => {
  const observeLog = [
    { ts: '2026-07-21T11:10:00.000Z', skill: 'review', gate: 'stop-audit', reason: 'unmet' },
    { kind: 'override', ts: '2026-07-21T11:10:00.000Z', skill: 'review', gate: 'stop-audit', reason: 'unmet' },
  ];
  const out = compliance.renderTrail(compliance.buildTrail({ ledger: fullFlowLedger(), observeLog }));
  assert.ok(/override/i.test(out), 'override mentioned');
  assert.ok(out.includes('1'), 'override count 1 shown');
});

test('hotfix rendered as sanctioned fast-path', () => {
  const ledger = [
    { ts: '2026-07-22T08:00:00.000Z', branch: 'hotfix/99-crash', issue: 99, type: 'skill-started', skill: 'hotfix' },
  ];
  const out = compliance.renderTrail(compliance.buildTrail({ ledger, observeLog: [] }));
  assert.ok(/sanctioned/i.test(out), 'sanctioned mentioned');
  assert.ok(/fast.?path/i.test(out), 'fast-path mentioned');
});

test('empty render is a clean nothing-recorded report', () => {
  const out = compliance.renderTrail(compliance.buildTrail({ ledger: [], observeLog: [] }));
  assert.ok(/nothing recorded/i.test(out), 'nothing-recorded message');
});

// ═══════════════════════════════════════════════════════════════════
// compliance(dir) — IO wrapper over temp dirs
// ═══════════════════════════════════════════════════════════════════

section('compliance(dir): reads ledger + observe-log from dir/.envoy');

test('renders a trail from on-disk ledger + observe-log', () => {
  const dir = makeTmp('compliance-io-');
  try {
    writeLines(dir, '.envoy/ledger.jsonl', fullFlowLedger());
    writeLines(dir, '.envoy/observe-log.jsonl', [
      { ts: '2026-07-21T11:10:00.000Z', skill: 'review', gate: 'stop-audit', reason: 'unmet' },
      { kind: 'override', ts: '2026-07-21T11:10:00.000Z', skill: 'review', gate: 'stop-audit', reason: 'unmet' },
    ]);
    const out = compliance.compliance(dir);
    assert.ok(out.includes('feature/41-compliance'));
    assert.ok(/✓\s+pickup/.test(out));
    assert.ok(/override/i.test(out));
  } finally {
    cleanup(dir);
  }
});

test('hotfix flow via disk renders sanctioned fast-path', () => {
  const dir = makeTmp('compliance-hotfix-');
  try {
    writeLines(dir, '.envoy/ledger.jsonl', [
      { ts: '2026-07-22T08:00:00.000Z', branch: 'hotfix/99-crash', issue: 99, type: 'skill-started', skill: 'hotfix' },
    ]);
    const out = compliance.compliance(dir);
    assert.ok(/sanctioned/i.test(out));
  } finally {
    cleanup(dir);
  }
});

section('compliance(dir): missing/empty/corrupt → clean, no throw');

test('missing files → nothing-recorded report, no throw', () => {
  const dir = makeTmp('compliance-missing-');
  try {
    let out;
    assert.doesNotThrow(() => {
      out = compliance.compliance(dir);
    });
    assert.ok(/nothing recorded/i.test(out));
  } finally {
    cleanup(dir);
  }
});

test('corrupt observe-log lines tolerated', () => {
  const dir = makeTmp('compliance-corrupt-');
  try {
    writeLines(dir, '.envoy/ledger.jsonl', fullFlowLedger());
    fs.writeFileSync(
      path.join(dir, '.envoy', 'observe-log.jsonl'),
      `${JSON.stringify({ ts: 't', skill: 'review', gate: 'stop-audit', reason: 'x' })}\n{ not json\n${JSON.stringify({ kind: 'override', ts: 't', skill: 'review', gate: 'stop-audit', reason: 'x' })}\n`,
      'utf8'
    );
    let out;
    assert.doesNotThrow(() => {
      out = compliance.compliance(dir);
    });
    const m = compliance.buildTrail({
      ledger: fullFlowLedger(),
      observeLog: compliance.readObserveLog(dir),
    });
    assert.strictEqual(m.overrides, 1);
    assert.strictEqual(m.wouldBlock, 1);
  } finally {
    cleanup(dir);
  }
});

test('readObserveLog missing file → []', () => {
  const dir = makeTmp('compliance-obsread-');
  try {
    assert.deepStrictEqual(compliance.readObserveLog(dir), []);
  } finally {
    cleanup(dir);
  }
});

// ═══════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
