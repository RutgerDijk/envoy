#!/usr/bin/env node
'use strict';

/**
 * Backgrounded PR poller for envoy:finalize (#94).
 *
 * Replaces the foreground wait loops that used to live in
 * skills/finalize/steps/coderabbit.md and steps/ci.md. Claude runs this once
 * per wait as a single Bash call with `run_in_background: true`; the session
 * stays free, and Claude is re-invoked when the process exits and branches on
 * the exit code.
 *
 * CLI:
 *   node lib/pr-poll.js <pr> --target coderabbit|ci [--deadline 1320] [--retrigger-count N]
 *
 * Exit codes:
 *   0  settled      — the last probe line names why (clean / unresolved=N /
 *                     retrigger / capped for coderabbit; checks settled for ci)
 *   1  deadline     — the deadline passed with the target still unsettled
 *   2  handoff      — CodeRabbit rate-limit resets too far out (per
 *                     shouldReTrigger); the line carries the babysit handoff
 *   3  unavailable  — getSnapshot could not be read on MAX_PROBE_FAILURES
 *                     consecutive probes (a successful probe resets the count;
 *                     tolerated failures log "; retrying" and keep the backoff),
 *                     or the probe evaluation itself crashed, or the deadline
 *                     passed without a single successful probe
 *   64 usage error
 *
 * Every probe reads one snapshot via lib/pr-status.js (getSnapshot for
 * coderabbit, the checks-only getChecksSnapshot for ci); the
 * rate-limit decision is lib/coderabbit-retrigger.js shouldReTrigger, never
 * re-derived here. The poller prints exactly one line per probe and has no
 * side effects (it never comments on the PR or writes state): a `retrigger`
 * settle hands the "@coderabbitai review" comment back to the caller, whose
 * re-run of the poller is the poll-clock reset.
 */

const EXIT = Object.freeze({ SETTLED: 0, DEADLINE: 1, HANDOFF: 2, UNAVAILABLE: 3 });
const EXIT_USAGE = 64;

const DEFAULT_DEADLINE_SECONDS = 1320;
const MAX_RETRIGGERS = 2;
/** Consecutive getSnapshot failures that end the poll with exit 3 (1-2 are tolerated). */
const MAX_PROBE_FAILURES = 3;

/** Collapse a (possibly multi-line gh stderr) error into one log-safe line. */
function oneLine(err) {
  return String((err && err.message) || err).replace(/\s+/g, ' ').trim();
}

/**
 * Delay in seconds BEFORE each probe; past the end the last entry repeats.
 * coderabbit: the GitHub App reviews asynchronously, so wait before the first
 *   probe — 120,120,240,360,480 (cumulative 2/4/8/14/22 min).
 * ci: synchronous checks, so probe at once, then 30,60,120,240,240,240.
 */
const BACKOFF = Object.freeze({
  coderabbit: Object.freeze([120, 120, 240, 360, 480]),
  ci: Object.freeze([0, 30, 60, 120, 240, 240, 240]),
});

const TARGETS = Object.keys(BACKOFF);

/** CodeRabbit check-run states that mean the review run has finished. */
const CR_TERMINAL = new Set([
  'SUCCESS', 'FAILURE', 'COMPLETED', 'NEUTRAL', 'SKIPPED', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED',
]);

/** CodeRabbit commit-status states that mean the review run has finished. */
const CR_STATUS_TERMINAL = new Set(['SUCCESS', 'FAILURE', 'ERROR']);

const isCoderabbitCheck = (c) => /coderabbit/i.test(String((c && c.name) || ''));

/**
 * The state that says whether CodeRabbit's run on the head commit finished.
 * CodeRabbit reports through a commit status, a check run, or both; a status,
 * when present, governs (as in lib/full-ci.js notReadyReason).
 * @returns {{state: string, done: boolean}}
 */
function coderabbitRunState(cr) {
  if (cr.statusState != null) {
    const state = String(cr.statusState).toUpperCase();
    return { state, done: CR_STATUS_TERMINAL.has(state) };
  }
  const state = String(cr.checkState || '').toUpperCase();
  return { state, done: CR_TERMINAL.has(state) };
}

/**
 * Evaluate one CodeRabbit snapshot.
 * @returns {{kind: 'settled'|'pending'|'handoff', reason: string, extendTo?: number}}
 */
