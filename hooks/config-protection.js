#!/usr/bin/env node
/**
 * PreToolUse hook: Config protection
 *
 * Blocks modifications to linter/formatter config files,
 * forcing Claude to fix source code instead of weakening rules.
 */

const path = require('path');

const BLOCKED_PATTERNS = [
  /^\.eslintrc/,
  /^eslint\.config\./,
  /^\.prettierrc/,
  /^prettier\.config\./,
  /^biome\.json$/,
  /^\.editorconfig$/,
];

const WARN_PATTERNS = [
  /^tsconfig\.json$/,
  /^tsconfig\..+\.json$/,
];

function run(rawInput) {
  try {
    const input = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
    const toolName = input.tool_name || '';
    const filePath = input.tool_input?.file_path || '';

    if (!filePath) return;
    if (!['Edit', 'Write'].includes(toolName)) return;

    const basename = path.basename(filePath);

    // Check blocked patterns
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(basename)) {
        // Exit code 2 = block the tool call
        console.error(JSON.stringify({
          decision: 'block',
          reason: `BLOCKED: Cannot modify ${basename}. Fix source code instead of weakening linter/formatter config.`,
        }));
        process.exit(2);
      }
    }

    // Check warn patterns
    for (const pattern of WARN_PATTERNS) {
      if (pattern.test(basename)) {
        console.error(JSON.stringify({
          decision: 'warn',
          reason: `WARNING: Modifying ${basename}. Ensure this is intentional and not to suppress errors.`,
        }));
        return;
      }
    }
  } catch (err) {
    // Don't block on errors in the hook itself
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

module.exports = { run, BLOCKED_PATTERNS, WARN_PATTERNS };
