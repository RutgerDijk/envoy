#!/usr/bin/env node
/**
 * PreToolUse[Edit|Write] combined hook: config-protection + post-edit-accumulator
 *
 * Latency fix: hooks.json previously wired config-protection (PreToolUse)
 * and post-edit-accumulator (PostToolUse) as two separate hook-runner
 * invocations, spawning two cold `node` processes per edit. This module
 * requires both hooks in-process and runs their logic from ONE spawn,
 * invoked on PreToolUse[Edit|Write].
 *
 * Behavior preserved exactly:
 *  - config-protection runs first and unconditionally (all profiles). If it
 *    blocks (BLOCKED_PATTERNS match), it calls process.exit(2) itself —
 *    same as before, and the accumulator half never runs for a blocked edit
 *    (matching the old behavior where PostToolUse never fires for a
 *    Pre-blocked tool call).
 *  - post-edit-accumulator only runs when the current ENVOY_HOOK_PROFILE
 *    would have run it originally (standard/strict, not minimal) — gated
 *    via hook-runner's shouldRun(), so profile scoping is unchanged even
 *    though it's now invoked from a Pre hook instead of a Post hook.
 *
 * Known behavior change (documented, in scope per task): the accumulator
 * now records the file path on the PreToolUse attempt rather than after a
 * confirmed-successful PostToolUse edit. For blocked edits this doesn't
 * matter (config-protection exits first). For edits that fail for other
 * reasons (e.g. old_string not found), the path may be recorded slightly
 * earlier than before; stop-batch-lint already tolerates unchanged files.
 */

const configProtection = require('./config-protection');
const postEditAccumulator = require('./post-edit-accumulator');
const { shouldRun } = require('./hook-runner');

function run(rawInput) {
  // May process.exit(2) internally to block the edit — nothing after this
  // line runs in that case.
  configProtection.run(rawInput);

  if (shouldRun('post-edit-accumulator')) {
    postEditAccumulator.run(rawInput);
  }
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
