'use strict';

/**
 * Pure helpers for the finalize "batch remediation cycle" (Task 7).
 *
 * A remediation cycle collects ALL CodeRabbit findings AND ALL CI failure
 * diagnoses together, applies every fix, then produces exactly ONE commit
 * and ONE push before replying/resolving CodeRabbit threads and re-polling.
 * This module holds the two pieces of real branching logic so the
 * SKILL.md prose doesn't have to re-derive them inline:
 *
 *   - buildCommitMessage(findings): one commit body enumerating every
 *     finding addressed, with its thread URL when it has one, so the
 *     mapping from "what changed" to "which thread it resolves" survives
 *     in git history.
 *   - shouldEscalate(cycleCount, remaining): the cycle-cap check — max 3
 *     cycles; if issues remain after cycle 3, stop and ask the user
 *     instead of looping again or silently finishing.
 */

const MAX_CYCLES = 3;

/**
 * @param {Array<{type: 'coderabbit'|'ci', summary: string, threadUrl?: string}>} findings
 * @returns {string} commit message: single-line subject + body enumerating each finding
 */
function buildCommitMessage(findings) {
  if (!Array.isArray(findings) || findings.length === 0) {
    throw new Error('buildCommitMessage requires at least one finding — nothing to commit');
  }

  const crCount = findings.filter((f) => f.type === 'coderabbit').length;
  const ciCount = findings.filter((f) => f.type === 'ci').length;

  const subjectParts = [];
  if (crCount > 0) subjectParts.push(`${crCount} CodeRabbit finding${crCount === 1 ? '' : 's'}`);
  if (ciCount > 0) subjectParts.push(`${ciCount} CI failure${ciCount === 1 ? '' : 's'}`);
  const subject = `fix: address ${subjectParts.join(' + ')}`;

  const bodyLines = findings.map((f, i) => {
    const label = f.type === 'coderabbit' ? 'CodeRabbit' : 'CI';
    const urlSuffix = f.threadUrl ? ` (${f.threadUrl})` : '';
    return `${i + 1}. [${label}] ${f.summary}${urlSuffix}`;
  });

  return [subject, '', ...bodyLines].join('\n');
}

/**
 * @param {number} cycleCount cycles completed so far (1-indexed)
 * @param {{coderabbit: Array<unknown>, ci: Array<unknown>}} remaining what's still open after this cycle's re-poll
 * @returns {boolean} true if the cap is reached AND issues remain — caller must stop and ask the user
 */
function shouldEscalate(cycleCount, remaining) {
  const remainingCount =
    ((remaining && remaining.coderabbit) || []).length + ((remaining && remaining.ci) || []).length;
  return cycleCount >= MAX_CYCLES && remainingCount > 0;
}

module.exports = {
  MAX_CYCLES,
  buildCommitMessage,
  shouldEscalate,
};
