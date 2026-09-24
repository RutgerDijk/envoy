#!/usr/bin/env node
/**
 * PostToolUse[Bash] hook: compress noisy build/test output before it
 * reaches Claude's context.
 *
 * Runs lib/output-compressor.js over tool_response.stdout keyed by the
 * command. When a pattern matches (and the safeguard ratio did not trip),
 * emits hookSpecificOutput.updatedToolOutput as an OBJECT shaped like
 * tool_response — Claude Code ignores a bare string for built-in Bash.
 * stderr / interrupted / isImage are passed through untouched.
 *
 * Fail-open: any error or unexpected input → no output, exit 0.
 */

const { compress } = require('../lib/output-compressor');

/**
 * Build the hook output for a PostToolUse event, or null to leave the
 * tool output unchanged.
 * @param {object} event - Parsed PostToolUse payload
 * @returns {object|null}
 */
function buildOutput(event) {
  if (!event || typeof event !== 'object' || event.tool_name !== 'Bash') return null;

  const command = event.tool_input && event.tool_input.command;
  const response = event.tool_response;
  if (typeof command !== 'string' || !response || typeof response !== 'object') return null;

  const stdout = response.stdout;
  if (typeof stdout !== 'string' || stdout.length === 0) return null;

  const { compressed, savings } = compress(stdout, command);
  const pattern = savings && savings.pattern;
  if (!pattern || pattern.endsWith('(safeguard)')) return null;
  if (typeof compressed !== 'string' || compressed === stdout) return null;

  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      updatedToolOutput: { ...response, stdout: compressed },
    },
  };
}

/**
 * Hook entry point. Called by hook-runner on PostToolUse[Bash].
 * @param {string} rawInput
 * @returns {number}
 */
function run(rawInput) {
  try {
    const output = buildOutput(JSON.parse(rawInput));
    if (output) process.stdout.write(JSON.stringify(output) + '\n');
  } catch {
    // Fail-open: never block or pollute context
  }
  return 0;
}

module.exports = { run, buildOutput };
