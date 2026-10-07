#!/usr/bin/env node
/**
 * PR status snapshot engine — Test Suite
 *
 * Fixture-based, no network — covers rate-limit parse, thread counting, snapshot assembly.
 * Run: node tests/lib/pr-status.test.js
 */

const assert = require('assert');
const path = require('path');

const prStatus = require(path.join(__dirname, '..', '..', 'lib', 'pr-status.js'));

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

// ═══════════════════════════════════════════════════════════════════
// parseRateLimit
// ═══════════════════════════════════════════════════════════════════

section('parseRateLimit: CodeRabbit rate-limit comment bodies');

test('non-rate-limit body returns not rate-limited, null reset', () => {
  const result = prStatus.parseRateLimit('Actionable comments posted: 3\n\nLooks good overall.');
  assert.deepStrictEqual(result, { rateLimited: false, resetsAt: null });
});

test('empty / null body returns not rate-limited', () => {
  assert.deepStrictEqual(prStatus.parseRateLimit(''), { rateLimited: false, resetsAt: null });
  assert.deepStrictEqual(prStatus.parseRateLimit(null), { rateLimited: false, resetsAt: null });
});

test('relative "minutes and seconds" body computes resetsAt from now', () => {
  const now = new Date('2026-07-15T12:00:00.000Z');
  const body = [
    '> [!WARNING]',
    '> ## Rate limit exceeded',
    '>',
    '> @rutger has exceeded the limit for the number of commits or files that can be',
    '> reviewed per hour. Please wait **14 minutes and 45 seconds** before requesting',
    '> another review.',
  ].join('\n');
  const result = prStatus.parseRateLimit(body, now);
  assert.strictEqual(result.rateLimited, true);
  // 14*60 + 45 = 885 seconds after noon
  assert.strictEqual(result.resetsAt, '2026-07-15T12:14:45.000Z');
});

test('relative "minutes" only body computes resetsAt from now', () => {
  const now = new Date('2026-07-15T12:00:00.000Z');
  const body = 'Rate limit exceeded. Please wait **22 minutes** before requesting another review.';
  const result = prStatus.parseRateLimit(body, now);
  assert.strictEqual(result.rateLimited, true);
  assert.strictEqual(result.resetsAt, '2026-07-15T12:22:00.000Z');
});

test('absolute ISO timestamp in body is used directly', () => {
  const body = 'Rate limit exceeded. Try again after 2026-07-15T13:30:00Z.';
  const result = prStatus.parseRateLimit(body, new Date('2026-07-15T12:00:00Z'));
  assert.strictEqual(result.rateLimited, true);
  assert.strictEqual(result.resetsAt, '2026-07-15T13:30:00.000Z');
});

test('rate-limit body with no parseable reset returns rateLimited true, null reset', () => {
  const body = 'Rate limit exceeded — please try again later.';
  const result = prStatus.parseRateLimit(body, new Date('2026-07-15T12:00:00Z'));
  assert.strictEqual(result.rateLimited, true);
  assert.strictEqual(result.resetsAt, null);
});

// ═══════════════════════════════════════════════════════════════════
// countUnresolvedThreads
// ═══════════════════════════════════════════════════════════════════

section('countUnresolvedThreads: GraphQL reviewThreads filtered to CodeRabbit + unresolved');

function thread(login, isResolved) {
  return {
    isResolved,
    comments: { nodes: [{ author: { login } }] },
  };
}

test('counts only CodeRabbit unresolved threads', () => {
  const payload = {
    nodes: [
      thread('coderabbitai', false),   // count
      thread('coderabbitai[bot]', false), // count
      thread('coderabbitai', true),    // resolved — skip
      thread('rutger', false),         // not CR — skip
      thread('CodeRabbit', false),     // case-insensitive — count
    ],
  };
  assert.strictEqual(prStatus.countUnresolvedThreads(payload), 3);
});

test('accepts a bare nodes array as well as the reviewThreads object', () => {
  const nodes = [thread('coderabbitai', false), thread('coderabbitai', true)];
  assert.strictEqual(prStatus.countUnresolvedThreads(nodes), 1);
  assert.strictEqual(prStatus.countUnresolvedThreads({ nodes }), 1);
});

test('empty / missing payload returns 0', () => {
  assert.strictEqual(prStatus.countUnresolvedThreads({ nodes: [] }), 0);
  assert.strictEqual(prStatus.countUnresolvedThreads(null), 0);
  assert.strictEqual(prStatus.countUnresolvedThreads(undefined), 0);
});

