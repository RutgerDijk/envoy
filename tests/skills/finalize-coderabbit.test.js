#!/usr/bin/env node
/**
 * Finalize CodeRabbit step — contract tests.
 *
 * Guards the #25 fix: finalize's CodeRabbit poll/advance gates must route through
 * lib/pr-status.js (GraphQL unresolved-thread count + rate-limit), NOT a REST-only
 * comment count that misses inline review threads.
 *
 * Since #94 the wait itself lives in lib/pr-poll.js (one backgrounded Bash call,
 * Claude re-invoked on exit), so the pr-status / unresolvedThreads / rateLimit
 * assertions target the lib, and both step files must be free of foreground waits.
 *
 * Run: node tests/skills/finalize-coderabbit.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..', '..');
const STEP = path.join(REPO_ROOT, 'skills', 'finalize', 'steps', 'coderabbit.md');
const CI_STEP = path.join(REPO_ROOT, 'skills', 'finalize', 'steps', 'ci.md');
const POLLER = path.join(REPO_ROOT, 'lib', 'pr-poll.js');

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

const md = fs.readFileSync(STEP, 'utf8');
const ciMd = fs.readFileSync(CI_STEP, 'utf8');
const poller = fs.existsSync(POLLER) ? fs.readFileSync(POLLER, 'utf8') : '';

section('finalize CodeRabbit wait routes through lib/pr-poll.js -> pr-status.js (#25, #94)');

test('lib/pr-poll.js exists', () => {
  assert.ok(poller.length > 0, 'lib/pr-poll.js must exist');
});

test('pr-poll.js uses lib/pr-status.js getSnapshot as the status source', () => {
  assert.ok(/pr-status(\.js)?['"]/.test(poller), 'pr-poll.js must require lib/pr-status.js');
  assert.ok(/getSnapshot/.test(poller), 'pr-poll.js must probe via getSnapshot');
});

test('pr-poll.js gates on GraphQL-derived unresolvedThreads', () => {
  assert.ok(/unresolvedThreads/.test(poller), 'the settle gate must use the unresolvedThreads snapshot field');
});

test('pr-poll.js honors CodeRabbit rate-limit state via shouldReTrigger', () => {
  assert.ok(/rateLimit/.test(poller), 'polling must consult the rateLimit snapshot so a rate-limited review is not read as "clean"');
  assert.ok(/coderabbit-retrigger(\.js)?['"]/.test(poller) && /shouldReTrigger/.test(poller),
    'the rate-limit decision must come from lib/coderabbit-retrigger.js shouldReTrigger');
});

test('coderabbit.md still names pr-status.js, unresolvedThreads and rateLimit for the Step 8 re-check', () => {
  assert.ok(/pr-status\.js/.test(md));
  assert.ok(/unresolvedThreads/.test(md));
  assert.ok(/rateLimit/.test(md));
});

test('no REST-only coderabbit comment-count is the sole advance signal', () => {
  assert.ok(
    !/select\(\s*\.user\.login\s*==\s*"coderabbitai"\s*\)\]\s*\|\s*length/.test(md),
    'the REST comment-count poll expression must be removed as the advance signal'
  );
});

test('each poll block self-derives PR_NUMBER (separate shell invocations)', () => {
  const defs = md.match(/PR_NUMBER=\$\(jq -r \.prNumber \.envoy\/finalize\/state\.json\)/g) || [];
  assert.ok(
    defs.length >= 2,
    `both the background wait and the re-poll block must derive PR_NUMBER in their own shell; found ${defs.length}`
  );
});

test('the Step 8 probe is non-fatal and checks for an empty snapshot before jq', () => {
  assert.ok(/SNAP=\$\(\$PR_STATUS "\$PR_NUMBER" 2>\/dev\/null \|\| true\)/.test(md),
    'a failing pr-status probe must not abort the step (needs "2>/dev/null || true")');
  assert.ok(/if \[ -z "\$SNAP" \]/.test(md), 'jq must be gated behind an explicit -z "$SNAP" check');
});

section('both step files wait in the background, not in the foreground (#94)');

for (const [name, body] of [['coderabbit.md', md], ['ci.md', ciMd]]) {
  test(`${name} contains no sleep`, () => {
    assert.ok(!/sleep/i.test(body), `${name} must not contain "sleep" — waits go through lib/pr-poll.js`);
  });

  test(`${name} waits via pr-poll.js with run_in_background: true`, () => {
    assert.ok(body.includes('node ${CLAUDE_SKILL_DIR}/../../lib/pr-poll.js "$PR_NUMBER" --target'),
      `${name} must call the poller via \${CLAUDE_SKILL_DIR}/../../lib/pr-poll.js`);
    assert.ok(/run_in_background: true/.test(body), `${name} must run the poller with run_in_background: true`);
  });

  test(`${name} branches on every poller exit code`, () => {
    for (const code of [0, 1, 2, 3]) {
      assert.ok(new RegExp(`\\*\\*Exit ${code}\\b`).test(body), `${name} must handle exit ${code}`);
    }
  });
}

test('ci.md bounded full-ci re-poll waits on coderabbit when the NOT READY reason names CodeRabbit', () => {
  const sec = ciMd.slice(ciMd.indexOf('**Bounded re-poll'));
  assert.ok(/--target coderabbit/.test(sec), 'a ci-target wait settles at once when only the gate is red, so the re-poll must wait on coderabbit');
});

test('coderabbit.md polls --target coderabbit; ci.md polls --target ci', () => {
  assert.ok(/--target coderabbit/.test(md));
  assert.ok(/--target ci/.test(ciMd));
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
