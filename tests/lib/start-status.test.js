#!/usr/bin/env node
/**
 * /envoy:start data collector — Test Suite
 *
 * Fully hermetic: fixture transcripts under a tmp projects root, fixture
 * ledgers under tmp repo/worktree dirs, and injected git / gh / prSnapshot
 * runners. Never touches the real ~/.claude/projects, git or gh.
 *
 * Run: node tests/lib/start-status.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

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

const ss = require(path.join(LIB, 'start-status'));
const { BEGIN, END } = require(path.join(LIB, 'tasks-embed'));

const NOW = new Date('2026-10-30T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY);

// ═══════════════════════════════════════════════════════════════════
// Fixture builder
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a sandbox: tmp repo root, worktree dirs, a projects root, plus
 * fake git/gh runners driven by a plain spec object.
 */
function makeFixture(spec = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'start-status-')));
  const repoRoot = path.join(base, 'repo');
  const projectsRoot = path.join(base, 'projects');
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(projectsRoot, { recursive: true });

  const worktrees = [{ path: repoRoot, branch: 'main' }].concat(
    (spec.worktrees || []).map((w) => ({ ...w, path: path.join(repoRoot, '.worktrees', w.dir) }))
  );
  for (const w of worktrees) fs.mkdirSync(w.path, { recursive: true });

  const porcelain = worktrees
    .map((w) => `worktree ${w.path}\nHEAD abc123\nbranch refs/heads/${w.branch}\n`)
    .join('\n');

  const gitCalls = [];
  const git = (args, cwd) => {
    gitCalls.push({ args, cwd });
    if (spec.gitThrows) throw new Error('git missing');
    const a = args.join(' ');
    if (a === 'worktree list --porcelain') return porcelain;
    if (a.startsWith('branch --format')) {
      return (spec.branches || worktrees.map((w) => w.branch)).join('\n') + '\n';
    }
    if (a.startsWith('remote get-url')) return 'https://github.com/acme/repo.git\n';
    if (a.startsWith('symbolic-ref')) return 'origin/main\n';
    const w = worktrees.find((x) => x.path === cwd) || {};
    if (a.startsWith('rev-list --count')) return `${w.ahead || 0}\n`;
    if (a.startsWith('status --porcelain')) return w.dirty ? ' M file.js\n' : '';
    if (a.startsWith('log -1')) return `${(w.lastCommit || NOW).toISOString()}\n`;
    return '';
  };

  const gh = (args) => {
    if (spec.ghThrows) throw new Error('gh missing');
    const a = args.join(' ');
    if (a.startsWith('pr list')) return JSON.stringify(spec.prs || []);
    if (a.startsWith('issue list')) return JSON.stringify(spec.issues || []);
    return '[]';
  };

  const prSnapshot = (n) => {
    const s = (spec.snapshots || {})[n];
    if (s instanceof Error) throw s;
    return s || { ci: { state: 'SUCCESS' }, threads: { unresolved: 0 } };
  };

  return {
    base,
    repoRoot,
    projectsRoot,
    worktrees,
    gitCalls,
    opts: { repoRoot, projectsRoot, now: NOW, git, gh, prSnapshot },
    wtPath: (dir) => path.join(repoRoot, '.worktrees', dir),
    cleanup: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}

/** Write a transcript for `cwd` into the projects root. */
function writeTranscript(fx, cwd, sessionId, { branch = 'main', lines = [], modified = NOW, prompt = 'hello' } = {}) {
  const dir = path.join(fx.projectsRoot, ss.encodeProjectDir(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const all = [
    { type: 'last-prompt', sessionId },
    { type: 'permission-mode', permissionMode: 'auto', sessionId },
    { type: 'user', cwd, gitBranch: branch, sessionId, timestamp: modified.toISOString(), message: { role: 'user', content: prompt } },
    ...lines,
  ];
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, all.map((l) => JSON.stringify(l)).join('\n') + '\n');
  fs.utimesSync(file, modified, modified);
  return file;
}

function writeLedger(dir, events) {
  fs.mkdirSync(path.join(dir, '.envoy'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.envoy', 'ledger.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

const skillUse = (skill) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill } }] },
});
const bashUse = (command) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] },
});

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

section('helpers');

test('encodeProjectDir replaces / and . with -', () => {
  assert.strictEqual(
    ss.encodeProjectDir('/Users/x/proj/.worktrees/93-foo'),
    '-Users-x-proj--worktrees-93-foo'
  );
});