test('thread with no comments is ignored', () => {
  const payload = { nodes: [{ isResolved: false, comments: { nodes: [] } }] };
  assert.strictEqual(prStatus.countUnresolvedThreads(payload), 0);
});

// ═══════════════════════════════════════════════════════════════════
// buildSnapshot
// ═══════════════════════════════════════════════════════════════════

section('buildSnapshot: schema-stable assembly from raw inputs');

const rawInputs = {
  pr: 42,
  ci: { state: 'FAILURE', checks: [{ name: 'test', state: 'FAILURE' }, { name: 'build', state: 'SUCCESS' }] },
  coderabbitCheckState: 'SUCCESS',
  reviewThreads: {
    nodes: [
      thread('coderabbitai', false),
      thread('coderabbitai', false),
      thread('coderabbitai', true),
      thread('rutger', false),
    ],
  },
  rateLimitCommentBody: 'Rate limit exceeded. Please wait **10 minutes** before requesting another review.',
  reviewers: [{ login: 'rutger', state: 'APPROVED' }],
  lastActivityAt: '2026-07-15T11:30:00.000Z',
  now: new Date('2026-07-15T12:00:00.000Z'),
};

test('snapshot has schema-stable top-level shape', () => {
  const snap = prStatus.buildSnapshot(rawInputs);
  assert.deepStrictEqual(Object.keys(snap).sort(), ['ci', 'coderabbit', 'idle', 'pr', 'reviewers', 'threads'].sort());
});

test('threads block counts all-author unresolved threads from GraphQL', () => {
  const snap = prStatus.buildSnapshot(rawInputs);
  assert.strictEqual(snap.threads.unresolved, 3);
});

test('snapshot pr and ci pass through', () => {
  const snap = prStatus.buildSnapshot(rawInputs);
  assert.strictEqual(snap.pr, 42);
  assert.strictEqual(snap.ci.state, 'FAILURE');
  assert.strictEqual(snap.ci.checks.length, 2);
});

test('coderabbit block wires checkState, unresolvedThreads (from GraphQL), rateLimit', () => {
  const snap = prStatus.buildSnapshot(rawInputs);
  assert.strictEqual(snap.coderabbit.checkState, 'SUCCESS');
  assert.strictEqual(snap.coderabbit.unresolvedThreads, 2);
  assert.strictEqual(snap.coderabbit.rateLimit.rateLimited, true);
  assert.strictEqual(snap.coderabbit.rateLimit.resetsAt, '2026-07-15T12:10:00.000Z');
});

test('idle block computes idleMinutes from lastActivityAt and now', () => {
  const snap = prStatus.buildSnapshot(rawInputs);
  assert.strictEqual(snap.idle.lastActivityAt, '2026-07-15T11:30:00.000Z');
  assert.strictEqual(snap.idle.idleMinutes, 30);
});

test('reviewers pass through', () => {
  const snap = prStatus.buildSnapshot(rawInputs);
  assert.deepStrictEqual(snap.reviewers, [{ login: 'rutger', state: 'APPROVED' }]);
});

test('missing rate-limit comment body yields not-rate-limited', () => {
  const snap = prStatus.buildSnapshot({ ...rawInputs, rateLimitCommentBody: null });
  assert.deepStrictEqual(snap.coderabbit.rateLimit, { rateLimited: false, resetsAt: null });
});

test('missing lastActivityAt yields null idleMinutes', () => {
  const snap = prStatus.buildSnapshot({ ...rawInputs, lastActivityAt: null });
  assert.strictEqual(snap.idle.lastActivityAt, null);
  assert.strictEqual(snap.idle.idleMinutes, null);
});

// ═══════════════════════════════════════════════════════════════════
// summarizeChecks
// ═══════════════════════════════════════════════════════════════════

section('summarizeChecks: CI rollup state + CodeRabbit check derivation');

test('empty rollup yields NONE state, no checks, null CodeRabbit state', () => {
  const result = prStatus.summarizeChecks([]);
  assert.strictEqual(result.ci.state, 'NONE');
  assert.deepStrictEqual(result.ci.checks, []);
  assert.strictEqual(result.coderabbitCheckState, null);
});

test('missing rollup (undefined) is treated as empty', () => {
  const result = prStatus.summarizeChecks(undefined);
  assert.strictEqual(result.ci.state, 'NONE');
  assert.strictEqual(result.coderabbitCheckState, null);
});

test('all-success checks yield SUCCESS', () => {
  const result = prStatus.summarizeChecks([
    { name: 'test', conclusion: 'SUCCESS' },
    { name: 'build', conclusion: 'SUCCESS' },
  ]);
  assert.strictEqual(result.ci.state, 'SUCCESS');
});

