#!/usr/bin/env node
/**
 * /envoy:start choices (option building + resume dispatch) — Test Suite
 *
 * Run: node tests/lib/start-choices.test.js
 *
 * Resume tests inject a fake execFile that records calls — open-session.js is
 * never actually spawned.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const LIB = path.join(__dirname, '..', '..', 'lib');
const choices = require(path.join(LIB, 'start-choices.js'));

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

const SID_OLD = '11111111-aaaa-bbbb-cccc-000000000001';
const SID_NEW = '22222222-aaaa-bbbb-cccc-000000000002';

/** A snapshot with one of everything. Override pieces per test. */
function snapshot(over = {}) {
  return {
    generatedAt: '2026-10-31T10:00:00.000Z',
    repo: { root: '/repo' },
    brainstorms: [
      { sessionId: 'bbbbbbbb-0000-0000-0000-000000000009', startedAt: '2026-10-29T10:00:00Z', ageDays: 2, topic: 'Dark mode idea', cwd: '/repo' },
    ],
    worktrees: [
      { path: '/repo', branch: 'main', issue: null, ahead: 0, dirty: false, idleDays: 0, stale: false, sessions: [] },
      {
        path: '/repo/.worktrees/83-koppel',
        branch: 'feature/83-koppel',
        issue: 83,
        ahead: 9,
        dirty: true,
        idleDays: 1,
        stale: false,
        sessions: [
          // Deliberately out of order and with mixed ISO offsets: newest by Date wins.
          { sessionId: SID_OLD, modified: '2026-10-30T23:00:00+00:00', cwd: '/repo/.worktrees/83-koppel' },
          { sessionId: SID_NEW, modified: '2026-10-31T03:00:00+02:00', cwd: '/repo/.worktrees/83-koppel' },
        ],
      },
      { path: '/repo/.worktrees/32-old', branch: 'feature/32-old', issue: 32, ahead: 1, dirty: false, idleDays: 40, stale: true, sessions: [] },
    ],
    prs: [
      { number: 91, title: 'Koppel PR', url: 'u', branch: 'feature/83-koppel', issue: 83, ci: 'failure', unresolved: 2, needsAttention: true },
    ],
    issues: [
      { number: 83, title: 'Koppel 6 losse context-modules', description: 'six modules', labels: [], url: 'u', plan: true, recommended: false },
      { number: 94, title: 'Finalize polling', description: 'poll', labels: [], url: 'u', plan: true, recommended: true },
    ],
    ranking: [
      { kind: 'pr', ref: 91, label: 'PR #91 Koppel PR', action: 'hervat' },
      { kind: 'worktree', ref: 'feature/83-koppel', label: 'feature/83-koppel', action: 'hervat' },
      { kind: 'brainstorm', ref: 'bbbbbbbb-0000-0000-0000-000000000009', label: 'Dark mode idea', action: 'hervat' },
      { kind: 'issue', ref: 83, label: '#83 Koppel', action: 'pickup' },
      { kind: 'issue', ref: 94, label: '#94 Finalize polling', action: 'pickup' },
      { kind: 'worktree', ref: 'feature/32-old', label: 'feature/32-old', action: 'cleanup' },
    ],
    next: null,
    ...over,
  };
}

function fakeDeps() {
  const calls = [];
  const logs = [];
  return {
    calls,
    logs,
    execFile: (cmd, args, opts) => { calls.push({ cmd, args, opts }); return ''; },
    log: (line) => logs.push(String(line)),
  };
}

section('buildOptions — ranking, dedupe, bounds');

test('PR and its own worktree collapse into one option (PR preferred)', () => {
  const opts = choices.buildOptions(snapshot());
  assert.strictEqual(opts.filter((o) => o.kind === 'worktree' && o.ref === 'feature/83-koppel').length, 0);
  assert.strictEqual(opts[0].kind, 'pr');
  assert.strictEqual(opts[0].label, 'Hervat PR #91: Koppel PR');
});

test('PR collapses its worktree even when the worktree is ranked first', () => {
  const s = snapshot();
  s.ranking = [s.ranking[1], s.ranking[0], ...s.ranking.slice(2)];
  const opts = choices.buildOptions(s);
  assert.deepStrictEqual(opts.filter((o) => o.ref === 'feature/83-koppel' || o.ref === 91).map((o) => o.kind), ['pr']);
});

test('first 3 deduped ranking items plus the recommended issue, 1-based index', () => {
  const opts = choices.buildOptions(snapshot());
  assert.deepStrictEqual(opts.map((o) => `${o.kind}:${o.ref}`), [
    'pr:91',
    'brainstorm:bbbbbbbb-0000-0000-0000-000000000009',
    'issue:83',
    'issue:94',
  ]);
  assert.deepStrictEqual(opts.map((o) => o.index), [1, 2, 3, 4]);
  assert.strictEqual(opts[3].label, 'Pickup #94: Finalize polling');
  assert.match(opts[3].description, /recommended/);
});

