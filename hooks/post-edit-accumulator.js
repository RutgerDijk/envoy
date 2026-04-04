#!/usr/bin/env node
/**
 * PostToolUse hook: Edit accumulator for batched processing
 *
 * Appends edited file paths to a temp file so stop-batch-lint.js
 * can run lint/format once across all files instead of per-edit.
 */

const fs = require('fs');
const path = require('path');

const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.cs', '.csx',
  '.css', '.scss', '.less',
  '.json', '.jsonc',
  '.html', '.htm',
  '.vue', '.svelte',
]);

function getAccumulatorPath() {
  const sessionId = process.env.CLAUDE_SESSION_ID || 'default';
  return path.join(require('os').tmpdir(), `envoy-edited-${sessionId}.txt`);
}

function run(rawInput) {
  try {
    const input = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
    const toolName = input.tool_name || '';
    const filePath = input.tool_input?.file_path || '';

    if (!filePath) return;
    if (!['Edit', 'Write'].includes(toolName)) return;

    const ext = path.extname(filePath).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext)) return;

    const accPath = getAccumulatorPath();
    fs.appendFileSync(accPath, filePath + '\n', 'utf8');
  } catch (err) {
    // Non-blocking — never fail the tool call
  }
}

// CLI mode: read from stdin
if (require.main === module) {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { data += chunk; });
  process.stdin.on('end', () => {
    run(data);
    process.exit(0);
  });
}

module.exports = { run, getAccumulatorPath };
