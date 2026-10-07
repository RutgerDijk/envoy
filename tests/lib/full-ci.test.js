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
  shaSequence,
} = {}) {
  const calls = [];
  let viewN = 0;
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'view') {
      if (view !== undefined) return view;
      const cur = shaSequence ? shaSequence[Math.min(viewN, shaSequence.length - 1)] : sha;
      viewN += 1;
      return JSON.stringify({ headRefOid: cur, labels: labels.map((name) => ({ name })), statusCheckRollup: rollup });
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


/** A ready snapshot (fast run green but for the marker, review done, CodeRabbit success). */
function snap(over = {}) {
  return {
    ci: { fullSuiteOwed: true, pinned: true, ...(over.ci || {}) },
    threads: { unresolved: 0, ...(over.threads || {}) },
    coderabbit: {
      statusState: 'success',
      unresolvedThreads: 0,
      ...(over.coderabbit || {}),
      rateLimit: { rateLimited: false, resetsAt: null, ...((over.coderabbit || {}).rateLimit || {}) },
    },
  };
}

/** Wrap run() with a ready snapshot, CodeRabbit not in use (auto, no config file). */
function go(opts) {
  const snapshot = opts.snapshot || (() => snap());
  return fullCi.run({ env: {}, exists: () => false, repoRoot: '/repo', ...opts, snapshot });
}

const has = (gh, ...prefix) =>
  gh.calls.filter((c) => prefix.every((p, i) => c[i] === p));

section('full-ci: label missing');

test('creates label, adds it, reruns the ci-gate run', () => {
  const gh = fakeGh();
  const res = go({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 0);
  assert.strictEqual(res.runId, 111);
  assert.deepStrictEqual(has(gh, 'label', 'create')[0], ['label', 'create', 'full-ci']);
  assert.deepStrictEqual(has(gh, 'pr', 'edit')[0], ['pr', 'edit', '7', '--add-label', 'full-ci']);
  assert.deepStrictEqual(has(gh, 'run', 'rerun')[0], ['run', 'rerun', '111']);
});

test('does not overwrite an existing label (no --force); "already exists" is tolerated', () => {
  const gh = fakeGh({ labelCreateError: 'label with name "full-ci" already exists; use `--force` to update its color and description' });
  const res = go({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 0);
  assert.ok(!has(gh, 'label', 'create')[0].includes('--force'));
  assert.strictEqual(has(gh, 'pr', 'edit').length, 1);
  assert.strictEqual(has(gh, 'run', 'rerun').length, 1);
});

test('other label create errors are reported as gh errors', () => {
  const gh = fakeGh({ labelCreateError: 'HTTP 403: Resource not accessible' });
  const res = go({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 1);
  assert.ok(res.message.includes('HTTP 403'));
  assert.strictEqual(has(gh, 'run', 'rerun').length, 0);
});

section('full-ci: label present');

test('skips labelling and only reruns', () => {
  const gh = fakeGh({ labels: ['full-ci'] });
  const res = go({ pr: 7, gh, cwd: tmp() });
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
  const res = go({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.runId, 111);
  assert.deepStrictEqual(has(gh, 'run', 'rerun'), [['run', 'rerun', '111']]);
  assert.deepStrictEqual(has(gh, 'api')[0], ['api', 'repos/{owner}/{repo}/actions/jobs/5001', '--jq', '.run_id']);
  assert.strictEqual(has(gh, 'run', 'list').length, 0);
});

test('two failed gate checks in the same run rerun it once', () => {
  const gh = fakeGh({ rollup: [gate(5001), gate(5002)], jobs: { 5001: 111, 5002: 111 } });
  const res = go({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 0);
  assert.deepStrictEqual(has(gh, 'run', 'rerun'), [['run', 'rerun', '111']]);
});

test('no failed ci-gate check: code 1, no label, no rerun, no cycle', () => {
  const cwd = tmp();
  const gh = fakeGh({ rollup: [{ name: 'ci-gate', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/o/r/actions/runs/0/job/5001' }] });
  const res = go({ pr: 7, gh, cwd });
  assert.strictEqual(res.code, 1);
  assert.ok(/no failed ci-gate/i.test(res.message) && res.message.includes('abc123'));
  assert.strictEqual(has(gh, 'run', 'rerun').length, 0);
  assert.strictEqual(has(gh, 'pr', 'edit').length, 0);
  assert.strictEqual(loops.loadState('full-ci-7', cwd).cyclesSeen, 0);
});

test('gh failure returns code 1 with message', () => {
  const gh = () => { throw new Error('boom'); };
  const res = go({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 1);
  assert.ok(res.message.includes('boom'));
});

test('invalid pr number rejected without calling gh', () => {
  const gh = fakeGh();
  const res = go({ pr: 'x; rm -rf', gh, cwd: tmp() });
  assert.strictEqual(res.code, 1);
  assert.strictEqual(gh.calls.length, 0);
});

test('gate run still in progress: code 1, retry message, no label, no rerun, no cycle', () => {
  const cwd = tmp();
  const gh = fakeGh({ runStatus: { 111: 'in_progress' } });
  const res = go({ pr: 7, gh, cwd });
  assert.strictEqual(res.code, 1);
  assert.ok(/still in progress/.test(res.message));
  assert.strictEqual(has(gh, 'run', 'rerun').length, 0);
  assert.strictEqual(has(gh, 'pr', 'edit').length, 0);
  assert.strictEqual(loops.loadState('full-ci-7', cwd).cyclesSeen, 0);
});

section('full-ci: gh output validation');

test('pr view without headRefOid: code 1 before any job lookup', () => {
  const gh = fakeGh({ view: JSON.stringify({ labels: [] }) });
  const res = go({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 1);
  assert.ok(/headRefOid/.test(res.message));
  assert.strictEqual(has(gh, 'api').length, 0);
  assert.strictEqual(has(gh, 'pr', 'edit').length, 0);
});

test('pr view non-JSON: code 1 before any job lookup', () => {
  const gh = fakeGh({ view: 'not json' });
  const res = go({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 1);
  assert.strictEqual(has(gh, 'api').length, 0);
});

test('gh error includes trimmed stderr and is labelled as gh error', () => {
  const gh = () => { const e = new Error('Command failed'); e.stderr = 'HTTP 403 rate limit\n'; throw e; };
  const res = go({ pr: 7, gh, cwd: tmp() });
  assert.strictEqual(res.code, 1);
  assert.ok(/gh/.test(res.message) && res.message.includes('HTTP 403 rate limit'));
  assert.ok(!res.message.endsWith('\n'));
});


const noWrites = (gh) => {
  assert.strictEqual(has(gh, 'label', 'create').length, 0);
  assert.strictEqual(has(gh, 'pr', 'edit').length, 0);
  assert.strictEqual(has(gh, 'run', 'rerun').length, 0);
};

function notReady(label, snapshot, matcher, extra = {}) {
  test(`not ready (${label}): exit 3, no writes, no cycle`, () => {
    const cwd = tmp();
    const gh = fakeGh();
    const res = go({ pr: 7, gh, cwd, snapshot: () => snapshot, ...extra });
    assert.strictEqual(res.code, 3);
    assert.ok(/^NOT READY: /.test(res.message), res.message);
    assert.ok(matcher.test(res.message), res.message);
    noWrites(gh);
    assert.strictEqual(loops.loadState('full-ci-7', cwd).cyclesSeen, 0);
  });
}

section('full-ci: readiness preconditions (exit 3)');

notReady('fullSuiteOwed false', snap({ ci: { fullSuiteOwed: false } }), /owed|FULL SUITE/i);
notReady('pinned read failed', snap({ ci: { pinned: false, fullSuiteOwed: false } }), /pinned check read failed/);
notReady('unresolved threads', snap({ coderabbit: { unresolvedThreads: 2 } }), /unresolved/i);
notReady('human-only unresolved thread (CodeRabbit count 0)', snap({ threads: { unresolved: 1 } }), /^NOT READY: 1 unresolved review thread\(s\)$/);
notReady('CodeRabbit unresolved thread (all-reviewers total agrees)', snap({ threads: { unresolved: 2 }, coderabbit: { unresolvedThreads: 2 } }), /^NOT READY: 2 unresolved review thread\(s\)$/);
notReady('missing threads field fails closed with a distinct reason', { ...snap(), threads: undefined }, /review thread count unavailable/i);
notReady('non-number threads.unresolved fails closed', snap({ threads: { unresolved: '0' } }), /review thread count unavailable/i);
notReady('missing CodeRabbit count fails closed without printing undefined', snap({ coderabbit: { unresolvedThreads: undefined } }), /CodeRabbit.*thread count unavailable/i);

test('no reason ever prints "undefined" or "NaN" for bad thread data', () => {
  for (const s of [{ ...snap(), threads: undefined }, snap({ threads: { unresolved: null } }), snap({ coderabbit: { unresolvedThreads: undefined } })]) {
    const r = fullCi.notReadyReason(s, false);
    assert.ok(r && !/undefined|NaN|null/.test(r), r);
  }
});

test('both thread counts zero is ready (exit 0)', () => {
  const res = go({ pr: 7, gh: fakeGh(), cwd: tmp(), snapshot: () => snap({ threads: { unresolved: 0 }, coderabbit: { unresolvedThreads: 0 } }) });
  assert.strictEqual(res.code, 0, res.message);
});

notReady('rate limited', snap({ coderabbit: { rateLimit: { rateLimited: true } } }), /rate.?limit/i);
notReady('rate limited, cooldown still running', snap({ coderabbit: { rateLimit: { rateLimited: true, resetsAt: '2999-01-01T00:00:00.000Z' } } }), /rate.?limit/i);

test('stale rate-limit comment whose cooldown has elapsed does not block (exit 0)', () => {
  const gh = fakeGh();
  const res = go({ pr: 7, gh, cwd: tmp(),
    snapshot: () => snap({ coderabbit: { rateLimit: { rateLimited: true, resetsAt: '2020-01-01T00:00:00.000Z' } } }) });
  assert.strictEqual(res.code, 0, res.message);
});

test('notReadyReason honours an injected now for the cooldown', () => {
  const s = snap({ coderabbit: { rateLimit: { rateLimited: true, resetsAt: '2026-10-07T12:00:00.000Z' } } });
  assert.ok(/rate.?limit/i.test(fullCi.notReadyReason(s, false, new Date('2026-10-07T11:59:00.000Z'))));
  assert.strictEqual(fullCi.notReadyReason(s, false, new Date('2026-10-07T12:01:00.000Z')), null);
});

test('a real pr-status buildSnapshot of a ready PR is ready (no hand-built snapshot)', () => {
  const prStatus = require(path.join(__dirname, '..', '..', 'lib', 'pr-status.js'));
  const real = prStatus.buildSnapshot({
    pr: 7,
    ci: { state: 'FAILURE', checks: [], fullSuiteSkipped: true, fullSuiteOwed: true, pinned: true },
    coderabbitCheckState: null,
    coderabbitStatusState: 'success',
    reviewThreads: { nodes: [] },
    rateLimitCommentBody: null,
    reviewers: [],
    lastActivityAt: null,
  });
  assert.strictEqual(fullCi.notReadyReason(real, true), null);
});

test('snapshot reader receives the PR number; read error is exit 1 and never writes', () => {
  const gh = fakeGh();
  let seen;
  const res = go({ pr: 7, gh, cwd: tmp(), snapshot: (n) => { seen = n; throw new Error('snap boom'); } });
  assert.strictEqual(seen, 7);
  assert.strictEqual(res.code, 1);
  assert.ok(res.message.includes('snap boom'));
  noWrites(gh);
});

section('full-ci: CodeRabbit-optional switch');

const crOn = { env: { ENVOY_CODERABBIT: 'on' } };
notReady('CodeRabbit on, status absent', snap({ coderabbit: { statusState: null } }), /absent/i, crOn);
notReady('CodeRabbit on, status pending', snap({ coderabbit: { statusState: 'pending' } }), /pending/i, crOn);
notReady('CodeRabbit on, status failure', snap({ coderabbit: { statusState: 'failure' } }), /failure/i, crOn);
notReady('auto with .coderabbit.yaml present, status absent', snap({ coderabbit: { statusState: null } }), /absent/i,
  { env: {}, exists: (f) => f === '/repo/.coderabbit.yaml' });
notReady('auto with .coderabbit.yml present, status absent', snap({ coderabbit: { statusState: null } }), /absent/i,
  { env: { ENVOY_CODERABBIT: 'auto' }, exists: (f) => f === '/repo/.coderabbit.yml' });

test('CodeRabbit on, success (any case): proceeds, exit 0', () => {
  const gh = fakeGh();
  const res = go({ pr: 7, gh, cwd: tmp(), ...crOn, snapshot: () => snap({ coderabbit: { statusState: 'SUCCESS' } }) });
  assert.strictEqual(res.code, 0);
});

test('CodeRabbit off: absent status does not block', () => {
  const gh = fakeGh();
  const res = go({ pr: 7, gh, cwd: tmp(), env: { ENVOY_CODERABBIT: 'off' }, exists: () => true,
    snapshot: () => snap({ coderabbit: { statusState: null } }) });
  assert.strictEqual(res.code, 0);
});

test('auto with no config file: absent status does not block', () => {
  const res = go({ pr: 7, gh: fakeGh(), cwd: tmp(), snapshot: () => snap({ coderabbit: { statusState: null } }) });
  assert.strictEqual(res.code, 0);
});

test('CodeRabbit on, absent status: exit 3 even though unresolved/rate checks pass', () => {
  const gh = fakeGh();
  const res = go({ pr: 7, gh, cwd: tmp(), ...crOn, snapshot: () => snap({ coderabbit: { statusState: null } }) });
  assert.strictEqual(res.code, 3);
  noWrites(gh);
});

test('auto resolves config against repoRoot', () => {
  const checked = [];
  go({ pr: 7, gh: fakeGh(), cwd: tmp(), repoRoot: '/the/root', exists: (f) => { checked.push(f); return false; } });
  assert.deepStrictEqual(checked.sort(), ['/the/root/.coderabbit.yaml', '/the/root/.coderabbit.yml']);
});

test('invalid ENVOY_CODERABBIT: exit 1 "invalid ENVOY_CODERABBIT", no gh calls', () => {
  const gh = fakeGh();
  const res = go({ pr: 7, gh, cwd: tmp(), env: { ENVOY_CODERABBIT: 'maybe' } });
  assert.strictEqual(res.code, 1);
  assert.ok(/invalid ENVOY_CODERABBIT/.test(res.message));
  assert.strictEqual(gh.calls.length, 0);
});

section('full-ci: head SHA race');

test('SHA changed between readiness read and writes: exit 1, no writes, no cycle', () => {
  const cwd = tmp();
  const gh = fakeGh({ shaSequence: ['abc123', 'def456'] });
  const res = go({ pr: 7, gh, cwd });
  assert.strictEqual(res.code, 1);
  assert.ok(/head.*changed|SHA/i.test(res.message));
  noWrites(gh);
  assert.strictEqual(loops.loadState('full-ci-7', cwd).cyclesSeen, 0);
});

test('SHA re-read failure: exit 1, no writes', () => {
  const gh = fakeGh({ shaSequence: ['abc123'] });
  const orig = gh;
  let n = 0;
  const wrapped = (args) => {
    if (args[0] === 'pr' && args[1] === 'view' && ++n === 2) throw new Error('reread boom');
    return orig(args);
  };
  wrapped.calls = orig.calls;
  const res = go({ pr: 7, gh: wrapped, cwd: tmp() });
  assert.strictEqual(res.code, 1);
  noWrites(orig);
});

test('stable SHA: label added then rerun, exit 0', () => {
  const gh = fakeGh({ shaSequence: ['abc123', 'abc123'] });
  assert.strictEqual(go({ pr: 7, gh, cwd: tmp() }).code, 0);
  assert.strictEqual(has(gh, 'run', 'rerun').length, 1);
});

test('label is never removed', () => {
  const gh = fakeGh({ labels: ['full-ci'] });
  go({ pr: 7, gh, cwd: tmp() });
  assert.ok(!gh.calls.some((c) => c.includes('--remove-label')));
});

section('full-ci: loop-safeguards max cycles');

test('records a cycle on loop full-ci-<pr>', () => {
  const cwd = tmp();
  go({ pr: 7, gh: fakeGh(), cwd });
  const state = loops.loadState('full-ci-7', cwd);
  assert.strictEqual(state.cyclesSeen, 1);
  assert.strictEqual(state.maxCycles, fullCi.MAX_CYCLES);
});

test('blocked at maxCycles: code 2, no rerun, no label changes', () => {
  const cwd = tmp();
  for (let i = 0; i < fullCi.MAX_CYCLES; i++) go({ pr: 7, gh: fakeGh(), cwd });
  const gh = fakeGh();
  const res = go({ pr: 7, gh, cwd });
  assert.strictEqual(res.code, 2);
  assert.strictEqual(has(gh, 'run', 'rerun').length, 0);
  assert.strictEqual(has(gh, 'pr', 'edit').length, 0);
  assert.ok(res.message.includes('cleanup full-ci-7'));
  assert.ok(!/\breset\b/.test(res.message));
});

test('failed attempt (no gate) does not consume a cycle', () => {
  const cwd = tmp();
  go({ pr: 7, gh: fakeGh({ rollup: [] }), cwd });
  assert.strictEqual(loops.loadState('full-ci-7', cwd).cyclesSeen, 0);
});

test('other PRs are tracked independently', () => {
  const cwd = tmp();
  for (let i = 0; i < fullCi.MAX_CYCLES; i++) go({ pr: 7, gh: fakeGh(), cwd });
  assert.strictEqual(go({ pr: 8, gh: fakeGh(), cwd }).code, 0);
});

for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
