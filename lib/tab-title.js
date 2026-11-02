#!/usr/bin/env node
'use strict';

/**
 * Terminal tab titles: keep every tab labelled with its issue (and PR).
 *
 * Derives the issue number from the current branch (`feature/<N>-…`,
 * `fix/<N>-…`, `hotfix/<N>-…`), looks up the issue title and any open PR for
 * the branch via `gh`, and sets the tab title to `#83 · <issue title>` or
 * `#83 · PR #91 · <issue title>`.
 *
 * Supported terminals:
 * - cmux — detected by `CMUX_WORKSPACE_ID` (auto-set in cmux terminals);
 *   applied with `cmux rename-workspace --workspace <id> -- <title>`.
 * - VS Code — only when `TERM_PROGRAM=vscode` AND
 *   `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` (see docs/vscode-tab-title-spike.md).
 *   Hooks have no controlling terminal, so the OSC 2 sequence is written to
 *   the tty device of the nearest ancestor process that owns one, found by
 *   walking `ps -o ppid=,tty=` upward. `ENVOY_TAB_TITLE_PID` overrides the
 *   starting pid, and `ENVOY_TAB_TITLE_TTY` (`/dev/tty*` or `/dev/pts/<n>`;
 *   anything else, including empty, means "no tty") skips the walk:
 *   the SessionStart hook resolves the tty synchronously and passes it in,
 *   because its detached child is reparented to launchd and loses its
 *   ancestry. refresh() resolves the tty before any git/gh call.
 * Anything else is a silent no-op, and no external command is run at all.
 *
 * Fail-soft by contract: every external call has a short timeout, every
 * failure is swallowed, `refresh` never throws and never writes to stdout
 * (hook stdout is JSON context). If no issue can be derived (e.g. on main),
 * the title is left unchanged.
 *
 * Zero external dependencies. `env`, `pid`, `exec`, `ttyWriter`, and
 * `ttyDevice` (applyTitle only: a pre-resolved device) are
 * injectable via `deps` so callers can test hermetically.
 *
 * CLI: `node lib/tab-title.js` runs refresh() and always exits 0.
 */

const fs = require('fs');
const { execFileSync } = require('child_process');
const { shouldRun } = require('../hooks/hook-runner');

/** Timeout for every external command, in milliseconds. */
const EXEC_TIMEOUT_MS = 3000;

/** Target maximum length of the whole title. */
const MAX_TITLE_LEN = 60;

/** Separator between title parts (U+00B7 with spaces). */
const SEP = ' · ';

/** A terminal device we are willing to write to (macOS ttys*, Linux pts). */
const TTY_DEVICE_RE = /^\/dev\/(tty[\w.]+|pts\/\d+)$/;

/** Upper bound on ancestor hops when searching for a tty. */
const MAX_PS_HOPS = 32;

/**
 * Run a command with an argv array (never a shell string).
 * @param {string} cmd
 * @param {string[]} args
 * @returns {string|null} stdout, or null on any failure or timeout
 */
function defaultExec(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: EXEC_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch (_e) {
    return null;
  }
}

/**
 * Write raw bytes to a tty device without acquiring it as controlling terminal.
 * @param {string} device e.g. /dev/ttys028
 * @param {string} data
 */
