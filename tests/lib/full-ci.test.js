#!/usr/bin/env node
/**
 * full-ci remediation helper — Test Suite
 *
 * Fake gh runner, temp cwd for loop state, no network.
 * Run: node tests/lib/full-ci.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fullCi = require(path.join(__dirname, '..', '..', 'lib', 'full-ci.js'));
const loops = require(path.join(__dirname, '..', '..', 'lib', 'loop-safeguards.js'));

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

const tmpDirs = [];
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'full-ci-'));
  tmpDirs.push(d);
  return d;
}

/** Fake gh: records calls, answers pr view / run list from options. */
function fakeGh({ labels = [], sha = 'abc123', view, runs = [{ databaseId: 111, createdAt: '2026-01-01T00:00:00Z', status: 'completed', headSha: 'abc123' }] } = {}) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'view') {
      if (view !== undefined) return view;
      return JSON.stringify({ headRefOid: sha, labels: labels.map((name) => ({ name })) });
    }
    if (args[0] === 'run' && args[1] === 'list') {
      const i = args.indexOf('--commit');
      const want = i === -1 ? undefined : args[i + 1];
      return JSON.stringify(runs.filter((r) => r.headSha === undefined || r.headSha === want));
    }
    return '';
  };
  gh.calls = calls;
  return gh;
}

const has = (gh, ...prefix) =>
  gh.calls.filter((c) => prefix.every((p, i) => c[i] === p));

section('full-ci: label missing');

