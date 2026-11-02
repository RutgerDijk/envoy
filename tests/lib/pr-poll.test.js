#!/usr/bin/env node
/**
 * lib/pr-poll.js — backgrounded PR poller tests (#94 task 1).
 *
 * Every test injects a fake clock, a fake wait (advances the clock instantly),
 * a fake getSnapshot and a captured log, so the suite runs with no network and
 * no real waiting.
 *
 * Run: node tests/lib/pr-poll.test.js
 */

const assert = require('assert');
const path = require('path');

const MODULE = path.join(__dirname, '..', '..', 'lib', 'pr-poll.js');
const { poll, parseArgs, BACKOFF, DEFAULT_DEADLINE_SECONDS, EXIT } = require(MODULE);
const { shouldReTrigger } = require(path.join(__dirname, '..', '..', 'lib', 'coderabbit-retrigger.js'));

let passed = 0;
let failed = 0;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function section(name) {
  tests.push({ section: name });
}

const START = new Date('2026-11-02T12:00:00Z').getTime();

/**
 * Build an injected harness. `snapshots` is an array consumed one per probe
 * (the last entry repeats); an entry that is an Error is thrown, a function is
 * called with the probe index.
 */
function harness(snapshots, extra = {}) {
  let clock = START;
  const waits = [];
  const lines = [];
  let probes = 0;
  const deps = {
    now: () => new Date(clock),
    wait: async (sec) => {
      waits.push(sec);
      clock += Math.round(sec * 1000);
    },
    getSnapshot: () => {
      clock += extra.snapshotMs || 0;
      const entry = snapshots[Math.min(probes, snapshots.length - 1)];
      probes++;
      if (entry instanceof Error) throw entry;
      return typeof entry === 'function' ? entry(probes - 1) : entry;
    },
    shouldReTrigger,
    log: (line) => lines.push(line),
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'snapshotMs')),
  };
  return {
    deps,
    waits,
    lines,
    get probes() {
      return probes;
    },
    elapsed: () => (clock - START) / 1000,
  };
}

function crSnap({ checkState = null, unresolved = 0, rateLimited = false, resetsAt = null } = {}) {
  return {
    pr: 7,
    ci: { state: 'PENDING', checks: [] },
    coderabbit: { checkState, unresolvedThreads: unresolved, rateLimit: { rateLimited, resetsAt } },
  };
}

function ciSnap(states) {
  return {
    pr: 7,
    ci: { state: 'X', checks: states.map((s, i) => ({ name: `c${i}`, state: s })) },
    coderabbit: { checkState: null, unresolvedThreads: 0, rateLimit: { rateLimited: false, resetsAt: null } },
  };
}

// ─────────────────────────────────────────────────────────────────────
section('exports');

test('exit-code contract is 0 settled, 1 deadline, 2 handoff, 3 unavailable', () => {
  assert.deepStrictEqual(EXIT, { SETTLED: 0, DEADLINE: 1, HANDOFF: 2, UNAVAILABLE: 3 });
});

test('default deadline is 1320s', () => {
  assert.strictEqual(DEFAULT_DEADLINE_SECONDS, 1320);
});

test('backoff table is owned by pr-poll.js (delay before each probe)', () => {
  assert.deepStrictEqual(BACKOFF.coderabbit, [120, 120, 240, 360, 480]);
  assert.deepStrictEqual(BACKOFF.ci, [0, 30, 60, 120, 240, 240, 240]);
});

// ─────────────────────────────────────────────────────────────────────
section('exit 0 — settled');

test('coderabbit: terminal checkState with zero unresolved threads settles (exit 0)', async () => {
  const h = harness([crSnap(), crSnap({ checkState: 'SUCCESS' })]);
  const code = await poll({ pr: 7, target: 'coderabbit', ...h.deps });
  assert.strictEqual(code, 0);
  assert.strictEqual(h.probes, 2);
  assert.ok(/settled/.test(h.lines[h.lines.length - 1]) && /clean/.test(h.lines[h.lines.length - 1]));
});

test('coderabbit: unresolved threads settle (exit 0) even while the check is pending', async () => {
  const h = harness([crSnap({ checkState: 'PENDING', unresolved: 3 })]);
  const code = await poll({ pr: 7, target: 'coderabbit', ...h.deps });
  assert.strictEqual(code, 0);
  assert.ok(/unresolved=3/.test(h.lines[0]));
});