test('recommended issue already in the top 3 is not added twice', () => {
  const s = snapshot();
  s.issues = s.issues.map((i) => ({ ...i, recommended: i.number === 83 }));
  const opts = choices.buildOptions(s);
  assert.strictEqual(opts.filter((o) => o.kind === 'issue' && o.ref === 83).length, 1);
  assert.strictEqual(opts.length, 3);
});

test('an in-progress recommended issue (all issues in flight) is not re-added as Pickup/Brainstorm', () => {
  const s = snapshot();
  s.issues = s.issues.map((i) => ({ ...i, inProgress: true }));
  s.ranking = s.ranking.filter((r) => r.kind !== 'issue');
  const opts = choices.buildOptions(s);
  assert.deepStrictEqual(opts.filter((o) => o.kind === 'issue'), []);
});

test('worktree label uses issue title with Dutch verb; cleanup uses branch', () => {
  const s = snapshot({ prs: [] });
  s.ranking = s.ranking.filter((r) => r.kind !== 'pr');
  s.ranking = [s.ranking[0], s.ranking[s.ranking.length - 1]];
  const opts = choices.buildOptions(s);
  assert.strictEqual(opts[0].label, 'Hervat #83: Koppel 6 losse context-modules');
  assert.match(opts[0].description, /9 commits ahead/);
  assert.strictEqual(opts[1].label, 'Cleanup feature/32-old');
  assert.strictEqual(opts[1].action, 'cleanup');
});

test('cleanup description says why: PR merged vs stale idle days', () => {
  const s = snapshot({ prs: [] });
  s.worktrees.push({ path: '/repo/.worktrees/91-done', branch: 'feature/91-done', issue: 91, ahead: 9, dirty: false,
    idleDays: 0, stale: false, merged: true, sessions: [] });
  s.ranking = [
    { kind: 'worktree', ref: 'feature/91-done', label: 'feature/91-done', action: 'cleanup' },
    { kind: 'worktree', ref: 'feature/32-old', label: 'feature/32-old', action: 'cleanup' },
  ];
  const opts = choices.buildOptions(s);
  assert.match(opts[0].description, /PR merged/);
  assert.doesNotMatch(opts[0].description, /stale/);
  assert.match(opts[1].description, /stale, idle 40 days/);
});

test('hervat description of a stale worktree mentions it is stale', () => {
  const s = snapshot({ prs: [] });
  s.worktrees.push({ path: '/repo/.worktrees/60-sw', branch: 'feature/60-stale-work', issue: null, ahead: 1, dirty: false,
    idleDays: 115, stale: true, sessions: [] });
  s.ranking = [
    { kind: 'worktree', ref: 'feature/83-koppel', label: 'feature/83-koppel', action: 'hervat' },
    { kind: 'worktree', ref: 'feature/60-stale-work', label: 'feature/60-stale-work', action: 'hervat' },
  ];
  const opts = choices.buildOptions(s);
  assert.doesNotMatch(opts[0].description, /stale/);
  assert.match(opts[1].description, /1 commits? ahead, idle 115d \(stale\)/);
});

test('labels are capped at 60 chars', () => {
  const s = snapshot();
  s.issues[1].title = 'x'.repeat(200);
  for (const o of choices.buildOptions(s)) assert.ok(o.label.length <= 60, `label too long: ${o.label.length}`);
});

test('empty ranking pads to 2 options (brainstorm new + nothing)', () => {
  const opts = choices.buildOptions(snapshot({ ranking: [], issues: [] }));
  assert.deepStrictEqual(opts.map((o) => o.action), ['brainstorm', 'none']);
  assert.strictEqual(opts[0].kind, 'new');
});

test('one item pads to 2 options; never more than 4', () => {
  const s = snapshot({ issues: [] });
  s.ranking = [s.ranking[3]];
  assert.strictEqual(choices.buildOptions(s).length, 2);
  assert.ok(choices.buildOptions(snapshot()).length <= 4);
});

section('resolve — newest session, dirs, PR without worktree');

test('worktree resolves to the newest session by Date, not string order', () => {
  const r = choices.resolve(snapshot({ prs: [] }), { kind: 'worktree', ref: 'feature/83-koppel' });
  assert.strictEqual(r.dir, '/repo/.worktrees/83-koppel');
  assert.strictEqual(r.session, SID_NEW);
  const s2 = snapshot({ prs: [] });
  s2.worktrees[1].sessions = [
    { sessionId: SID_OLD, modified: '2026-10-31T09:00:00+00:00' },
    { sessionId: SID_NEW, modified: '2026-10-31T10:30:00+02:00' }, // 08:30Z, older despite larger string
  ];
  assert.strictEqual(choices.resolve(s2, { kind: 'worktree', ref: 'feature/83-koppel' }).session, SID_OLD);
});

