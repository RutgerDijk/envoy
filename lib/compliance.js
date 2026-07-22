'use strict';

/**
 * ABOUTME: Renders a per-PR skill-compliance trail from the ledger + observe-log.
 * ABOUTME: Shows which rigid steps ran vs skipped, handoffs, gate overrides, hotfix.
 *
 * A worktree's .envoy/ledger.jsonl and .envoy/observe-log.jsonl ARE that branch's
 * trail (the logs are per-worktree). This module reads both and answers: did the
 * work flow through the rigid pickup→review→finalize→cleanup workflow, or skip
 * steps? How many gate would-blocks were overridden (the false-positive signal)?
 * And was any fast work a *sanctioned* hotfix rather than invisible skill-less work?
 *
 * The core is pure so tests can feed fixtures directly: `buildTrail` turns
 * already-parsed event arrays into a trail model and `renderTrail` turns that
 * model into a prose report. `compliance(dir)` is the thin IO wrapper that reads
 * the two files and calls the pure core; missing files yield empty arrays and a
 * clean "nothing recorded" report rather than a throw.
 *
 * Zero external dependencies.
 *
 * Usage:
 *   node lib/compliance.js [dir]     # dir defaults to cwd
 */

const fs = require('fs');
const path = require('path');
const { readLedger } = require(path.join(__dirname, 'ledger'));

/** The rigid workflow steps, always shown in order. */
const RIGID_STEPS = ['pickup', 'review', 'finalize', 'cleanup'];

/** Skips a hotfix legitimately makes — not flagged as violations when hotfix ran. */
const HOTFIX_SANCTIONED_SKIPS = new Set(['brainstorm', 'review']);

const OBSERVE_LOG_REL = path.join('.envoy', 'observe-log.jsonl');

/**
 * Read all records from dir/.envoy/observe-log.jsonl. Missing file → []; corrupt
 * lines are skipped rather than thrown on (mirrors readLedger's tolerance).
 * @param {string} dir
 * @returns {object[]}
 */
function readObserveLog(dir) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(dir, OBSERVE_LOG_REL), 'utf8');
  } catch (_err) {
    return [];
  }
  const records = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    try {
      records.push(JSON.parse(line));
    } catch (_err) {
      // Skip a corrupt line — the log stays readable.
    }
  }
  return records;
}

/**
 * Build the trail model from already-parsed event arrays. Pure — no fs.
 *
 * @param {{ledger?: object[], observeLog?: object[]}} [input]
 * @returns {TrailModel}
 */
function buildTrail(input = {}) {
  const ledger = Array.isArray(input.ledger) ? input.ledger : [];
  const observeLog = Array.isArray(input.observeLog) ? input.observeLog : [];

  // First-seen ts per started skill.
  const startedAt = {};
  for (const e of ledger) {
    if (e && e.type === 'skill-started' && e.skill && !(e.skill in startedAt)) {
      startedAt[e.skill] = e.ts || null;
    }
  }

  const hotfix = 'hotfix' in startedAt
    ? { ran: true, ts: startedAt.hotfix }
    : null;

  // Steps: brainstorm only when it has a skill-started; then the rigid four.
  const stepNames = [];
  if ('brainstorm' in startedAt) stepNames.push('brainstorm');
  stepNames.push(...RIGID_STEPS);

  const steps = stepNames.map((skill) => {
    const ran = skill in startedAt;
    const step = { skill, ran, ts: ran ? startedAt[skill] : null };
    if (!ran && hotfix && HOTFIX_SANCTIONED_SKIPS.has(skill)) {
      step.sanctionedSkip = true;
    }
    return step;
  });

  const handoffs = ledger
    .filter((e) => e && e.type === 'handoff-written')
    .map((e) => ({ from: e.from || null, to: e.to || null, ts: e.ts || null }));

  let overrides = 0;
  let wouldBlock = 0;
  for (const r of observeLog) {
    if (r && r.kind === 'override') overrides += 1;
    else wouldBlock += 1;
  }

  const label = ledgerLabel(ledger);

  return {
    branch: label.branch,
    issue: label.issue,
    steps,
    handoffs,
    overrides,
    wouldBlock,
    hotfix,
    empty: ledger.length === 0 && observeLog.length === 0,
  };
}

