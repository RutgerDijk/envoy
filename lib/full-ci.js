#!/usr/bin/env node
/**
 * full-ci remediation helper.
 *
 * When CI reports a check named "FULL SUITE NOT RUN", the fix is to add the
 * `full-ci` label to the PR and rerun the workflow run for the PR head SHA.
 * This CLI does both, idempotently, and is shared by finalize, fix-ci and
 * babysit. Retries are bounded through loop-safeguards state
 * (.envoy/loops/full-ci-<pr>.json).
 *
 * Usage: node lib/full-ci.js <pr>
 * Exit:  0 rerun triggered (prints run id), 1 failure / no run, 2 blocked by max cycles
 */

const { execFileSync } = require('child_process');
const loops = require('./loop-safeguards');

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
 * Pick the most recent run (by createdAt) from a `gh run list` payload.
 *
 * @param {Array<{databaseId: number, createdAt?: string}>} runs
 * @returns {number|null} run database id, or null when none
 */
function pickRunId(runs) {
  if (!Array.isArray(runs) || runs.length === 0) return null;
  const time = (r) => Date.parse(r.createdAt || '') || 0;
  return runs.reduce((best, r) => (time(r) > time(best) ? r : best)).databaseId;
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
 * Add the full-ci label (if needed) and rerun the PR head-SHA run.
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

  try {
    const state = loops.loadState(loopName, cwd);
    if (state.maxCycles === null) state.maxCycles = MAX_CYCLES;
    if (isBlocked(state)) {
      return {
        code: 2,
        message: `BLOCKED: ${loopName} reached maxCycles=${state.maxCycles}; refusing to rerun. Reset with: node lib/loop-safeguards.js reset ${loopName} --reason <text>`,
      };
    }

    const view = JSON.parse(gh(['pr', 'view', prNum, '--json', 'headRefOid,labels']));
    const sha = view.headRefOid;
    const hasLabel = (view.labels || []).some((l) => l.name === LABEL);

    if (!hasLabel) {
      gh(['label', 'create', LABEL, '--force']);
      gh(['pr', 'edit', prNum, '--add-label', LABEL]);
    }

    const runs = JSON.parse(gh(['run', 'list', '--commit', sha, '--json', 'databaseId,createdAt,status', '--limit', '20']));
    const runId = pickRunId(runs);
    if (runId === null) {
      return { code: 1, message: `no workflow run found for PR #${prNum} head ${sha}; nothing to rerun` };
    }

    gh(['run', 'rerun', String(runId)]);

    state.cyclesSeen += 1;
    state.history.push({ action: 'rerun', at: new Date().toISOString(), reason: `run ${runId}` });
    loops.saveState(state, cwd);

    return { code: 0, message: String(runId), runId };
  } catch (err) {
    return { code: 1, message: `full-ci failed: ${err.message}` };
  }
}

module.exports = { run, pickRunId, isBlocked, defaultGh, LABEL, MAX_CYCLES };

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
