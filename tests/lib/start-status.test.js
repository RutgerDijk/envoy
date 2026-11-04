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

const queue = [];

function test(name, fn) {
  queue.push({ name, fn });
}

function section(name) {
  queue.push({ section: name });
}

async function runAll() {
  for (const item of queue) {
    if (item.section) {
      process.stdout.write(`\n\x1b[1m${item.section}\x1b[0m\n`);
      continue;
    }
    try {
      await item.fn();
      passed++;
      process.stdout.write(`  \x1b[32m✓\x1b[0m ${item.name}\n`);
    } catch (err) {
      failed++;
      process.stdout.write(`  \x1b[31m✗\x1b[0m ${item.name}\n    ${err.message}\n`);
    }
  }
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
    if (a.startsWith('rev-parse --verify')) {
      if (spec.noOriginRef) throw new Error('unknown ref');
      return 'deadbeef\n';
    }
    const w = worktrees.find((x) => x.path === cwd) || {};
    if (a === 'rev-parse HEAD') return `${w.head || 'abc123'}\n`;
    if (a.startsWith('merge-base --is-ancestor HEAD ')) {
      // exit 0 when HEAD is an ancestor; otherwise git exits non-zero (1, or 128 for an unknown oid)
      if ((w.ancestorOf || []).includes(args[3])) return '';
      throw new Error('not an ancestor');
    }
    if (a.startsWith('rev-list --count')) {
      if (w.aheadThrows) throw new Error('git timed out');
      return `${w.ahead || 0}\n`;
    }
    if (a.includes('status --porcelain')) {
      if (w.statusThrows) throw new Error('git timed out');
      return w.dirty ? ' M file.js\n' : '';
    }
    if (a.startsWith('log -1')) return `${(w.lastCommit || NOW).toISOString()}\n`;
    return '';
  };

  const gh = (args) => {
    if (spec.ghThrows) throw new Error('gh missing');
    const a = args.join(' ');
    if (a.startsWith('pr list') && a.includes('--state merged')) {
      if (spec.mergedThrows) throw new Error('gh merged list failed');
      return JSON.stringify(spec.mergedPrs || []);
    }
    if (a.startsWith('pr list')) return JSON.stringify(spec.prs || []);
    if (a.startsWith('issue list')) return JSON.stringify(spec.issues || []);
    return '[]';
  };

  const prSnapshot = spec.prSnapshot || ((n) => {
    const s = (spec.snapshots || {})[n];
    if (s instanceof Error) throw s;
    return s || { ci: { state: 'SUCCESS' }, threads: { unresolved: 0 } };
  });

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

test('encodeProjectDir replaces / and . with -', async () => {
  assert.strictEqual(
    ss.encodeProjectDir('/Users/x/proj/.worktrees/93-foo'),
    '-Users-x-proj--worktrees-93-foo'
  );
});

test('linkedIssue parses feature/fix/hotfix branches', async () => {
  assert.strictEqual(ss.linkedIssue('feature/93-envoy-start'), 93);
  assert.strictEqual(ss.linkedIssue('fix/12-bug'), 12);
  assert.strictEqual(ss.linkedIssue('hotfix/7-x'), 7);
  assert.strictEqual(ss.linkedIssue('main'), null);
  assert.strictEqual(ss.linkedIssue('chore/5-x'), null);
  assert.strictEqual(ss.linkedIssue(null), null);
});

test('linkedIssue accepts a bare feature/<N> branch, matching tab-title issueFromBranch', async () => {
  assert.strictEqual(ss.linkedIssue('feature/83'), 83);
  assert.strictEqual(ss.linkedIssue('feature/83x'), null);
});

