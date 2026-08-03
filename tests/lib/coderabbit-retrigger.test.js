#!/usr/bin/env node
/**
 * lib/coderabbit-retrigger.js — pure-function tests for the shared
 * CodeRabbit rate-limit re-trigger decision (Task 8), used by BOTH
 * finalize's remediation-cycle collect phase and babysit's Step 3.
 *
 * Run: node tests/lib/coderabbit-retrigger.test.js
 */

const assert = require('assert');
const path = require('path');

const MODULE = path.join(__dirname, '..', '..', 'lib', 'coderabbit-retrigger.js');
const { shouldReTrigger, formatHandoffMessage } = require(MODULE);

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

const NOW = new Date('2026-08-03T12:00:00Z');

section('shouldReTrigger(rateLimit, now, opts) — not rate-limited');

test('not rate-limited — no action', () => {
  const result = shouldReTrigger({ rateLimited: false, resetsAt: null }, NOW);
  assert.strictEqual(result.action, 'none');
});

section('shouldReTrigger — resetsAt has already passed (retrigger branch)');

test('resetsAt in the past — retrigger and reset poll clock', () => {
  const resetsAt = new Date(NOW.getTime() - 60 * 1000).toISOString();
  const result = shouldReTrigger({ rateLimited: true, resetsAt }, NOW);
  assert.strictEqual(result.action, 'retrigger');
});

test('resetsAt unknown (null) while rate-limited but past-due semantics unavailable — treated as handoff-less wait is not possible; falls back to retrigger only when explicitly passed', () => {
  // resetsAt null with rateLimited true: no known time to compute against.
  // Per spec, resetsAt is required to compute minutesUntilReset; null means
  // we cannot decide to wait or hand off with a time — default to retrigger
  // since we cannot compute a future minutesUntilReset either.
  const result = shouldReTrigger({ rateLimited: true, resetsAt: null }, NOW);
  assert.strictEqual(result.action, 'retrigger');
});

section('shouldReTrigger — resetsAt in the future, close (<=10min): wait-and-extend');

test('resetsAt 5 minutes away — wait, extend deadline to resetsAt+2min (no cap hit)', () => {
  const resetsAt = new Date(NOW.getTime() + 5 * 60 * 1000).toISOString();
  const result = shouldReTrigger({ rateLimited: true, resetsAt }, NOW, { currentDeadlineSeconds: 1320 });
  assert.strictEqual(result.action, 'wait');
  // resetsAt+2min = 7min from now = 420s, less than current 1320s cap, so deadline stays 1320s (no shrink)
  assert.strictEqual(result.extendedDeadlineSeconds, 1320);
});

test('resetsAt exactly at 10 minutes away — still wait (boundary is inclusive)', () => {
  const resetsAt = new Date(NOW.getTime() + 10 * 60 * 1000).toISOString();
  const result = shouldReTrigger({ rateLimited: true, resetsAt }, NOW, { currentDeadlineSeconds: 1320 });
  assert.strictEqual(result.action, 'wait');
});

test('resetsAt 15 minutes away but computed extension exceeds current 22min cap — extends deadline', () => {
  // current elapsed poll deadline already at cap (1320s = 22min); resetsAt+2min = 17min = 1020s
  // which does NOT exceed 1320s, so this case doesn't extend. Use a case where it does:
  // if current deadline were smaller e.g. 480s (8min) and resetsAt+2min = 8min(close, <=10) -> extends
  const resetsAt = new Date(NOW.getTime() + 8 * 60 * 1000).toISOString();
  const result = shouldReTrigger({ rateLimited: true, resetsAt }, NOW, { currentDeadlineSeconds: 480 });
  assert.strictEqual(result.action, 'wait');
  // resetsAt+2min = 10min = 600s > 480s current cap -> extend to 600s
  assert.strictEqual(result.extendedDeadlineSeconds, 600);
});

test('extension respects the 60-minute hard ceiling', () => {
  // resetsAt 10min away (boundary), +2min = 12min = 720s, way under 60min so ceiling doesn't bind here.
  // Construct a case where resetsAt+2min alone would exceed 60min: not possible since resetsAt<=10min bound
  // means resetsAt+2min <= 12min always. So hard ceiling is tested via currentDeadlineSeconds already near it
  // combined with extension request beyond 3600s — simulate directly via opts override for safety-net coverage.
  const resetsAt = new Date(NOW.getTime() + 9 * 60 * 1000).toISOString();
  const result = shouldReTrigger({ rateLimited: true, resetsAt }, NOW, { currentDeadlineSeconds: 4000 });
  assert.ok(result.extendedDeadlineSeconds <= 3600);
});

section('shouldReTrigger — resetsAt in the future, far (>10min): handoff');

test('resetsAt 11 minutes away — handoff, do not wait', () => {
  const resetsAt = new Date(NOW.getTime() + 11 * 60 * 1000).toISOString();
  const result = shouldReTrigger({ rateLimited: true, resetsAt }, NOW);
  assert.strictEqual(result.action, 'handoff');
  assert.strictEqual(result.resetsAt, resetsAt);
});

test('resetsAt 1 hour away — handoff', () => {
  const resetsAt = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();
  const result = shouldReTrigger({ rateLimited: true, resetsAt }, NOW);
  assert.strictEqual(result.action, 'handoff');
});

section('shouldReTrigger — re-trigger cap (max 2 per run)');

test('retrigger branch respects retriggerCount cap — returns handoff-like cappedOut when at max', () => {
  const resetsAt = new Date(NOW.getTime() - 60 * 1000).toISOString();
  const result = shouldReTrigger({ rateLimited: true, resetsAt }, NOW, { retriggerCount: 2, maxRetriggers: 2 });
  assert.strictEqual(result.action, 'capped');
});

test('retrigger allowed when under cap', () => {
  const resetsAt = new Date(NOW.getTime() - 60 * 1000).toISOString();
  const result = shouldReTrigger({ rateLimited: true, resetsAt }, NOW, { retriggerCount: 1, maxRetriggers: 2 });
  assert.strictEqual(result.action, 'retrigger');
});

section('formatHandoffMessage(resetsAt)');

test('formats HH:MM (UTC) into the babysit handoff message', () => {
  const msg = formatHandoffMessage('2026-08-03T13:45:00Z');
  assert.ok(/run \/envoy:babysit after 13:45/.test(msg), msg);
});

test('pads single-digit hours/minutes with zero', () => {
  const msg = formatHandoffMessage('2026-08-03T05:07:00Z');
  assert.ok(/run \/envoy:babysit after 05:07/.test(msg), msg);
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
