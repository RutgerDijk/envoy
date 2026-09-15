#!/usr/bin/env node
/**
 * PreToolUse[Edit|Write] hook: config-protection.
 *
 * Task 15 originally also folded post-edit-accumulator's file-path
 * recording into this same Pre-hook spawn, to cut two `node` spawns
 * per edit down to one. That was found to be incorrect: PreToolUse
 * fires before the edit is attempted, and stop-batch-lint.js filters
 * queued paths only via fs.existsSync(), not by whether the edit
 * actually succeeded — so a failed Edit (e.g. old_string not found) on
 * a pre-existing file still got run through `eslint --fix` /
 * `dotnet format` at Stop, reformatting a file the session never
 * actually touched.
 *
 * Investigation: Claude Code fires PostToolUse only on tool SUCCESS —
 * a failed tool call raises a distinct PostToolUseFailure event
 * instead. So the original, pre-Task-15 post-edit-accumulator.js
 * (registered on PostToolUse, and itself never checking any
 * success/error field) was already correctly gated on success —
 * implicitly, via the event it was wired to. Moving its recording onto
 * PreToolUse is what broke that guarantee; this was a regression
 * introduced by the Task 15 merge, not a pre-existing bug in
 * post-edit-accumulator.js.
 *
 * Fix: this module now runs config-protection ONLY (must block BEFORE
 * the edit happens). post-edit-accumulator is restored as its own
 * standalone PostToolUse[Edit|Write] hooks.json entry (unchanged file,
 * unchanged logic), so it only records paths for edits Claude Code
 * confirms succeeded.
 *
 * Tradeoff: this costs back one `node` spawn per edit (2 total: Pre +
 * Post), a narrow, deliberate exception to Task 15's "one spawn per
 * Edit/Write" acceptance criterion. Pre and Post are different
 * lifecycle events; merging accumulator recording across them was
 * never actually safe to do in one spawn without losing the
 * success-gate. Correctness (don't lint-fix files an edit never
 * touched) outweighs the latency win here. Task 15's other single-spawn
 * wins (e.g. post-pr-poll gating) are unaffected.
 */

const configProtection = require('./config-protection');

function run(rawInput) {
  // May process.exit(2) internally to block the edit.
  configProtection.run(rawInput);
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
