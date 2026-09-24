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

const fs = require('fs');
const { compress } = require('../lib/output-compressor');

/**
 * Hook-level allowlist: compressor pattern → the leading invocation that
 * must actually start the command. Compressor patterns are unanchored
 * substring regexes, so without this `cat jest.config.js` would be
 * "compressed" by the jest pattern. Runners whose compression was shown to
 * hide failures are excluded (see comments below).
 */
const ALLOWED_INVOCATIONS = {
  'dotnet-build': /^dotnet\s+build(\s|$)/,
  'dotnet-test':  /^dotnet\s+test(\s|$)/,
  // Direct jest/vitest only: `npm test` may run node:test or mocha, whose
  // failures the jest pattern cannot see (it would report "All tests passed.").
  'jest-vitest':  /^(npx\s+(jest|vitest)|jest|vitest)(\s|$)/,
  // No `cargo test`: the cargo pattern drops `... FAILED` and panic lines.
  'cargo':        /^cargo\s+(build|check|clippy)(\s|$)/,
  // Deliberately absent (compression can hide failures): npm-install (npm 10
  // prints `npm error`, not `npm ERR!`), npm-build (Next.js "Compiled
  // successfully" precedes type errors), playwright (dot reporter drops the
  // failing test name), git-*, docker-compose.
};

/**
 * Loss guard. Compressor patterns can hide failures even for allowlisted
 * runners: the dotnet-build pattern drops code-less MSBuild errors
 * (`error : …`), and dotnet-test reports a solution where one test project
 * fails to compile but another passes as "All tests passed.". So any
 * distinct original line carrying a failure signal must survive
 * compression verbatim, or the original output stands.
 */
const FAILURE_SIGNAL = /: error |\berror [A-Z]+\d+:|\berror :|aborted|host process crashed/i;

/**
 * @param {string} original
 * @param {string} compressed
 * @returns {boolean} true when every failure-signal line survived
 */
function keepsFailureSignals(original, compressed) {
  const lines = new Set(original.split('\n').map(l => l.trim()).filter(Boolean));
  for (const line of lines) {
    if (FAILURE_SIGNAL.test(line) && !compressed.includes(line)) return false;
  }
  return true;
}

/**
 * Normalize a command to a single simple invocation, or null when it is
 * compound (&&, ||, ;, |, &, $(, backticks, newlines). A single trailing
 * `2>&1` redirect is allowed.
 * @param {string} command
 * @returns {string|null}
 */
function simpleCommand(command) {
  const cmd = command.trim().replace(/\s+2>&1$/, '');
  if (/[;&|`\n\r]|\$\(/.test(cmd)) return null;
  return cmd;
}

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

  const simple = simpleCommand(command);
  if (!simple) return null;

  const { compressed, savings } = compress(stdout, simple);
  const pattern = savings && savings.pattern;
  const invocation = pattern && ALLOWED_INVOCATIONS[pattern];
  if (!invocation || !invocation.test(simple)) return null;
  if (typeof compressed !== 'string' || compressed === stdout) return null;
  if (!keepsFailureSignals(stdout, compressed)) return null;

  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      updatedToolOutput: { ...response, stdout: compressed },
    },
  };
}

/**
 * Write synchronously to fd 1. hook-runner calls process.exit() right after
 * run(), which drops async pipe writes beyond the 64KB pipe buffer.
 * @param {string} text
 */
function writeAllSync(text) {
  const buf = Buffer.from(text, 'utf8');
  let offset = 0;
  while (offset < buf.length) {
    try {
      offset += fs.writeSync(1, buf, offset, buf.length - offset);
    } catch (err) {
      if (err && err.code === 'EAGAIN') continue;
      throw err;
    }
  }
}

/**
 * Hook entry point. Called by hook-runner on PostToolUse[Bash].
 * @param {string} rawInput
 * @returns {number}
 */
function run(rawInput) {
  try {
    const output = buildOutput(JSON.parse(rawInput));
    if (output) writeAllSync(JSON.stringify(output) + '\n');
  } catch {
    // Fail-open: never block or pollute context
  }
  return 0;
}

module.exports = { run, buildOutput, simpleCommand, keepsFailureSignals, ALLOWED_INVOCATIONS, FAILURE_SIGNAL };
