#!/usr/bin/env node
/**
 * Durable append-only workflow ledger — Test Suite
 *
 * Run: node tests/lib/ledger.test.js
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

function ledgerPath(dir) {
  return path.join(dir, '.envoy', 'ledger.jsonl');
}

function readLines(dir) {
  return fs
    .readFileSync(ledgerPath(dir), 'utf8')
    .split('\n')
    .filter((l) => l.length > 0);
}

const ledger = require(path.join(LIB, 'ledger'));

// ═══════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════

section('exports');

test('appendEvent is exported', () => {
  assert.strictEqual(typeof ledger.appendEvent, 'function');
});

test('readLedger is exported', () => {
  assert.strictEqual(typeof ledger.readLedger, 'function');
});

test('tailLedger is exported', () => {
  assert.strictEqual(typeof ledger.tailLedger, 'function');
});

// ═══════════════════════════════════════════════════════════════════
// appendEvent — stamping + file creation
// ═══════════════════════════════════════════════════════════════════

section('appendEvent: stamps ts + branch + issue; creates .envoy');

test('creates .envoy directory and writes one JSON line', () => {
  const dir = makeTmp('ledger-append-');
  assert.ok(!fs.existsSync(path.join(dir, '.envoy')));
  ledger.appendEvent(dir, { type: 'skill-started', skill: 'pickup' }, {
    now: new Date('2026-07-21T10:00:00.000Z'),
    branch: 'feature/65-ledger',
  });
  assert.ok(fs.existsSync(ledgerPath(dir)));
  assert.strictEqual(readLines(dir).length, 1);
  cleanup(dir);
});

test('stamps ts and branch and merges event fields', () => {
  const dir = makeTmp('ledger-append-');
  ledger.appendEvent(dir, { type: 'skill-started', skill: 'pickup' }, {
    now: new Date('2026-07-21T10:00:00.000Z'),
    branch: 'feature/65-ledger',
  });
  const ev = JSON.parse(readLines(dir)[0]);
  assert.strictEqual(ev.ts, '2026-07-21T10:00:00.000Z');
  assert.strictEqual(ev.branch, 'feature/65-ledger');
  assert.strictEqual(ev.type, 'skill-started');
  assert.strictEqual(ev.skill, 'pickup');
  cleanup(dir);
});

test('stamps issue from event.issue', () => {
  const dir = makeTmp('ledger-append-');
  ledger.appendEvent(dir, { type: 'skill-started', issue: 65 }, {
    now: new Date(), branch: 'b',
  });
  const ev = JSON.parse(readLines(dir)[0]);
  assert.strictEqual(ev.issue, 65);
  cleanup(dir);
});

test('stamps issue from opts.issue when event has none', () => {
  const dir = makeTmp('ledger-append-');
  ledger.appendEvent(dir, { type: 'skill-started' }, {
    now: new Date(), branch: 'b', issue: 42,
  });
  const ev = JSON.parse(readLines(dir)[0]);
  assert.strictEqual(ev.issue, 42);
  cleanup(dir);
});

test('omits issue when neither event nor opts provide it', () => {
  const dir = makeTmp('ledger-append-');
  ledger.appendEvent(dir, { type: 'skill-started' }, {
    now: new Date(), branch: 'b',
  });
  const ev = JSON.parse(readLines(dir)[0]);
  assert.ok(!('issue' in ev), 'issue should be omitted');
  cleanup(dir);
});

test('appends successive events as separate lines', () => {
  const dir = makeTmp('ledger-append-');
  const opts = { now: new Date(), branch: 'b' };
  ledger.appendEvent(dir, { type: 'a' }, opts);
  ledger.appendEvent(dir, { type: 'b' }, opts);
  ledger.appendEvent(dir, { type: 'c' }, opts);
  const lines = readLines(dir);
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(JSON.parse(lines[0]).type, 'a');
  assert.strictEqual(JSON.parse(lines[2]).type, 'c');
  cleanup(dir);
});

// ═══════════════════════════════════════════════════════════════════
// appendEvent — size cap
// ═══════════════════════════════════════════════════════════════════

section('appendEvent: size-capped, oldest dropped');

test('trims to maxLines, dropping oldest', () => {
  const dir = makeTmp('ledger-cap-');
  const opts = { now: new Date(), branch: 'b', maxLines: 3 };
  for (let i = 0; i < 6; i++) ledger.appendEvent(dir, { type: 'e', n: i }, opts);
  const lines = readLines(dir);
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(JSON.parse(lines[0]).n, 3);
  assert.strictEqual(JSON.parse(lines[2]).n, 5);
  cleanup(dir);
});

test('does not trim while under the cap', () => {
  const dir = makeTmp('ledger-cap-');
  const opts = { now: new Date(), branch: 'b', maxLines: 10 };
  for (let i = 0; i < 4; i++) ledger.appendEvent(dir, { type: 'e', n: i }, opts);
  assert.strictEqual(readLines(dir).length, 4);
  cleanup(dir);
});

// ═══════════════════════════════════════════════════════════════════
// appendEvent — fail-soft
// ═══════════════════════════════════════════════════════════════════

section('appendEvent: never throws on fs error');

test('does not throw when dir is unwritable (fs error swallowed)', () => {
  // A file where the .envoy directory should be forces mkdir/append to fail.
  const dir = makeTmp('ledger-failsoft-');
  fs.writeFileSync(path.join(dir, '.envoy'), 'not a directory', 'utf8');
  assert.doesNotThrow(() => {
    ledger.appendEvent(dir, { type: 'x' }, { now: new Date(), branch: 'b' });
  });
  cleanup(dir);
});

// ═══════════════════════════════════════════════════════════════════
// readLedger
// ═══════════════════════════════════════════════════════════════════

section('readLedger: parse all; missing ⇒ []; corrupt line skipped');

test('returns all parsed events', () => {
  const dir = makeTmp('ledger-read-');
  const opts = { now: new Date(), branch: 'b' };
  ledger.appendEvent(dir, { type: 'a' }, opts);
  ledger.appendEvent(dir, { type: 'b' }, opts);
  const events = ledger.readLedger(dir);
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].type, 'a');
  assert.strictEqual(events[1].type, 'b');
  cleanup(dir);
});

test('missing file returns []', () => {
  const dir = makeTmp('ledger-read-');
  assert.deepStrictEqual(ledger.readLedger(dir), []);
  cleanup(dir);
});

test('skips corrupt lines without throwing', () => {
  const dir = makeTmp('ledger-read-');
  fs.mkdirSync(path.join(dir, '.envoy'), { recursive: true });
  fs.writeFileSync(
    ledgerPath(dir),
    `${JSON.stringify({ type: 'a' })}\n{ not json\n${JSON.stringify({ type: 'b' })}\n`,
    'utf8'
  );
  let events;
  assert.doesNotThrow(() => {
    events = ledger.readLedger(dir);
  });
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].type, 'a');
  assert.strictEqual(events[1].type, 'b');
  cleanup(dir);
});

// ═══════════════════════════════════════════════════════════════════
// tailLedger
// ═══════════════════════════════════════════════════════════════════

section('tailLedger: last n events; missing ⇒ []');

test('returns the last n events', () => {
  const dir = makeTmp('ledger-tail-');
  const opts = { now: new Date(), branch: 'b' };
  for (let i = 0; i < 5; i++) ledger.appendEvent(dir, { type: 'e', n: i }, opts);
  const tail = ledger.tailLedger(dir, 2);
  assert.strictEqual(tail.length, 2);
  assert.strictEqual(tail[0].n, 3);
  assert.strictEqual(tail[1].n, 4);
  cleanup(dir);
});

test('returns fewer when n exceeds count', () => {
  const dir = makeTmp('ledger-tail-');
  ledger.appendEvent(dir, { type: 'e', n: 0 }, { now: new Date(), branch: 'b' });
  const tail = ledger.tailLedger(dir, 10);
  assert.strictEqual(tail.length, 1);
  cleanup(dir);
});

test('missing file returns []', () => {
  const dir = makeTmp('ledger-tail-');
  assert.deepStrictEqual(ledger.tailLedger(dir, 3), []);
  cleanup(dir);
});

// ═══════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
