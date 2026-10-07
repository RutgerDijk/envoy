#!/usr/bin/env node
/**
 * full-ci remediation helper.
 *
 * A ci-gate failure with a "FULL SUITE NOT RUN" annotation means "fast run green,
 * full run owed". The fix is to add the `full-ci` label to the PR and rerun the
 * workflow run that owns the failed ci-gate job (resolved from its job id, so a
 * newer run of an unrelated workflow or event is never rerun by mistake).
 *
 * This is the LAST step before merge. The helper enforces the readiness snapshot: the
 * label is only added when the pinned check read succeeded, the fast run is green apart
 * from the marker (ci.fullSuiteOwed), no unresolved review thread from ANY reviewer
 * (human or CodeRabbit; snapshot.threads.unresolved) remains, CodeRabbit is not rate
 * limited and, when the repo uses CodeRabbit, its latest commit status is `success`
 * (absent is not done); plus the head SHA re-read before the writes. "No more pushes
 * planned" is enforced by the callers (finalize and babysit call this only as their last
 * step), not by this helper. When not ready it exits 3 without any gh write and
 * without consuming a loop cycle. The label is never removed or toggled here.
 *
 * ENVOY_CODERABBIT = on | off | auto (default auto; anything else is exit 1).
 * `auto` means CodeRabbit is in use iff .coderabbit.yaml or .coderabbit.yml exists at
 * the repo root (git toplevel of cwd, falling back to cwd). When not in use, an
 * absent CodeRabbit status does not block.
 *
 * The head SHA is read before the readiness snapshot and re-read right before the
 * label/rerun writes; if it moved, exit 1 (report only) and retry on the next pass.
 *
 * This CLI is idempotent and run by finalize and babysit (fix-ci is report-only and never calls it). Retries are
 * bounded through loop-safeguards state (.envoy/loops/full-ci-<pr>.json).
 *
 * Usage: node lib/full-ci.js <pr>
 * Exit:  0 rerun triggered (prints run id)
 *        1 failure / no failed gate / run in progress / head SHA moved (report only)
 *        2 blocked by max cycles
 *        3 not ready: re-poll on the next pass, not a failure or escalation
 * Output: exit 0 message on stdout, every non-zero message (incl. exit 3) on stderr.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const loops = require('./loop-safeguards');
const { summarizeChecks, getSnapshot } = require('./pr-status');

const LABEL = 'full-ci';
const MAX_CYCLES = 3;

/**
 * Default gh runner. Arg array only — never a shell string.
 *
 * @param {string[]} args - gh arguments
 * @returns {string} stdout
 */
function defaultGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Create the full-ci label without overwriting a consumer's existing
 * colour/description (no --force). "already exists" is the idempotent case.
 *
 * @param {function(string[]): string} gh
 */
function ensureLabel(gh) {
  try {
    gh(['label', 'create', LABEL]);
  } catch (err) {
    if (/already exists/i.test(String((err && err.stderr) || ''))) return;
    throw err;
  }
}

/**
 * Whether the loop for this PR has exhausted its cycles.
 *
 * @param {object} state - loop-safeguards state
 * @returns {boolean}
 */
function isBlocked(state) {
  return state.maxCycles !== null && state.cyclesSeen >= state.maxCycles;
}

/**
 * Resolve whether CodeRabbit is in use for this repo.
 *
 * @param {object} env
 * @param {function(string): boolean} exists
 * @param {string} repoRoot
 * @returns {{inUse: boolean}|{error: string}}
 */
function resolveCodeRabbit(env, exists, repoRoot) {
  const mode = String((env && env.ENVOY_CODERABBIT) || 'auto').trim().toLowerCase();
  if (mode === 'on') return { inUse: true };
  if (mode === 'off') return { inUse: false };
  if (mode !== 'auto') {
    return { error: `invalid ENVOY_CODERABBIT "${mode.slice(0, 40)}" (expected on, off or auto)` };
  }
  return { inUse: ['.coderabbit.yaml', '.coderabbit.yml'].some((f) => exists(path.join(repoRoot, f))) };
}

