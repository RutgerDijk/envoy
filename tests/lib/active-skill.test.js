#!/usr/bin/env node
/**
 * Active-skill marker lifecycle — Test Suite
 *
 * Run: node tests/lib/active-skill.test.js
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

function markerPath(dir) {
  return path.join(dir, '.envoy', 'active-skill.json');
}

function readRaw(dir) {
  return JSON.parse(fs.readFileSync(markerPath(dir), 'utf8'));
}

// ═══════════════════════════════════════════════════════════════════
// Load module + schema validator
// ═══════════════════════════════════════════════════════════════════

const activeSkill = require(path.join(LIB, 'active-skill'));
const { validate } = require(path.join(LIB, 'validate-schema'));

// ═══════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════

section('exports');

test('writeActiveSkill is exported', () => {
  assert.strictEqual(typeof activeSkill.writeActiveSkill, 'function');
});

test('readActiveSkill is exported', () => {
  assert.strictEqual(typeof activeSkill.readActiveSkill, 'function');
});

test('clearActiveSkill is exported', () => {
  assert.strictEqual(typeof activeSkill.clearActiveSkill, 'function');
});

// ═══════════════════════════════════════════════════════════════════
// writeActiveSkill
// ═══════════════════════════════════════════════════════════════════

section('writeActiveSkill: stamps meta + lifecycle fields');

test('writes marker with skill, issueNumber, startedAt, branch, session', () => {
  const dir = makeTmp('as-write-');
  const now = new Date('2026-07-20T10:00:00.000Z');
  activeSkill.writeActiveSkill(
    dir,
    { skill: 'pickup', issueNumber: 60 },
    { now, branch: 'feature/60-observe-gates', session: 'sess-abc' }
  );
  const m = readRaw(dir);
  assert.strictEqual(m.skill, 'pickup');
  assert.strictEqual(m.issueNumber, 60);
  assert.strictEqual(m.startedAt, '2026-07-20T10:00:00.000Z');
  assert.strictEqual(m.branch, 'feature/60-observe-gates');
  assert.strictEqual(m.session, 'sess-abc');
  cleanup(dir);
});

test('written marker validates against active-skill schema', () => {
  const dir = makeTmp('as-write-');
  activeSkill.writeActiveSkill(
    dir,
    { skill: 'pickup', issueNumber: 60 },
    { now: new Date(), branch: 'main', session: 'x' }
  );
  const result = validate('active-skill', readRaw(dir));
  assert.ok(result.valid, `expected valid, errors: ${result.errors.join(', ')}`);
  cleanup(dir);
});

test('omits issueNumber when absent (schema requires number when present)', () => {
  const dir = makeTmp('as-write-');
  activeSkill.writeActiveSkill(
    dir,
    { skill: 'cleanup' },
    { now: new Date(), branch: 'main', session: 'x' }
  );
  const m = readRaw(dir);
  assert.ok(!('issueNumber' in m), 'issueNumber should be omitted');
  assert.ok(validate('active-skill', m).valid);
  cleanup(dir);
});

test('creates .envoy directory if missing', () => {
  const dir = makeTmp('as-write-');
  assert.ok(!fs.existsSync(path.join(dir, '.envoy')));
  activeSkill.writeActiveSkill(dir, { skill: 'pickup' }, { now: new Date(), branch: 'b', session: 's' });
  assert.ok(fs.existsSync(markerPath(dir)));
  cleanup(dir);
});

// ═══════════════════════════════════════════════════════════════════
// readActiveSkill — fresh
// ═══════════════════════════════════════════════════════════════════

section('readActiveSkill: fresh marker round-trips');

test('returns the marker when branch + session match and within TTL', () => {
  const dir = makeTmp('as-read-');
  const started = new Date('2026-07-20T10:00:00.000Z');
  activeSkill.writeActiveSkill(dir, { skill: 'pickup', issueNumber: 60 }, {
    now: started, branch: 'feat', session: 'sess-1',
  });
  const m = activeSkill.readActiveSkill(dir, {
    now: new Date('2026-07-20T10:30:00.000Z'),
    branch: 'feat',
    session: 'sess-1',
    ttlMs: 4 * 60 * 60 * 1000,
  });
  assert.ok(m, 'expected a marker');
  assert.strictEqual(m.skill, 'pickup');
  assert.strictEqual(m.issueNumber, 60);
  cleanup(dir);
});

// ═══════════════════════════════════════════════════════════════════
// readActiveSkill — stale
// ═══════════════════════════════════════════════════════════════════

section('readActiveSkill: stale ⇒ null');

test('null when now - startedAt exceeds ttlMs', () => {
  const dir = makeTmp('as-read-');
  const started = new Date('2026-07-20T10:00:00.000Z');
  activeSkill.writeActiveSkill(dir, { skill: 'pickup' }, {
    now: started, branch: 'feat', session: 'sess-1',
  });
  const m = activeSkill.readActiveSkill(dir, {
    now: new Date('2026-07-20T15:00:00.000Z'), // 5h later
    branch: 'feat',
    session: 'sess-1',
    ttlMs: 4 * 60 * 60 * 1000, // 4h TTL
  });
  assert.strictEqual(m, null);
  cleanup(dir);
});

test('null when marker branch differs from current branch', () => {
  const dir = makeTmp('as-read-');
  const started = new Date('2026-07-20T10:00:00.000Z');
  activeSkill.writeActiveSkill(dir, { skill: 'pickup' }, {
    now: started, branch: 'feat', session: 'sess-1',
  });
  const m = activeSkill.readActiveSkill(dir, {
    now: new Date('2026-07-20T10:05:00.000Z'),
    branch: 'main', // different branch
    session: 'sess-1',
    ttlMs: 4 * 60 * 60 * 1000,
  });
  assert.strictEqual(m, null);
  cleanup(dir);
});

test('null when marker session differs from current session', () => {
  const dir = makeTmp('as-read-');
  const started = new Date('2026-07-20T10:00:00.000Z');
  activeSkill.writeActiveSkill(dir, { skill: 'pickup' }, {
    now: started, branch: 'feat', session: 'sess-1',
  });
  const m = activeSkill.readActiveSkill(dir, {
    now: new Date('2026-07-20T10:05:00.000Z'),
    branch: 'feat',
    session: 'sess-2', // different session
    ttlMs: 4 * 60 * 60 * 1000,
  });
  assert.strictEqual(m, null);
  cleanup(dir);
});

test('uses default TTL when ttlMs not provided', () => {
  const dir = makeTmp('as-read-');
  const started = new Date('2026-07-20T10:00:00.000Z');
  activeSkill.writeActiveSkill(dir, { skill: 'pickup' }, {
    now: started, branch: 'feat', session: 'sess-1',
  });
  // 1 minute later, same branch/session — must be fresh under any sane default
  const fresh = activeSkill.readActiveSkill(dir, {
    now: new Date('2026-07-20T10:01:00.000Z'),
    branch: 'feat',
    session: 'sess-1',
  });
  assert.ok(fresh, 'expected fresh marker under default TTL');
  cleanup(dir);
});

// ═══════════════════════════════════════════════════════════════════
// readActiveSkill — missing / unparseable
// ═══════════════════════════════════════════════════════════════════

section('readActiveSkill: missing / unparseable ⇒ null (no throw)');

test('null when marker file is missing', () => {
  const dir = makeTmp('as-read-');
  const m = activeSkill.readActiveSkill(dir, {
    now: new Date(), branch: 'feat', session: 'x',
  });
  assert.strictEqual(m, null);
  cleanup(dir);
});

test('null when marker file is unparseable', () => {
  const dir = makeTmp('as-read-');
  fs.mkdirSync(path.join(dir, '.envoy'), { recursive: true });
  fs.writeFileSync(markerPath(dir), '{ not json', 'utf8');
  let m;
  assert.doesNotThrow(() => {
    m = activeSkill.readActiveSkill(dir, { now: new Date(), branch: 'feat', session: 'x' });
  });
  assert.strictEqual(m, null);
  cleanup(dir);
});

// ═══════════════════════════════════════════════════════════════════
// clearActiveSkill
// ═══════════════════════════════════════════════════════════════════

section('clearActiveSkill: removes marker; no-throw when absent');

test('removes an existing marker', () => {
  const dir = makeTmp('as-clear-');
  activeSkill.writeActiveSkill(dir, { skill: 'cleanup' }, { now: new Date(), branch: 'b', session: 's' });
  assert.ok(fs.existsSync(markerPath(dir)));
  activeSkill.clearActiveSkill(dir);
  assert.ok(!fs.existsSync(markerPath(dir)), 'marker should be gone');
  cleanup(dir);
});

test('does not throw when marker is already absent', () => {
  const dir = makeTmp('as-clear-');
  assert.doesNotThrow(() => activeSkill.clearActiveSkill(dir));
  cleanup(dir);
});

// ═══════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
