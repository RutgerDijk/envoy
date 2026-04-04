/**
 * Loop safeguards for autonomous Envoy workflows.
 *
 * A single "I'm done" could be hallucinated. Three consecutive
 * completion signals with evidence between each confirm genuine completion.
 *
 * Skills reference this protocol — this file documents the constants
 * and the protocol for consistency across all skills.
 */

/**
 * The exact string agents must output to signal loop completion.
 */
const COMPLETION_SIGNAL = 'ENVOY_LOOP_COMPLETE';

/**
 * Number of consecutive signals required before a loop actually stops.
 */
const REQUIRED_CONSECUTIVE = 3;

/**
 * Protocol for skills to reference:
 *
 * Before claiming any autonomous loop is complete:
 *
 * 1. Run verification, output ENVOY_LOOP_COMPLETE with evidence
 * 2. Run verification AGAIN (fresh check), output ENVOY_LOOP_COMPLETE with evidence
 * 3. Run verification THIRD TIME (fresh check), output ENVOY_LOOP_COMPLETE with evidence
 *
 * Only after 3 consecutive signals: loop is truly done.
 *
 * If ANY check fails between signals: reset counter to 0 and resume the loop.
 *
 * This applies to:
 * - Fix-and-verify cycles (verification skill)
 * - CodeRabbit re-poll cycles (finishing-branch skill)
 * - Any polling loop (e.g., waiting for CI)
 * - Execution plan completion checks
 */
const PROTOCOL = `
## Completion Signal Protocol

Autonomous loops must confirm completion ${REQUIRED_CONSECUTIVE} times consecutively.

\`\`\`
counter = 0

while counter < ${REQUIRED_CONSECUTIVE}:
  1. Run the verification/check
  2. If check PASSES:
     - Output: "${COMPLETION_SIGNAL}" with evidence
     - counter += 1
  3. If check FAILS:
     - counter = 0  (reset!)
     - Address the failure
     - Continue loop

Loop exits only when counter reaches ${REQUIRED_CONSECUTIVE}.
\`\`\`

A single "I'm done" could be hallucinated. Three consecutive confirmations
with fresh evidence each time prove genuine completion.
`;

module.exports = {
  COMPLETION_SIGNAL,
  REQUIRED_CONSECUTIVE,
  PROTOCOL,
};