function evaluateCoderabbit(cr, ctx) {
  // Unresolved threads are findings to fix whatever the rate-limit state says.
  const unresolved = cr.unresolvedThreads;
  if (typeof unresolved === 'number' && unresolved > 0) {
    return { kind: 'settled', reason: `settled: unresolved=${unresolved}` };
  }

  // A stale comment (CodeRabbit reviewed after it) no longer describes the PR.
  const rl = cr.rateLimit || {};
  if (rl.rateLimited && !rl.stale) {
    const decision = ctx.shouldReTrigger(rl, ctx.now, {
      currentDeadlineSeconds: ctx.remainingSec,
      retriggerCount: ctx.retriggerCount,
      maxRetriggers: MAX_RETRIGGERS,
    });
    switch (decision.action) {
      case 'handoff':
        return { kind: 'handoff', reason: `handoff: ${ctx.formatHandoffMessage(decision.resetsAt)}` };
      case 'retrigger':
        return { kind: 'settled', reason: 'settled: retrigger (rate-limit reset passed; post "@coderabbitai review" and re-run the poller)' };
      case 'capped':
        return { kind: 'settled', reason: `settled: capped (rate-limited, re-trigger cap ${MAX_RETRIGGERS}/${MAX_RETRIGGERS} reached)` };
      case 'wait':
        return {
          kind: 'pending',
          reason: `rate-limited (resets ${decision.resetsAt}); waiting`,
          extendTo: decision.extendedDeadlineSeconds,
        };
      default:
        break; // 'none' — fall through to the normal gate
    }
  }

  const { state, done } = coderabbitRunState(cr);
  if (unresolved === 0 && done) {
    return { kind: 'settled', reason: `settled: clean (${state}, unresolved=0)` };
  }
  return { kind: 'pending', reason: `pending (check ${state || 'none'}, unresolved=${unresolved == null ? 'unknown' : unresolved})` };
}

/**
 * Evaluate one CI snapshot. Settled once at least one check is registered and
 * none is still pending; no checks yet (just pushed) stays pending. CodeRabbit's
 * own check is not CI — the coderabbit target waits for it — so it is left out.
 */
function evaluateCi(ci) {
  const { PENDING_CHECK_STATES } = require('./pr-status.js');
  const checks = (Array.isArray(ci.checks) ? ci.checks : []).filter((c) => !isCoderabbitCheck(c));
  if (checks.length === 0) return { kind: 'pending', reason: 'pending (no CI checks registered yet)' };
  const pending = checks.filter((c) => PENDING_CHECK_STATES.has(String((c && c.state) || '').toUpperCase())).length;
  if (pending > 0) return { kind: 'pending', reason: `pending (${pending}/${checks.length} checks running)` };
  return { kind: 'settled', reason: `settled: ${checks.length} checks finished (ci ${ci.state || 'unknown'})` };
}

/**
 * Default probe per target: the CI wait reads checks only (no review threads,
 * comments or annotations); the CodeRabbit wait needs the full snapshot.
 * @param {'coderabbit'|'ci'} target
 * @returns {(pr: number) => object}
 */
function defaultProbe(target) {
  const prStatus = require('./pr-status.js');
  return target === 'ci' ? prStatus.getChecksSnapshot : prStatus.getSnapshot;
}

/**
 * Poll a PR target until it settles, the deadline passes, a handoff is due, or
 * the probe fails. All I/O is injectable so tests run on a fake clock.
 *
 * @param {object} o
 * @param {number} o.pr
 * @param {'coderabbit'|'ci'} o.target
 * @param {number} [o.deadlineSec=1320]
 * @param {number} [o.retriggerCount=0] - CodeRabbit re-triggers already used this run
 * @param {() => Date} [o.now]
 * @param {(sec: number) => Promise<void>} [o.wait]
 * @param {(pr: number) => object} [o.getSnapshot]
 * @param {Function} [o.shouldReTrigger]
 * @param {(resetsAt: string) => string} [o.formatHandoffMessage]
 * @param {(line: string) => void} [o.log]
 * @returns {Promise<number>} exit code (see EXIT)
 */