test('any failing check yields FAILURE (precedence over pending)', () => {
  const result = prStatus.summarizeChecks([
    { name: 'a', conclusion: 'PENDING' },
    { name: 'b', conclusion: 'FAILURE' },
    { name: 'c', conclusion: 'SUCCESS' },
  ]);
  assert.strictEqual(result.ci.state, 'FAILURE');
});

test('pending without failure yields PENDING', () => {
  const result = prStatus.summarizeChecks([
    { name: 'a', conclusion: 'SUCCESS' },
    { name: 'b', status: 'IN_PROGRESS' },
  ]);
  assert.strictEqual(result.ci.state, 'PENDING');
});

test('name falls back context→unknown; state falls back conclusion→state→status→null', () => {
  const result = prStatus.summarizeChecks([
    { context: 'legacy-status', state: 'SUCCESS' },
    { conclusion: 'SUCCESS' },
  ]);
  assert.strictEqual(result.ci.checks[0].name, 'legacy-status');
  assert.strictEqual(result.ci.checks[1].name, 'unknown');
  assert.strictEqual(result.ci.checks[0].state, 'SUCCESS');
});

test('CodeRabbit check state is picked out by name (case-insensitive)', () => {
  const result = prStatus.summarizeChecks([
    { name: 'CI', conclusion: 'SUCCESS' },
    { name: 'CodeRabbit', conclusion: 'NEUTRAL' },
  ]);
  assert.strictEqual(result.coderabbitCheckState, 'NEUTRAL');
});

test('no CodeRabbit check yields null coderabbitCheckState', () => {
  const result = prStatus.summarizeChecks([{ name: 'CI', conclusion: 'SUCCESS' }]);
  assert.strictEqual(result.coderabbitCheckState, null);
});

function withGateEnv(value, fn) {
  const prev = process.env.ENVOY_CI_GATE_CHECK;
  if (value === undefined) delete process.env.ENVOY_CI_GATE_CHECK;
  else process.env.ENVOY_CI_GATE_CHECK = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.ENVOY_CI_GATE_CHECK;
    else process.env.ENVOY_CI_GATE_CHECK = prev;
  }
}

const gateNode = (over) => ({
  name: 'ci-gate',
  conclusion: 'FAILURE',
  detailsUrl: 'https://github.com/o/r/actions/runs/111/job/222',
  ...over,
});
const MARKER = [{ message: '::error::FULL SUITE NOT RUN - add the full-ci label', title: '' }];

test('summarizeChecks returns failed ci-gate candidates with check-run id from detailsUrl', () => {
  const r = withGateEnv(undefined, () => prStatus.summarizeChecks([gateNode(), { name: 'build', conclusion: 'SUCCESS' }]));
  assert.deepStrictEqual(r.gateChecks, [{ name: 'ci-gate', state: 'FAILURE', checkRunId: '222' }]);
  assert.strictEqual(r.ci.checks.length, 2);
});

test('summarizeChecks gate name match is case-insensitive and honors ENVOY_CI_GATE_CHECK', () => {
  const r = withGateEnv('My-Gate', () => prStatus.summarizeChecks([gateNode({ name: 'my-gate' }), gateNode()]));
  assert.deepStrictEqual(r.gateChecks.map((g) => g.name), ['my-gate']);
});

test('summarizeChecks excludes SUCCESS gate and gate without parsable id', () => {
  const r = withGateEnv(undefined, () =>
    prStatus.summarizeChecks([gateNode({ conclusion: 'SUCCESS' }), gateNode({ detailsUrl: 'https://x/none' }), gateNode({ detailsUrl: undefined })])
  );
  assert.deepStrictEqual(r.gateChecks, []);
});

test('summarizeChecks accepts ERROR and TIMED_OUT gate states, null rollup yields no gates', () => {
  const t = withGateEnv(undefined, () => prStatus.summarizeChecks([gateNode({ conclusion: 'TIMED_OUT' })]));
  const e = withGateEnv(undefined, () => prStatus.summarizeChecks([gateNode({ conclusion: 'error' })]));
  assert.strictEqual(t.gateChecks.length, 1);
  assert.strictEqual(e.gateChecks.length, 1);
  assert.deepStrictEqual(prStatus.summarizeChecks(null).gateChecks, []);
});

