'use strict';

/**
 * Shared CodeRabbit rate-limit re-trigger decision (Task 8).
 *
 * A rate-limited CodeRabbit run does not resume on its own. This module is
 * the ONE place that decides what to do about it — both `envoy:finalize`
 * (steps/coderabbit.md, Step 3 collect phase) and `envoy:babysit` (Step 3)
 * call into `shouldReTrigger` rather than duplicating the decision logic.
 *
 * Locked decision (resolved from the spec's given/when/then):
 *   1. minutesUntilReset > 10  -> action: 'handoff'. Do not wait. The caller
 *      (finalize) should STOP and hand off to babysit with
 *      formatHandoffMessage(resetsAt); babysit itself never hits this
 *      branch in a useful way since it doesn't poll, but the helper is
 *      shared so the branch exists for both callers.
 *   2. minutesUntilReset <= 10 -> action: 'wait'. The poll deadline extends
 *      to (resetsAt + 2min) IF that exceeds the current poll deadline,
 *      capped at a 60-minute hard ceiling. The extension only ever applies
 *      in this branch — it is not a general invitation to wait an hour
 *      whenever rate-limited.
 *   3. resetsAt has already passed (in the past relative to `now`) ->
 *      action: 'retrigger' (post "@coderabbitai review" and reset the poll
 *      clock) — UNLESS the caller has already used up its retrigger
 *      budget for this run, in which case action: 'capped'.
 *   4. rateLimited is false -> action: 'none'.
 *
 * Max 2 re-triggers per finalize run (acceptance criterion #1) is enforced
 * here via the `retriggerCount`/`maxRetriggers` opts, not duplicated in
 * either SKILL.md's prose.
 */

const HANDOFF_THRESHOLD_MINUTES = 10;
const EXTENSION_PADDING_SECONDS = 2 * 60; // resetsAt + 2min
const HARD_CEILING_SECONDS = 60 * 60; // 60min hard ceiling
const DEFAULT_MAX_RETRIGGERS = 2;

/**
 * @param {{rateLimited: boolean, resetsAt: string|null}} rateLimit - from lib/pr-status.js parseRateLimit()
 * @param {Date} [now] - reference time (defaults to current time)
 * @param {object} [opts]
 * @param {number} [opts.currentDeadlineSeconds] - the poll loop's current deadline in seconds (e.g. 1320 for the 22min cap)
 * @param {number} [opts.retriggerCount] - re-triggers already used this run
 * @param {number} [opts.maxRetriggers] - cap on re-triggers per run (default 2)
 * @returns {{action: 'none'|'wait'|'retrigger'|'handoff'|'capped', resetsAt?: string|null, extendedDeadlineSeconds?: number, minutesUntilReset?: number}}
 */
function shouldReTrigger(rateLimit, now = new Date(), opts = {}) {
  const rl = rateLimit || {};
  if (!rl.rateLimited) {
    return { action: 'none' };
  }

  const maxRetriggers = opts.maxRetriggers != null ? opts.maxRetriggers : DEFAULT_MAX_RETRIGGERS;
  const retriggerCount = opts.retriggerCount || 0;
  const currentDeadlineSeconds = opts.currentDeadlineSeconds || 0;

  // resetsAt unknown — cannot compute minutesUntilReset. Nothing to wait on
  // or hand off with a time, so treat as immediately-actionable retrigger
  // (subject to the same cap as any other retrigger).
  if (!rl.resetsAt) {
    if (retriggerCount >= maxRetriggers) return { action: 'capped' };
    return { action: 'retrigger' };
  }

  const resetsAtMs = new Date(rl.resetsAt).getTime();
  const nowMs = now.getTime();
  const minutesUntilReset = (resetsAtMs - nowMs) / 60000;

  // resetsAt has already passed -> retrigger now (subject to cap).
  if (minutesUntilReset <= 0) {
    if (retriggerCount >= maxRetriggers) return { action: 'capped' };
    return { action: 'retrigger' };
  }

  // Far out (>10min): do not wait — hand off to babysit.
  if (minutesUntilReset > HANDOFF_THRESHOLD_MINUTES) {
    return { action: 'handoff', resetsAt: rl.resetsAt, minutesUntilReset };
  }

  // Close (<=10min): wait it out. Extend the deadline to resetsAt+2min only
  // if that exceeds the current deadline, capped at the 60min hard ceiling.
  const resetsAtSecondsFromNow = Math.ceil((resetsAtMs - nowMs) / 1000);
  const requestedDeadline = Math.min(resetsAtSecondsFromNow + EXTENSION_PADDING_SECONDS, HARD_CEILING_SECONDS);
  const extendedDeadlineSeconds = Math.min(
    Math.max(currentDeadlineSeconds, requestedDeadline),
    HARD_CEILING_SECONDS
  );

  return {
    action: 'wait',
    resetsAt: rl.resetsAt,
    minutesUntilReset,
    extendedDeadlineSeconds,
  };
}

/**
 * Format the explicit finalize -> babysit handoff message when a rate-limit
 * reset is too far out to wait for.
 *
 * @param {string} resetsAt - ISO timestamp
 * @returns {string}
 */
function formatHandoffMessage(resetsAt) {
  const d = new Date(resetsAt);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `CodeRabbit is rate-limited past the wait window. run /envoy:babysit after ${hh}:${mm}`;
}

module.exports = {
  HANDOFF_THRESHOLD_MINUTES,
  EXTENSION_PADDING_SECONDS,
  HARD_CEILING_SECONDS,
  DEFAULT_MAX_RETRIGGERS,
  shouldReTrigger,
  formatHandoffMessage,
};
