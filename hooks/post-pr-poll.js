#!/usr/bin/env node
/**
 * PostToolCall hook: Post-PR CodeRabbit poll trigger
 *
 * After `gh pr create`, saves the PR number and outputs
 * instructions for Claude to poll for CodeRabbit comments.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function run(rawInput) {
  try {
    const input = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
    const toolName = input.tool_name || '';
    const toolInput = input.tool_input || {};
    const toolOutput = input.tool_output || '';

    // Only trigger on Bash calls containing 'gh pr create'
    if (toolName !== 'Bash') return;
    const command = toolInput.command || '';
    if (!command.includes('gh pr create')) return;

    // Extract PR number from output (gh pr create outputs the PR URL)
    const prMatch = toolOutput.match(/pull\/(\d+)/);
    if (!prMatch) return;

    const prNumber = prMatch[1];

    // Save PR number for other hooks
    const prFile = path.join(os.tmpdir(), 'envoy-active-pr.txt');
    fs.writeFileSync(prFile, prNumber, 'utf8');

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
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { data += chunk; });
  process.stdin.on('end', () => {
    run(data);
    process.exit(0);
  });
}

module.exports = { run };