test('a non-gate check literally named FULL SUITE NOT RUN does not count', () => {
  const r = withGateEnv(undefined, () => prStatus.summarizeChecks([{ name: 'FULL SUITE NOT RUN', conclusion: 'SUCCESS', detailsUrl: 'u/job/5' }]));
  assert.deepStrictEqual(r.gateChecks, []);
  assert.strictEqual(prStatus.detectFullSuiteSkipped(r.gateChecks, () => MARKER), false);
});

test('detectFullSuiteSkipped: failed gate with marker annotation is true', () => {
  const calls = [];
  const out = prStatus.detectFullSuiteSkipped([{ name: 'ci-gate', state: 'FAILURE', checkRunId: '222' }], (id) => {
    calls.push(id);
    return MARKER;
  });
  assert.strictEqual(out, true);
  assert.deepStrictEqual(calls, ['222']);
});

test('detectFullSuiteSkipped: unrelated annotation is false', () => {
  const out = prStatus.detectFullSuiteSkipped([{ checkRunId: '1' }], () => [{ message: 'tests failed', title: 'x' }]);
  assert.strictEqual(out, false);
});

test('detectFullSuiteSkipped: marker matched in title, case-insensitive', () => {
  const out = prStatus.detectFullSuiteSkipped([{ checkRunId: '1' }], () => [{ message: 'm', title: 'Full Suite Not Run' }]);
  assert.strictEqual(out, true);
});

test('detectFullSuiteSkipped: no gate checks means no fetch and false', () => {
  let called = false;
  assert.strictEqual(prStatus.detectFullSuiteSkipped([], () => { called = true; return MARKER; }), false);
  assert.strictEqual(called, false);
});

test('detectFullSuiteSkipped: fetch throwing yields false and never throws', () => {
  const out = prStatus.detectFullSuiteSkipped([{ checkRunId: '1' }], () => { throw new Error('gh failed'); });
  assert.strictEqual(out, false);
});

test('detectFullSuiteSkipped: later gate can still match after an earlier fetch error', () => {
  const out = prStatus.detectFullSuiteSkipped([{ checkRunId: '1' }, { checkRunId: '2' }], (id) => {
    if (id === '1') throw new Error('x');
    return MARKER;
  });
  assert.strictEqual(out, true);
});

test('buildSnapshot passes ci.fullSuiteSkipped through, defaulting to false', () => {
  const on = prStatus.buildSnapshot({ ...rawInputs, ci: { state: 'SUCCESS', checks: [], fullSuiteSkipped: true } });
  assert.strictEqual(on.ci.fullSuiteSkipped, true);
  assert.strictEqual(prStatus.buildSnapshot(rawInputs).ci.fullSuiteSkipped, false);
});

// ═══════════════════════════════════════════════════════════════════
// countUnresolvedTotal
// ═══════════════════════════════════════════════════════════════════

section('countUnresolvedTotal: all-author unresolved review threads');

test('counts every unresolved thread regardless of author', () => {
  const payload = {
    nodes: [
      thread('coderabbitai', false),   // count
      thread('rutger', false),         // count
      thread('someReviewer', false),   // count
      thread('coderabbitai', true),    // resolved — skip
      thread('rutger', true),          // resolved — skip
    ],
  };
  assert.strictEqual(prStatus.countUnresolvedTotal(payload), 3);
});

test('accepts a bare nodes array as well as the reviewThreads object', () => {
  const nodes = [thread('rutger', false), thread('coderabbitai', false), thread('rutger', true)];
  assert.strictEqual(prStatus.countUnresolvedTotal(nodes), 2);
  assert.strictEqual(prStatus.countUnresolvedTotal({ nodes }), 2);
});

test('empty / missing payload returns 0', () => {
  assert.strictEqual(prStatus.countUnresolvedTotal({ nodes: [] }), 0);
  assert.strictEqual(prStatus.countUnresolvedTotal(null), 0);
  assert.strictEqual(prStatus.countUnresolvedTotal(undefined), 0);
});

test('threads without an explicit false isResolved are not counted', () => {
  const payload = { nodes: [{ isResolved: true }, { isResolved: undefined }, {}] };
  assert.strictEqual(prStatus.countUnresolvedTotal(payload), 0);
});

// ═══════════════════════════════════════════════════════════════════
// fetchReviewThreads pagination (injected page-fetcher — no network)
// ═══════════════════════════════════════════════════════════════════

section('fetchReviewThreads: accumulates nodes across paginated fetchPage calls');

