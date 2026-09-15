#!/usr/bin/env node
/**
 * PostToolCall hook: Post-PR CodeRabbit poll trigger
 *
 * After `gh pr create`, updates .envoy/finalize/state.json with the PR
 * number/URL and outputs instructions for Claude to poll for CodeRabbit
 * comments.
 *
 * Latency: hooks.json already gates the `node` spawn on
 * `[ -f .envoy/finalize/state.json ]` so this hook mostly never spawns
 * outside a finalize lifecycle. As defense in depth (profile variations,
 * direct invocation, etc.) STATE_PATH existence is re-checked here, first,
 * before any stdin read or JSON parsing — the cheapest possible bail-out.
 *
 * The retired /tmp/envoy-active-pr.txt write (CLAUDE.md: replaced by
 * .envoy/finalize/state.json) has been removed; this hook now merges the
 * PR number/URL into the same state.json that finalize itself seeds and
 * updates, instead of writing a second, unread file.
 */

const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join('.envoy', 'finalize', 'state.json');

function run(rawInput) {
  try {
    // Cheapest possible gate: no finalize lifecycle active, nothing to do.
    // Checked again here (in addition to hooks.json's shell-level gate) so
    // this hook is inert even if invoked directly / under a profile variant.
    if (!fs.existsSync(STATE_PATH)) return;

    const input = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
    const toolName = input.tool_name || '';
    const toolInput = input.tool_input || {};
    const toolOutput = input.tool_output || '';

    // Only trigger on Bash calls containing 'gh pr create'
    if (toolName !== 'Bash') return;
    const command = toolInput.command || '';
    if (!command.includes('gh pr create')) return;

    // Extract PR number/URL from output (gh pr create outputs the PR URL)
    const prMatch = toolOutput.match(/pull\/(\d+)/);
    if (!prMatch) return;

    const prNumber = prMatch[1];
    const prUrlMatch = toolOutput.match(/https?:\/\/\S*\/pull\/\d+/);

    // Merge PR info into .envoy/finalize/state.json (seeded by finalize's
    // preflight) instead of the retired /tmp/envoy-active-pr.txt.
    try {
      const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
      state.prNumber = Number(prNumber);
      if (prUrlMatch) state.prUrl = prUrlMatch[0];
      state.updatedAt = new Date().toISOString();
      fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
    } catch (writeErr) {
      // Non-blocking — state.json update is best-effort.
    }

    // Output instruction for Claude to poll
    const output = {
      hookSpecificOutput: `PR #${prNumber} created. GitHub CodeRabbit will review shortly. Poll for comments with: gh api repos/{owner}/{repo}/pulls/${prNumber}/comments`,
    };

    console.log(JSON.stringify(output));
  } catch (err) {
    // Non-blocking
  }
}

// CLI mode
if (require.main === module) {
  // Bail before even touching stdin when there's no finalize lifecycle.
  if (!fs.existsSync(STATE_PATH)) {
    process.exit(0);
  }
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { data += chunk; });
  process.stdin.on('end', () => {
    run(data);
    process.exit(0);
  });
}

module.exports = { run, STATE_PATH };