test('linkedIssue parses feature/fix/hotfix branches', () => {
  assert.strictEqual(ss.linkedIssue('feature/93-envoy-start'), 93);
  assert.strictEqual(ss.linkedIssue('fix/12-bug'), 12);
  assert.strictEqual(ss.linkedIssue('hotfix/7-x'), 7);
  assert.strictEqual(ss.linkedIssue('main'), null);
  assert.strictEqual(ss.linkedIssue('chore/5-x'), null);
  assert.strictEqual(ss.linkedIssue(null), null);
});

test('describeBody strips headers and caps to one short line', () => {
  const d = ss.describeBody('## Overview\n\nAdds a **dashboard** for\nsessions.\n\n## Architecture\n' + 'x'.repeat(300));
  assert.ok(!d.includes('#'), d);
  assert.ok(!d.includes('\n'), d);
  assert.ok(d.startsWith('Adds a'), d);
  assert.ok(d.length <= 120, `len ${d.length}`);
  assert.strictEqual(ss.describeBody(null), '');
});

// ═══════════════════════════════════════════════════════════════════
// Sessions
// ═══════════════════════════════════════════════════════════════════

section('sessions');

test('session is linked to its worktree via cwd and gitBranch', () => {
  const fx = makeFixture({ worktrees: [{ dir: '12-foo', branch: 'feature/12-foo', ahead: 1 }] });
  try {
    writeTranscript(fx, fx.wtPath('12-foo'), 'sess-wt', { branch: 'feature/12-foo', modified: daysAgo(20) });
    const snap = ss.collect(fx.opts);
    const wt = snap.worktrees.find((w) => w.branch === 'feature/12-foo');
    assert.ok(wt, 'worktree present');
    assert.strictEqual(wt.sessions.length, 1);
    assert.strictEqual(wt.sessions[0].sessionId, 'sess-wt');
    assert.strictEqual(wt.sessions[0].cwd, fx.wtPath('12-foo'));
    assert.strictEqual(wt.sessions[0].gitBranch, 'feature/12-foo');
  } finally {
    fx.cleanup();
  }
});

test('old session on the default branch is dropped; recent one is kept', () => {
  const fx = makeFixture();
  try {
    writeTranscript(fx, fx.repoRoot, 'old-main', { branch: 'main', modified: daysAgo(10) });
    writeTranscript(fx, fx.repoRoot, 'new-main', { branch: 'main', modified: daysAgo(2) });
    const snap = ss.collect(fx.opts);
    const main = snap.worktrees.find((w) => w.path === fx.repoRoot);
    const ids = main.sessions.map((s) => s.sessionId);
    assert.deepStrictEqual(ids, ['new-main']);
  } finally {
    fx.cleanup();
  }
});

test('old session whose branch is alive (open PR) is kept', () => {
  const fx = makeFixture({
    worktrees: [{ dir: '20-bar', branch: 'feature/20-bar' }],
    prs: [{ number: 5, title: 'Bar', headRefName: 'feature/20-bar', url: 'u' }],
  });
  try {
    writeTranscript(fx, fx.wtPath('20-bar'), 'old-pr', { branch: 'feature/20-bar', modified: daysAgo(40) });
    const snap = ss.collect(fx.opts);
    const wt = snap.worktrees.find((w) => w.branch === 'feature/20-bar');
    assert.deepStrictEqual(wt.sessions.map((s) => s.sessionId), ['old-pr']);
  } finally {
    fx.cleanup();
  }
});

test('session with unknown cwd falls back to matching gitBranch', () => {
  const fx = makeFixture({ worktrees: [{ dir: '30-baz', branch: 'feature/30-baz' }] });
  try {
    // Transcript lives in the main repo project dir but ran on the worktree branch.
    writeTranscript(fx, '/elsewhere/gone', 'moved', { branch: 'feature/30-baz', modified: daysAgo(1) });
    // Re-home the file under the main repo's project dir.
    const from = path.join(fx.projectsRoot, ss.encodeProjectDir('/elsewhere/gone'), 'moved.jsonl');
    const toDir = path.join(fx.projectsRoot, ss.encodeProjectDir(fx.repoRoot));
    fs.mkdirSync(toDir, { recursive: true });
    fs.renameSync(from, path.join(toDir, 'moved.jsonl'));
    const snap = ss.collect(fx.opts);
    const wt = snap.worktrees.find((w) => w.branch === 'feature/30-baz');
    assert.deepStrictEqual(wt.sessions.map((s) => s.sessionId), ['moved']);
  } finally {
    fx.cleanup();
  }
});