test('describeBody strips headers and caps to one short line', async () => {
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

test('session is linked to its worktree via cwd and gitBranch', async () => {
  const fx = makeFixture({ worktrees: [{ dir: '12-foo', branch: 'feature/12-foo', ahead: 1 }] });
  try {
    writeTranscript(fx, fx.wtPath('12-foo'), 'sess-wt', { branch: 'feature/12-foo', modified: daysAgo(20) });
    const snap = await ss.collect(fx.opts);
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

test('old session on the default branch is dropped; recent one is kept', async () => {
  const fx = makeFixture();
  try {
    writeTranscript(fx, fx.repoRoot, 'old-main', { branch: 'main', modified: daysAgo(10) });
    writeTranscript(fx, fx.repoRoot, 'new-main', { branch: 'main', modified: daysAgo(2) });
    const snap = await ss.collect(fx.opts);
    const main = snap.worktrees.find((w) => w.path === fx.repoRoot);
    const ids = main.sessions.map((s) => s.sessionId);
    assert.deepStrictEqual(ids, ['new-main']);
  } finally {
    fx.cleanup();
  }
});

test('indexed session uses the transcript mtime, not a stale sessions-index modified', async () => {
  const fx = makeFixture();
  try {
    const file = writeTranscript(fx, fx.repoRoot, 'idx-main', { branch: 'main', modified: daysAgo(1) });
    fs.writeFileSync(path.join(path.dirname(file), 'sessions-index.json'), JSON.stringify({
      entries: [{ sessionId: 'idx-main', fullPath: file, summary: 'indexed', modified: daysAgo(20).toISOString(), gitBranch: 'main' }],
    }));
    const snap = await ss.collect(fx.opts);
    const main = snap.worktrees.find((w) => w.path === fx.repoRoot);
    const s = main.sessions.find((x) => x.sessionId === 'idx-main');
    assert.ok(s, 'fresh transcript must be kept despite a 20-day-old index entry');
    assert.strictEqual(s.modified, daysAgo(1).toISOString());
  } finally {
    fx.cleanup();
  }
});

test('old session whose branch is alive (open PR) is kept', async () => {
  const fx = makeFixture({
    worktrees: [{ dir: '20-bar', branch: 'feature/20-bar' }],
    prs: [{ number: 5, title: 'Bar', headRefName: 'feature/20-bar', url: 'u' }],
  });
  try {
    writeTranscript(fx, fx.wtPath('20-bar'), 'old-pr', { branch: 'feature/20-bar', modified: daysAgo(40) });
    const snap = await ss.collect(fx.opts);
    const wt = snap.worktrees.find((w) => w.branch === 'feature/20-bar');
    assert.deepStrictEqual(wt.sessions.map((s) => s.sessionId), ['old-pr']);
  } finally {
    fx.cleanup();
  }
});

test('session with unknown cwd falls back to matching gitBranch', async () => {
  const fx = makeFixture({ worktrees: [{ dir: '30-baz', branch: 'feature/30-baz' }] });
  try {
    // Transcript lives in the main repo project dir but ran on the worktree branch.
    writeTranscript(fx, '/elsewhere/gone', 'moved', { branch: 'feature/30-baz', modified: daysAgo(1) });
    // Re-home the file under the main repo's project dir.
    const from = path.join(fx.projectsRoot, ss.encodeProjectDir('/elsewhere/gone'), 'moved.jsonl');
    const toDir = path.join(fx.projectsRoot, ss.encodeProjectDir(fx.repoRoot));
    fs.mkdirSync(toDir, { recursive: true });
    fs.renameSync(from, path.join(toDir, 'moved.jsonl'));
    const snap = await ss.collect(fx.opts);
    const wt = snap.worktrees.find((w) => w.branch === 'feature/30-baz');
    assert.deepStrictEqual(wt.sessions.map((s) => s.sessionId), ['moved']);
  } finally {
    fx.cleanup();
  }
});

test('session that started in main but moved into a worktree attaches to that worktree', async () => {
  const fx = makeFixture({ worktrees: [{ dir: '33-mv', branch: 'feature/33-mv' }] });
  try {
    const filler = [];
    const big = 'q'.repeat(2000);
    for (let i = 0; i < 300; i++) filler.push({ type: 'user', message: { content: big } });
    writeTranscript(fx, fx.repoRoot, 'drift', {
      branch: 'main',
      modified: daysAgo(1),
      lines: [
        ...filler,
        { type: 'user', cwd: fx.wtPath('33-mv'), gitBranch: 'feature/33-mv', sessionId: 'drift', message: { content: 'go' } },
      ],
    });
    const snap = await ss.collect(fx.opts);
    const wt = snap.worktrees.find((w) => w.branch === 'feature/33-mv');
    const main = snap.worktrees.find((w) => w.path === fx.repoRoot);
    assert.deepStrictEqual(wt.sessions.map((s) => s.sessionId), ['drift']);
    assert.strictEqual(wt.sessions[0].cwd, fx.wtPath('33-mv'));
    assert.strictEqual(wt.sessions[0].gitBranch, 'feature/33-mv');
    assert.deepStrictEqual(main.sessions, []);
  } finally {
    fx.cleanup();
  }
});

test('session summary is a clean single line without markup tags', async () => {
  const fx = makeFixture();
  try {
    writeTranscript(fx, fx.repoRoot, 'tags', {
      modified: daysAgo(1),
      prompt: '\n\n<command-message>envoy:pickup</command-message>\n<command-name>/envoy:pickup</command-name> 93',
    });
    const snap = await ss.collect(fx.opts);
    const s = snap.worktrees[0].sessions[0];
    assert.ok(!/[<>\n]/.test(s.summary), JSON.stringify(s.summary));
    assert.ok(s.summary.includes('envoy:pickup'), s.summary);
  } finally {
    fx.cleanup();
  }
});

// ═══════════════════════════════════════════════════════════════════
// Brainstorms
// ═══════════════════════════════════════════════════════════════════

section('brainstorms');

test('ledger brainstorm with sessionId and no issue is listed', async () => {
  const fx = makeFixture();
  try {
    writeLedger(fx.repoRoot, [
      { ts: daysAgo(3).toISOString(), branch: 'main', type: 'skill-started', skill: 'brainstorm', sessionId: 'bs-1' },
    ]);
    writeTranscript(fx, fx.repoRoot, 'bs-1', { prompt: 'dark mode toggle', modified: daysAgo(3) });
    const snap = await ss.collect(fx.opts);
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

test('ledger brainstorm whose transcript ran gh issue create is not listed', async () => {
  const fx = makeFixture();
  try {
    writeLedger(fx.repoRoot, [
      { ts: daysAgo(1).toISOString(), branch: 'main', type: 'skill-started', skill: 'brainstorm', sessionId: 'bs-done' },
    ]);
    writeTranscript(fx, fx.repoRoot, 'bs-done', {
      modified: daysAgo(1),
      lines: [skillUse('envoy:brainstorm'), bashUse('ISSUE_URL=$(gh issue create --title "X" --body "y")')],
    });
    const snap = await ss.collect(fx.opts);
    assert.deepStrictEqual(snap.brainstorms, []);
  } finally {
    fx.cleanup();
  }
});

test('ledger brainstorm whose session later logged an issue is not listed', async () => {
  const fx = makeFixture();
  try {
    writeLedger(fx.repoRoot, [
      { ts: daysAgo(2).toISOString(), branch: 'main', type: 'skill-started', skill: 'brainstorm', sessionId: 'bs-2' },
      { ts: daysAgo(2).toISOString(), branch: 'main', type: 'skill-started', skill: 'pickup', issue: 44, sessionId: 'bs-2' },
    ]);
    const snap = await ss.collect(fx.opts);
    assert.deepStrictEqual(snap.brainstorms, []);
  } finally {
    fx.cleanup();
  }
});

test('duplicate ledger brainstorm events dedupe by sessionId keeping earliest ts', async () => {
  const fx = makeFixture({ worktrees: [{ dir: '1-a', branch: 'feature/1-a' }] });
  try {
    writeLedger(fx.repoRoot, [
      { ts: daysAgo(2).toISOString(), branch: 'main', type: 'skill-started', skill: 'brainstorm', sessionId: 'dup' },
    ]);
    writeLedger(fx.wtPath('1-a'), [
      { ts: daysAgo(4).toISOString(), branch: 'main', type: 'skill-started', skill: 'brainstorm', sessionId: 'dup' },
    ]);
    const snap = await ss.collect(fx.opts);
    assert.strictEqual(snap.brainstorms.length, 1);
    assert.strictEqual(snap.brainstorms[0].startedAt, daysAgo(4).toISOString());
  } finally {
    fx.cleanup();
  }
});

test('fallback: transcript with brainstorm Skill tool_use and no gh issue create is listed', async () => {
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
    const snap = await ss.collect(fx.opts);
    assert.deepStrictEqual(snap.brainstorms.map((b) => b.sessionId), ['fb-1']);
    assert.ok(snap.brainstorms[0].topic.includes('offline sync'));
  } finally {
    fx.cleanup();
  }
});

test('fallback: slash-command brainstorm invocation is detected', async () => {
  const fx = makeFixture();
  try {
    writeTranscript(fx, fx.repoRoot, 'fb-cmd', {
      modified: daysAgo(1),
      lines: [{ type: 'user', message: { content: '<command-name>/envoy:brainstorm</command-name>' } }],
    });
    const snap = await ss.collect(fx.opts);
    assert.deepStrictEqual(snap.brainstorms.map((b) => b.sessionId), ['fb-cmd']);
  } finally {
    fx.cleanup();
  }
});

test('fallback: skills listing mentioning envoy:brainstorm is not an invocation', async () => {
  const fx = makeFixture();
  try {
    writeTranscript(fx, fx.repoRoot, 'noise', {
      modified: daysAgo(1),
      lines: [{ type: 'user', message: { content: '- envoy:brainstorm: Use when starting any new feature' } }],
    });
    const snap = await ss.collect(fx.opts);
    assert.deepStrictEqual(snap.brainstorms, []);
  } finally {
    fx.cleanup();
  }
});

test('fallback: issue created late in a large transcript is found (head+tail scan)', async () => {
  const fx = makeFixture();
  try {
    const filler = [];
    const big = 'z'.repeat(2000);
    for (let i = 0; i < 1000; i++) filler.push({ type: 'user', message: { content: big } });
    writeTranscript(fx, fx.repoRoot, 'late', {
      modified: daysAgo(1),
      lines: [skillUse('envoy:brainstorm'), ...filler, bashUse('gh issue create --title T')],
    });
    const snap = await ss.collect(fx.opts);
    assert.deepStrictEqual(snap.brainstorms, []);
  } finally {
    fx.cleanup();
  }
});

test('issue created mid-transcript (outside head/tail windows) is found', async () => {
  const fx = makeFixture();
  try {
    const big = 'm'.repeat(2000);
    const pad = () => Array.from({ length: 400 }, () => ({ type: 'user', message: { content: big } }));
    writeTranscript(fx, fx.repoRoot, 'mid', {
      modified: daysAgo(1),
      lines: [skillUse('envoy:brainstorm'), ...pad(), bashUse('gh issue create --title T'), ...pad()],
    });
    writeLedger(fx.repoRoot, [
      { ts: daysAgo(1).toISOString(), branch: 'main', type: 'skill-started', skill: 'brainstorm', sessionId: 'mid' },
    ]);
    const snap = await ss.collect(fx.opts);
    assert.deepStrictEqual(snap.brainstorms, []);
  } finally {
    fx.cleanup();
  }
});

// ═══════════════════════════════════════════════════════════════════
// Worktrees
// ═══════════════════════════════════════════════════════════════════

section('worktrees');

test('worktree reports branch, issue, ahead, dirty, lastActivityAt, idleDays, stale', async () => {
  const fx = makeFixture({
    worktrees: [
      { dir: '12-foo', branch: 'feature/12-foo', ahead: 3, dirty: true, lastCommit: daysAgo(2) },
      { dir: '13-old', branch: 'fix/13-old', ahead: 0, dirty: false, lastCommit: daysAgo(45) },
    ],
  });
  try {
    const snap = await ss.collect(fx.opts);
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

test('newer session activity refreshes worktree lastActivityAt', async () => {
  const fx = makeFixture({ worktrees: [{ dir: '14-x', branch: 'feature/14-x', lastCommit: daysAgo(40) }] });
  try {
    writeTranscript(fx, fx.wtPath('14-x'), 's14', { branch: 'feature/14-x', modified: daysAgo(1) });
    const snap = await ss.collect(fx.opts);
    const w = snap.worktrees.find((x) => x.branch === 'feature/14-x');
    assert.strictEqual(w.idleDays, 1);
    assert.strictEqual(w.stale, false);
  } finally {
    fx.cleanup();
  }
});

test('main worktree is never stale', async () => {
  const fx = makeFixture();
  try {
    fx.worktrees[0].lastCommit = daysAgo(90);
    const snap = await ss.collect(fx.opts);
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

test('PR status comes from prSnapshot; red CI or unresolved threads need attention', async () => {
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
    const snap = await ss.collect(fx.opts);
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

test('one failing prSnapshot yields ci:null for that PR only', async () => {
  const fx = makeFixture({
    prs: [
      { number: 1, title: 'Boom', headRefName: 'a', url: 'u1' },
      { number: 2, title: 'Ok', headRefName: 'b', url: 'u2' },
    ],
    snapshots: { 1: new Error('boom') },
  });
  try {
    const snap = await ss.collect(fx.opts);
    assert.strictEqual(snap.prs.length, 2);
    assert.strictEqual(snap.prs.find((p) => p.number === 1).ci, null);
    assert.strictEqual(snap.prs.find((p) => p.number === 2).ci, 'SUCCESS');
  } finally {
    fx.cleanup();
  }
});

section('issues');

const planBody = `## Overview\n\nPlanned work.\n\n${BEGIN}\n\`\`\`json\n{"tasks":[]}\n\`\`\`\n${END}\n`;

test('issues carry title, description, labels, url and plan flag', async () => {
  const fx = makeFixture({
    issues: [
      { number: 40, title: 'Plain', body: '## Overview\n\nJust an idea.', labels: [{ name: 'enhancement' }], url: 'i40' },
      { number: 41, title: 'Planned', body: planBody, labels: [], url: 'i41' },
    ],
  });
  try {
    const snap = await ss.collect(fx.opts);
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

test('exactly one issue is recommended: plan first, then lowest number', async () => {
  const fx = makeFixture({
    issues: [
      { number: 50, title: 'a', body: '', labels: [], url: '' },
      { number: 60, title: 'b', body: planBody, labels: [], url: '' },
      { number: 55, title: 'c', body: planBody, labels: [], url: '' },
    ],
  });
  try {
    const snap = await ss.collect(fx.opts);
    const rec = snap.issues.filter((i) => i.recommended);
    assert.strictEqual(rec.length, 1);
    assert.strictEqual(rec[0].number, 55);
  } finally {
    fx.cleanup();
  }
});

test('without plan issues, lowest number is recommended', async () => {
  const fx = makeFixture({
    issues: [
      { number: 9, title: 'a', body: '', labels: [], url: '' },
      { number: 3, title: 'b', body: '', labels: [], url: '' },
    ],
  });
  try {
    const snap = await ss.collect(fx.opts);
    assert.deepStrictEqual(snap.issues.filter((i) => i.recommended).map((i) => i.number), [3]);
  } finally {
    fx.cleanup();
  }
});

// ═══════════════════════════════════════════════════════════════════
// Ranking
// ═══════════════════════════════════════════════════════════════════

section('ranking');

test('order: attention PR > fresh worktree with work > stale worktree with work > brainstorm > plan issue > issue > merged cleanup', async () => {
  const fx = makeFixture({
    worktrees: [
      { dir: '72-stale', branch: 'feature/72-stale', ahead: 5, lastCommit: daysAgo(60) },
      { dir: '70-work', branch: 'feature/70-work', ahead: 2, lastCommit: daysAgo(1) },
      { dir: '71-idle', branch: 'feature/71-idle', ahead: 0, lastCommit: daysAgo(1) },
      { dir: '73-empty', branch: 'feature/73-empty', ahead: 0, lastCommit: daysAgo(60) },
      { dir: '74-merged', branch: 'feature/74-merged', ahead: 3, head: 'm74' },
    ],
    mergedPrs: [{ number: 75, headRefName: 'feature/74-merged', headRefOid: 'm74' }],
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
    const snap = await ss.collect(fx.opts);
    const seq = snap.ranking.map((r) => `${r.kind}:${r.ref}:${r.action}`);
    assert.deepStrictEqual(seq, [
      'pr:8:hervat',
      'worktree:feature/70-work:hervat',
      'worktree:feature/72-stale:hervat',
      'brainstorm:bs-r:hervat',
      'issue:91:pickup',
      'issue:90:brainstorm',
      'worktree:feature/74-merged:cleanup',
    ]);
    for (const r of snap.ranking) assert.ok(typeof r.label === 'string' && r.label.length > 0);
    assert.deepStrictEqual(snap.next, snap.ranking[0]);
  } finally {
    fx.cleanup();
  }
});

test('next is null when nothing is open', async () => {
  const fx = makeFixture();
  try {
    const snap = await ss.collect(fx.opts);
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

test('snapshot has the documented top-level shape', async () => {
  const fx = makeFixture();
  try {
    const snap = await ss.collect(fx.opts);
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

test('gh missing yields empty prs/issues, never a crash', async () => {
  const fx = makeFixture({ ghThrows: true, worktrees: [{ dir: '1-a', branch: 'feature/1-a' }] });
  try {
    const snap = await ss.collect(fx.opts);
    assert.deepStrictEqual(snap.prs, []);
    assert.deepStrictEqual(snap.issues, []);
    assert.ok(snap.worktrees.length >= 1);
  } finally {
    fx.cleanup();
  }
});

test('git missing yields a usable snapshot with empty worktrees', async () => {
  const fx = makeFixture({ gitThrows: true });
  try {
    const snap = await ss.collect(fx.opts);
    assert.ok(Array.isArray(snap.worktrees));
    assert.strictEqual(snap.repo.root, fx.repoRoot);
  } finally {
    fx.cleanup();
  }
});

test('missing projects root yields no sessions or brainstorms, never a crash', async () => {
  const fx = makeFixture();
  try {
    const snap = await ss.collect({ ...fx.opts, projectsRoot: path.join(fx.base, 'nope') });
    assert.deepStrictEqual(snap.brainstorms, []);
    assert.ok(snap.worktrees.every((w) => w.sessions.length === 0));
  } finally {
    fx.cleanup();
  }
});

test('corrupt transcript and ledger lines are skipped', async () => {
  const fx = makeFixture();
  try {
    const dir = path.join(fx.projectsRoot, ss.encodeProjectDir(fx.repoRoot));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bad.jsonl'), '{not json\n');
    fs.mkdirSync(path.join(fx.repoRoot, '.envoy'), { recursive: true });
    fs.writeFileSync(path.join(fx.repoRoot, '.envoy', 'ledger.jsonl'), 'garbage\n');
    const snap = await ss.collect(fx.opts);
    assert.deepStrictEqual(snap.brainstorms, []);
  } finally {
    fx.cleanup();
  }
});


// ═══════════════════════════════════════════════════════════════════
// Fix round: async PRs, timeouts, in-flight issues, ranking, git hygiene
// ═══════════════════════════════════════════════════════════════════

section('async + parallel PR status');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prList = (n) => Array.from({ length: n }, (_, i) => ({ number: i + 1, title: `P${i + 1}`, headRefName: `b${i + 1}`, url: '' }));

test('collect returns a Promise', async () => {
  const fx = makeFixture();
  try {
    const p = ss.collect(fx.opts);
    assert.ok(p && typeof p.then === 'function', 'returns a thenable');
    await p;
  } finally {
    fx.cleanup();
  }
});

test('async prSnapshot calls run concurrently (4 PRs ≈ one delay)', async () => {
  const fx = makeFixture({
    prs: prList(4),
    prSnapshot: async () => {
      await sleep(150);
      return { ci: { state: 'SUCCESS' }, threads: { unresolved: 0 } };
    },
  });
  try {
    const t0 = Date.now();
    const snap = await ss.collect(fx.opts);
    const ms = Date.now() - t0;
    assert.strictEqual(snap.prs.length, 4);
    assert.ok(snap.prs.every((p) => p.ci === 'SUCCESS'));
    assert.ok(ms < 450, `took ${ms}ms`);
  } finally {
    fx.cleanup();
  }
});

test('PR concurrency is capped at 4', async () => {
  let active = 0;
  let peak = 0;
  const fx = makeFixture({
    prs: prList(10),
    prSnapshot: async () => {
      active++;
      peak = Math.max(peak, active);
      await sleep(20);
      active--;
      return { ci: { state: 'SUCCESS' }, threads: { unresolved: 0 } };
    },
  });
  try {
    const snap = await ss.collect(fx.opts);
    assert.strictEqual(snap.prs.length, 10);
    assert.ok(peak > 1, `peak ${peak}`);
    assert.ok(peak <= 4, `peak ${peak}`);
  } finally {
    fx.cleanup();
  }
});

test('default prSnapshot spawns pr-status.js via execFile in repoRoot with timeout', async () => {
  const fx = makeFixture({ prs: prList(1) });
  const calls = [];
  const execFile = (file, args, options, cb) => {
    calls.push({ file, args, options });
    setImmediate(() => cb(null, JSON.stringify({ ci: { state: 'FAILURE' }, threads: { unresolved: 1 } }), ''));
  };
  try {
    const { prSnapshot, ...rest } = fx.opts;
    const snap = await ss.collect({ ...rest, execFile });
    assert.strictEqual(calls.length, 1);
    const c = calls[0];
    assert.strictEqual(c.file, process.execPath);
    assert.ok(/pr-status\.js$/.test(c.args[0]), c.args[0]);
    assert.strictEqual(c.args[1], '1');
    assert.strictEqual(c.options.cwd, fx.repoRoot);
    assert.strictEqual(c.options.timeout, 15000);
    assert.ok(c.options.maxBuffer >= 16 * 1024 * 1024);
    assert.strictEqual(snap.prs[0].ci, 'FAILURE');
    assert.strictEqual(snap.prs[0].unresolved, 1);
  } finally {
    fx.cleanup();
  }
});

section('timeouts');

test('a timed-out PR gets ci:null while the others still fill', async () => {
  const fx = makeFixture({
    prs: prList(3),
    prSnapshot: async (n) => {
      if (n === 2) {
        const e = new Error('spawnSync timed out');
        e.code = 'ETIMEDOUT';
        throw e;
      }
      return { ci: { state: 'SUCCESS' }, threads: { unresolved: 0 } };
    },
  });
  try {
    const snap = await ss.collect(fx.opts);
    const byN = Object.fromEntries(snap.prs.map((p) => [p.number, p]));
    assert.strictEqual(byN[2].ci, null);
    assert.strictEqual(byN[1].ci, 'SUCCESS');
    assert.strictEqual(byN[3].ci, 'SUCCESS');
  } finally {
    fx.cleanup();
  }
});

test('default runner timeouts: git 5s, gh 15s, pr-status 15s, 16MB maxBuffer', async () => {
  assert.strictEqual(ss.TIMEOUTS.git, 5000);
  assert.strictEqual(ss.TIMEOUTS.gh, 15000);
  assert.strictEqual(ss.TIMEOUTS.prStatus, 15000);
  assert.ok(ss.MAX_BUFFER >= 16 * 1024 * 1024);
});

section('in-flight issues');

test('issue linked to a worktree or open PR is inProgress', async () => {
  const fx = makeFixture({
    worktrees: [{ dir: '40-wt', branch: 'feature/40-wt' }],
    prs: [{ number: 7, title: 'x', headRefName: 'fix/41-pr', url: '' }],
    issues: [
      { number: 40, title: 'a', body: '', labels: [], url: '' },
      { number: 41, title: 'b', body: '', labels: [], url: '' },
      { number: 42, title: 'c', body: '', labels: [], url: '' },
    ],
  });
  try {
    const snap = await ss.collect(fx.opts);
    const byN = Object.fromEntries(snap.issues.map((i) => [i.number, i]));
    assert.strictEqual(byN[40].inProgress, true);
    assert.strictEqual(byN[41].inProgress, true);
    assert.strictEqual(byN[42].inProgress, false);
  } finally {
    fx.cleanup();
  }
});

test('in-flight issues are not ranked and not recommended', async () => {
  const fx = makeFixture({
    worktrees: [{ dir: '50-wt', branch: 'feature/50-wt' }],
    issues: [
      { number: 50, title: 'flight', body: planBody, labels: [], url: '' },
      { number: 51, title: 'free', body: '', labels: [], url: '' },
    ],
  });
  try {
    const snap = await ss.collect(fx.opts);
    assert.deepStrictEqual(snap.issues.filter((i) => i.recommended).map((i) => i.number), [51]);
    const issueRefs = snap.ranking.filter((r) => r.kind === 'issue').map((r) => r.ref);
    assert.deepStrictEqual(issueRefs, [51]);
  } finally {
    fx.cleanup();
  }
});

test('when all issues are in flight, the best one is still recommended', async () => {
  const fx = makeFixture({
    worktrees: [{ dir: '60-a', branch: 'feature/60-a' }, { dir: '61-b', branch: 'feature/61-b' }],
    issues: [
      { number: 60, title: 'a', body: '', labels: [], url: '' },
      { number: 61, title: 'b', body: planBody, labels: [], url: '' },
    ],
  });
  try {
    const snap = await ss.collect(fx.opts);
    assert.deepStrictEqual(snap.issues.filter((i) => i.recommended).map((i) => i.number), [61]);
    assert.deepStrictEqual(snap.ranking.filter((r) => r.kind === 'issue'), []);
  } finally {
    fx.cleanup();
  }
});

section('ranking refinements');

test('worktree with an open PR is represented by the PR, not ranked itself', async () => {
  const fx = makeFixture({
    worktrees: [
      { dir: '70-red', branch: 'feature/70-red', ahead: 2 },
      { dir: '71-green', branch: 'feature/71-green', ahead: 3, dirty: true },
    ],
    prs: [
      { number: 1, title: 'red', headRefName: 'feature/70-red', url: '' },
      { number: 2, title: 'green', headRefName: 'feature/71-green', url: '' },
    ],
    snapshots: { 1: { ci: { state: 'FAILURE' }, threads: { unresolved: 0 } } },
  });
  try {
    const snap = await ss.collect(fx.opts);
    const seq = snap.ranking.map((r) => `${r.kind}:${r.ref}:${r.action}`);
    assert.deepStrictEqual(seq, ['pr:1:hervat']);
  } finally {
    fx.cleanup();
  }
});

test('main worktree is never ranked, even when dirty', async () => {
  const fx = makeFixture();
  try {
    fx.worktrees[0].dirty = true;
    const snap = await ss.collect(fx.opts);
    assert.strictEqual(snap.worktrees[0].dirty, true);
    assert.deepStrictEqual(snap.ranking, []);
  } finally {
    fx.cleanup();
  }
});

test('worktree action: open PR → null (even when stale), stale-empty → null, work → hervat, else null', async () => {
  const fx = makeFixture({
    worktrees: [
      { dir: '80-pr', branch: 'feature/80-pr', ahead: 5, lastCommit: daysAgo(40) },
      { dir: '81-old', branch: 'feature/81-old', lastCommit: daysAgo(40) },
      { dir: '82-work', branch: 'feature/82-work', ahead: 1 },
      { dir: '83-idle', branch: 'feature/83-idle' },
    ],
    prs: [{ number: 8, title: 'pr', headRefName: 'feature/80-pr', url: '' }],
  });
  try {
    const snap = await ss.collect(fx.opts);
    const by = Object.fromEntries(snap.worktrees.map((w) => [w.branch, w]));
    assert.strictEqual(by['feature/80-pr'].action, null);
    assert.strictEqual(by['feature/80-pr'].pr, 8);
    assert.strictEqual(by['feature/81-old'].stale, true);
    assert.strictEqual(by['feature/81-old'].action, null);
    assert.strictEqual(by['feature/82-work'].action, 'hervat');
    assert.strictEqual(by['feature/83-idle'].action, null);
    assert.strictEqual(by['main'].action, null);
  } finally {
    fx.cleanup();
  }
});

test('stale worktree without a merged PR is never cleanup: work → hervat, empty → null', async () => {
  const fx = makeFixture({
    worktrees: [
      { dir: '60-stale-work', branch: 'feature/60-stale-work', ahead: 1, lastCommit: daysAgo(115) },
      { dir: '61-stale-dirty', branch: 'feature/61-stale-dirty', ahead: 0, dirty: true, lastCommit: daysAgo(115) },
      { dir: '62-stale-empty', branch: 'feature/62-stale-empty', ahead: 0, lastCommit: daysAgo(115) },
    ],
  });
  try {
    const snap = await ss.collect(fx.opts);
    const by = Object.fromEntries(snap.worktrees.map((w) => [w.branch, w]));
    assert.strictEqual(by['feature/60-stale-work'].stale, true);
    assert.strictEqual(by['feature/60-stale-work'].action, 'hervat');
    assert.strictEqual(by['feature/61-stale-dirty'].stale, true);
    assert.strictEqual(by['feature/61-stale-dirty'].action, 'hervat');
    assert.strictEqual(by['feature/62-stale-empty'].stale, true);
    assert.strictEqual(by['feature/62-stale-empty'].action, null);
    assert.deepStrictEqual(snap.ranking.filter((r) => r.action === 'cleanup'), []);
    assert.ok(!snap.ranking.some((r) => r.ref === 'feature/62-stale-empty'), 'stale-empty is not ranked');
  } finally {
    fx.cleanup();
  }
});

test('ranking items carry a display label: #N · issue title, PR #N · title, else the label', async () => {
  const fx = makeFixture({
    worktrees: [
      { dir: '93-start', branch: 'feature/93-envoystart-session-dashboard-with-resume', ahead: 3 },
      { dir: '94-gone', branch: 'feature/94-closed-issue', ahead: 1 },
      { dir: 'spike', branch: 'spike/no-issue', ahead: 1 },
    ],
    prs: [{ number: 91, title: 'Red PR title', headRefName: 'feature/80-red', url: '' }],
    snapshots: { 91: { ci: { state: 'FAILURE' }, threads: { unresolved: 0 } } },
    issues: [
      { number: 93, title: '/envoy:start session dashboard', body: '', labels: [], url: '' },
      { number: 5, title: 'Free issue', body: '', labels: [], url: '' },
    ],
  });
  try {
    const snap = await ss.collect(fx.opts);
    const by = Object.fromEntries(snap.ranking.map((r) => [`${r.kind}:${r.ref}`, r]));
    assert.strictEqual(by['pr:91'].display, 'PR #91 · Red PR title');
    assert.strictEqual(by['worktree:feature/93-envoystart-session-dashboard-with-resume'].display, '#93 · /envoy:start session dashboard');
    assert.strictEqual(by['worktree:feature/94-closed-issue'].display, 'feature/94-closed-issue');
    assert.strictEqual(by['worktree:spike/no-issue'].display, 'spike/no-issue');
    assert.strictEqual(by['issue:5'].display, '#5 · Free issue');
    assert.strictEqual(snap.next.display, 'PR #91 · Red PR title');
  } finally {
    fx.cleanup();
  }
});

test('worktree whose PR is merged at its HEAD gets cleanup (not hervat), ranked in the cleanup bucket', async () => {
  const fx = makeFixture({
    worktrees: [{ dir: '91-done', branch: 'feature/91-done', ahead: 9, head: 'm92' }],
    mergedPrs: [{ number: 92, headRefName: 'feature/91-done', headRefOid: 'm92' }],
    issues: [{ number: 5, title: 'next', body: '', labels: [], url: '' }],
  });
  try {
    const snap = await ss.collect(fx.opts);
    const w = snap.worktrees.find((x) => x.branch === 'feature/91-done');
    assert.strictEqual(w.merged, true);
    assert.strictEqual(w.action, 'cleanup');
    const seq = snap.ranking.map((r) => `${r.kind}:${r.ref}:${r.action}`);
    assert.deepStrictEqual(seq, ['issue:5:brainstorm', 'worktree:feature/91-done:cleanup']);
  } finally {
    fx.cleanup();
  }
});

test('an open PR wins over a merged PR on the same branch', async () => {
  const fx = makeFixture({
    worktrees: [{ dir: '95-again', branch: 'feature/95-again', ahead: 2 }],
    prs: [{ number: 97, title: 'again', headRefName: 'feature/95-again', url: '' }],
    mergedPrs: [{ number: 96, headRefName: 'feature/95-again' }],
  });
  try {
    const snap = await ss.collect(fx.opts);
    const w = snap.worktrees.find((x) => x.branch === 'feature/95-again');
    assert.strictEqual(w.merged, false);
    assert.strictEqual(w.action, null);
    assert.deepStrictEqual(snap.ranking, []);
  } finally {
    fx.cleanup();
  }
});

test('merged PR lookup failing is fail-soft: worktree keeps its normal action', async () => {
  const fx = makeFixture({
    worktrees: [{ dir: '98-work', branch: 'feature/98-work', ahead: 1 }],
    mergedThrows: true,
  });
  try {
    const snap = await ss.collect(fx.opts);
    const w = snap.worktrees.find((x) => x.branch === 'feature/98-work');
    assert.strictEqual(w.merged, false);
    assert.strictEqual(w.action, 'hervat');
  } finally {
    fx.cleanup();
  }
});

test('merged PR but uncommitted changes: hervat, never cleanup (would lose work)', async () => {
  const fx = makeFixture({
    worktrees: [{ dir: '91-done', branch: 'feature/91-done', ahead: 9, dirty: true, head: 'm92' }],
    mergedPrs: [{ number: 92, headRefName: 'feature/91-done', headRefOid: 'm92' }],
  });
  try {
    const snap = await ss.collect(fx.opts);
    const w = snap.worktrees.find((x) => x.branch === 'feature/91-done');
    assert.strictEqual(w.merged, true);
    assert.strictEqual(w.action, 'hervat');
  } finally {
    fx.cleanup();
  }
});

test('merged PR lookup asks gh for headRefOid', async () => {
  const calls = [];
  const fx = makeFixture();
  const gh = fx.opts.gh;
  try {
    await ss.collect({ ...fx.opts, gh: (args, cwd) => { calls.push(args.join(' ')); return gh(args, cwd); } });
    const merged = calls.find((c) => c.includes('--state merged'));
    assert.ok(merged && /headRefOid/.test(merged), merged);
  } finally {
    fx.cleanup();
  }
});

test('merged PR whose head HEAD is an ancestor of gets cleanup', async () => {
  const fx = makeFixture({
    worktrees: [{ dir: '91-done', branch: 'feature/91-done', ahead: 4, head: 'h-old', ancestorOf: ['m92'] }],
    mergedPrs: [{ number: 92, headRefName: 'feature/91-done', headRefOid: 'm92' }],
  });
  try {
    const snap = await ss.collect(fx.opts);
    assert.strictEqual(snap.worktrees.find((x) => x.branch === 'feature/91-done').action, 'cleanup');
  } finally {
    fx.cleanup();
  }
});

test('follow-up commits after a merged PR: hervat, not cleanup', async () => {
  const fx = makeFixture({
    worktrees: [{ dir: '91-done', branch: 'feature/91-done', ahead: 10, head: 'h-followup' }],
    mergedPrs: [{ number: 92, headRefName: 'feature/91-done', headRefOid: 'm92' }],
  });
  try {
    const snap = await ss.collect(fx.opts);
    const w = snap.worktrees.find((x) => x.branch === 'feature/91-done');
    assert.strictEqual(w.merged, true);
    assert.strictEqual(w.action, 'hervat');
    assert.deepStrictEqual(snap.ranking.filter((r) => r.action === 'cleanup'), []);
  } finally {
    fx.cleanup();
  }
});

test('merged PR without a headRefOid never yields cleanup', async () => {
  const fx = makeFixture({
    worktrees: [{ dir: '91-done', branch: 'feature/91-done', ahead: 9 }],
    mergedPrs: [{ number: 92, headRefName: 'feature/91-done' }],
  });
  try {
    const snap = await ss.collect(fx.opts);
    assert.strictEqual(snap.worktrees.find((x) => x.branch === 'feature/91-done').action, 'hervat');
  } finally {
    fx.cleanup();
  }
});

test('failed git status → dirty null and no cleanup, even when merged at HEAD', async () => {
  const fx = makeFixture({
    worktrees: [{ dir: '91-done', branch: 'feature/91-done', ahead: 9, head: 'm92', statusThrows: true }],
    mergedPrs: [{ number: 92, headRefName: 'feature/91-done', headRefOid: 'm92' }],
  });
  try {
    const snap = await ss.collect(fx.opts);
    const w = snap.worktrees.find((x) => x.branch === 'feature/91-done');
    assert.strictEqual(w.dirty, null);
    assert.notStrictEqual(w.action, 'cleanup');
  } finally {
    fx.cleanup();
  }
});

test('failed ahead count → ahead null and no cleanup, even when merged at HEAD', async () => {
  const fx = makeFixture({
    worktrees: [{ dir: '91-done', branch: 'feature/91-done', head: 'm92', aheadThrows: true }],
    mergedPrs: [{ number: 92, headRefName: 'feature/91-done', headRefOid: 'm92' }],
  });
  try {
    const snap = await ss.collect(fx.opts);
    const w = snap.worktrees.find((x) => x.branch === 'feature/91-done');
    assert.strictEqual(w.ahead, null);
    assert.strictEqual(w.action, null);
  } finally {
    fx.cleanup();
  }
});

test('unknown git state: null action unless known work (ahead > 0 or dirty)', async () => {
  const fx = makeFixture({
    worktrees: [
      { dir: '40-unknown', branch: 'feature/40-unknown', aheadThrows: true, statusThrows: true, lastCommit: daysAgo(60) },
      { dir: '41-ahead', branch: 'feature/41-ahead', ahead: 2, statusThrows: true },
      { dir: '42-dirty', branch: 'feature/42-dirty', dirty: true, aheadThrows: true },
    ],
  });
  try {
    const snap = await ss.collect(fx.opts);
    const by = Object.fromEntries(snap.worktrees.map((w) => [w.branch, w]));
    assert.strictEqual(by['feature/40-unknown'].ahead, null);
    assert.strictEqual(by['feature/40-unknown'].dirty, null);
    assert.strictEqual(by['feature/40-unknown'].action, null);
    assert.strictEqual(by['feature/41-ahead'].action, 'hervat');
    assert.strictEqual(by['feature/42-dirty'].action, 'hervat');
  } finally {
    fx.cleanup();
  }
});

test('run from inside a worktree (opts.cwd): repoRoot is the main checkout, worktree is not main', async () => {
  const fx = makeFixture({
    worktrees: [{ dir: '12-foo', branch: 'feature/12-foo', ahead: 2 }],
  });
  try {
    const { repoRoot, ...rest } = fx.opts;
    const snap = await ss.collect({ ...rest, cwd: fx.wtPath('12-foo') });
    assert.strictEqual(snap.repo.root, fx.repoRoot);
    const w = snap.worktrees.find((x) => x.branch === 'feature/12-foo');
    assert.strictEqual(w.action, 'hervat', 'treated as main checkout: main never gets an action');
    assert.ok(fx.gitCalls.some((c) => c.args.join(' ') === 'worktree list --porcelain' && c.cwd === fx.wtPath('12-foo')));
  } finally {
    fx.cleanup();
  }
});

section('brainstorm window + scan');

test('ledger brainstorm older than 30 days is dropped', async () => {
  const fx = makeFixture();
  try {
    writeLedger(fx.repoRoot, [
      { ts: daysAgo(45).toISOString(), branch: 'main', type: 'skill-started', skill: 'brainstorm', sessionId: 'ancient' },
      { ts: daysAgo(5).toISOString(), branch: 'main', type: 'skill-started', skill: 'brainstorm', sessionId: 'fresh' },
    ]);
    const snap = await ss.collect(fx.opts);
    assert.deepStrictEqual(snap.brainstorms.map((b) => b.sessionId), ['fresh']);
  } finally {
    fx.cleanup();
  }
});

section('transcript metadata');

test('later cwd change without gitBranch resets the stale branch', async () => {
  const fx = makeFixture({ worktrees: [{ dir: '80-x', branch: 'feature/80-x' }] });
  try {
    const filler = Array.from({ length: 100 }, () => ({ type: 'user', message: { content: 'f'.repeat(2000) } }));
    writeTranscript(fx, fx.repoRoot, 'nobranch', {
      branch: 'main',
      modified: daysAgo(1),
      lines: [...filler, { type: 'user', cwd: fx.wtPath('80-x'), sessionId: 'nobranch', message: { content: 'x' } }],
    });
    const snap = await ss.collect(fx.opts);
    const wt = snap.worktrees.find((w) => w.branch === 'feature/80-x');
    assert.deepStrictEqual(wt.sessions.map((s) => s.sessionId), ['nobranch']);
    assert.notStrictEqual(wt.sessions[0].gitBranch, 'main');
  } finally {
    fx.cleanup();
  }
});

section('git hygiene');

test('ahead counts against origin/<default> when that ref exists', async () => {
  const fx = makeFixture({ worktrees: [{ dir: '90-a', branch: 'feature/90-a', ahead: 1 }] });
  try {
    await ss.collect(fx.opts);
    const rl = fx.gitCalls.find((c) => c.args[0] === 'rev-list');
    assert.ok(rl, 'rev-list called');
    assert.ok(rl.args.includes('origin/main..HEAD'), rl.args.join(' '));
  } finally {
    fx.cleanup();
  }
});

test('ahead falls back to local default when origin ref is missing', async () => {
  const fx = makeFixture({ noOriginRef: true, worktrees: [{ dir: '91-a', branch: 'feature/91-a', ahead: 1 }] });
  try {
    await ss.collect(fx.opts);
    const rl = fx.gitCalls.find((c) => c.args[0] === 'rev-list');
    assert.ok(rl.args.includes('main..HEAD'), rl.args.join(' '));
  } finally {
    fx.cleanup();
  }
});

test('git status uses --no-optional-locks', async () => {
  const fx = makeFixture({ worktrees: [{ dir: '92-a', branch: 'feature/92-a' }] });
  try {
    await ss.collect(fx.opts);
    const st = fx.gitCalls.filter((c) => c.args.includes('status'));
    assert.ok(st.length > 0);
    assert.ok(st.every((c) => c.args[0] === '--no-optional-locks'), JSON.stringify(st.map((c) => c.args)));
  } finally {
    fx.cleanup();
  }
});

runAll().then(() => {
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
});
