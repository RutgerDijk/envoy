#!/usr/bin/env node
/**
 * full-ci remediation helper.
 *
 * When the PR's ci-gate check failed with a "FULL SUITE NOT RUN" annotation,
 * the fix is to add the `full-ci` label to the PR and rerun the workflow run
 * that owns the failed ci-gate job (resolved from its job id, so a newer run
 * of an unrelated workflow or event is never rerun by mistake).
 * This CLI does both, idempotently, and is shared by finalize, fix-ci and
 * babysit. Retries are bounded through loop-safeguards state
 * (.envoy/loops/full-ci-<pr>.json).
 *
 * Usage: node lib/full-ci.js <pr>
 * Exit:  0 rerun triggered (prints run id), 1 failure / no failed gate / run in progress,
 *        2 blocked by max cycles
 */

const { execFileSync } = require('child_process');
const loops = require('./loop-safeguards');
const { summarizeChecks } = require('./pr-status');

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
 * Add the full-ci label (if needed) and rerun the run owning the failed ci-gate job.
 *
 * @param {{pr: number|string, gh?: function(string[]): string, cwd?: string}} opts
 * @returns {{code: number, message: string, runId?: number}}
 */
function run({ pr, gh = defaultGh, cwd = process.cwd() } = {}) {
  const prNum = String(pr);
  if (!/^[1-9]\d*$/.test(prNum)) {
    return { code: 1, message: `invalid PR number: ${prNum}` };
  }
  const loopName = `full-ci-${prNum}`;

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

module.exports = { run, isBlocked, defaultGh, LABEL, MAX_CYCLES };

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
