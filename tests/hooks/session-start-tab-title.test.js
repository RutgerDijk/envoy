#!/usr/bin/env node
/**
 * SessionStart hook — tab-title wiring — Test Suite
 *
 * Run: node tests/hooks/session-start-tab-title.test.js
 *
 * Runs the real hooks/session-start.sh with fake `ps`, `node`, and `cmux`
 * first on PATH. The fake `node` records any lib/tab-title.js launch (with
 * its ENVOY_TAB_TITLE_* env) and delegates everything else to the real node,
 * so the hook's own JSON output is produced normally. No real cmux, tty, or
 * process tree is touched.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOK = path.join(REPO_ROOT, 'hooks', 'session-start.sh');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
  } catch (err) {
    failed++;
    process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n    ${err.message}\n`);
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Env vars that could make the real hook touch a real terminal. */
const TERMINAL_VARS = [
  'CMUX_WORKSPACE_ID',
  'CMUX_SURFACE_ID',
  'CMUX_TAB_ID',
  'TERM_PROGRAM',
  'CLAUDE_CODE_DISABLE_TERMINAL_TITLE',
  'ENVOY_TAB_TITLE_TTY',
  'ENVOY_TAB_TITLE_PID',
  'ENVOY_DISABLED_HOOKS'
];

function cleanEnv() {
  const env = { ...process.env };
  for (const k of TERMINAL_VARS) delete env[k];
  return env;
}

/**
 * Build a sandbox with fake binaries.
 * @param {string} psTty tty the fake ps reports for the "terminal-owning" pid 4242
 */
function makeSandbox(psTty = 'ttys042') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-tabtitle-'));
  const bin = path.join(root, 'bin');
  const cwd = path.join(root, 'cwd');
  fs.mkdirSync(bin);
  fs.mkdirSync(cwd);
  const log = path.join(root, 'calls.log');
  const launched = path.join(root, 'launched.env');

  const write = (name, body) => {
    const p = path.join(bin, name);
    fs.writeFileSync(p, `#!/bin/bash\n${body}\n`);
    fs.chmodSync(p, 0o755);
  };

  // Fake ps: pid 4242 owns the terminal; every other pid is a tty-less child of 4242.
  write(
    'ps',
    `echo "ps $*" >> "${log}"
pid="\${@: -1}"
if [ "$pid" = "4242" ]; then echo "    1 ${psTty}"; else echo " 4242 ??"; fi`
  );
  write('cmux', `echo "cmux $*" >> "${log}"`);
  write(
    'node',
    `case "$1" in
  */lib/tab-title.js)
    { echo "TTY=\${ENVOY_TAB_TITLE_TTY-<unset>}"; echo "PID=\${ENVOY_TAB_TITLE_PID-<unset>}"; } > "${launched}.tmp"
    mv "${launched}.tmp" "${launched}"
    exit 0 ;;
esac
exec "${process.execPath}" "$@"`
  );

  return {
    root,
    cwd,
    run(extraEnv = {}) {
      const env = { ...cleanEnv(), ...extraEnv, CLAUDE_PLUGIN_ROOT: REPO_ROOT };
      env.PATH = `${bin}:${process.env.PATH}`;
      return execFileSync('bash', [HOOK], {
        cwd,
        encoding: 'utf8',
        timeout: 30000,
        input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 't', cwd }),
        env
      });
    },
    /** Wait up to `ms` for the background launch record; null if none. */
    launched(ms = 3000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (fs.existsSync(launched)) return fs.readFileSync(launched, 'utf8');
        sleep(50);
      }
      return null;
    },
    calls() {
      return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

const VSCODE = { TERM_PROGRAM: 'vscode', CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1' };

test('opted-in VS Code: child receives the tty resolved from the ps chain, and no pid', () => {
  const sb = makeSandbox();
  try {
    JSON.parse(sb.run(VSCODE));
    const rec = sb.launched();
    assert.ok(rec, 'tab-title.js was launched');
    assert.match(rec, /^TTY=\/dev\/ttys042$/m);
    assert.match(rec, /^PID=<unset>$/m);
    assert.ok(sb.calls().some((c) => c.startsWith('ps -o ppid=,tty= -p')));
  } finally {
    sb.cleanup();
  }
});

test('opted-in VS Code with a non-tty device from ps (e.g. null): not launched', () => {
  const sb = makeSandbox('null');
  try {
    JSON.parse(sb.run(VSCODE));
    assert.strictEqual(sb.launched(800), null);
  } finally {
    sb.cleanup();
  }
});

test('VS Code not opted in: no ps calls and not launched', () => {
  const sb = makeSandbox();
  try {
    JSON.parse(sb.run({ TERM_PROGRAM: 'vscode' }));
    assert.strictEqual(sb.launched(800), null);
    assert.deepStrictEqual(sb.calls(), []);
  } finally {
    sb.cleanup();
  }
});

test('no supported terminal: no ps calls and not launched', () => {
  const sb = makeSandbox();
  try {
    JSON.parse(sb.run({}));
    assert.strictEqual(sb.launched(800), null);
    assert.deepStrictEqual(sb.calls(), []);
  } finally {
    sb.cleanup();
  }
});

test('cmux: launched (no ps walk), stdout valid JSON and identical to the no-terminal run', () => {
  const sb = makeSandbox();
  try {
    const plain = sb.run({});
    const withCmux = sb.run({ CMUX_WORKSPACE_ID: 'fake-ws' });
    JSON.parse(withCmux);
    assert.strictEqual(withCmux, plain);
    assert.ok(sb.launched(), 'tab-title.js was launched');
    assert.ok(!sb.calls().some((c) => c.startsWith('ps ')), 'no ps walk for cmux');
    assert.ok(!sb.calls().some((c) => c.startsWith('cmux ')), 'hook itself never calls cmux');
  } finally {
    sb.cleanup();
  }
});

test('ENVOY_DISABLED_HOOKS containing tab-title skips the launch entirely', () => {
  const sb = makeSandbox();
  try {
    JSON.parse(sb.run({ ...VSCODE, CMUX_WORKSPACE_ID: 'fake-ws', ENVOY_DISABLED_HOOKS: 'foo, tab-title ,bar' }));
    assert.strictEqual(sb.launched(800), null);
    assert.deepStrictEqual(sb.calls(), []);
  } finally {
    sb.cleanup();
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
