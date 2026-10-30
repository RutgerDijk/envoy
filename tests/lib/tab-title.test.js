#!/usr/bin/env node
/**
 * Terminal tab titles (cmux / VS Code) — Test Suite
 *
 * Run: node tests/lib/tab-title.test.js
 *
 * Every external call is faked: no real cmux, gh, git, ps, or tty is touched.
 */

const assert = require('assert');
const path = require('path');

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

const tt = require(path.join(LIB, 'tab-title'));

const CMUX_ENV = { CMUX_WORKSPACE_ID: 'ws-uuid-1' };
const VSCODE_ENV = { TERM_PROGRAM: 'vscode', CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1' };

/**
 * Build fake deps. `responses` maps "cmd arg0 arg1…" prefixes to stdout
 * strings (or null to simulate a failed/timed-out call).
 */
function fakeDeps({ env = {}, responses = {}, pid = 500 } = {}) {
  const calls = [];
  const writes = [];
  return {
    calls,
    writes,
    deps: {
      env,
      pid,
      exec(cmd, args) {
        calls.push([cmd, ...args]);
        const key = [cmd, ...args].join(' ');
        const match = Object.keys(responses)
          .filter((k) => key.startsWith(k))
          .sort((a, b) => b.length - a.length)[0];
        if (match === undefined) return null;
        return responses[match];
      },
      ttyWriter(device, data) {
        writes.push([device, data]);
      }
    }
  };
}

const GIT_BRANCH = 'git rev-parse --abbrev-ref HEAD';
const GH_ISSUE = 'gh issue view';
const GH_PR = 'gh pr list';

// ═══════════════════════════════════════════════════════════════════
// issueFromBranch
// ═══════════════════════════════════════════════════════════════════

section('issueFromBranch');

test('feature/<N>-slug yields N', () => {
  assert.strictEqual(tt.issueFromBranch('feature/83-envoy-start'), 83);
});

test('fix/ and hotfix/ prefixes are accepted', () => {
  assert.strictEqual(tt.issueFromBranch('fix/12-bug'), 12);
  assert.strictEqual(tt.issueFromBranch('hotfix/7-urgent'), 7);
});

test('main, detached HEAD, and unknown prefixes yield null', () => {
  assert.strictEqual(tt.issueFromBranch('main'), null);
  assert.strictEqual(tt.issueFromBranch('HEAD'), null);
  assert.strictEqual(tt.issueFromBranch('chore/5-x'), null);
  assert.strictEqual(tt.issueFromBranch('feature/abc'), null);
  assert.strictEqual(tt.issueFromBranch(''), null);
  assert.strictEqual(tt.issueFromBranch(null), null);
  assert.strictEqual(tt.issueFromBranch(undefined), null);
});

// ═══════════════════════════════════════════════════════════════════
// computeTitle
// ═══════════════════════════════════════════════════════════════════

section('computeTitle');

test('issue + title without PR', () => {
  assert.strictEqual(
    tt.computeTitle({ issue: 83, issueTitle: 'Session dashboard' }),
    '#83 · Session dashboard'
  );
});

test('issue + PR + title', () => {
  assert.strictEqual(
    tt.computeTitle({ issue: 83, issueTitle: 'Session dashboard', pr: 91 }),
    '#83 · PR #91 · Session dashboard'
  );
});

test('no issue yields null', () => {
  assert.strictEqual(tt.computeTitle({ issue: null, issueTitle: 'x', pr: 3 }), null);
  assert.strictEqual(tt.computeTitle({}), null);
});

test('missing issue title still yields the numbers', () => {
  assert.strictEqual(tt.computeTitle({ issue: 83 }), '#83');
  assert.strictEqual(tt.computeTitle({ issue: 83, pr: 91 }), '#83 · PR #91');
});

test('long issue titles are truncated to keep the whole title <= 60 chars', () => {
  const long = 'A'.repeat(200);
  const t = tt.computeTitle({ issue: 83, issueTitle: long, pr: 91 });
  assert.ok(t.length <= 60, `length ${t.length}`);
  assert.ok(t.startsWith('#83 · PR #91 · A'));
  assert.ok(t.endsWith('…'));
});

test('control characters in the issue title are stripped', () => {
  const t = tt.computeTitle({ issue: 1, issueTitle: 'bad\x07\x1b]2;evil\nname' });
  assert.ok(!/[\x00-\x1f\x7f]/.test(t), JSON.stringify(t));
});

// ═══════════════════════════════════════════════════════════════════
// detectTerminal
// ═══════════════════════════════════════════════════════════════════

section('detectTerminal');

test('cmux via CMUX_WORKSPACE_ID', () => {
  assert.strictEqual(tt.detectTerminal(CMUX_ENV), 'cmux');
});

test('vscode only with TERM_PROGRAM=vscode AND CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1', () => {
  assert.strictEqual(tt.detectTerminal(VSCODE_ENV), 'vscode');
  assert.strictEqual(tt.detectTerminal({ TERM_PROGRAM: 'vscode' }), null);
  assert.strictEqual(
    tt.detectTerminal({ TERM_PROGRAM: 'vscode', CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '0' }),
    null
  );
});

test('anything else is null', () => {
  assert.strictEqual(tt.detectTerminal({}), null);
  assert.strictEqual(tt.detectTerminal({ TERM_PROGRAM: 'iTerm.app' }), null);
  assert.strictEqual(tt.detectTerminal(undefined), null);
});

// ═══════════════════════════════════════════════════════════════════
// findTtyDevice
// ═══════════════════════════════════════════════════════════════════

section('findTtyDevice');

test('walks ppid chain to the nearest ancestor with a real tty', () => {
  const { deps } = fakeDeps({
    responses: {
      'ps -o ppid=,tty= -p 500': ' 400 ??',
      'ps -o ppid=,tty= -p 400': ' 300 ttys028',
      'ps -o ppid=,tty= -p 300': ' 200 ttys028'
    }
  });
  assert.strictEqual(tt.findTtyDevice(deps), '/dev/ttys028');
});

test('ENVOY_TAB_TITLE_PID overrides the starting pid', () => {
  const { deps, calls } = fakeDeps({
    env: { ENVOY_TAB_TITLE_PID: '900' },
    responses: { 'ps -o ppid=,tty= -p 900': ' 1 ttys003' }
  });
  assert.strictEqual(tt.findTtyDevice(deps), '/dev/ttys003');
  assert.deepStrictEqual(calls[0], ['ps', '-o', 'ppid=,tty=', '-p', '900']);
});

test('returns null when no ancestor has a tty or ps fails', () => {
  const none = fakeDeps({
    responses: { 'ps -o ppid=,tty= -p 500': ' 1 ??', 'ps -o ppid=,tty= -p 1': ' 0 ??' }
  });
  assert.strictEqual(tt.findTtyDevice(none.deps), null);
  const broken = fakeDeps({ responses: {} });
  assert.strictEqual(tt.findTtyDevice(broken.deps), null);
});

test('ENVOY_TAB_TITLE_TTY (resolved by the hook) is used with zero ps calls', () => {
  const { deps, calls } = fakeDeps({ env: { ENVOY_TAB_TITLE_TTY: '/dev/ttys042' } });
  assert.strictEqual(tt.findTtyDevice(deps), '/dev/ttys042');
  assert.strictEqual(calls.length, 0);
});

test('invalid ENVOY_TAB_TITLE_TTY is ignored and the walk runs', () => {
  for (const bad of ['/etc/passwd; x', 'ttys042', '/dev/../etc/x y']) {
    const { deps, calls } = fakeDeps({
      env: { ENVOY_TAB_TITLE_TTY: bad },
      responses: { 'ps -o ppid=,tty= -p 500': ' 1 ttys001' }
    });
    assert.strictEqual(tt.findTtyDevice(deps), '/dev/ttys001', bad);
    assert.strictEqual(calls.length, 1);
  }
});

test('walk is bounded (no infinite loop on a cycle)', () => {
  const { deps, calls } = fakeDeps({ responses: { 'ps -o ppid=,tty= -p 500': ' 500 ??' } });
  assert.strictEqual(tt.findTtyDevice(deps), null);
  assert.ok(calls.length <= 32);
});

// ═══════════════════════════════════════════════════════════════════
// applyTitle
// ═══════════════════════════════════════════════════════════════════

section('applyTitle');

test('cmux: rename-workspace on the current workspace with argv array', () => {
  const { deps, calls, writes } = fakeDeps({ env: CMUX_ENV, responses: { cmux: '' } });
  assert.strictEqual(tt.applyTitle('#83 · x', deps), true);
  assert.deepStrictEqual(calls, [
    ['cmux', 'rename-workspace', '--workspace', 'ws-uuid-1', '--', '#83 · x']
  ]);
  assert.strictEqual(writes.length, 0);
});

test('cmux: a failed CLI call returns false and does not throw', () => {
  const { deps } = fakeDeps({ env: CMUX_ENV, responses: { cmux: null } });
  assert.strictEqual(tt.applyTitle('#1', deps), false);
});

test('vscode: OSC 2 is written to the ancestor tty device', () => {
  const { deps, writes } = fakeDeps({
    env: VSCODE_ENV,
    responses: { 'ps -o ppid=,tty= -p 500': ' 400 ttys028' }
  });
  assert.strictEqual(tt.applyTitle('#83', deps), true);
  assert.deepStrictEqual(writes, [['/dev/ttys028', '\x1b]2;#83\x07']]);
});

test('vscode without a tty is a no-op', () => {
  const { deps, writes } = fakeDeps({ env: VSCODE_ENV, responses: {} });
  assert.strictEqual(tt.applyTitle('#83', deps), false);
  assert.strictEqual(writes.length, 0);
});

test('vscode: a throwing ttyWriter is swallowed', () => {
  const { deps } = fakeDeps({
    env: VSCODE_ENV,
    responses: { 'ps -o ppid=,tty= -p 500': ' 400 ttys028' }
  });
  deps.ttyWriter = () => {
    throw new Error('EACCES');
  };
  assert.strictEqual(tt.applyTitle('#83', deps), false);
});

test('VS Code without CLAUDE_CODE_DISABLE_TERMINAL_TITLE, or other terminals, are silent no-ops', () => {
  for (const env of [{ TERM_PROGRAM: 'vscode' }, {}, { TERM_PROGRAM: 'Apple_Terminal' }]) {
    const { deps, calls, writes } = fakeDeps({ env, responses: { cmux: '' } });
    assert.strictEqual(tt.applyTitle('#83', deps), false);
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(writes.length, 0);
  }
});

test('null title is a no-op', () => {
  const { deps, calls } = fakeDeps({ env: CMUX_ENV, responses: { cmux: '' } });
  assert.strictEqual(tt.applyTitle(null, deps), false);
  assert.strictEqual(calls.length, 0);
});

// ═══════════════════════════════════════════════════════════════════
// refresh
// ═══════════════════════════════════════════════════════════════════

section('refresh');

test('cmux + feature branch + open PR: full title applied', () => {
  const { deps, calls } = fakeDeps({
    env: CMUX_ENV,
    responses: {
      [GIT_BRANCH]: 'feature/83-envoy-start\n',
      [GH_ISSUE]: 'Session dashboard\n',
      [GH_PR]: '91\n',
      cmux: ''
    }
  });
  const title = tt.refresh(deps);
  assert.strictEqual(title, '#83 · PR #91 · Session dashboard');
  assert.ok(
    calls.some(
      (c) => c.join(' ') === 'gh issue view 83 --json title -q .title'
    ),
    'gh issue view called with argv'
  );
  assert.ok(
    calls.some(
      (c) =>
        c.join(' ') ===
        "gh pr list --head feature/83-envoy-start --state open --json number -q .[0].number"
    ),
    'gh pr list called with argv'
  );
  const last = calls[calls.length - 1];
  assert.deepStrictEqual(last, [
    'cmux',
    'rename-workspace',
    '--workspace',
    'ws-uuid-1',
    '--',
    '#83 · PR #91 · Session dashboard'
  ]);
});

test('no open PR (empty gh output): title without PR', () => {
  const { deps } = fakeDeps({
    env: CMUX_ENV,
    responses: {
      [GIT_BRANCH]: 'fix/12-bug',
      [GH_ISSUE]: 'Fix it',
      [GH_PR]: '',
      cmux: ''
    }
  });
  assert.strictEqual(tt.refresh(deps), '#12 · Fix it');
});

test('gh failures degrade to the bare issue number', () => {
  const { deps } = fakeDeps({
    env: CMUX_ENV,
    responses: { [GIT_BRANCH]: 'feature/83-x', [GH_ISSUE]: null, [GH_PR]: null, cmux: '' }
  });
  assert.strictEqual(tt.refresh(deps), '#83');
});

test('main branch: nothing is applied (title left unchanged)', () => {
  const { deps, calls } = fakeDeps({
    env: CMUX_ENV,
    responses: { [GIT_BRANCH]: 'main', cmux: '' }
  });
  assert.strictEqual(tt.refresh(deps), null);
  assert.ok(!calls.some((c) => c[0] === 'cmux' || c[0] === 'gh'));
});

test('git failure: nothing is applied', () => {
  const { deps, calls } = fakeDeps({ env: CMUX_ENV, responses: { cmux: '' } });
  assert.strictEqual(tt.refresh(deps), null);
  assert.ok(!calls.some((c) => c[0] === 'cmux'));
});

test('outside cmux/VS Code: no external calls at all', () => {
  const { deps, calls, writes } = fakeDeps({
    env: {},
    responses: { [GIT_BRANCH]: 'feature/83-x', [GH_ISSUE]: 't', [GH_PR]: '', cmux: '' }
  });
  assert.strictEqual(tt.refresh(deps), null);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(writes.length, 0);
});

test('vscode path writes OSC 2 to the ancestor tty', () => {
  const { deps, writes } = fakeDeps({
    env: VSCODE_ENV,
    responses: {
      [GIT_BRANCH]: 'feature/83-x',
      [GH_ISSUE]: 'Dash',
      [GH_PR]: '',
      'ps -o ppid=,tty= -p 500': ' 400 ttys009'
    }
  });
  assert.strictEqual(tt.refresh(deps), '#83 · Dash');
  assert.deepStrictEqual(writes, [['/dev/ttys009', '\x1b]2;#83 · Dash\x07']]);
});

test('vscode: the tty is resolved before any git/gh call (ancestors may exit)', () => {
  const { deps, calls } = fakeDeps({
    env: VSCODE_ENV,
    responses: {
      [GIT_BRANCH]: 'feature/83-x',
      [GH_ISSUE]: 'Dash',
      [GH_PR]: '',
      'ps -o ppid=,tty= -p 500': ' 400 ttys009'
    }
  });
  tt.refresh(deps);
  const firstPs = calls.findIndex((c) => c[0] === 'ps');
  const firstOther = calls.findIndex((c) => c[0] === 'git' || c[0] === 'gh');
  assert.ok(firstPs !== -1 && firstPs < firstOther, JSON.stringify(calls));
  assert.strictEqual(calls.filter((c) => c[0] === 'ps').length, 1, 'tty resolved once');
});

test('vscode without a tty: refresh stops before any gh call', () => {
  const { deps, calls } = fakeDeps({
    env: VSCODE_ENV,
    responses: { [GIT_BRANCH]: 'feature/83-x', [GH_ISSUE]: 'Dash', [GH_PR]: '' }
  });
  assert.strictEqual(tt.refresh(deps), null);
  assert.ok(!calls.some((c) => c[0] === 'gh'));
});

test('refresh never throws, even when exec throws', () => {
  const { deps } = fakeDeps({ env: CMUX_ENV });
  deps.exec = () => {
    throw new Error('boom');
  };
  assert.doesNotThrow(() => tt.refresh(deps));
  assert.strictEqual(tt.refresh(deps), null);
});

test('refresh writes nothing to stdout', () => {
  const { deps } = fakeDeps({
    env: CMUX_ENV,
    responses: { [GIT_BRANCH]: 'feature/83-x', [GH_ISSUE]: 'Dash', [GH_PR]: '91', cmux: '' }
  });
  const orig = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk) => {
    out += chunk;
    return true;
  };
  try {
    tt.refresh(deps);
  } finally {
    process.stdout.write = orig;
  }
  assert.strictEqual(out, '');
});

// ═══════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