test('accumulates all nodes across multiple pages', () => {
  const pages = [
    { nodes: [thread('rutger', false), thread('coderabbitai', false)], pageInfo: { hasNextPage: true, endCursor: 'c1' } },
    { nodes: [thread('someReviewer', true)], pageInfo: { hasNextPage: true, endCursor: 'c2' } },
    { nodes: [thread('rutger', true)], pageInfo: { hasNextPage: false, endCursor: 'c3' } },
  ];
  const seenCursors = [];
  const fakeFetchPage = (repo, prNumber, after) => {
    seenCursors.push(after);
    return pages.shift();
  };
  const result = prStatus.fetchReviewThreads({ owner: 'o', repo: 'r' }, 7, fakeFetchPage);
  assert.strictEqual(result.nodes.length, 4);
  assert.deepStrictEqual(seenCursors, [null, 'c1', 'c2']);
});

test('single page (hasNextPage false) returns that page only', () => {
  let calls = 0;
  const fakeFetchPage = () => {
    calls++;
    return { nodes: [thread('rutger', false)], pageInfo: { hasNextPage: false, endCursor: 'c1' } };
  };
  const result = prStatus.fetchReviewThreads({ owner: 'o', repo: 'r' }, 7, fakeFetchPage);
  assert.strictEqual(result.nodes.length, 1);
  assert.strictEqual(calls, 1);
});

test('aborts (does not hang) when hasNextPage stays true but the cursor never advances', () => {
  // Safety cap so a missing guard surfaces as a distinct error, not an infinite hang.
  let calls = 0;
  const fakeFetchPage = () => {
    if (++calls > 50) throw new Error('SAFETY: loop did not terminate');
    return { nodes: [thread('rutger', false)], pageInfo: { hasNextPage: true, endCursor: null } };
  };
  assert.throws(
    () => prStatus.fetchReviewThreads({ owner: 'o', repo: 'r' }, 7, fakeFetchPage),
    /did not advance/,
    'must abort with a clear invariant error, not hang, when the cursor does not advance'
  );
});

// ═══════════════════════════════════════════════════════════════════
// SHA-pinned reads, dedupe, combined status, fullSuiteOwed (#87)
// ═══════════════════════════════════════════════════════════════════

section('summarizeChecks: dedupe by name keeping the latest run');

const run = (over) => ({
  name: 'ci-gate',
  status: 'completed',
  conclusion: 'failure',
  started_at: '2026-10-07T10:00:00Z',
  completed_at: '2026-10-07T10:05:00Z',
  details_url: 'https://github.com/o/r/actions/runs/111/job/222',
  ...over,
});
const green = (over) => run({ conclusion: 'success', started_at: '2026-10-07T11:00:00Z', completed_at: '2026-10-07T11:05:00Z', details_url: 'https://github.com/o/r/actions/runs/333/job/444', ...over });
const status = (context, state, over) => ({ __typename: 'StatusContext', context, state, created_at: '2026-10-07T10:00:00Z', ...over });
const markerFetch = () => MARKER;
const ciFor = (nodes) => withGateEnv(undefined, () => {
  const summary = prStatus.summarizeChecks(nodes);
  return { summary, ci: prStatus.deriveCi(summary, markerFetch) };
});

test('older failed ci-gate run is superseded by a newer green run (API snake_case timestamps)', () => {
  const { summary, ci } = ciFor([run(), green()]);
  assert.strictEqual(summary.ci.checks.length, 1);
  assert.strictEqual(summary.ci.state, 'SUCCESS');
  assert.deepStrictEqual(summary.gateChecks, []);
  assert.strictEqual(ci.fullSuiteSkipped, false);
  assert.strictEqual(ci.fullSuiteOwed, false);
});

test('dedupe is order-independent and handles gh camelCase timestamps', () => {
  const oldFail = { name: 'ci-gate', workflowName: 'CI', conclusion: 'FAILURE', startedAt: '2026-10-07T10:00:00Z', completedAt: '2026-10-07T10:05:00Z', detailsUrl: 'u/job/1' };
  const newGreen = { name: 'ci-gate', workflowName: 'CI', conclusion: 'SUCCESS', startedAt: '2026-10-07T11:00:00Z', completedAt: '2026-10-07T11:05:00Z' };
  const r = prStatus.summarizeChecks([newGreen, oldFail]);
  assert.strictEqual(r.ci.checks.length, 1);
  assert.strictEqual(r.ci.state, 'SUCCESS');
});