test('creates label, adds it, reruns the head-SHA run', () => {
  const gh = fakeGh();
  const res = fullCi.run({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 0);
  assert.strictEqual(res.runId, 111);
  assert.strictEqual(has(gh, 'label', 'create').length, 1);
  assert.deepStrictEqual(has(gh, 'pr', 'edit')[0], ['pr', 'edit', '7', '--add-label', 'full-ci']);
  assert.deepStrictEqual(has(gh, 'run', 'rerun')[0], ['run', 'rerun', '111']);
  const list = has(gh, 'run', 'list')[0];
  assert.strictEqual(list[list.indexOf('--commit') + 1], 'abc123');
});

section('full-ci: label present');

test('skips labelling and only reruns', () => {
  const gh = fakeGh({ labels: ['full-ci'] });
  const res = fullCi.run({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 0);
  assert.strictEqual(has(gh, 'label', 'create').length, 0);
  assert.strictEqual(has(gh, 'pr', 'edit').length, 0);
  assert.strictEqual(has(gh, 'run', 'rerun').length, 1);
});

section('full-ci: run selection');

test('picks the most recent run for the head SHA', () => {
  const gh = fakeGh({ runs: [
    { databaseId: 1, createdAt: '2026-01-01T00:00:00Z', status: 'completed' },
    { databaseId: 3, createdAt: '2026-01-03T00:00:00Z', status: 'completed' },
    { databaseId: 2, createdAt: '2026-01-02T00:00:00Z', status: 'completed' },
  ] });
  const res = fullCi.run({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.runId, 3);
  assert.deepStrictEqual(has(gh, 'run', 'rerun')[0], ['run', 'rerun', '3']);
});

test('no run for head SHA: code 1, clear message, no rerun', () => {
  const gh = fakeGh({ runs: [] });
  const res = fullCi.run({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 1);
  assert.ok(/no (workflow )?run/i.test(res.message) && res.message.includes('abc123'));
  assert.strictEqual(has(gh, 'run', 'rerun').length, 0);
});

test('gh failure returns code 1 with message', () => {
  const gh = () => { throw new Error('boom'); };
  const res = fullCi.run({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 1);
  assert.ok(res.message.includes('boom'));
});

test('invalid pr number rejected without calling gh', () => {
  const gh = fakeGh();
  const res = fullCi.run({ pr: 'x; rm -rf', gh, cwd: tmp() });
  assert.strictEqual(res.code, 1);
  assert.strictEqual(gh.calls.length, 0);
});

test('runs for a different SHA are ignored by the commit filter', () => {
  const gh = fakeGh({ runs: [{ databaseId: 9, createdAt: '2026-01-09T00:00:00Z', status: 'completed', headSha: 'other' }] });
  const res = fullCi.run({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 1);
  assert.strictEqual(has(gh, 'run', 'rerun').length, 0);
});

test('prefers latest completed run over a newer in-progress one', () => {
  const gh = fakeGh({ runs: [
    { databaseId: 1, createdAt: '2026-01-01T00:00:00Z', status: 'completed' },
    { databaseId: 2, createdAt: '2026-01-02T00:00:00Z', status: 'in_progress' },
  ] });
  assert.strictEqual(fullCi.run({ pr: 7, gh, cwd: tmp() }).runId, 1);
});

test('only an in-progress run: code 1, retry message, no rerun, no cycle', () => {
  const cwd = tmp();
  const gh = fakeGh({ runs: [{ databaseId: 2, createdAt: '2026-01-02T00:00:00Z', status: 'in_progress' }] });
  const res = fullCi.run({ pr: 7, gh, cwd });
  assert.strictEqual(res.code, 1);
  assert.ok(/still in progress/.test(res.message));
  assert.strictEqual(has(gh, 'run', 'rerun').length, 0);
  assert.strictEqual(loops.loadState('full-ci-7', cwd).cyclesSeen, 0);
});

section('full-ci: gh output validation');

test('pr view without headRefOid: code 1 before any run list', () => {
  const gh = fakeGh({ view: JSON.stringify({ labels: [] }) });
  const res = fullCi.run({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 1);
  assert.ok(/headRefOid/.test(res.message));
  assert.strictEqual(has(gh, 'run', 'list').length, 0);
  assert.strictEqual(has(gh, 'pr', 'edit').length, 0);
});

test('pr view non-JSON: code 1 before any run list', () => {
  const gh = fakeGh({ view: 'not json' });
  const res = fullCi.run({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 1);
  assert.strictEqual(has(gh, 'run', 'list').length, 0);
});

test('gh error includes trimmed stderr and is labelled as gh error', () => {
  const gh = () => { const e = new Error('Command failed'); e.stderr = 'HTTP 403 rate limit\n'; throw e; };
  const res = fullCi.run({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 1);
  assert.ok(/gh/.test(res.message) && res.message.includes('HTTP 403 rate limit'));
  assert.ok(!res.message.endsWith('\n'));
});

section('full-ci: loop-safeguards max cycles');

test('records a cycle on loop full-ci-<pr>', () => {
  const cwd = tmp();
  fullCi.run({ pr: 7, gh: fakeGh(), cwd });
  const state = loops.loadState('full-ci-7', cwd);
  assert.strictEqual(state.cyclesSeen, 1);
  assert.strictEqual(state.maxCycles, fullCi.MAX_CYCLES);
});

test('blocked at maxCycles: code 2, no rerun, no label changes', () => {
  const cwd = tmp();
  for (let i = 0; i < fullCi.MAX_CYCLES; i++) fullCi.run({ pr: 7, gh: fakeGh(), cwd });
  const gh = fakeGh();
  const res = fullCi.run({ pr: 7, gh, cwd });
  assert.strictEqual(res.code, 2);
  assert.strictEqual(has(gh, 'run', 'rerun').length, 0);
  assert.strictEqual(has(gh, 'pr', 'edit').length, 0);
  assert.ok(res.message.includes('cleanup full-ci-7'));
  assert.ok(!/\breset\b/.test(res.message));
});

test('failed attempt (no run) does not consume a cycle', () => {
  const cwd = tmp();
  fullCi.run({ pr: 7, gh: fakeGh({ runs: [] }), cwd });
  assert.strictEqual(loops.loadState('full-ci-7', cwd).cyclesSeen, 0);
});

test('other PRs are tracked independently', () => {
  const cwd = tmp();
  for (let i = 0; i < fullCi.MAX_CYCLES; i++) fullCi.run({ pr: 7, gh: fakeGh(), cwd });
  assert.strictEqual(fullCi.run({ pr: 8, gh: fakeGh(), cwd }).code, 0);
});

for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
