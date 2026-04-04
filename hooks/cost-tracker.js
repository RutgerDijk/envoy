#!/usr/bin/env node
/**
 * Async Stop hook: Cost tracker
 *
 * Logs token usage to ~/.claude/metrics/envoy-costs.jsonl
 * for optimization insights. Non-blocking, no context pollution.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const METRICS_DIR = path.join(os.homedir(), '.claude', 'metrics');
const METRICS_FILE = path.join(METRICS_DIR, 'envoy-costs.jsonl');

function run(rawInput) {
  try {
    const input = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;

    // Ensure metrics directory exists
    fs.mkdirSync(METRICS_DIR, { recursive: true });

    // Build record
    const record = {
      timestamp: new Date().toISOString(),
      session_id: process.env.CLAUDE_SESSION_ID || 'unknown',
      model: input.model || process.env.CLAUDE_MODEL || 'unknown',
      input_tokens: input.input_tokens || 0,
      output_tokens: input.output_tokens || 0,
      phase: detectPhase(input),
      branch: getBranch(),
    };

    // Append as JSONL
    fs.appendFileSync(METRICS_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    // Async hook — never block, never fail
  }
}

/**
 * Detect the current phase from session context.
 */
function detectPhase(input) {
  const conversation = (input.conversation || '').toLowerCase();

  if (conversation.includes('review') || conversation.includes('layered-review')) {
    return 'review';
  }
  if (conversation.includes('implement') || conversation.includes('executing-plan')) {
    return 'implement';
  }
  if (conversation.includes('brainstorm') || conversation.includes('planning')) {
    return 'brainstorm';
  }
  if (conversation.includes('finalize') || conversation.includes('finishing')) {
    return 'finalize';
  }
  return 'general';
}

/**
 * Get the current git branch name.
 */
function getBranch() {
  try {
    const { execSync } = require('child_process');
    return execSync('git branch --show-current', {
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
  } catch (err) {
    return 'unknown';
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