test('coderabbit: rate-limit past reset with budget left settles as retrigger (exit 0)', async () => {
  const past = new Date(START - 60000).toISOString();
  const h = harness([crSnap({ rateLimited: true, resetsAt: past })]);
  const code = await poll({ pr: 7, target: 'coderabbit', retriggerCount: 0, ...h.deps });
  assert.strictEqual(code, 0);
  assert.ok(/retrigger/.test(h.lines[0]));
});

test('coderabbit: rate-limit with retrigger budget used settles as capped (exit 0)', async () => {
  const past = new Date(START - 60000).toISOString();
  const h = harness([crSnap({ rateLimited: true, resetsAt: past })]);
  const code = await poll({ pr: 7, target: 'coderabbit', retriggerCount: 2, ...h.deps });
  assert.strictEqual(code, 0);
  assert.ok(/capped/.test(h.lines[0]));
});

test('coderabbit: a rate-limited review with 0 unresolved is NOT read as clean', async () => {
  // Helper always says "wait" without extending: the run must reach the deadline, not settle.
  const h = harness([crSnap({ checkState: 'SUCCESS', rateLimited: true, resetsAt: new Date(START).toISOString() })], {
    shouldReTrigger: (rl, now, opts) => ({ action: 'wait', resetsAt: rl.resetsAt, extendedDeadlineSeconds: opts.currentDeadlineSeconds }),
  });
  const code = await poll({ pr: 7, target: 'coderabbit', deadlineSec: 240, ...h.deps });
  assert.strictEqual(code, 1);
});

test('ci: settles (exit 0) once no check is pending', async () => {
  const h = harness([ciSnap(['SUCCESS', 'IN_PROGRESS']), ciSnap(['SUCCESS', 'FAILURE'])]);
  const code = await poll({ pr: 7, target: 'ci', ...h.deps });
  assert.strictEqual(code, 0);
  assert.strictEqual(h.probes, 2);
});

test('ci: a failure alone does not settle while another check is still pending', async () => {
  const h = harness([ciSnap(['FAILURE', 'QUEUED']), ciSnap(['FAILURE', 'SUCCESS'])]);
  const code = await poll({ pr: 7, target: 'ci', ...h.deps });
  assert.strictEqual(code, 0);
  assert.strictEqual(h.probes, 2, 'must keep polling until the QUEUED check resolves');
});

test('ci: no checks registered yet (just pushed) is pending, not settled', async () => {
  const h = harness([ciSnap([]), ciSnap(['SUCCESS'])]);
  const code = await poll({ pr: 7, target: 'ci', ...h.deps });
  assert.strictEqual(code, 0);
  assert.strictEqual(h.probes, 2);
});

test('prints exactly one line per probe', async () => {
  const h = harness([crSnap(), crSnap(), crSnap({ unresolved: 1 })]);
  await poll({ pr: 7, target: 'coderabbit', ...h.deps });
  assert.strictEqual(h.probes, 3);
  assert.strictEqual(h.lines.length, 3);
});

// ─────────────────────────────────────────────────────────────────────
section('exit 1 — deadline');

test('coderabbit: default 1320s deadline passes unsettled -> exit 1', async () => {
  const h = harness([crSnap({ checkState: 'PENDING' })]);
  const code = await poll({ pr: 7, target: 'coderabbit', ...h.deps });
  assert.strictEqual(code, 1);
  assert.strictEqual(h.elapsed(), 1320);
  assert.ok(/deadline/.test(h.lines[h.lines.length - 1]));
});

test('--deadline override is honoured (ci, 900s)', async () => {
  const h = harness([ciSnap(['PENDING'])]);
  const code = await poll({ pr: 7, target: 'ci', deadlineSec: 900, ...h.deps });
  assert.strictEqual(code, 1);
  assert.strictEqual(h.elapsed(), 900);
});

test('rate-limit reset close (<=10min) extends the deadline instead of exiting', async () => {
  // resetsAt 8min after start; on probe at 120s it is 6min away -> wait, deadline extends.
  const resetsAt = new Date(START + 8 * 60000).toISOString();
  const h = harness([crSnap({ rateLimited: true, resetsAt }), crSnap({ rateLimited: true, resetsAt }), crSnap({ unresolved: 2 })]);
  const code = await poll({ pr: 7, target: 'coderabbit', deadlineSec: 200, ...h.deps });
  assert.strictEqual(code, 0, 'deadline 200s would have expired without the extension');
  assert.ok(h.elapsed() > 200);
});

// ─────────────────────────────────────────────────────────────────────
section('exit 2 — handoff');

