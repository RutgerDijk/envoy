'use strict';

/**
 * Session opener for /envoy:start — resume a chosen item in a fresh terminal.
 *
 * Given a directory and a Claude session id, open a new terminal there running
 * `claude --resume <id>`. Three modes, picked from the environment:
 *
 *   - cmux   — `CMUX_WORKSPACE_ID` is set (cmux auto-sets it in every cmux
 *              terminal). Runs `cmux new-workspace --cwd <dir> [--name <title>]
 *              --focus true --command <cmd>` (cmux defaults --focus to false).
 *   - vscode — `TERM_PROGRAM=vscode` without cmux. Runs `code -n <dir>` and
 *              copies the resume command to the clipboard via `pbcopy`
 *              (fail-soft: on pbcopy failure the command is still printed).
 *   - print  — anything else. No process is spawned; the dir and command are
 *              printed for the user to run. Also the fallback when the cmux or
 *              code exec throws (result then carries `fallbackFrom`).
 *
 * Every process is spawned with an argv array (execFileSync, never a shell
 * string). cmux runs `--command` in a shell, so the sessionId is validated
 * against /^[A-Za-z0-9-]+$/ — the only interpolated value in that string.
 * `dir` and `title` travel as their own argv entries and need no escaping.
 *
 * Zero external dependencies. `env`, `execFile`, and `log` are injectable so
 * tests never spawn cmux, code, or pbcopy.
 *
 * CLI: node lib/open-session.js --dir <abs> --session <id> [--title <t>]
 */

const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Allowed session id shape (UUID-like). Keeps the cmux --command injection-free;
 * the leading alphanumeric blocks option injection (`--dangerously-…`).
 */
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/**
 * Default exec: synchronous, argv array, no shell.
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} [options]
 * @returns {string|Buffer}
 */
function defaultExecFile(cmd, args, options) {
  return execFileSync(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'], ...options });
}

/**
 * Build the resume command shown to the user / run by cmux.
 * @param {string} sessionId
 * @returns {string}
 */
function resumeCommand(sessionId) {
  return `claude --resume ${sessionId}`;
}

/**
 * Validate openSession inputs; throws on bad values.
 * @param {{dir?: string, sessionId?: string}} input
 */
function validate({ dir, sessionId }) {
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    throw new Error(`invalid sessionId: must match ${SESSION_ID_RE}`);
  }
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
    throw new Error('invalid dir: must be an absolute path');
  }
}

/**
 * POSIX single-quote a string for display in a copy-pasteable shell line.
 * @param {string} s
 * @returns {string}
 */
function shellQuote(s) {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Log the manual `cd <dir>` + resume command instructions.
 * @param {Function} log
 * @param {string} dir
 * @param {string} command
 */
function printInstructions(log, dir, command) {
  log(`cd ${shellQuote(dir)}`);
  log(command);
}

/**
 * Pick the opening mode from the environment.
 * @param {object} env
 * @returns {'cmux'|'vscode'|'print'}
 */
function detectMode(env) {
  if (env.CMUX_WORKSPACE_ID) return 'cmux';
  if (env.TERM_PROGRAM === 'vscode') return 'vscode';
  return 'print';
}

/**
 * Open a session in a fresh terminal in `dir` running `claude --resume <id>`.
 *
 * @param {{dir: string, sessionId: string, title?: string}} input
 * @param {{env?: object, execFile?: Function, log?: Function}} [deps]
 * @returns {{mode: 'cmux'|'vscode'|'print', command: string, fallbackFrom?: 'cmux'|'vscode'}}
 *   `fallbackFrom` is set when the cmux/code exec failed and print mode was used.
 * @throws {Error} on invalid sessionId or non-absolute dir
 */
function openSession({ dir, sessionId, title } = {}, deps = {}) {
  const env = deps.env || process.env;
  const execFile = deps.execFile || defaultExecFile;
  const log = deps.log || console.log;

  validate({ dir, sessionId });
  const command = resumeCommand(sessionId);
  const mode = detectMode(env);

  if (mode === 'cmux') {
    const args = ['new-workspace', '--cwd', dir];
    if (title) args.push('--name', String(title));
    args.push('--focus', 'true', '--command', command);
    try {
      execFile('cmux', args);
    } catch {
      printInstructions(log, dir, command);
      return { mode: 'print', command, fallbackFrom: 'cmux' };
    }
    return { mode, command };
  }

  if (mode === 'vscode') {
    try {
      execFile('code', ['-n', dir]);
    } catch {
      printInstructions(log, dir, command);
      return { mode: 'print', command, fallbackFrom: 'vscode' };
    }
    let copied = false;
    try {
      execFile('pbcopy', [], { input: command });
      copied = true;
    } catch {
      // fail-soft: clipboard is optional, the command is printed below
    }
    log(command);
    log(
      copied
        ? 'Copied to clipboard — paste it into the new VS Code window\'s terminal.'
        : `Clipboard unavailable — run it in the new VS Code window's terminal (cwd: ${dir}).`,
    );
    return { mode, command };
  }

  printInstructions(log, dir, command);
  return { mode, command };
}

/**
 * Parse CLI argv into {dir, sessionId, title}.
 * @param {string[]} argv
 * @returns {{dir?: string, sessionId?: string, title?: string}}
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') out.dir = argv[++i];
    else if (a === '--session') out.sessionId = argv[++i];
    else if (a === '--title') out.title = argv[++i];
  }
  return out;
}

if (require.main === module) {
  try {
    openSession(parseArgs(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(
      `open-session: ${err.message}\nusage: node lib/open-session.js --dir <abs> --session <id> [--title <t>]\n`,
    );
    process.exit(1);
  }
}

module.exports = { openSession, detectMode, resumeCommand, SESSION_ID_RE };