// ═══════════════════════════════════════════════════════════════════
// Brainstorms
// ═══════════════════════════════════════════════════════════════════

section('brainstorms');

test('ledger brainstorm with sessionId and no issue is listed', () => {
  const fx = makeFixture();
  try {
    writeLedger(fx.repoRoot, [
      { ts: daysAgo(3).toISOString(), branch: 'main', type: 'skill-started', skill: 'brainstorm', sessionId: 'bs-1' },
    ]);
    writeTranscript(fx, fx.repoRoot, 'bs-1', { prompt: 'dark mode toggle', modified: daysAgo(3) });
    const snap = ss.collect(fx.opts);
    assert.strictEqual(snap.brainstorms.length, 1);
    const b = snap.brainstorms[0];
    assert.strictEqual(b.sessionId, 'bs-1');
    assert.strictEqual(b.startedAt, daysAgo(3).toISOString());
    assert.strictEqual(b.ageDays, 3);
    assert.ok(b.topic.includes('dark mode'), b.topic);
    assert.strictEqual(b.cwd, fx.repoRoot);
  } finally {
    fx.cleanup();
  }
});

test('ledger brainstorm whose transcript ran gh issue create is not listed', () => {
  const fx = makeFixture();
  try {
    writeLedger(fx.repoRoot, [
      { ts: daysAgo(1).toISOString(), branch: 'main', type: 'skill-started', skill: 'brainstorm', sessionId: 'bs-done' },
    ]);
    writeTranscript(fx, fx.repoRoot, 'bs-done', {
      modified: daysAgo(1),
      lines: [skillUse('envoy:brainstorm'), bashUse('ISSUE_URL=$(gh issue create --title "X" --body "y")')],
    });
    const snap = ss.collect(fx.opts);
    assert.deepStrictEqual(snap.brainstorms, []);
  } finally {
    fx.cleanup();
  }
});

test('ledger brainstorm whose session later logged an issue is not listed', () => {
  const fx = makeFixture();
  try {
    writeLedger(fx.repoRoot, [
      { ts: daysAgo(2).toISOString(), branch: 'main', type: 'skill-started', skill: 'brainstorm', sessionId: 'bs-2' },
      { ts: daysAgo(2).toISOString(), branch: 'main', type: 'skill-started', skill: 'pickup', issue: 44, sessionId: 'bs-2' },
    ]);
    const snap = ss.collect(fx.opts);
    assert.deepStrictEqual(snap.brainstorms, []);
  } finally {
    fx.cleanup();
  }
});

test('duplicate ledger brainstorm events dedupe by sessionId keeping earliest ts', () => {
  const fx = makeFixture({ worktrees: [{ dir: '1-a', branch: 'feature/1-a' }] });
  try {
    writeLedger(fx.repoRoot, [
      { ts: daysAgo(2).toISOString(), branch: 'main', type: 'skill-started', skill: 'brainstorm', sessionId: 'dup' },
    ]);
    writeLedger(fx.wtPath('1-a'), [
      { ts: daysAgo(4).toISOString(), branch: 'main', type: 'skill-started', skill: 'brainstorm', sessionId: 'dup' },
    ]);
    const snap = ss.collect(fx.opts);
    assert.strictEqual(snap.brainstorms.length, 1);
    assert.strictEqual(snap.brainstorms[0].startedAt, daysAgo(4).toISOString());
  } finally {
    fx.cleanup();
  }
});

test('fallback: transcript with brainstorm Skill tool_use and no gh issue create is listed', () => {
  const fx = makeFixture();
  try {
    writeTranscript(fx, fx.repoRoot, 'fb-1', {
      prompt: 'offline sync idea',
      modified: daysAgo(1),
      // Skill body text mentioning `gh issue create` inside a user message must NOT count.
      lines: [
        skillUse('envoy:brainstorm'),
        { type: 'user', message: { content: 'Step 2: ISSUE_URL=$(gh issue create --title ...)' } },
      ],
    });
    const snap = ss.collect(fx.opts);
    assert.deepStrictEqual(snap.brainstorms.map((b) => b.sessionId), ['fb-1']);
    assert.ok(snap.brainstorms[0].topic.includes('offline sync'));
  } finally {
    fx.cleanup();
  }
});