test('rate-limit resetsAt too far (>10min) -> exit 2 with the babysit handoff line', async () => {
  const resetsAt = new Date(START + 60 * 60000).toISOString();
  const h = harness([crSnap({ rateLimited: true, resetsAt })]);
  const code = await poll({ pr: 7, target: 'coderabbit', ...h.deps });
  assert.strictEqual(code, 2);
  assert.ok(/run \/envoy:babysit after/.test(h.lines[0]), h.lines[0]);
});

test('handoff decision comes from the injected shouldReTrigger', async () => {
  const calls = [];
  const h = harness([crSnap({ rateLimited: true, resetsAt: new Date(START).toISOString() })], {
    shouldReTrigger: (rl, now, opts) => {
      calls.push({ rl, opts });
      return { action: 'handoff', resetsAt: rl.resetsAt };
    },
  });
  const code = await poll({ pr: 7, target: 'coderabbit', retriggerCount: 1, ...h.deps });
  assert.strictEqual(code, 2);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].opts.retriggerCount, 1);
  assert.strictEqual(calls[0].opts.maxRetriggers, 2);
});

// ─────────────────────────────────────────────────────────────────────
section('exit 3 — probe unavailable');

test('getSnapshot throws on 3 consecutive probes -> exit 3', async () => {
  const h = harness([new Error('gh: not authenticated')]);
  const code = await poll({ pr: 7, target: 'coderabbit', ...h.deps });
  assert.strictEqual(code, 3);
  assert.strictEqual(h.probes, 3);
  assert.strictEqual(h.lines.length, 3, 'one line per probe, tolerated failures included');
  assert.ok(/unavailable/.test(h.lines[0]) && /retrying/.test(h.lines[0]));
  assert.ok(/unavailable/.test(h.lines[2]) && !/retrying/.test(h.lines[2]));
});

test('tolerated failures wait per the backoff table before the next probe', async () => {
  const h = harness([new Error('blip')]);
  await poll({ pr: 7, target: 'ci', ...h.deps });
  assert.deepStrictEqual(h.waits, [30, 60]);
});

test('1 failure then success -> no exit 3', async () => {
  const h = harness([new Error('blip'), crSnap({ unresolved: 1 })]);
  assert.strictEqual(await poll({ pr: 7, target: 'coderabbit', ...h.deps }), 0);
});

test('2 failures then success -> no exit 3', async () => {
  const h = harness([new Error('blip'), null, crSnap({ unresolved: 1 })]);
  assert.strictEqual(await poll({ pr: 7, target: 'coderabbit', ...h.deps }), 0);
  assert.strictEqual(h.probes, 3);
});

test('failure, success, failure, failure -> no exit 3 (success resets the counter)', async () => {
  const h = harness([new Error('a'), crSnap(), new Error('b'), new Error('c'), crSnap({ unresolved: 2 })]);
  assert.strictEqual(await poll({ pr: 7, target: 'coderabbit', ...h.deps }), 0);
  assert.strictEqual(h.probes, 5);
});

test('no probe ever succeeded and the deadline is reached -> exit 3, not 1', async () => {
  const h = harness([new Error('blip')]);
  const code = await poll({ pr: 7, target: 'ci', deadlineSec: 30, ...h.deps });
  assert.strictEqual(h.probes, 2, 'probe at 0s and at the 30s deadline');
  assert.strictEqual(code, 3);
});

test('a failed probe at the deadline after an earlier success still exits 1', async () => {
  const h = harness([ciSnap(['PENDING']), new Error('blip')]);
  const code = await poll({ pr: 7, target: 'ci', deadlineSec: 30, ...h.deps });
  assert.strictEqual(code, 1);
});

test('getSnapshot returns null persistently -> exit 3 (never misread as clean)', async () => {
  const h = harness([null]);
  const code = await poll({ pr: 7, target: 'ci', ...h.deps });
  assert.strictEqual(code, 3);
});

test('a multi-line probe error is collapsed onto one log line', async () => {
  const h = harness([new Error('gh: HTTP 502\n  Bad Gateway\n\n  retry later  ')]);
  await poll({ pr: 7, target: 'ci', ...h.deps });
  for (const line of h.lines) assert.ok(!/\n/.test(line), JSON.stringify(line));
  assert.ok(/gh: HTTP 502 Bad Gateway retry later/.test(h.lines[0]), h.lines[0]);
});

test('a throw while evaluating the probe -> exit 3, never a rejection (which would read as exit 1)', async () => {
  const h = harness([crSnap({ rateLimited: true, resetsAt: new Date(START).toISOString() })], {
    shouldReTrigger: () => {
      throw new Error('boom');
    },
  });
  const code = await poll({ pr: 7, target: 'coderabbit', ...h.deps });
  assert.strictEqual(code, 3);
  assert.ok(/unavailable/.test(h.lines[0]));
});

