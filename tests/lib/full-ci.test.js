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

/** A failed ci-gate rollup node whose detailsUrl points at job <jobId>. */
const gate = (jobId, name = 'ci-gate') => ({
  name,
  conclusion: 'FAILURE',
  detailsUrl: `https://github.com/o/r/actions/runs/0/job/${jobId}`,
});

/**
 * Fake gh: records calls. pr view returns labels + statusCheckRollup;
 * `gh api .../actions/jobs/<id>` maps job -> run via `jobs`; `gh run view`
 * reports run status via `runStatus` (default completed).
 */
function fakeGh({
  labels = [],
  sha = 'abc123',
  view,
  rollup = [gate(5001)],
  jobs = { 5001: 111 },
  runStatus = {},
  labelCreateError,
} = {}) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'view') {
      if (view !== undefined) return view;
      return JSON.stringify({ headRefOid: sha, labels: labels.map((name) => ({ name })), statusCheckRollup: rollup });
    }
    if (args[0] === 'api') {
      const m = /actions\/jobs\/(\d+)$/.exec(args[1]);
      if (m && jobs[m[1]] !== undefined) return `${jobs[m[1]]}\n`;
      const e = new Error('Command failed'); e.stderr = 'HTTP 404: Not Found'; throw e;
    }
    if (args[0] === 'run' && args[1] === 'view') {
      return JSON.stringify({ status: runStatus[args[2]] || 'completed' });
    }
    if (args[0] === 'label' && args[1] === 'create' && labelCreateError) {
      const e = new Error('Command failed'); e.stderr = labelCreateError; throw e;
    }
    return '';
  };
  gh.calls = calls;
  return gh;
}

const has = (gh, ...prefix) =>
  gh.calls.filter((c) => prefix.every((p, i) => c[i] === p));

section('full-ci: label missing');

test('creates label, adds it, reruns the ci-gate run', () => {
  const gh = fakeGh();
  const res = fullCi.run({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 0);
  assert.strictEqual(res.runId, 111);
  assert.deepStrictEqual(has(gh, 'label', 'create')[0], ['label', 'create', 'full-ci']);
  assert.deepStrictEqual(has(gh, 'pr', 'edit')[0], ['pr', 'edit', '7', '--add-label', 'full-ci']);
  assert.deepStrictEqual(has(gh, 'run', 'rerun')[0], ['run', 'rerun', '111']);
});

test('does not overwrite an existing label (no --force); "already exists" is tolerated', () => {
  const gh = fakeGh({ labelCreateError: 'label with name "full-ci" already exists; use `--force` to update its color and description' });
  const res = fullCi.run({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 0);
  assert.ok(!has(gh, 'label', 'create')[0].includes('--force'));
  assert.strictEqual(has(gh, 'pr', 'edit').length, 1);
  assert.strictEqual(has(gh, 'run', 'rerun').length, 1);
});

test('other label create errors are reported as gh errors', () => {
  const gh = fakeGh({ labelCreateError: 'HTTP 403: Resource not accessible' });
  const res = fullCi.run({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 1);
  assert.ok(res.message.includes('HTTP 403'));
  assert.strictEqual(has(gh, 'run', 'rerun').length, 0);
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

test('reruns the run that owns the failed ci-gate job, not the newest run', () => {
  const gh = fakeGh({
    rollup: [
      { name: 'lint', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/o/r/actions/runs/0/job/9001' },
      gate(5001),
      { name: 'docs', conclusion: 'FAILURE', detailsUrl: 'https://github.com/o/r/actions/runs/0/job/9002' },
    ],
    jobs: { 5001: 111, 9001: 999, 9002: 998 },
  });
  const res = fullCi.run({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.runId, 111);
  assert.deepStrictEqual(has(gh, 'run', 'rerun'), [['run', 'rerun', '111']]);
  assert.deepStrictEqual(has(gh, 'api')[0], ['api', 'repos/{owner}/{repo}/actions/jobs/5001', '--jq', '.run_id']);
  assert.strictEqual(has(gh, 'run', 'list').length, 0);
});

test('two failed gate checks in the same run rerun it once', () => {
  const gh = fakeGh({ rollup: [gate(5001), gate(5002)], jobs: { 5001: 111, 5002: 111 } });
  const res = fullCi.run({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 0);
  assert.deepStrictEqual(has(gh, 'run', 'rerun'), [['run', 'rerun', '111']]);
});

test('no failed ci-gate check: code 1, no label, no rerun, no cycle', () => {
  const cwd = tmp();
  const gh = fakeGh({ rollup: [{ name: 'ci-gate', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/o/r/actions/runs/0/job/5001' }] });
  const res = fullCi.run({ pr: 7, gh, cwd });
  assert.strictEqual(res.code, 1);
  assert.ok(/no failed ci-gate/i.test(res.message) && res.message.includes('abc123'));
  assert.strictEqual(has(gh, 'run', 'rerun').length, 0);
  assert.strictEqual(has(gh, 'pr', 'edit').length, 0);
  assert.strictEqual(loops.loadState('full-ci-7', cwd).cyclesSeen, 0);
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

test('gate run still in progress: code 1, retry message, no label, no rerun, no cycle', () => {
  const cwd = tmp();
  const gh = fakeGh({ runStatus: { 111: 'in_progress' } });
  const res = fullCi.run({ pr: 7, gh, cwd });
  assert.strictEqual(res.code, 1);
  assert.ok(/still in progress/.test(res.message));
  assert.strictEqual(has(gh, 'run', 'rerun').length, 0);
  assert.strictEqual(has(gh, 'pr', 'edit').length, 0);
  assert.strictEqual(loops.loadState('full-ci-7', cwd).cyclesSeen, 0);
});

section('full-ci: gh output validation');

test('pr view without headRefOid: code 1 before any job lookup', () => {
  const gh = fakeGh({ view: JSON.stringify({ labels: [] }) });
  const res = fullCi.run({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 1);
  assert.ok(/headRefOid/.test(res.message));
  assert.strictEqual(has(gh, 'api').length, 0);
  assert.strictEqual(has(gh, 'pr', 'edit').length, 0);
});

test('pr view non-JSON: code 1 before any job lookup', () => {
  const gh = fakeGh({ view: 'not json' });
  const res = fullCi.run({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 1);
  assert.strictEqual(has(gh, 'api').length, 0);
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

test('failed attempt (no gate) does not consume a cycle', () => {
  const cwd = tmp();
  fullCi.run({ pr: 7, gh: fakeGh({ rollup: [] }), cwd });
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
