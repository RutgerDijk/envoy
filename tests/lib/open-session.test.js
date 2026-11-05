#!/usr/bin/env node
/**
 * Session opener (/envoy:start resume) — Test Suite
 *
 * Run: node tests/lib/open-session.test.js
 *
 * Every test injects a fake execFile that records calls — cmux, code, and
 * pbcopy are never actually spawned.
 */

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

const LIB = path.join(__dirname, '..', '..', 'lib');

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

function section(name) {
  process.stdout.write(`\n\x1b[1m${name}\x1b[0m\n`);
}

/** Build injectable deps that record exec calls and log lines. */
function fakeDeps(env, opts = {}) {
  const calls = [];
  const logs = [];
  return {
    calls,
    logs,
    deps: {
      env,
      execFile: (cmd, args, options) => {
        calls.push({ cmd, args, options });
        if (opts.failOn && opts.failOn === cmd) throw new Error(`${cmd} failed`);
        return '';
      },
      log: (line) => logs.push(String(line)),
    },
  };
}

const SID = '0f3c2a1e-9b7d-4c1a-8e2f-123456789abc';
const DIR = '/Users/me/proj/.worktrees/93-thing';

const mod = require(path.join(LIB, 'open-session'));
const { openSession } = mod;

section('exports');

test('openSession is exported as a function', () => {
  assert.strictEqual(typeof openSession, 'function');
});

section('cmux mode');

test('CMUX_WORKSPACE_ID present → cmux new-workspace with argv array', () => {
  const f = fakeDeps({ CMUX_WORKSPACE_ID: 'abc', TERM_PROGRAM: 'vscode' });
  const res = openSession({ dir: DIR, sessionId: SID, title: '#93 start' }, f.deps);
  assert.strictEqual(res.mode, 'cmux');
  assert.strictEqual(res.command, `claude --resume ${SID}`);
  assert.strictEqual(f.calls.length, 1);
  assert.strictEqual(f.calls[0].cmd, 'cmux');
  assert.deepStrictEqual(f.calls[0].args, [
    'new-workspace',
    '--cwd', DIR,
    '--name', '#93 start',
    '--focus', 'true',
    '--command', `claude --resume ${SID}`,
  ]);
});

test('cmux mode without title omits --name', () => {
  const f = fakeDeps({ CMUX_WORKSPACE_ID: 'abc' });
  openSession({ dir: DIR, sessionId: SID }, f.deps);
  assert.deepStrictEqual(f.calls[0].args, [
    'new-workspace', '--cwd', DIR, '--focus', 'true', '--command', `claude --resume ${SID}`,
  ]);
});

test('cmux mode passes a title with shell metacharacters verbatim as one argv', () => {
  const f = fakeDeps({ CMUX_WORKSPACE_ID: 'abc' });
  const evil = 'x"; rm -rf ~; echo "';
  openSession({ dir: DIR, sessionId: SID, title: evil }, f.deps);
  assert.strictEqual(f.calls[0].args[4], evil);
});

test('cmux exec failure falls back to print mode', () => {
  const f = fakeDeps({ CMUX_WORKSPACE_ID: 'abc' }, { failOn: 'cmux' });
  const res = openSession({ dir: DIR, sessionId: SID }, f.deps);
  assert.deepStrictEqual(res, {
    mode: 'print', command: `claude --resume ${SID}`, fallbackFrom: 'cmux',
  });
  const out = f.logs.join('\n');
  assert.ok(out.includes(`cd '${DIR}'`), 'prints cd line');
  assert.ok(out.includes(`claude --resume ${SID}`), 'prints the command');
});

section('vscode mode');

test('TERM_PROGRAM=vscode without cmux → code -n <dir> then pbcopy', () => {
  const f = fakeDeps({ TERM_PROGRAM: 'vscode' });
  const res = openSession({ dir: DIR, sessionId: SID, title: 't' }, f.deps);
  assert.strictEqual(res.mode, 'vscode');
  assert.strictEqual(res.command, `claude --resume ${SID}`);
  assert.strictEqual(f.calls.length, 2);
  assert.strictEqual(f.calls[0].cmd, 'code');
  assert.deepStrictEqual(f.calls[0].args, ['-n', DIR]);
  assert.strictEqual(f.calls[1].cmd, 'pbcopy');
  assert.deepStrictEqual(f.calls[1].args, []);
  assert.strictEqual(f.calls[1].options.input, `claude --resume ${SID}`);
  const out = f.logs.join('\n');
  assert.ok(out.includes(`claude --resume ${SID}`), 'logs the command');
  assert.ok(/clipboard/i.test(out), 'logs a clipboard hint');
});