/**
 * Derive the branch/issue label from the first ledger events that carry them.
 * @param {object[]} ledger
 * @returns {{branch: string|null, issue: number|null}}
 */
function ledgerLabel(ledger) {
  let branch = null;
  let issue = null;
  for (const e of ledger) {
    if (!e) continue;
    if (branch === null && e.branch) branch = e.branch;
    if (issue === null && e.issue !== undefined && e.issue !== null) issue = e.issue;
    if (branch !== null && issue !== null) break;
  }
  return { branch, issue };
}

/**
 * Render a trail model as a prose report string. Pure — no fs.
 * @param {TrailModel} model
 * @returns {string}
 */
function renderTrail(model) {
  const heading = trailHeading(model);

  if (model.empty) {
    return `${heading}\n\nNothing recorded — this branch has no ledger or gate activity.\n`;
  }

  const lines = [heading, ''];

  lines.push('Workflow steps:');
  for (const step of model.steps) {
    if (step.ran) {
      lines.push(`  ✓ ${step.skill.padEnd(10)} ran ${step.ts}`);
    } else if (step.sanctionedSkip) {
      lines.push(`  ✗ ${step.skill.padEnd(10)} skipped (sanctioned — hotfix fast-path)`);
    } else {
      lines.push(`  ✗ ${step.skill.padEnd(10)} skipped`);
    }
  }
  lines.push('');

  lines.push('Handoffs:');
  if (model.handoffs.length === 0) {
    lines.push('  (none recorded)');
  } else {
    for (const h of model.handoffs) {
      lines.push(`  ${h.from} → ${h.to}${h.ts ? ` (${h.ts})` : ''}`);
    }
  }
  lines.push('');

  if (model.hotfix) {
    lines.push(
      `Hotfix: sanctioned fast-path (ran ${model.hotfix.ts}) — a hotfix legitimately`,
      '  skips brainstorm and review; this is tracked work, not skill-less.',
      ''
    );
  }

  lines.push(
    `Gate overrides: ${model.overrides} override(s) across ${model.wouldBlock} would-block event(s).`
  );

  return lines.join('\n') + '\n';
}

/**
 * Compose the report heading from the branch/issue label.
 * @param {TrailModel} model
 * @returns {string}
 */
function trailHeading(model) {
  const branch = model.branch || '(unknown branch)';
  const issue = model.issue !== null && model.issue !== undefined ? ` (issue #${model.issue})` : '';
  return `Compliance trail — ${branch}${issue}`;
}

/**
 * Read the ledger + observe-log under `dir/.envoy/` and render the trail. Missing
 * files → empty arrays → a clean "nothing recorded" report; never throws on
 * absent or corrupt logs.
 * @param {string} dir
 * @returns {string}
 */
function compliance(dir) {
  const ledger = readLedger(dir);
  const observeLog = readObserveLog(dir);
  return renderTrail(buildTrail({ ledger, observeLog }));
}

function main() {
  const dir = process.argv[2] || process.cwd();
  process.stdout.write(compliance(dir));
}

if (require.main === module) main();

module.exports = {
  buildTrail,
  renderTrail,
  compliance,
  readObserveLog,
};

/**
 * @typedef {Object} TrailModel
 * @property {string|null} branch
 * @property {number|null} issue
 * @property {Array<{skill: string, ran: boolean, ts: string|null, sanctionedSkip?: boolean}>} steps
 * @property {Array<{from: string|null, to: string|null, ts: string|null}>} handoffs
 * @property {number} overrides - Count of {kind:'override'} observe-log records.
 * @property {number} wouldBlock - Count of plain would-block observe-log records.
 * @property {{ran: boolean, ts: string|null}|null} hotfix
 * @property {boolean} empty - True when neither log had any records.
 */
