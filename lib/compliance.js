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
 *   node lib/compliance.js [dir]             # dir defaults to cwd
 *   node lib/compliance.js --pr-body [dir]   # '## Envoy trail' + fenced trail for a PR body
 *
 * `--pr-body` renders pre-merge (cleanup is 'pending', not 'skipped'), redacts the
 * home directory, uses a fence longer than any backtick run in the content, and
 * always exits 0 — a trail failure must never block PR creation.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { readLedger } = require(path.join(__dirname, 'ledger'));

/** The rigid workflow steps, always shown in order. */
const RIGID_STEPS = ['pickup', 'review', 'finalize', 'cleanup'];

/**
 * Skips a hotfix legitimately makes — not flagged as violations when hotfix ran.
 * Hotfix does pickup's job (own worktree + TDD) and finalize's job (own PR), and
 * skips brainstorm and multi-layer review by design.
 */
const HOTFIX_SANCTIONED_SKIPS = new Set(['brainstorm', 'pickup', 'review', 'finalize']);

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
 * `pending` names steps that cannot have run yet at render time (e.g.
 * ['cleanup'] before merge). A listed step that did not run renders as
 * pending instead of skipped; a step that did run is unaffected. Opt-in.
 *
 * @param {{ledger?: object[], observeLog?: object[], pending?: string[]}} [input]
 * @returns {TrailModel}
 */
function buildTrail(input = {}) {
  const ledger = Array.isArray(input.ledger) ? input.ledger : [];
  const observeLog = Array.isArray(input.observeLog) ? input.observeLog : [];
  const pending = new Set(Array.isArray(input.pending) ? input.pending : []);

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

  // Steps: brainstorm when it has a skill-started, or under a hotfix (where its
  // absence is a sanctioned skip worth showing); then the rigid four.
  const stepNames = [];
  if ('brainstorm' in startedAt || hotfix) stepNames.push('brainstorm');
  stepNames.push(...RIGID_STEPS);

  const steps = stepNames.map((skill) => {
    const ran = skill in startedAt;
    const step = { skill, ran, ts: ran ? startedAt[skill] : null };
    if (!ran && pending.has(skill)) {
      step.pending = true;
    } else if (!ran && hotfix && HOTFIX_SANCTIONED_SKIPS.has(skill)) {
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
 * Derive the branch/issue label: the LATEST event's branch (early events
 * such as brainstorm/pickup preflight run in the main checkout before the
 * worktree exists and carry "main"), and the first issue number seen.
 * @param {object[]} ledger
 * @returns {{branch: string|null, issue: number|null}}
 */
function ledgerLabel(ledger) {
  let branch = null;
  let issue = null;
  for (const e of ledger) {
    if (!e) continue;
    if (e.branch) branch = e.branch;
    if (issue === null && e.issue !== undefined && e.issue !== null) issue = e.issue;
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
    } else if (step.pending) {
      lines.push(`  … ${step.skill.padEnd(10)} pending (cannot have run yet)`);
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
      '  skips brainstorm and review and does the pickup and finalize jobs itself',
      '  (own worktree, own PR); this is tracked work, not skill-less.',
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
 * @param {{pending?: string[]}} [opts] - Forwarded to buildTrail.
 * @returns {string}
 */
function compliance(dir, opts = {}) {
  const ledger = readLedger(dir);
  const observeLog = readObserveLog(dir);
  return renderTrail(buildTrail({ ledger, observeLog, pending: opts.pending }));
}

/** Steps that cannot have run when the PR is being created (pre-merge). */
const PRE_MERGE_PENDING = ['cleanup'];

const PR_BODY_HEADING = '## Envoy trail';

/**
 * Make rendered trail text safe for a public PR body: redact the home
 * directory to `~` (only at a path boundary, so /Users/a never rewrites
 * /Users/ab), and strip C0/C1 control characters (keeping newlines and tabs)
 * plus zero-width and bidi-override characters.
 * @param {string} text
 * @param {string} [home]
 * @returns {string}
 */
function sanitizeForPrBody(text, home = os.homedir()) {
  let out = String(text);
  if (home && home.length > 1) {
    const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`${escaped}(?![\\w.-])`, 'g'), '~');
  }
  // eslint-disable-next-line no-control-regex
  return out.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '');
}

/**
 * Wrap text in a fenced code block whose fence is longer than any backtick
 * run inside it, so ledger content cannot close the block early.
 * @param {string} text
 * @returns {string}
 */
function fence(text) {
  const longest = (text.match(/`+/g) || []).reduce((n, run) => Math.max(n, run.length), 0);
  const f = '`'.repeat(Math.max(3, longest + 1));
  return `${f}\n${text.replace(/\n+$/, '')}\n${f}`;
}

/**
 * The PR-body section: a leading blank line, '## Envoy trail', and the
 * pre-merge trail (cleanup pending) in a fenced code block. Never throws —
 * any failure degrades to the nothing-recorded report.
 * @param {string} dir
 * @returns {string}
 */
function prBodySection(dir) {
  let trail;
  try {
    trail = compliance(dir, { pending: PRE_MERGE_PENDING });
  } catch (_err) {
    trail = renderTrail(buildTrail({}));
  }
  return `\n${PR_BODY_HEADING}\n\n${fence(sanitizeForPrBody(trail))}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const prBody = args.includes('--pr-body');
  const dir = args.find((a) => !a.startsWith('--')) || process.cwd();
  if (prBody) {
    try {
      process.stdout.write(prBodySection(dir));
    } catch (_err) {
      process.stdout.write(`\n${PR_BODY_HEADING}\n\n\`\`\`\nNothing recorded.\n\`\`\`\n`);
    }
    process.exitCode = 0;
    return;
  }
  process.stdout.write(compliance(dir));
}

if (require.main === module) main();

module.exports = {
  buildTrail,
  renderTrail,
  compliance,
  readObserveLog,
  prBodySection,
  sanitizeForPrBody,
  fence,
};

/**
 * @typedef {Object} TrailModel
 * @property {string|null} branch
 * @property {number|null} issue
 * @property {Array<{skill: string, ran: boolean, ts: string|null, sanctionedSkip?: boolean, pending?: boolean}>} steps
 * @property {Array<{from: string|null, to: string|null, ts: string|null}>} handoffs
 * @property {number} overrides - Count of {kind:'override'} observe-log records.
 * @property {number} wouldBlock - Count of plain would-block observe-log records.
 * @property {{ran: boolean, ts: string|null}|null} hotfix
 * @property {boolean} empty - True when neither log had any records.
 */