async function poll(o) {
  const retrigger = require('./coderabbit-retrigger.js');
  const now = o.now || (() => new Date());
  const wait = o.wait || ((sec) => new Promise((resolve) => setTimeout(resolve, sec * 1000)));
  const getSnapshot = o.getSnapshot || defaultProbe(o.target);
  const shouldReTrigger = o.shouldReTrigger || retrigger.shouldReTrigger;
  const formatHandoffMessage = o.formatHandoffMessage || retrigger.formatHandoffMessage;
  const log = o.log || ((line) => process.stdout.write(`${line}\n`));
  const { pr, target } = o;
  const retriggerCount = o.retriggerCount || 0;
  let deadline = o.deadlineSec || DEFAULT_DEADLINE_SECONDS;

  const table = BACKOFF[target];
  if (!table) throw new Error(`unknown target: ${target}`);

  // Time is compared in milliseconds: rounding elapsed to whole seconds could
  // land a probe just short of the deadline and trigger one extra ~1s probe.
  const start = now().getTime();
  const elapsedMs = () => now().getTime() - start;
  let failures = 0;
  let everRead = false;

  for (let probe = 0; ; probe++) {
    const delayMs = table[Math.min(probe, table.length - 1)] * 1000;
    const remainingMs = Math.max(deadline * 1000 - elapsedMs(), 0);
    const stepMs = Math.min(delayMs, remainingMs);
    // A wait clamped to the remaining time reaches the deadline, even if the
    // timer fires a hair early.
    const clampedTo = stepMs === remainingMs ? deadline : null;
    if (stepMs > 0) await wait(stepMs / 1000);

    const elapsed = Math.floor(elapsedMs() / 1000);
    const prefix = `[pr-poll] #${pr} ${target} probe ${probe + 1} t=${elapsed}s:`;
    const atDeadline = () => elapsedMs() >= deadline * 1000 || clampedTo === deadline;

    let snap;
    let probeError = null;
    try {
      snap = getSnapshot(pr);
      if (!snap || !snap[target]) probeError = `snapshot has no ${target} block`;
    } catch (err) {
      probeError = oneLine(err);
    }
    if (probeError) {
      failures++;
      if (failures >= MAX_PROBE_FAILURES) {
        log(`${prefix} unavailable (${probeError}); ${failures} consecutive failures, giving up`);
        return EXIT.UNAVAILABLE;
      }
      if (atDeadline()) {
        // Never having read a snapshot is "unavailable", not "deadline".
        log(`${prefix} unavailable (${probeError}); deadline ${deadline}s reached${everRead ? '' : ' without a successful probe'}`);
        return everRead ? EXIT.DEADLINE : EXIT.UNAVAILABLE;
      }
      log(`${prefix} unavailable (${probeError}); retrying (${failures}/${MAX_PROBE_FAILURES})`);
      continue;
    }
    failures = 0;
    everRead = true;
    const block = snap[target];

    let result;
    try {
      result = target === 'coderabbit'
        ? evaluateCoderabbit(block, {
          now: now(),
          remainingSec: Math.max(deadline - elapsed, 0),
          retriggerCount,
          shouldReTrigger,
          formatHandoffMessage,
        })
        : evaluateCi(block);
    } catch (err) {
      // A crash must never surface as exit 1 (deadline) — that would read as "CodeRabbit never commented".
      log(`${prefix} unavailable (evaluation failed: ${oneLine(err)})`);
      return EXIT.UNAVAILABLE;
    }

    if (result.kind === 'settled') {
      log(`${prefix} ${result.reason}`);
      return EXIT.SETTLED;
    }
    if (result.kind === 'handoff') {
      log(`${prefix} ${result.reason}`);
      return EXIT.HANDOFF;
    }
    if (typeof result.extendTo === 'number') {
      deadline = Math.max(deadline, elapsed + result.extendTo);
    }
    if (atDeadline()) {
      log(`${prefix} ${result.reason}; deadline ${deadline}s reached`);
      return EXIT.DEADLINE;
    }
    log(`${prefix} ${result.reason} (deadline ${deadline}s)`);
  }
}

/**
 * Parse CLI arguments. Throws on invalid input.
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {{pr: number, target: string, deadlineSec: number, retriggerCount: number}}
 */
function parseArgs(argv) {
  const out = { pr: NaN, target: null, deadlineSec: DEFAULT_DEADLINE_SECONDS, retriggerCount: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--deadline') out.deadlineSec = Number(argv[++i]);
    else if (a === '--retrigger-count') out.retriggerCount = Number(argv[++i]);
    else if (!a.startsWith('--') && Number.isNaN(out.pr)) {
      if (!/^#?\d+$/.test(a)) throw new Error(`invalid <pr>: ${a}`);
      out.pr = parseInt(a.replace(/^#/, ''), 10);
    }
    else throw new Error(`unexpected argument: ${a}`);
  }
  if (!Number.isInteger(out.pr) || out.pr <= 0) throw new Error('missing or invalid <pr>');
  if (!TARGETS.includes(out.target)) throw new Error(`--target must be one of: ${TARGETS.join('|')}`);
  if (!Number.isFinite(out.deadlineSec) || out.deadlineSec <= 0) throw new Error('--deadline must be a positive number of seconds');
  if (!Number.isInteger(out.retriggerCount) || out.retriggerCount < 0) throw new Error('--retrigger-count must be a non-negative integer');
  return out;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`pr-poll: ${err.message}\nUsage: node lib/pr-poll.js <pr> --target coderabbit|ci [--deadline 1320] [--retrigger-count N]\n`);
    process.exit(EXIT_USAGE);
  }
  const code = await poll(args);
  process.exit(code);
}

if (require.main === module) {
  // An unhandled rejection exits 1, which callers would misread as a deadline.
  main().catch((err) => {
    process.stderr.write(`pr-poll: ${(err && err.stack) || err}\n`);
    process.exit(EXIT.UNAVAILABLE);
  });
}

module.exports = {
  EXIT,
  EXIT_USAGE,
  DEFAULT_DEADLINE_SECONDS,
  MAX_PROBE_FAILURES,
  BACKOFF,
  poll,
  parseArgs,
  evaluateCoderabbit,
  evaluateCi,
  defaultProbe,
};
