'use strict';

/**
 * ABOUTME: PreToolUse[Bash] guard: a command containing `gh issue create`
 * ABOUTME: gets permissionDecision "ask" so issue creation always needs user approval.
 *
 * Issues are born through brainstorm/hotfix after the user says go — never
 * on the model's own initiative. This guard does not block: it forces a
 * manual permission prompt, overriding any Bash allowlist rule.
 *
 * FAIL-OPEN: any error is swallowed and we return 0 with no output. A broken
 * guard must never affect a tool call.
 */

const REASON =
  'Self-initiated issue creation is not allowed (first time right). ' +
  'Approve only if you asked for this issue.';

/**
 * Evaluate one PreToolUse event.
 * @param {string|object} rawInput raw stdin payload (the tool-use event JSON)
 * @returns {number} exit code: always 0; the ask decision travels via stdout
 */
function run(rawInput) {
  try {
    const input = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
    if ((input.tool_name || '') !== 'Bash') return 0;

    const command = input.tool_input?.command || '';
    if (!command.includes('gh issue create')) return 0;

    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: REASON,
      },
    }));
    return 0;
  } catch {
    return 0;
  }
}

module.exports = { run };