test('fallback: slash-command brainstorm invocation is detected', () => {
  const fx = makeFixture();
  try {
    writeTranscript(fx, fx.repoRoot, 'fb-cmd', {
      modified: daysAgo(1),
      lines: [{ type: 'user', message: { content: '<command-name>/envoy:brainstorm</command-name>' } }],
    });
    const snap = ss.collect(fx.opts);
    assert.deepStrictEqual(snap.brainstorms.map((b) => b.sessionId), ['fb-cmd']);
  } finally {
    fx.cleanup();
  }
});

test('fallback: skills listing mentioning envoy:brainstorm is not an invocation', () => {
  const fx = makeFixture();
  try {
    writeTranscript(fx, fx.repoRoot, 'noise', {
      modified: daysAgo(1),
      lines: [{ type: 'user', message: { content: '- envoy:brainstorm: Use when starting any new feature' } }],
    });
    const snap = ss.collect(fx.opts);
    assert.deepStrictEqual(snap.brainstorms, []);
  } finally {
    fx.cleanup();
  }
});

test('fallback: issue created late in a large transcript is found (head+tail scan)', () => {
  const fx = makeFixture();
  try {
    const filler = [];
    const big = 'z'.repeat(2000);
    for (let i = 0; i < 1000; i++) filler.push({ type: 'user', message: { content: big } });
    writeTranscript(fx, fx.repoRoot, 'late', {
      modified: daysAgo(1),
      lines: [skillUse('envoy:brainstorm'), ...filler, bashUse('gh issue create --title T')],
    });
    const snap = ss.collect(fx.opts);
    assert.deepStrictEqual(snap.brainstorms, []);
  } finally {
    fx.cleanup();
  }
});

// ═══════════════════════════════════════════════════════════════════
// Worktrees
// ═══════════════════════════════════════════════════════════════════

section('worktrees');

test('worktree reports branch, issue, ahead, dirty, lastActivityAt, idleDays, stale', () => {
  const fx = makeFixture({
    worktrees: [
      { dir: '12-foo', branch: 'feature/12-foo', ahead: 3, dirty: true, lastCommit: daysAgo(2) },
      { dir: '13-old', branch: 'fix/13-old', ahead: 0, dirty: false, lastCommit: daysAgo(45) },
    ],
  });
  try {
    const snap = ss.collect(fx.opts);
    const a = snap.worktrees.find((w) => w.branch === 'feature/12-foo');
    assert.strictEqual(a.path, fx.wtPath('12-foo'));
    assert.strictEqual(a.issue, 12);
    assert.strictEqual(a.ahead, 3);
    assert.strictEqual(a.dirty, true);
    assert.strictEqual(a.lastActivityAt, daysAgo(2).toISOString());
    assert.strictEqual(a.idleDays, 2);
    assert.strictEqual(a.stale, false);
    const b = snap.worktrees.find((w) => w.branch === 'fix/13-old');
    assert.strictEqual(b.issue, 13);
    assert.strictEqual(b.idleDays, 45);
    assert.strictEqual(b.stale, true);
  } finally {
    fx.cleanup();
  }
});

test('newer session activity refreshes worktree lastActivityAt', () => {
  const fx = makeFixture({ worktrees: [{ dir: '14-x', branch: 'feature/14-x', lastCommit: daysAgo(40) }] });
  try {
    writeTranscript(fx, fx.wtPath('14-x'), 's14', { branch: 'feature/14-x', modified: daysAgo(1) });
    const snap = ss.collect(fx.opts);
    const w = snap.worktrees.find((x) => x.branch === 'feature/14-x');
    assert.strictEqual(w.idleDays, 1);
    assert.strictEqual(w.stale, false);
  } finally {
    fx.cleanup();
  }
});

test('main worktree is never stale', () => {
  const fx = makeFixture();
  try {
    fx.worktrees[0].lastCommit = daysAgo(90);
    const snap = ss.collect(fx.opts);
    const main = snap.worktrees.find((w) => w.path === fx.repoRoot);
    assert.strictEqual(main.stale, false);
    assert.strictEqual(main.issue, null);
  } finally {
    fx.cleanup();
  }
});

// ═══════════════════════════════════════════════════════════════════
// PRs and issues
// ═══════════════════════════════════════════════════════════════════

section('prs');

