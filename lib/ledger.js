'use strict';

/**
 * Durable append-only workflow ledger.
 *
 * The ledger lives at .envoy/ledger.jsonl and records one JSON line per
 * lifecycle event (skill started, handoff written, …). It is the workflow's
 * diary: a flat, greppable trail of what happened, in order, across a run.
 *
 * Every event is stamped with `ts` (ISO time), `branch` (the git branch it was
 * written under), optionally `issue` (the issue number in play), and
 * optionally `sessionId` (the Claude session that wrote it, so /envoy:start can
 * offer `claude --resume <id>`). sessionId resolves from `opts.sessionId`, then
 * CLAUDE_SESSION_ID, then CLAUDE_CODE_SESSION_ID, and is omitted when none is
 * set — stamped centrally here so no skill has to pass it. The file is
 * size-capped so an unbounded run never grows it without limit — once it
 * exceeds `maxLines`, the oldest lines are dropped.
 *
 * A diary write must never break the workflow it observes, so appendEvent is
 * fail-soft: any fs error is swallowed. Reads are equally forgiving — a missing
 * file yields [] and corrupt lines are skipped rather than thrown on.
 *
 * Zero external dependencies. `now`, `branch`, `issue`, `sessionId`, and
 * `maxLines` are injectable so callers can test hermetically without touching
 * the real repo's git state, clock, or session env.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LEDGER_REL = path.join('.envoy', 'ledger.jsonl');

/** Default size cap: keep the last 500 events. */
const DEFAULT_MAX_LINES = 500;

/**
 * Resolve the ledger path under a working directory.
 * @param {string} dir
 * @returns {string}
 */
function ledgerPath(dir) {
  return path.join(dir, LEDGER_REL);
}

/**
 * Current git branch for a directory, or 'unknown' when git is unavailable.
 * @param {string} dir
 * @returns {string}
 */
function currentBranch(dir) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_err) {
    return 'unknown';
  }
}

/**
 * Resolve the Claude session id: opts.sessionId (null explicitly suppresses)
 * → CLAUDE_SESSION_ID → CLAUDE_CODE_SESSION_ID. Returns undefined when unset.
 * @param {{sessionId?: string|null}} opts
 * @returns {string|undefined}
 */
function resolveSessionId(opts) {
  if (opts.sessionId !== undefined) return opts.sessionId === null ? undefined : opts.sessionId;
  return process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CODE_SESSION_ID || undefined;
}

/**
 * Append one stamped event to dir/.envoy/ledger.jsonl. Creates .envoy when
 * missing and trims the file to the last `maxLines` events after appending.
 * Never throws — any fs error is swallowed so a diary write cannot break a
 * workflow.
 * @param {string} dir - Working directory root (ledger written under dir/.envoy).
 * @param {object} event - Event fields; merged over the stamped fields.
 * @param {{now?: Date, branch?: string, issue?: number, sessionId?: string|null, maxLines?: number}} [opts]
 *   `sessionId` overrides the env lookup; `null` suppresses the field. An
 *   explicit `event.sessionId` still wins (event is merged last).
 */
function appendEvent(dir, event = {}, opts = {}) {
  try {
    const now = opts.now || new Date();
    const branch = opts.branch !== undefined ? opts.branch : currentBranch(dir);
    const issue = event.issue !== undefined ? event.issue : opts.issue;
    const maxLines = opts.maxLines !== undefined ? opts.maxLines : DEFAULT_MAX_LINES;

    const record = {
      ts: now.toISOString(),
      branch,
    };
    if (issue !== undefined && issue !== null) record.issue = issue;
    const sessionId = resolveSessionId(opts);
    if (sessionId) record.sessionId = sessionId;
    Object.assign(record, event);

    const full = ledgerPath(dir);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.appendFileSync(full, `${JSON.stringify(record)}\n`);

    trimToMaxLines(full, maxLines);
  } catch (_err) {
    // Fail-soft: a diary write must never break the workflow it observes.
  }
}

/**
 * Trim a ledger file to its last `maxLines` lines, dropping the oldest. No-op
 * when the file is already within the cap or maxLines is not positive.
 * @param {string} full
 * @param {number} maxLines
 */
function trimToMaxLines(full, maxLines) {
  if (!(maxLines > 0)) return;
  const lines = fs.readFileSync(full, 'utf8').split('\n').filter((l) => l.length > 0);
  if (lines.length <= maxLines) return;
  const kept = lines.slice(lines.length - maxLines);
  fs.writeFileSync(full, `${kept.join('\n')}\n`);
}

/**
 * Read all events from the ledger. Missing file → []; corrupt lines are skipped
 * rather than thrown on.
 * @param {string} dir
 * @returns {object[]}
 */
function readLedger(dir) {
  let raw;
  try {
    raw = fs.readFileSync(ledgerPath(dir), 'utf8');
  } catch (_err) {
    return [];
  }
  const events = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    try {
      events.push(JSON.parse(line));
    } catch (_err) {
      // Skip a corrupt line — the diary stays readable.
    }
  }
  return events;
}

/**
 * Read the last `n` events from the ledger (or fewer). Missing file → [].
 * @param {string} dir
 * @param {number} n
 * @returns {object[]}
 */
function tailLedger(dir, n) {
  const events = readLedger(dir);
  if (!(n > 0)) return [];
  return events.slice(Math.max(0, events.length - n));
}

module.exports = {
  appendEvent,
  readLedger,
  tailLedger,
  DEFAULT_MAX_LINES,
};