test('same name from two different apps is not collapsed: the failure is kept, not owed', () => {
  const nodes = [
    green({ app: { slug: 'github-actions' } }),
    run({ name: 'check', app: { slug: 'other-app' }, started_at: '2026-10-07T09:00:00Z', completed_at: '2026-10-07T09:01:00Z' }),
    { name: 'check', status: 'completed', conclusion: 'success', app: { slug: 'github-actions' }, completed_at: '2026-10-07T12:00:00Z' },
  ];
  const { summary, ci } = ciFor(nodes);
  assert.strictEqual(summary.ci.checks.length, 3);
  assert.strictEqual(summary.ci.state, 'FAILURE');
  assert.strictEqual(ci.fullSuiteOwed, false);
});

test('same name from two different workflows (gh rollup workflowName) is not collapsed', () => {
  const r = prStatus.summarizeChecks([
    { name: 'test', workflowName: 'A', conclusion: 'FAILURE', completedAt: '2026-10-07T10:00:00Z' },
    { name: 'test', workflowName: 'B', conclusion: 'SUCCESS', completedAt: '2026-10-07T11:00:00Z' },
  ]);
  assert.strictEqual(r.ci.checks.length, 2);
  assert.strictEqual(r.ci.state, 'FAILURE');
});

test('case-differing names are not merged (GitHub check names are case-sensitive)', () => {
  const r = prStatus.summarizeChecks([
    { name: 'Build', conclusion: 'FAILURE', completedAt: '2026-10-07T10:00:00Z' },
    { name: 'build', conclusion: 'SUCCESS', completedAt: '2026-10-07T11:00:00Z' },
  ]);
  assert.strictEqual(r.ci.checks.length, 2);
  assert.strictEqual(r.ci.state, 'FAILURE');
});

test('a newer in-progress rerun supersedes an older failed run (not owed)', () => {
  const rerun = run({ status: 'in_progress', conclusion: null, started_at: '2026-10-07T11:00:00Z', completed_at: null });
  const { summary, ci } = ciFor([run(), rerun]);
  assert.strictEqual(summary.ci.state, 'PENDING');
  assert.strictEqual(ci.fullSuiteOwed, false);
});

section('deriveCi: fullSuiteOwed');

test('marker on latest ci-gate with every other check green is owed', () => {
  const { ci } = ciFor([run(), { name: 'check', status: 'completed', conclusion: 'success' }, status('CodeRabbit', 'success')]);
  assert.strictEqual(ci.fullSuiteSkipped, true);
  assert.strictEqual(ci.fullSuiteOwed, true);
  assert.strictEqual(ci.state, 'FAILURE');
});

test('marker plus a failed non-gate check is not owed and ci.state stays failing', () => {
  const { ci } = ciFor([run(), { name: 'check', status: 'completed', conclusion: 'failure' }]);
  assert.strictEqual(ci.fullSuiteSkipped, true);
  assert.strictEqual(ci.fullSuiteOwed, false);
  assert.strictEqual(ci.state, 'FAILURE');
});

test('marker plus a pending non-gate check is not owed', () => {
  const { ci } = ciFor([run(), { name: 'check', status: 'in_progress', conclusion: null }]);
  assert.strictEqual(ci.fullSuiteOwed, false);
});

test('marker plus a failed or pending commit status of any context is not owed', () => {
  for (const state of ['failure', 'error', 'pending']) {
    for (const ctx of ['CodeRabbit', 'deploy/preview']) {
      const { ci } = ciFor([run(), status(ctx, state)]);
      assert.strictEqual(ci.fullSuiteSkipped, true, `${ctx}/${state} skipped`);
      assert.strictEqual(ci.fullSuiteOwed, false, `${ctx}/${state} owed`);
    }
  }
});

test('no marker means not owed even when only the gate fails', () => {
  const summary = withGateEnv(undefined, () => prStatus.summarizeChecks([run()]));
  const ci = prStatus.deriveCi(summary, () => []);
  assert.strictEqual(ci.fullSuiteOwed, false);
});

test('pinned:false (read failure) forces fullSuiteOwed false even with marker', () => {
  const summary = withGateEnv(undefined, () => prStatus.summarizeChecks([run()]));
  const ci = prStatus.deriveCi(summary, markerFetch, { pinned: false });
  assert.strictEqual(ci.fullSuiteSkipped, true);
  assert.strictEqual(ci.fullSuiteOwed, false);
  assert.strictEqual(ci.pinned, false);
});

section('buildSnapshot: fullSuiteOwed and coderabbit.statusState');

test('buildSnapshot passes ci.fullSuiteOwed through, defaulting to false', () => {
  const on = prStatus.buildSnapshot({ ...rawInputs, ci: { state: 'FAILURE', checks: [], fullSuiteSkipped: true, fullSuiteOwed: true } });
  assert.strictEqual(on.ci.fullSuiteOwed, true);
  assert.strictEqual(prStatus.buildSnapshot(rawInputs).ci.fullSuiteOwed, false);
});