test('PR status comes from prSnapshot; red CI or unresolved threads need attention', () => {
  const fx = makeFixture({
    prs: [
      { number: 1, title: 'Red', headRefName: 'feature/10-red', url: 'u1' },
      { number: 2, title: 'Threads', headRefName: 'feature/11-thr', url: 'u2' },
      { number: 3, title: 'Green', headRefName: 'chore/green', url: 'u3' },
    ],
    snapshots: {
      1: { ci: { state: 'FAILURE' }, threads: { unresolved: 0 } },
      2: { ci: { state: 'SUCCESS' }, threads: { unresolved: 2 } },
      3: { ci: { state: 'SUCCESS' }, threads: { unresolved: 0 } },
    },
  });
  try {
    const snap = ss.collect(fx.opts);
    const byN = Object.fromEntries(snap.prs.map((p) => [p.number, p]));
    assert.strictEqual(byN[1].ci, 'FAILURE');
    assert.strictEqual(byN[1].needsAttention, true);
    assert.strictEqual(byN[1].issue, 10);
    assert.strictEqual(byN[1].branch, 'feature/10-red');
    assert.strictEqual(byN[2].unresolved, 2);
    assert.strictEqual(byN[2].needsAttention, true);
    assert.strictEqual(byN[3].needsAttention, false);
    assert.strictEqual(byN[3].issue, null);
    assert.strictEqual(byN[3].title, 'Green');
    assert.strictEqual(byN[3].url, 'u3');
  } finally {
    fx.cleanup();
  }
});

test('one failing prSnapshot yields ci:null for that PR only', () => {
  const fx = makeFixture({
    prs: [
      { number: 1, title: 'Boom', headRefName: 'a', url: 'u1' },
      { number: 2, title: 'Ok', headRefName: 'b', url: 'u2' },
    ],
    snapshots: { 1: new Error('boom') },
  });
  try {
    const snap = ss.collect(fx.opts);
    assert.strictEqual(snap.prs.length, 2);
    assert.strictEqual(snap.prs.find((p) => p.number === 1).ci, null);
    assert.strictEqual(snap.prs.find((p) => p.number === 2).ci, 'SUCCESS');
  } finally {
    fx.cleanup();
  }
});

section('issues');

const planBody = `## Overview\n\nPlanned work.\n\n${BEGIN}\n\`\`\`json\n{"tasks":[]}\n\`\`\`\n${END}\n`;

test('issues carry title, description, labels, url and plan flag', () => {
  const fx = makeFixture({
    issues: [
      { number: 40, title: 'Plain', body: '## Overview\n\nJust an idea.', labels: [{ name: 'enhancement' }], url: 'i40' },
      { number: 41, title: 'Planned', body: planBody, labels: [], url: 'i41' },
    ],
  });
  try {
    const snap = ss.collect(fx.opts);
    const byN = Object.fromEntries(snap.issues.map((i) => [i.number, i]));
    assert.strictEqual(byN[40].title, 'Plain');
    assert.strictEqual(byN[40].description, 'Just an idea.');
    assert.deepStrictEqual(byN[40].labels, ['enhancement']);
    assert.strictEqual(byN[40].url, 'i40');
    assert.strictEqual(byN[40].plan, false);
    assert.strictEqual(byN[41].plan, true);
  } finally {
    fx.cleanup();
  }
});

test('exactly one issue is recommended: plan first, then lowest number', () => {
  const fx = makeFixture({
    issues: [
      { number: 50, title: 'a', body: '', labels: [], url: '' },
      { number: 60, title: 'b', body: planBody, labels: [], url: '' },
      { number: 55, title: 'c', body: planBody, labels: [], url: '' },
    ],
  });
  try {
    const snap = ss.collect(fx.opts);
    const rec = snap.issues.filter((i) => i.recommended);
    assert.strictEqual(rec.length, 1);
    assert.strictEqual(rec[0].number, 55);
  } finally {
    fx.cleanup();
  }
});

test('without plan issues, lowest number is recommended', () => {
  const fx = makeFixture({
    issues: [
      { number: 9, title: 'a', body: '', labels: [], url: '' },
      { number: 3, title: 'b', body: '', labels: [], url: '' },
    ],
  });
  try {
    const snap = ss.collect(fx.opts);
    assert.deepStrictEqual(snap.issues.filter((i) => i.recommended).map((i) => i.number), [3]);
  } finally {
    fx.cleanup();
  }
});

// ═══════════════════════════════════════════════════════════════════
// Ranking
// ═══════════════════════════════════════════════════════════════════

section('ranking');