test('PR resolves through its worktree and carries issue + title parts', () => {
  const r = choices.resolve(snapshot(), { kind: 'pr', ref: 91 });
  assert.strictEqual(r.dir, '/repo/.worktrees/83-koppel');
  assert.strictEqual(r.issue, 83);
  assert.strictEqual(r.pr, 91);
  assert.strictEqual(r.issueTitle, 'Koppel 6 losse context-modules');
});

test('brainstorm resolves to its own session and cwd', () => {
  const r = choices.resolve(snapshot(), { kind: 'brainstorm', ref: 'bbbbbbbb-0000-0000-0000-000000000009' });
  assert.strictEqual(r.session, 'bbbbbbbb-0000-0000-0000-000000000009');
  assert.strictEqual(r.dir, '/repo');
});

section('resume — argv only, no shell');

test('resume runs open-session.js via execFile with argv and inherit stdio', () => {
  const d = fakeDeps();
  choices.resume(snapshot(), 1, d);
  assert.strictEqual(d.calls.length, 1);
  const { cmd, args, opts } = d.calls[0];
  assert.strictEqual(cmd, process.execPath);
  assert.strictEqual(args[0], path.join(LIB, 'open-session.js'));
  assert.deepStrictEqual(args.slice(1), [
    '--dir', '/repo/.worktrees/83-koppel',
    '--session', SID_NEW,
    '--title', '#83 · PR #91 · Koppel 6 losse context-modules',
  ]);
  assert.strictEqual(opts.stdio, 'inherit');
});

test('no session: prints the worktree path, spawns nothing', () => {
  const s = snapshot({ prs: [] });
  s.worktrees[1].sessions = [];
  s.ranking = [s.ranking[1], s.ranking[3]];
  const d = fakeDeps();
  choices.resume(s, 1, d);
  assert.strictEqual(d.calls.length, 0);
  assert.ok(d.logs.some((l) => l.includes('/repo/.worktrees/83-koppel')), d.logs.join('\n'));
});

test('PR without a local worktree points to babysit / gh pr checkout', () => {
  const s = snapshot();
  s.prs[0].branch = 'feature/elsewhere';
  const d = fakeDeps();
  choices.resume(s, 1, d);
  assert.strictEqual(d.calls.length, 0);
  const out = d.logs.join('\n');
  assert.match(out, /gh pr checkout 91/);
  assert.match(out, /envoy:babysit/);
});

test('non-hervat index is refused without spawning', () => {
  const d = fakeDeps();
  assert.throws(() => choices.resume(snapshot(), 3, d), /not a resume option/);
  assert.strictEqual(d.calls.length, 0);
});

test('hostile branch and title travel only as argv entries', () => {
  const s = snapshot({ prs: [] });
  s.worktrees[1].branch = 'feature/$(touch x)';
  s.worktrees[1].path = "/repo/.worktrees/it's $(touch x)";
  s.issues[0].title = "It's `rm -rf` $(touch x)";
  s.ranking = [{ kind: 'worktree', ref: 'feature/$(touch x)', label: 'x', action: 'hervat' }, s.ranking[4]];
  const d = fakeDeps();
  choices.resume(s, 1, d);
  const { cmd, args } = d.calls[0];
  assert.strictEqual(cmd, process.execPath);
  assert.strictEqual(args[2], "/repo/.worktrees/it's $(touch x)");
  assert.ok(args[6].includes("It's `rm -rf` $(touch x)"));
});

section('optionDir — cleanup target');

test('optionDir returns the worktree path for a cleanup option', () => {
  const s = snapshot({ issues: [] });
  s.ranking = [s.ranking[5], s.ranking[3]];
  assert.strictEqual(choices.optionDir(s, 1), '/repo/.worktrees/32-old');
});

section('CLI');

test('options / dir CLI read a snapshot file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'start-choices-'));
  const file = path.join(tmp, 'snap.json');
  const s = snapshot({ issues: [] });
  s.ranking = [s.ranking[5], s.ranking[3]];
  fs.writeFileSync(file, JSON.stringify(s));
  const cli = path.join(LIB, 'start-choices.js');
  const opts = JSON.parse(execFileSync(process.execPath, [cli, 'options', file]).toString());
  assert.strictEqual(opts[0].label, 'Cleanup feature/32-old');
  assert.strictEqual(execFileSync(process.execPath, [cli, 'dir', file, '1']).toString().trim(), '/repo/.worktrees/32-old');
  fs.rmSync(tmp, { recursive: true, force: true });
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