/** Git toplevel of cwd, falling back to cwd. */
function defaultRepoRoot(cwd) {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return top || cwd;
  } catch {
    return cwd;
  }
}

/**
 * True while a CodeRabbit rate limit still applies. Missing data fails closed; an
 * unknown reset time blocks; a reset time already in the past is a stale comment
 * (the cooldown elapsed) and does not block.
 *
 * @param {{rateLimited: boolean, resetsAt: string|null}|undefined} rl
 * @param {Date} now
 * @returns {boolean}
 */
function rateLimitActive(rl, now) {
  if (!rl || typeof rl.rateLimited !== 'boolean') return true;
  if (!rl.rateLimited) return false;
  const resetsAtMs = rl.resetsAt ? Date.parse(rl.resetsAt) : NaN;
  return Number.isNaN(resetsAtMs) || resetsAtMs > now.getTime();
}

/**
 * Readiness check. Returns a reason string when NOT ready, else null.
 *
 * @param {object} snapshot - pr-status snapshot
 * @param {boolean} crInUse
 * @param {Date} [now] - Reference time for the rate-limit cooldown (defaults to current time)
 * @returns {string|null}
 */
function notReadyReason(snapshot, crInUse, now = new Date()) {
  const ci = (snapshot && snapshot.ci) || {};
  const cr = (snapshot && snapshot.coderabbit) || {};
  if (ci.pinned !== true) return 'pinned check read failed; cannot trust the CI state';
  if (ci.fullSuiteOwed !== true) return 'full suite is not owed (the fast run is not green apart from the FULL SUITE NOT RUN marker)';
  // threads.unresolved counts every unresolved review thread (any author, outdated ones
  // included) and is authoritative; the CodeRabbit count is a subset kept only to fail closed.
  const total = snapshot && snapshot.threads && snapshot.threads.unresolved;
  if (!Number.isInteger(total) || total < 0) return 'review thread count unavailable; cannot confirm all threads are resolved';
  if (total !== 0) return `${total} unresolved review thread(s)`;
  if (!Number.isInteger(cr.unresolvedThreads) || cr.unresolvedThreads < 0) return 'CodeRabbit thread count unavailable; cannot confirm its threads are resolved';
  if (cr.unresolvedThreads !== 0) return `${cr.unresolvedThreads} unresolved CodeRabbit review thread(s)`;
  if (rateLimitActive(cr.rateLimit, now)) return 'CodeRabbit is rate limited';
  if (crInUse) {
    const st = cr.statusState == null ? null : String(cr.statusState).toLowerCase();
    if (st === null) return 'CodeRabbit status is absent (not done)';
    if (st !== 'success') return `CodeRabbit status is ${st}`;
  }
  return null;
}

/**
 * Read the PR head SHA.
 *
 * @param {function(string[]): string} gh
 * @param {string} prNum
 * @returns {string|null}
 */
function readHeadSha(gh, prNum) {
  const out = JSON.parse(gh(['pr', 'view', prNum, '--json', 'headRefOid']));
  return out && typeof out.headRefOid === 'string' && out.headRefOid !== '' ? out.headRefOid : null;
}

/**
 * Add the full-ci label (if needed) and rerun the run owning the failed ci-gate job.
 *
 * @param {{pr: number|string, gh?: function(string[]): string, cwd?: string,
 *   snapshot?: function(number): object, env?: object, exists?: function(string): boolean, repoRoot?: string}} opts
 * @returns {{code: number, message: string, runId?: number}}
 */