test('order: attention PR > worktree with work > brainstorm > plan issue > issue > stale cleanup', () => {
  const fx = makeFixture({
    worktrees: [
      { dir: '70-work', branch: 'feature/70-work', ahead: 2, lastCommit: daysAgo(1) },
      { dir: '71-idle', branch: 'feature/71-idle', ahead: 0, lastCommit: daysAgo(1) },
      { dir: '72-stale', branch: 'feature/72-stale', ahead: 5, lastCommit: daysAgo(60) },
    ],
    prs: [
      { number: 8, title: 'Red PR', headRefName: 'feature/80-red', url: '' },
      { number: 9, title: 'Green PR', headRefName: 'feature/81-green', url: '' },
    ],
    snapshots: { 8: { ci: { state: 'FAILURE' }, threads: { unresolved: 0 } } },
    issues: [
      { number: 90, title: 'No plan', body: '', labels: [], url: '' },
      { number: 91, title: 'Plan', body: planBody, labels: [], url: '' },
    ],
  });
  try {
    writeLedger(fx.repoRoot, [
      { ts: daysAgo(1).toISOString(), branch: 'main', type: 'skill-started', skill: 'brainstorm', sessionId: 'bs-r' },
    ]);
    const snap = ss.collect(fx.opts);
    const seq = snap.ranking.map((r) => `${r.kind}:${r.ref}:${r.action}`);
    assert.deepStrictEqual(seq, [
      'pr:8:hervat',
      'worktree:feature/70-work:hervat',
      'brainstorm:bs-r:hervat',
      'issue:91:pickup',
      'issue:90:brainstorm',
      'worktree:feature/72-stale:cleanup',
    ]);
    for (const r of snap.ranking) assert.ok(typeof r.label === 'string' && r.label.length > 0);
    assert.deepStrictEqual(snap.next, snap.ranking[0]);
  } finally {
    fx.cleanup();
  }
});

test('next is null when nothing is open', () => {
  const fx = makeFixture();
  try {
    const snap = ss.collect(fx.opts);
    assert.deepStrictEqual(snap.ranking, []);
    assert.strictEqual(snap.next, null);
  } finally {
    fx.cleanup();
  }
});

// ═══════════════════════════════════════════════════════════════════
// Snapshot shape and fail-soft
// ═══════════════════════════════════════════════════════════════════

section('shape + fail-soft');

test('snapshot has the documented top-level shape', () => {
  const fx = makeFixture();
  try {
    const snap = ss.collect(fx.opts);
    assert.strictEqual(snap.generatedAt, NOW.toISOString());
    assert.strictEqual(snap.repo.root, fx.repoRoot);
    assert.strictEqual(snap.repo.url, 'https://github.com/acme/repo');
    for (const k of ['brainstorms', 'worktrees', 'prs', 'issues', 'ranking']) {
      assert.ok(Array.isArray(snap[k]), k);
    }
    assert.ok('next' in snap);
  } finally {
    fx.cleanup();
  }
});

test('gh missing yields empty prs/issues, never a crash', () => {
  const fx = makeFixture({ ghThrows: true, worktrees: [{ dir: '1-a', branch: 'feature/1-a' }] });
  try {
    const snap = ss.collect(fx.opts);
    assert.deepStrictEqual(snap.prs, []);
    assert.deepStrictEqual(snap.issues, []);
    assert.ok(snap.worktrees.length >= 1);
  } finally {
    fx.cleanup();
  }
});

test('git missing yields a usable snapshot with empty worktrees', () => {
  const fx = makeFixture({ gitThrows: true });
  try {
    const snap = ss.collect(fx.opts);
    assert.ok(Array.isArray(snap.worktrees));
    assert.strictEqual(snap.repo.root, fx.repoRoot);
  } finally {
    fx.cleanup();
  }
});

test('missing projects root yields no sessions or brainstorms, never a crash', () => {
  const fx = makeFixture();
  try {
    const snap = ss.collect({ ...fx.opts, projectsRoot: path.join(fx.base, 'nope') });
    assert.deepStrictEqual(snap.brainstorms, []);
    assert.ok(snap.worktrees.every((w) => w.sessions.length === 0));
  } finally {
    fx.cleanup();
  }
});

test('corrupt transcript and ledger lines are skipped', () => {
  const fx = makeFixture();
  try {
    const dir = path.join(fx.projectsRoot, ss.encodeProjectDir(fx.repoRoot));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bad.jsonl'), '{not json\n');
    fs.mkdirSync(path.join(fx.repoRoot, '.envoy'), { recursive: true });
    fs.writeFileSync(path.join(fx.repoRoot, '.envoy', 'ledger.jsonl'), 'garbage\n');
    const snap = ss.collect(fx.opts);
    assert.deepStrictEqual(snap.brainstorms, []);
  } finally {
    fx.cleanup();
  }
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
