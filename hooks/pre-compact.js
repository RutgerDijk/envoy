#!/usr/bin/env node
/**
 * ABOUTME: PreCompact hook — records a pre-compact event in the durable ledger.
 * ABOUTME: Also captures the active-skill marker (if any) so which rigid skill
 * ABOUTME: was mid-flight survives compaction even though context does not.
 * ABOUTME: Fail-open: any error is swallowed and it always exits 0, never blocking compaction.
 */

const path = require('path');

/**
 * Append a pre-compact event to the ledger. Never throws. When
 * .envoy/active-skill.json has a live (non-stale) marker, the event also
 * carries `activeSkill` and `issueNumber` so SessionStart can nudge
 * re-invocation on resume.
 * @param {string} [_rawInput] - PreCompact stdin payload (unused).
 * @returns {number} Always 0.
 */
function run(_rawInput) {
  try {
    const { appendEvent } = require(path.join(__dirname, '..', 'lib', 'ledger'));
    const { readActiveSkill } = require(path.join(__dirname, '..', 'lib', 'active-skill'));

    const event = { type: 'pre-compact' };
    try {
      const marker = readActiveSkill(process.cwd());
      if (marker && marker.skill) {
        event.activeSkill = marker.skill;
        if (marker.issueNumber !== undefined && marker.issueNumber !== null) {
          event.issueNumber = marker.issueNumber;
        }
      }
    } catch (_markerErr) {
      // Fail-open: an unreadable/stale marker is not fatal — record the bare event.
    }

    appendEvent(process.cwd(), event);
  } catch (_err) {
    // Fail-open: a PreCompact hook must never break compaction.
  }
  return 0;
}

// CLI mode
if (require.main === module) {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { data += chunk; });
  process.stdin.on('end', () => {
    run(data);
    process.exit(0);
  });
}

module.exports = { run };