function run({ pr, gh = defaultGh, cwd = process.cwd(), snapshot = getSnapshot, env = process.env, exists = fs.existsSync, repoRoot } = {}) {
  const prNum = String(pr);
  if (!/^[1-9]\d*$/.test(prNum)) {
    return { code: 1, message: `invalid PR number: ${prNum}` };
  }
  const loopName = `full-ci-${prNum}`;
  const cr = resolveCodeRabbit(env, exists, repoRoot || (String((env && env.ENVOY_CODERABBIT) || 'auto').trim().toLowerCase() === 'auto' ? defaultRepoRoot(cwd) : cwd));
  if (cr.error) return { code: 1, message: cr.error };

  let state;
  try {
    state = loops.loadState(loopName, cwd);
  } catch (err) {
    return { code: 1, message: `full-ci loop-state error: ${err.message}` };
  }
  if (state.maxCycles === null) state.maxCycles = MAX_CYCLES;
  if (isBlocked(state)) {
    return {
      code: 2,
      message: `BLOCKED: ${loopName} reached maxCycles=${state.maxCycles}; refusing to rerun. After fixing the root cause, clear with: node lib/loop-safeguards.js cleanup ${loopName}`,
    };
  }

  let runIds;
  try {
    let view;
    try {
      view = JSON.parse(gh(['pr', 'view', prNum, '--json', 'headRefOid,labels,statusCheckRollup']));
    } catch (err) {
      if (err instanceof SyntaxError) {
        return { code: 1, message: `unexpected non-JSON output from gh pr view ${prNum}` };
      }
      throw err;
    }
    const sha = view && view.headRefOid;
    if (typeof sha !== 'string' || sha === '') {
      return { code: 1, message: `gh pr view ${prNum} returned no headRefOid; cannot resolve the PR head` };
    }

    let snap;
    try {
      snap = snapshot(Number(prNum));
    } catch (err) {
      return { code: 1, message: `full-ci snapshot error: ${err && err.message}` };
    }
    const reason = notReadyReason(snap, cr.inUse);
    if (reason) return { code: 3, message: `NOT READY: ${reason}` };

    const { gateChecks } = summarizeChecks(view.statusCheckRollup);
    if (gateChecks.length === 0) {
      return { code: 1, message: `no failed ci-gate check on PR #${prNum} head ${sha}; nothing to rerun — re-poll` };
    }
    runIds = [...new Set(gateChecks.map((g) =>
      gh(['api', `repos/{owner}/{repo}/actions/jobs/${g.checkRunId}`, '--jq', '.run_id']).trim()))];
    for (const id of runIds) {
      if (!/^\d+$/.test(id)) {
        return { code: 1, message: `could not resolve the ci-gate run id (got "${id}") for PR #${prNum}` };
      }
      const { status } = JSON.parse(gh(['run', 'view', id, '--json', 'status']));
      if (status !== 'completed') {
        return { code: 1, message: `ci-gate run ${id} still in progress — retry when it completes (PR #${prNum} head ${sha})` };
      }
    }

    let sha2;
    try {
      sha2 = readHeadSha(gh, prNum);
    } catch (err) {
      return { code: 1, message: `full-ci could not re-read the PR head before writing: ${err && err.message}` };
    }
    if (sha2 !== sha) {
      return { code: 1, message: `PR #${prNum} head changed (${sha} -> ${sha2}) since the readiness read; retry on the next pass` };
    }

    if (!(view.labels || []).some((l) => l.name === LABEL)) {
      ensureLabel(gh);
      gh(['pr', 'edit', prNum, '--add-label', LABEL]);
    }

    for (const id of runIds) gh(['run', 'rerun', id]);
  } catch (err) {
    const stderr = err && err.stderr ? String(err.stderr).trim() : '';
    return { code: 1, message: `full-ci gh error: ${err.message}${stderr ? ` — ${stderr}` : ''}` };
  }

  const runId = Number(runIds[0]);
  const ids = runIds.join(', ');
  try {
    state.cyclesSeen += 1;
    state.history.push({ action: 'rerun', at: new Date().toISOString(), reason: `run ${ids}` });
    loops.saveState(state, cwd);
  } catch (err) {
    return { code: 1, message: `full-ci loop-state error (rerun was triggered for run ${ids}): ${err.message}`, runId };
  }

  return { code: 0, message: ids, runId };
}

module.exports = { run, isBlocked, resolveCodeRabbit, notReadyReason, defaultGh, LABEL, MAX_CYCLES };

if (require.main === module) {
  const pr = process.argv[2];
  if (!pr) {
    process.stderr.write('Usage: node lib/full-ci.js <pr>\n');
    process.exit(1);
  }
  const res = run({ pr });
  (res.code === 0 ? process.stdout : process.stderr).write(`${res.message}\n`);
  process.exit(res.code);
}