test('buildSnapshot exposes coderabbit.statusState separately; absent is null', () => {
  assert.strictEqual(prStatus.buildSnapshot({ ...rawInputs, coderabbitStatusState: 'SUCCESS' }).coderabbit.statusState, 'SUCCESS');
  assert.strictEqual(prStatus.buildSnapshot(rawInputs).coderabbit.statusState, null);
  assert.strictEqual(prStatus.buildSnapshot(rawInputs).coderabbit.checkState, 'SUCCESS');
});

section('CodeRabbit commit status via combined status');

test('combined status keeps latest per context: superseded pending/failed CodeRabbit resolves to success', () => {
  const nodes = prStatus.normalizePinnedNodes([], {
    statuses: [{ context: 'CodeRabbit', state: 'success', created_at: '2026-10-07T12:00:00Z' }],
  });
  assert.strictEqual(prStatus.summarizeChecks(nodes).coderabbitStatusState, 'success');
});

test('summarizeChecks also dedupes duplicate statuses by context, latest created_at wins', () => {
  const r = prStatus.summarizeChecks([
    status('CodeRabbit', 'pending', { created_at: '2026-10-07T10:00:00Z' }),
    status('CodeRabbit', 'success', { created_at: '2026-10-07T12:00:00Z' }),
    status('CodeRabbit', 'failure', { created_at: '2026-10-07T11:00:00Z' }),
  ]);
  assert.strictEqual(r.coderabbitStatusState, 'success');
  assert.strictEqual(r.ci.state, 'SUCCESS');
});

test('no CodeRabbit status yields null statusState, distinct from success; check run does not count as status', () => {
  const nodes = prStatus.normalizePinnedNodes([{ name: 'CodeRabbit', status: 'completed', conclusion: 'success' }], { statuses: [] });
  const r = prStatus.summarizeChecks(nodes);
  assert.strictEqual(r.coderabbitStatusState, null);
  assert.strictEqual(r.coderabbitCheckState, 'success');
  assert.strictEqual(prStatus.summarizeChecks([]).coderabbitStatusState, null);
});

section('readPinnedChecks: SHA validation and injectable fetchers');

test('rejects a non-40-hex SHA without calling any fetcher', () => {
  let called = false;
  const f = () => { called = true; return []; };
  assert.throws(() => prStatus.readPinnedChecks({ owner: 'o', repo: 'r' }, 'abc; rm -rf', { fetchCheckRuns: f, fetchStatus: f }), /invalid head SHA/);
  assert.strictEqual(called, false);
});

test('reads check runs and combined status for the SHA and merges into nodes', () => {
  const sha = 'a'.repeat(40);
  const seen = [];
  const nodes = prStatus.readPinnedChecks({ owner: 'o', repo: 'r' }, sha, {
    fetchCheckRuns: (repo, s) => { seen.push(['runs', s]); return [run()]; },
    fetchStatus: (repo, s) => { seen.push(['status', s]); return { total_count: 1, statuses: [{ context: 'CodeRabbit', state: 'success' }] }; },
  });
  assert.deepStrictEqual(seen, [['runs', sha], ['status', sha]]);
  assert.strictEqual(nodes.length, 2);
  assert.ok(nodes.some((n) => n.context === 'CodeRabbit' && n.__typename === 'StatusContext'));
});

test('combined status with total_count > statuses.length throws (fail closed, no silent truncation)', () => {
  const sha = 'c'.repeat(40);
  assert.throws(() => prStatus.readPinnedChecks({ owner: 'o', repo: 'r' }, sha, {
    fetchCheckRuns: () => [],
    fetchStatus: () => ({ total_count: 150, statuses: new Array(100).fill({ context: 'x', state: 'success' }) }),
  }), /truncated|total_count/);
});

test('combined status with matching total_count is accepted', () => {
  const sha = 'd'.repeat(40);
  const nodes = prStatus.readPinnedChecks({ owner: 'o', repo: 'r' }, sha, {
    fetchCheckRuns: () => [],
    fetchStatus: () => ({ total_count: 1, statuses: [{ context: 'x', state: 'success' }] }),
  });
  assert.strictEqual(nodes.length, 1);
});

