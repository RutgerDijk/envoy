#!/usr/bin/env node
/**
 * ABOUTME: PreCompact hook — records a pre-compact event in the durable ledger.
 * ABOUTME: Fail-open: any error is swallowed and it always exits 0, never blocking compaction.
 */

const path = require('path');

/**
 * Append a pre-compact event to the ledger. Never throws.
 * @param {string} [_rawInput] - PreCompact stdin payload (unused).
 * @returns {number} Always 0.
 */
function run(_rawInput) {
  try {
    const { appendEvent } = require(path.join(__dirname, '..', 'lib', 'ledger'));
    appendEvent(process.cwd(), { type: 'pre-compact' });
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
