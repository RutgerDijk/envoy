#!/usr/bin/env node
/**
 * /envoy:start renderer (bin/envoy-start.js) — Test Suite
 *
 * Run: node tests/bin/envoy-start.test.js
 *
 * Never calls real gh/git: `collect` is always injected.
 */

const assert = require('assert');
const path = require('path');

const BIN = path.join(__dirname, '..', '..', 'bin', 'envoy-start.js');

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

let mod;
try {
  mod = require(BIN);
} catch (err) {
  mod = {};
  test('bin/envoy-start.js loads', () => { throw err; });
}

const REPO = 'https://github.com/acme/widgets';

function fixture() {
  return {
    generatedAt: '2026-10-31T10:00:00.000Z',
    repo: { root: '/repo', url: REPO },
    brainstorms: [
      { sessionId: 'aaaa-1111', startedAt: '2026-10-29T10:00:00.000Z', ageDays: 2, topic: 'Design a caching layer for the API gateway', cwd: '/repo' },
    ],
    worktrees: [
      { path: '/repo', branch: 'main', issue: null, ahead: 0, dirty: false, lastActivityAt: '2026-10-31T09:00:00.000Z', idleDays: 0, stale: false, sessions: [] },
      { path: '/repo/.worktrees/93-start', branch: 'feature/93-start-dashboard', issue: 93, ahead: 4, dirty: true, lastActivityAt: '2026-10-31T09:00:00.000Z', idleDays: 0, stale: false,
        sessions: [{ sessionId: 's1', summary: 'x', modified: '2026-10-31T09:00:00.000Z', cwd: '/repo/.worktrees/93-start', gitBranch: 'feature/93-start-dashboard' },
          { sessionId: 's2', summary: 'y', modified: '2026-10-30T09:00:00.000Z', cwd: null, gitBranch: 'unknown' }] },
      { path: '/repo/.worktrees/12-old', branch: 'fix/12-old-thing', issue: 12, ahead: 0, dirty: false, lastActivityAt: '2026-08-01T09:00:00.000Z', idleDays: 91, stale: true, sessions: [] },
    ],
    prs: [
      { number: 101, title: 'feat: start dashboard', url: `${REPO}/pull/101`, branch: 'feature/93-start-dashboard', issue: 93, ci: 'failure', unresolved: 2, needsAttention: true },
      { number: 102, title: 'docs: readme', url: `${REPO}/pull/102`, branch: 'docs/readme', issue: null, ci: 'success', unresolved: 0, needsAttention: false },
    ],
    issues: [
      { number: 7, title: 'Old idea without plan', description: 'Some description', labels: [], url: `${REPO}/issues/7`, plan: false, recommended: false },
      { number: 50, title: 'Planned feature with a fairly long title that may need truncation at narrow widths', description: 'A dimmed one-line description of the planned feature', labels: ['enhancement'], url: `${REPO}/issues/50`, plan: true, recommended: false },
      { number: 60, title: 'Recommended issue', description: 'Do this next', labels: [], url: `${REPO}/issues/60`, plan: true, recommended: true },
    ],
    ranking: [
      { kind: 'pr', ref: 101, label: 'PR #101 feat: start dashboard', action: 'hervat' },
      { kind: 'worktree', ref: 'feature/93-start-dashboard', label: 'feature/93-start-dashboard', action: 'hervat' },
    ],
    next: { kind: 'pr', ref: 101, label: 'PR #101 feat: start dashboard', action: 'hervat' },
  };
}

function emptyFixture() {
  return {
    generatedAt: '2026-10-31T10:00:00.000Z',
    repo: { root: '/repo' },
    brainstorms: [], worktrees: [], prs: [], issues: [], ranking: [], next: null,
  };
}

function capture() {
  const chunks = [];
  return { write: (s) => { chunks.push(String(s)); return true; }, text: () => chunks.join('') };
}