function defaultTtyWriter(device, data) {
  const c = fs.constants;
  const fd = fs.openSync(device, c.O_WRONLY | (c.O_NOCTTY || 0) | (c.O_NONBLOCK || 0));
  try {
    fs.writeSync(fd, data);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Fill in default deps.
 * @param {object} [deps]
 * @returns {{env: object, pid: number, exec: Function, ttyWriter: Function}}
 */
function resolveDeps(deps) {
  const d = deps || {};
  return {
    env: d.env || process.env,
    pid: d.pid || process.pid,
    exec: d.exec || defaultExec,
    ttyWriter: d.ttyWriter || defaultTtyWriter
  };
}

/**
 * Call deps.exec fail-soft: a throwing runner counts as a failed call.
 * @returns {string|null}
 */
function safeExec(deps, cmd, args) {
  try {
    const out = deps.exec(cmd, args);
    return typeof out === 'string' ? out : null;
  } catch (_e) {
    return null;
  }
}

/**
 * Derive the issue number from a branch name.
 * @param {string|null|undefined} branch
 * @returns {number|null}
 */
function issueFromBranch(branch) {
  if (typeof branch !== 'string') return null;
  const m = branch.trim().match(/^(?:feature|fix|hotfix)\/(\d+)(?:-|$)/);
  return m ? Number(m[1]) : null;
}

/**
 * Strip control characters (so an issue title cannot inject escape
 * sequences) and collapse whitespace.
 * @param {string} s
 * @returns {string}
 */
function sanitize(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Compute the tab title.
 * @param {{issue?: number|null, issueTitle?: string|null, pr?: number|null}} parts
 * @returns {string|null} null when there is no issue
 */
function computeTitle({ issue, issueTitle, pr } = {}) {
  if (!issue) return null;
  let prefix = `#${issue}`;
  if (pr) prefix += `${SEP}PR #${pr}`;
  const name = issueTitle ? sanitize(issueTitle) : '';
  if (!name) return prefix;
  // Count and cut by code points so an astral character is never split.
  const chars = Array.from(name);
  const room = MAX_TITLE_LEN - prefix.length - SEP.length;
  if (room <= 1) return prefix;
  const shown =
    chars.length > room ? `${chars.slice(0, room - 1).join('').trimEnd()}…` : name;
  return `${prefix}${SEP}${shown}`;
}

/**
 * Detect a terminal whose tab title Envoy can set.
 * @param {object} [env]
 * @returns {'cmux'|'vscode'|null}
 */
function detectTerminal(env) {
  const e = env || {};
  if (e.CMUX_WORKSPACE_ID) return 'cmux';
  if (e.TERM_PROGRAM === 'vscode' && e.CLAUDE_CODE_DISABLE_TERMINAL_TITLE === '1') {
    return 'vscode';
  }
  return null;
}

/**
 * Walk the process tree upward to the nearest ancestor with a real tty.
 * @param {object} [deps]
 * @returns {string|null} e.g. /dev/ttys028, or null
 */
function findTtyDevice(deps) {
  const d = resolveDeps(deps);
  // A preset from the SessionStart hook is authoritative: when present but
  // empty/invalid, do not fall back to walking from a possibly reused pid.
  const preset = d.env.ENVOY_TAB_TITLE_TTY;
  if (preset !== undefined) {
    return typeof preset === 'string' && TTY_DEVICE_RE.test(preset) ? preset : null;
  }
  const override = Number(d.env.ENVOY_TAB_TITLE_PID);
  let pid = Number.isInteger(override) && override > 0 ? override : d.pid;
  const seen = new Set();
  for (let hop = 0; hop < MAX_PS_HOPS && pid > 0 && !seen.has(pid); hop++) {
    seen.add(pid);
    const out = safeExec(d, 'ps', ['-o', 'ppid=,tty=', '-p', String(pid)]);
    if (!out) return null;
    const [ppid, tty] = out.trim().split(/\s+/);
    if (tty && tty !== '??' && tty !== '?') {
      const device = `/dev/${tty}`;
      return TTY_DEVICE_RE.test(device) ? device : null;
    }
    pid = Number(ppid);
  }
  return null;
}

/**
 * Apply a title to the detected terminal.
 * @param {string|null} title
 * @param {object} [deps]
 * @returns {boolean} true when the title was handed to the terminal
 */
function applyTitle(title, deps) {
  try {
    if (!title) return false;
    const d = resolveDeps(deps);
    const terminal = detectTerminal(d.env);
    if (terminal === 'cmux') {
      const out = safeExec(d, 'cmux', [
        'rename-workspace',
        '--workspace',
        String(d.env.CMUX_WORKSPACE_ID),
        '--',
        title
      ]);
      return out !== null;
    }
    if (terminal === 'vscode') {
      const device = (deps && deps.ttyDevice) || findTtyDevice(d);
      if (!device) return false;
      d.ttyWriter(device, `\x1b]2;${title}\x07`);
      return true;
    }
    return false;
  } catch (_e) {
    return false;
  }
}

/**
 * Recompute the title from git/gh state and apply it.
 * Never throws; writes nothing to stdout.
 * @param {object} [deps]
 * @returns {string|null} the title applied, or null when nothing was done
 */
function refresh(deps) {
  try {
    const d = resolveDeps(deps);
    // Profile-aware like every other hook (minimal / ENVOY_DISABLED_HOOKS).
    if (!shouldRun('tab-title', d.env)) return null;
    const terminal = detectTerminal(d.env);
    if (!terminal) return null;
    // Resolve the tty first: the ancestors it is found through (e.g. the
    // SessionStart hook) may exit while the gh calls below are in flight.
    let ttyDevice = null;
    if (terminal === 'vscode') {
      ttyDevice = findTtyDevice(d);
      if (!ttyDevice) return null;
    }
    const branch = (safeExec(d, 'git', ['rev-parse', '--abbrev-ref', 'HEAD']) || '').trim();
    const issue = issueFromBranch(branch);
    if (!issue) return null;
    const issueTitle = (
      safeExec(d, 'gh', ['issue', 'view', String(issue), '--json', 'title', '-q', '.title']) || ''
    ).trim();
    const prRaw = (
      safeExec(d, 'gh', [
        'pr',
        'list',
        '--head',
        branch,
        '--state',
        'open',
        '--json',
        'number',
        '-q',
        '.[0].number'
      ]) || ''
    ).trim();
    const pr = /^\d+$/.test(prRaw) ? Number(prRaw) : null;
    const title = computeTitle({ issue, issueTitle, pr });
    return applyTitle(title, { ...d, ttyDevice }) ? title : null;
  } catch (_e) {
    return null;
  }
}

module.exports = {
  issueFromBranch,
  computeTitle,
  detectTerminal,
  findTtyDevice,
  applyTitle,
  refresh,
  MAX_TITLE_LEN,
  SEP
};

if (require.main === module) {
  refresh();
  process.exit(0);
}
