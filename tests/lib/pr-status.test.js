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
  assert.deepStrictEqual(Object.keys(snap).sort(), ['ci', 'coderabbit', 'idle', 'pr', 'reviewers'].sort());
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
// Summary
// ═══════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