test('combined status with missing or non-numeric total_count throws (fail closed)', () => {
  const sha = 'e'.repeat(40);
  for (const bad of [undefined, null, '1', NaN, Infinity]) {
    assert.throws(() => prStatus.readPinnedChecks({ owner: 'o', repo: 'r' }, sha, {
      fetchCheckRuns: () => [],
      fetchStatus: () => ({ total_count: bad, statuses: [{ context: 'x', state: 'success' }] }),
    }), /total_count/, `total_count=${String(bad)}`);
  }
  assert.throws(() => prStatus.readPinnedChecks({ owner: 'o', repo: 'r' }, sha, {
    fetchCheckRuns: () => [],
    fetchStatus: () => ({ statuses: [] }),
  }), /total_count/);
  assert.throws(() => prStatus.readPinnedChecks({ owner: 'o', repo: 'r' }, sha, {
    fetchCheckRuns: () => [],
    fetchStatus: () => null,
  }), /total_count/);
});

test('total_count 0 with an empty statuses list is accepted', () => {
  const sha = 'f'.repeat(40);
  const nodes = prStatus.readPinnedChecks({ owner: 'o', repo: 'r' }, sha, {
    fetchCheckRuns: () => [],
    fetchStatus: () => ({ total_count: 0, statuses: [] }),
  });
  assert.deepStrictEqual(nodes, []);
});

test('a fetcher error propagates (caller fails closed)', () => {
  const sha = 'b'.repeat(40);
  assert.throws(() => prStatus.readPinnedChecks({ owner: 'o', repo: 'r' }, sha, {
    fetchCheckRuns: () => { throw new Error('boom'); },
    fetchStatus: () => ({ total_count: 0, statuses: [] }),
  }), /boom/);
});

section('readPinnedChecks: fetch order (dae0334)');

test('check runs are fetched before the combined status', () => {
  const sha = '1'.repeat(40);
  const order = [];
  prStatus.readPinnedChecks({ owner: 'o', repo: 'r' }, sha, {
    fetchCheckRuns: () => { order.push('checkRuns'); return []; },
    fetchStatus: () => { order.push('status'); return { total_count: 0, statuses: [] }; },
  });
  assert.deepStrictEqual(order, ['checkRuns', 'status']);
});

test('a check-runs fetch error short-circuits: the status fetcher is never called', () => {
  const sha = '2'.repeat(40);
  const order = [];
  assert.throws(() => prStatus.readPinnedChecks({ owner: 'o', repo: 'r' }, sha, {
    fetchCheckRuns: () => { order.push('checkRuns'); throw new Error('check-runs boom'); },
    fetchStatus: () => { order.push('status'); return { total_count: 0, statuses: [] }; },
  }), /check-runs boom/);
  assert.deepStrictEqual(order, ['checkRuns']);
});

section('buildSnapshot: real deriveCi output survives into the snapshot');

test('ci.pinned from deriveCi is carried through buildSnapshot (true and false)', () => {
  const { ci } = ciFor([run(), { name: 'check', status: 'completed', conclusion: 'success' }]);
  assert.strictEqual(ci.pinned, true);
  const snap = prStatus.buildSnapshot({ ...rawInputs, ci });
  assert.strictEqual(snap.ci.pinned, true);
  assert.strictEqual(snap.ci.fullSuiteOwed, true);

  const summary = withGateEnv(undefined, () => prStatus.summarizeChecks([run()]));
  const unpinned = prStatus.deriveCi(summary, markerFetch, { pinned: false });
  assert.strictEqual(prStatus.buildSnapshot({ ...rawInputs, ci: unpinned }).ci.pinned, false);
});

test('ci.pinned fails closed to false when absent', () => {
  const snap = prStatus.buildSnapshot({ ...rawInputs, ci: { state: 'FAILURE', checks: [] } });
  assert.strictEqual(snap.ci.pinned, false);
});

section('buildSnapshot: relative rate-limit cooldown is measured from the comment time');

test('relative "N minutes" resetsAt is anchored on rateLimitCommentAt, not now', () => {
  const snap = prStatus.buildSnapshot({
    ...rawInputs,
    rateLimitCommentAt: '2026-07-15T09:00:00.000Z',
    now: new Date('2026-07-15T12:00:00.000Z'),
  });
  assert.strictEqual(snap.coderabbit.rateLimit.rateLimited, true);
  assert.strictEqual(snap.coderabbit.rateLimit.resetsAt, '2026-07-15T09:10:00.000Z');
});

test('without rateLimitCommentAt the relative cooldown still falls back to now', () => {
  const snap = prStatus.buildSnapshot({ ...rawInputs, rateLimitCommentAt: null });
  assert.strictEqual(snap.coderabbit.rateLimit.resetsAt, '2026-07-15T12:10:00.000Z');
});

// ═══════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
