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
 *   3  unavailable  — getSnapshot could not be read
 *   64 usage error
 *
 * Every probe reads one snapshot via lib/pr-status.js getSnapshot; the
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

/** CodeRabbit check states that mean the review run has finished. */
const CR_TERMINAL = new Set([
  'SUCCESS', 'FAILURE', 'COMPLETED', 'NEUTRAL', 'SKIPPED', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED',
]);

/** Check states that mean a CI check has not finished yet (missing state counts as pending). */
const CI_PENDING = new Set(['PENDING', 'IN_PROGRESS', 'QUEUED', 'EXPECTED', 'WAITING', 'REQUESTED', '']);

/**
 * Evaluate one CodeRabbit snapshot.
 * @returns {{kind: 'settled'|'pending'|'handoff', reason: string, extendTo?: number}}
 */
function evaluateCoderabbit(cr, ctx) {
  const rl = cr.rateLimit || {};
  if (rl.rateLimited) {
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

  const unresolved = cr.unresolvedThreads;
  if (typeof unresolved === 'number' && unresolved > 0) {
    return { kind: 'settled', reason: `settled: unresolved=${unresolved}` };
  }
  const state = String(cr.checkState || '').toUpperCase();
  if (unresolved === 0 && CR_TERMINAL.has(state)) {
    return { kind: 'settled', reason: `settled: clean (${state}, unresolved=0)` };
  }
  return { kind: 'pending', reason: `pending (check ${state || 'none'}, unresolved=${unresolved == null ? 'unknown' : unresolved})` };
}

/**
 * Evaluate one CI snapshot. Settled once at least one check is registered and
 * none is still pending; no checks yet (just pushed) stays pending.
 */
function evaluateCi(ci) {
  const checks = Array.isArray(ci.checks) ? ci.checks : [];
  if (checks.length === 0) return { kind: 'pending', reason: 'pending (no checks registered yet)' };
  const pending = checks.filter((c) => CI_PENDING.has(String((c && c.state) || '').toUpperCase())).length;
  if (pending > 0) return { kind: 'pending', reason: `pending (${pending}/${checks.length} checks running)` };
  return { kind: 'settled', reason: `settled: ${checks.length} checks finished (ci ${ci.state || 'unknown'})` };
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
  const getSnapshot = o.getSnapshot || require('./pr-status.js').getSnapshot;
  const shouldReTrigger = o.shouldReTrigger || retrigger.shouldReTrigger;
  const formatHandoffMessage = o.formatHandoffMessage || retrigger.formatHandoffMessage;
  const log = o.log || ((line) => process.stdout.write(`${line}\n`));
  const { pr, target } = o;
  const retriggerCount = o.retriggerCount || 0;
  let deadline = o.deadlineSec || DEFAULT_DEADLINE_SECONDS;

  const table = BACKOFF[target];
  if (!table) throw new Error(`unknown target: ${target}`);

  const start = now().getTime();
  const elapsedSec = () => Math.round((now().getTime() - start) / 1000);

  for (let probe = 0; ; probe++) {
    const delay = table[Math.min(probe, table.length - 1)];
    const step = Math.min(delay, Math.max(deadline - elapsedSec(), 0));
    if (step > 0) await wait(step);

    const elapsed = elapsedSec();
    const prefix = `[pr-poll] #${pr} ${target} probe ${probe + 1} t=${elapsed}s:`;

    let snap;
    try {
      snap = getSnapshot(pr);
    } catch (err) {
      log(`${prefix} unavailable (${(err && err.message) || err})`);
      return EXIT.UNAVAILABLE;
    }
    const block = snap && snap[target];
    if (!block) {
      log(`${prefix} unavailable (snapshot has no ${target} block)`);
      return EXIT.UNAVAILABLE;
    }

    const result = target === 'coderabbit'
      ? evaluateCoderabbit(block, {
        now: now(),
        remainingSec: Math.max(deadline - elapsed, 0),
        retriggerCount,
        shouldReTrigger,
        formatHandoffMessage,
      })
      : evaluateCi(block);

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
    if (elapsed >= deadline) {
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
    else if (!a.startsWith('--') && Number.isNaN(out.pr)) out.pr = parseInt(String(a).replace(/^#/, ''), 10);
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
  main();
}

module.exports = {
  EXIT,
  EXIT_USAGE,
  DEFAULT_DEADLINE_SECONDS,
  BACKOFF,
  poll,
  parseArgs,
  evaluateCoderabbit,
  evaluateCi,
};