test('vscode mode is fail-soft when pbcopy throws', () => {
  const f = fakeDeps({ TERM_PROGRAM: 'vscode' }, { failOn: 'pbcopy' });
  const res = openSession({ dir: DIR, sessionId: SID }, f.deps);
  assert.strictEqual(res.mode, 'vscode');
  const out = f.logs.join('\n');
  assert.ok(out.includes(`claude --resume ${SID}`), 'still logs the command');
  assert.ok(!/copied to (the )?clipboard/i.test(out), 'does not claim it was copied');
});

test('code exec failure falls back to print mode without pbcopy', () => {
  const f = fakeDeps({ TERM_PROGRAM: 'vscode' }, { failOn: 'code' });
  const res = openSession({ dir: DIR, sessionId: SID }, f.deps);
  assert.deepStrictEqual(res, {
    mode: 'print', command: `claude --resume ${SID}`, fallbackFrom: 'vscode',
  });
  assert.ok(!f.calls.some((c) => c.cmd === 'pbcopy'), 'does not call pbcopy');
  assert.ok(f.logs.join('\n').includes(`cd '${DIR}'`));
});

section('print mode');

test('neither cmux nor vscode → no exec calls, prints dir + command', () => {
  const f = fakeDeps({ TERM_PROGRAM: 'iTerm.app' });
  const res = openSession({ dir: DIR, sessionId: SID }, f.deps);
  assert.strictEqual(res.mode, 'print');
  assert.strictEqual(res.command, `claude --resume ${SID}`);
  assert.strictEqual(f.calls.length, 0);
  const out = f.logs.join('\n');
  assert.ok(out.includes(DIR), 'prints the dir');
  assert.ok(out.includes(`claude --resume ${SID}`), 'prints the command');
});

test('print mode POSIX single-quotes dir (spaces, quotes)', () => {
  const f = fakeDeps({});
  openSession({ dir: "/Users/me/my proj/it's", sessionId: SID }, f.deps);
  assert.ok(f.logs.includes("cd '/Users/me/my proj/it'\\''s'"), f.logs.join('|'));
});

test('print mode result has no fallbackFrom', () => {
  const f = fakeDeps({});
  const res = openSession({ dir: DIR, sessionId: SID }, f.deps);
  assert.ok(!('fallbackFrom' in res));
});

test('empty CMUX_WORKSPACE_ID does not count as cmux', () => {
  const f = fakeDeps({ CMUX_WORKSPACE_ID: '' });
  assert.strictEqual(openSession({ dir: DIR, sessionId: SID }, f.deps).mode, 'print');
});

section('validation');

test('rejects sessionId with shell metacharacters', () => {
  const f = fakeDeps({ CMUX_WORKSPACE_ID: 'abc' });
  assert.throws(() => openSession({ dir: DIR, sessionId: 'abc; rm -rf /' }, f.deps), /sessionId/);
  assert.throws(() => openSession({ dir: DIR, sessionId: '$(whoami)' }, f.deps), /sessionId/);
  assert.strictEqual(f.calls.length, 0);
});

test('rejects sessionId starting with "-" (option injection)', () => {
  const f = fakeDeps({ CMUX_WORKSPACE_ID: 'abc' });
  assert.throws(() => openSession({ dir: DIR, sessionId: '--dangerously-skip-permissions' }, f.deps), /sessionId/);
  assert.throws(() => openSession({ dir: DIR, sessionId: '-x' }, f.deps), /sessionId/);
  assert.strictEqual(f.calls.length, 0);
});

test('rejects missing sessionId', () => {
  const f = fakeDeps({});
  assert.throws(() => openSession({ dir: DIR }, f.deps), /sessionId/);
});

test('rejects relative or missing dir', () => {
  const f = fakeDeps({});
  assert.throws(() => openSession({ dir: 'relative/path', sessionId: SID }, f.deps), /dir/);
  assert.throws(() => openSession({ sessionId: SID }, f.deps), /dir/);
});

section('CLI');

const CLI = path.join(LIB, 'open-session.js');

function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, TERM_PROGRAM: 'none' },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

test('CLI print mode prints the command and exits 0', () => {
  const r = runCli(['--dir', DIR, '--session', SID, '--title', 'x']);
  assert.strictEqual(r.code, 0, r.stderr);
  assert.ok(r.stdout.includes(`claude --resume ${SID}`));
});

test('CLI exits 1 on invalid session id', () => {
  const r = runCli(['--dir', DIR, '--session', 'bad;id']);
  assert.strictEqual(r.code, 1);
  assert.ok(/sessionId/.test(r.stderr));
});

test('CLI exits 1 when --dir is missing', () => {
  const r = runCli(['--session', SID]);
  assert.strictEqual(r.code, 1);
  assert.ok(r.stderr.length > 0);
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