test('CLI wrapper exits 3 (not 1) when poll itself rejects', () => {
  const src = require('fs').readFileSync(MODULE, 'utf8');
  assert.ok(/main\(\)\.catch\([\s\S]*?EXIT\.UNAVAILABLE/.test(src), 'main() must catch and exit EXIT.UNAVAILABLE');
});

test('snapshot persistently missing the target block -> exit 3', async () => {
  const h = harness([{ pr: 7 }]);
  const code = await poll({ pr: 7, target: 'coderabbit', ...h.deps });
  assert.strictEqual(code, 3);
});

// ─────────────────────────────────────────────────────────────────────
section('backoff table drives the delays');

test('coderabbit: waits follow [120,120,240,360,480] (wait before first probe)', async () => {
  const h = harness([crSnap({ checkState: 'PENDING' })]);
  await poll({ pr: 7, target: 'coderabbit', ...h.deps });
  assert.deepStrictEqual(h.waits, [120, 120, 240, 360, 480]);
  assert.strictEqual(h.probes, 5);
});

test('ci: probes immediately then waits [30,60,120,240,240], clamped to the deadline', async () => {
  const h = harness([ciSnap(['PENDING'])]);
  await poll({ pr: 7, target: 'ci', deadlineSec: 900, ...h.deps });
  // 0,30,90,210,450,690 then clamp 210 -> 900
  assert.deepStrictEqual(h.waits, [30, 60, 120, 240, 240, 210]);
  assert.strictEqual(h.probes, 7);
});

test('the last wait is clamped to the exact remaining time (ms), so probe time causes no extra probe', async () => {
  // Each probe costs 700ms. The second probe must land exactly on the 30s deadline.
  const h = harness([ciSnap(['PENDING'])], { snapshotMs: 700 });
  const code = await poll({ pr: 7, target: 'ci', deadlineSec: 30, ...h.deps });
  assert.strictEqual(code, 1);
  assert.deepStrictEqual(h.waits, [29.3]);
  assert.strictEqual(h.probes, 2);
});

test('past the end of the table the last delay repeats', async () => {
  const h = harness([crSnap({ checkState: 'PENDING' })]);
  await poll({ pr: 7, target: 'coderabbit', deadlineSec: 1320 + 960, ...h.deps });
  assert.deepStrictEqual(h.waits, [120, 120, 240, 360, 480, 480, 480]);
});

// ─────────────────────────────────────────────────────────────────────
section('CLI argument parsing');

test('parseArgs reads <pr> --target --deadline --retrigger-count', () => {
  assert.deepStrictEqual(parseArgs(['12', '--target', 'ci', '--deadline', '900']), {
    pr: 12,
    target: 'ci',
    deadlineSec: 900,
    retriggerCount: 0,
  });
  assert.deepStrictEqual(parseArgs(['12', '--target', 'coderabbit', '--retrigger-count', '1']), {
    pr: 12,
    target: 'coderabbit',
    deadlineSec: 1320,
    retriggerCount: 1,
  });
});

test('parseArgs rejects a bad target or missing pr', () => {
  assert.throws(() => parseArgs(['12', '--target', 'nope']));
  assert.throws(() => parseArgs(['--target', 'ci']));
});

test('parseArgs rejects a non-numeric pr like 12abc, accepts #12', () => {
  assert.throws(() => parseArgs(['12abc', '--target', 'ci']));
  assert.throws(() => parseArgs(['1.5', '--target', 'ci']));
  assert.strictEqual(parseArgs(['#12', '--target', 'ci']).pr, 12);
});

test('CLI exits 64 on a malformed pr', () => {
  const r = require('child_process').spawnSync(process.execPath, [MODULE, '12abc', '--target', 'ci'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 64, r.stderr);
});

test('lib/pr-poll.js starts with a node shebang', () => {
  assert.ok(require('fs').readFileSync(MODULE, 'utf8').startsWith('#!/usr/bin/env node\n'));
});

// ─────────────────────────────────────────────────────────────────────
(async () => {
  for (const t of tests) {
    if (t.section) {
      process.stdout.write(`\n\x1b[1m${t.section}\x1b[0m\n`);
      continue;
    }
    try {
      await t.fn();
      passed++;
      process.stdout.write(`  \x1b[32m✓\x1b[0m ${t.name}\n`);
    } catch (err) {
      failed++;
      process.stdout.write(`  \x1b[31m✗\x1b[0m ${t.name}\n    ${err.message}\n`);
    }
  }
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