const strip = (s) => s
  .replace(/\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
  .replace(/\x1b\[[0-9;]*m/g, '');

const TITLES = ['Brainstorms without issue', 'Worktrees / branches', 'Open PRs', 'Open issues'];

/** Lines that belong to a box-drawn table (borders, header, rows). */
function tableLines(out) {
  return out.split('\n').filter((l) => /^[┌├└│]/.test(strip(l)));
}

/** Split rendered output into tables: arrays of lines from ┌ to └. */
function tables(out) {
  const result = [];
  let cur = null;
  for (const line of out.split('\n')) {
    const s = strip(line);
    if (s.startsWith('┌')) cur = [line];
    else if (cur) {
      cur.push(line);
      if (s.startsWith('└')) { result.push(cur); cur = null; }
    }
  }
  return result;
}

/** Data rows (│ lines after the header separator) as arrays of stripped, trimmed cells. */
function dataRows(tableLinesArr) {
  const rows = [];
  let afterHeader = false;
  for (const line of tableLinesArr) {
    const s = strip(line);
    if (s.startsWith('├')) { afterHeader = true; continue; }
    if (afterHeader && s.startsWith('│')) {
      rows.push(s.split('│').slice(1, -1).map((c) => c.trim()));
    }
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════════
section('visibleWidth / link');
// ═══════════════════════════════════════════════════════════════════

test('visibleWidth strips SGR codes', () => {
  assert.strictEqual(mod.visibleWidth('\x1b[1;36mabc\x1b[0m'), 3);
});

test('visibleWidth strips OSC 8 links (BEL and ST terminators)', () => {
  assert.strictEqual(mod.visibleWidth('\x1b]8;;https://x.y/1\x07#1\x1b]8;;\x07'), 2);
  assert.strictEqual(mod.visibleWidth('\x1b]8;;https://x.y/1\x1b\\#12\x1b]8;;\x1b\\'), 3);
});

test('visibleWidth counts code points, not UTF-16 units', () => {
  assert.strictEqual(mod.visibleWidth('a…─'), 3);
});

test('link wraps text in an OSC 8 sequence', () => {
  assert.strictEqual(mod.link('#5', 'https://x.y/5'), '\x1b]8;;https://x.y/5\x07#5\x1b]8;;\x07');
});

// ═══════════════════════════════════════════════════════════════════
section('render — structure');
// ═══════════════════════════════════════════════════════════════════

test('four titled tables appear in order, followed by NEXT STEP', () => {
  const out = strip(mod.render(fixture(), { width: 120 }));
  let pos = -1;
  for (const t of TITLES) {
    const i = out.indexOf(t);
    assert.ok(i > pos, `title "${t}" missing or out of order`);
    pos = i;
  }
  const next = out.indexOf('NEXT STEP');
  assert.ok(next > pos, 'NEXT STEP missing or not after the tables');
  assert.strictEqual(tables(mod.render(fixture(), { width: 120 })).length, 4);
});

test('NEXT STEP line shows the action verb and label', () => {
  const out = strip(mod.render(fixture(), { width: 120 }));
  assert.match(out, /NEXT STEP\s+hervat\s+PR #101 feat: start dashboard/);
});

test('NEXT STEP with next=null suggests /envoy:brainstorm', () => {
  const out = strip(mod.render(emptyFixture(), { width: 120 }));
  assert.match(out, /NEXT STEP.*nothing open.*\/envoy:brainstorm/);
});

test('box-drawing characters are used', () => {
  const out = mod.render(fixture(), { width: 120 });
  for (const ch of '┌─┬┐│├┼┤└┴┘') assert.ok(out.includes(ch), `missing ${ch}`);
});

// ═══════════════════════════════════════════════════════════════════
section('render — links');
// ═══════════════════════════════════════════════════════════════════

test('PR numbers are OSC 8 links to the PR url', () => {
  const out = mod.render(fixture(), { width: 120 });
  assert.ok(out.includes(`\x1b]8;;${REPO}/pull/101\x07#101\x1b]8;;\x07`), 'PR #101 link missing');
  assert.ok(out.includes(`\x1b]8;;${REPO}/pull/102\x07#102\x1b]8;;\x07`), 'PR #102 link missing');
});

test('issue numbers are OSC 8 links to the issue url', () => {
  const out = mod.render(fixture(), { width: 120 });
  for (const n of [7, 50, 60]) {
    assert.ok(out.includes(`\x1b]8;;${REPO}/issues/${n}\x07#${n}\x1b]8;;\x07`), `issue #${n} link missing`);
  }
});

test('worktree issue column links to repo.url/issues/N', () => {
  const out = mod.render(fixture(), { width: 120 });
  const wt = tables(out)[1].join('\n');
  assert.ok(wt.includes(`\x1b]8;;${REPO}/issues/93\x07#93\x1b]8;;\x07`), 'worktree #93 link missing');
});

test('worktree issue without repo.url is plain text', () => {
  const snap = fixture();
  delete snap.repo.url;
  const wt = tables(mod.render(snap, { width: 120 }))[1].join('\n');
  assert.ok(!wt.includes('\x1b]8;;'), 'unexpected link');
  assert.ok(strip(wt).includes('#93'));
});

// ═══════════════════════════════════════════════════════════════════
section('render — alignment');
// ═══════════════════════════════════════════════════════════════════

for (const width of [140, 100, 80, 60]) {
  test(`every line of a table has equal visibleWidth (width ${width}, ANSI + links)`, () => {
    const out = mod.render(fixture(), { width });
    for (const t of tables(out)) {
      const widths = t.map((l) => mod.visibleWidth(l));
      assert.ok(widths.every((w) => w === widths[0]), `misaligned: ${widths.join(',')}\n${strip(t.join('\n'))}`);
      assert.ok(widths[0] <= width, `table width ${widths[0]} exceeds ${width}`);
    }
  });
}

test('long cells are truncated with an ellipsis at narrow widths', () => {
  const out = strip(mod.render(fixture(), { width: 60 }));
  assert.ok(out.includes('…'), 'no ellipsis');
  assert.ok(!out.includes('may need truncation at narrow widths'), 'long title not truncated');
});

test('alignment also holds with color disabled', () => {
  const out = mod.render(fixture(), { width: 80, color: false });
  for (const t of tables(out)) {
    const widths = t.map((l) => mod.visibleWidth(l));
    assert.ok(widths.every((w) => w === widths[0]), `misaligned: ${widths.join(',')}`);
  }
});

// ═══════════════════════════════════════════════════════════════════
section('render — content');
// ═══════════════════════════════════════════════════════════════════

test('Action column contains only allowed verbs or —', () => {
  const allowed = new Set(['hervat', 'pickup', 'brainstorm', 'cleanup', '—']);
  const out = mod.render(fixture(), { width: 140 });
  for (const t of tables(out)) {
    for (const row of dataRows(t)) {
      const action = row[row.length - 1];
      assert.ok(allowed.has(action), `unexpected action "${action}"`);
    }
  }
});

test('worktree actions: hervat when ahead/dirty, cleanup when stale, — otherwise', () => {
  const rows = dataRows(tables(mod.render(fixture(), { width: 140 }))[1]);
  const byBranch = Object.fromEntries(rows.map((r) => [r[0], r[r.length - 1]]));
  assert.strictEqual(byBranch['main'], '—');
  assert.strictEqual(byBranch['feature/93-start-dashboard'], 'hervat');
  assert.strictEqual(byBranch['fix/12-old-thing'], 'cleanup');
});

test('worktree sessions column shows the count', () => {
  const rows = dataRows(tables(mod.render(fixture(), { width: 140 }))[1]);
  const row = rows.find((r) => r[0] === 'feature/93-start-dashboard');
  assert.ok(row.includes('2'), `sessions count missing: ${row.join('|')}`);
});

test('PR actions: hervat when needsAttention else —', () => {
  const rows = dataRows(tables(mod.render(fixture(), { width: 140 }))[2]);
  assert.strictEqual(rows[0][0], '#101');
  assert.strictEqual(rows[0][rows[0].length - 1], 'hervat');
  assert.strictEqual(rows[1][rows[1].length - 1], '—');
});

test('brainstorm row shows topic, age and hervat', () => {
  const rows = dataRows(tables(mod.render(fixture(), { width: 140 }))[0]);
  assert.strictEqual(rows.length, 1);
  assert.match(rows[0][0], /Design a caching layer/);
  assert.match(rows[0][1], /2d/);
  assert.strictEqual(rows[0][2], 'hervat');
});

test('issues: recommended first, then planned, then by number; pickup/brainstorm actions', () => {
  const rows = dataRows(tables(mod.render(fixture(), { width: 140 }))[3]);
  const nums = rows.map((r) => r[0].replace(/^>\s*/, ''));
  assert.deepStrictEqual(nums, ['#60', '#50', '#7']);
  assert.ok(rows[0][0].startsWith('>'), 'recommended row not marked with >');
  assert.ok(!rows[1][0].startsWith('>'));
  assert.strictEqual(rows[0][rows[0].length - 1], 'pickup');
  assert.strictEqual(rows[1][rows[1].length - 1], 'pickup');
  assert.strictEqual(rows[2][rows[2].length - 1], 'brainstorm');
  assert.strictEqual(rows[0][2], 'yes');
  assert.strictEqual(rows[2][2], 'no');
});

test('issue title cell includes the description', () => {
  const rows = dataRows(tables(mod.render(fixture(), { width: 160 }))[3]);
  assert.match(rows[0][1], /Recommended issue.*Do this next/);
});

test('status colours: CI failure red, dirty yellow', () => {
  const out = mod.render(fixture(), { width: 140 });
  assert.ok(/\x1b\[31m[^\x1b]*failure/.test(out), 'CI failure not red');
  assert.ok(/\x1b\[33m[^\x1b]*yes/.test(tables(out)[1].join('\n')), 'dirty not yellow');
});

test('empty sections render a dimmed placeholder row', () => {
  const out = mod.render(emptyFixture(), { width: 100 });
  const ts = tables(out);
  assert.strictEqual(ts.length, 4);
  for (const t of ts) {
    const body = t.filter((l) => strip(l).startsWith('│')).slice(1); // skip header
    assert.strictEqual(body.length, 1, 'expected one placeholder row');
    assert.ok(body[0].includes('\x1b[2m'), 'placeholder not dimmed');
    assert.ok(mod.visibleWidth(body[0]) === mod.visibleWidth(t[0]), 'placeholder misaligned');
  }
});

test('no emoji in output', () => {
  for (const snap of [fixture(), emptyFixture()]) {
    const out = mod.render(snap, { width: 100 });
    assert.ok(!/\p{Extended_Pictographic}/u.test(out), 'emoji found');
  }
});

test('color:false emits no SGR and no OSC 8 sequences but keeps box chars', () => {
  const out = mod.render(fixture(), { width: 120, color: false });
  assert.ok(!out.includes('\x1b'), 'escape sequence present');
  assert.ok(out.includes('┌') && out.includes('#101'));
});

// ═══════════════════════════════════════════════════════════════════
section('main');
// ═══════════════════════════════════════════════════════════════════

test('--json prints the raw snapshot', () => {
  const stdout = capture();
  const snap = fixture();
  const code = mod.main(['--json'], { collect: () => snap, stdout, stderr: capture(), env: {} });
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(JSON.parse(stdout.text()), snap);
});

test('default prints the dashboard', () => {
  const stdout = capture();
  const code = mod.main([], { collect: fixture, stdout, stderr: capture(), env: {}, width: 120 });
  assert.strictEqual(code, 0);
  assert.ok(stdout.text().includes('\x1b['), 'expected colour by default');
  assert.ok(strip(stdout.text()).includes('NEXT STEP'));
});

test('NO_COLOR env disables colour and links', () => {
  const stdout = capture();
  mod.main([], { collect: fixture, stdout, stderr: capture(), env: { NO_COLOR: '1' }, width: 120 });
  assert.ok(!stdout.text().includes('\x1b'), 'escape sequence present under NO_COLOR');
  assert.ok(stdout.text().includes('NEXT STEP'));
});

test('collect throwing: error on stderr, empty dashboard, exit 0', () => {
  const stdout = capture();
  const stderr = capture();
  const code = mod.main([], { collect: () => { throw new Error('boom'); }, stdout, stderr, env: {}, width: 100 });
  assert.strictEqual(code, 0);
  assert.match(stderr.text(), /boom/);
  assert.strictEqual(tables(stdout.text()).length, 4);
  assert.match(strip(stdout.text()), /nothing open/);
});

test('collect is called with the repo root option', () => {
  let got = null;
  mod.main(['--json'], { collect: (o) => { got = o; return emptyFixture(); }, stdout: capture(), stderr: capture(), env: {}, cwd: '/some/dir' });
  assert.ok(got && got.repoRoot === '/some/dir', `repoRoot not passed: ${JSON.stringify(got)}`);
});

// ═══════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
