#!/usr/bin/env node
/**
 * lib/session-state.js — task reconciliation and CLI (#94 review).
 *
 * The rigid pickup steps no longer require the lib inline: they call
 * `node lib/session-state.js <command>`. Re-invoking pickup after the issue's
 * task list changed reconciles the session by task id.
 *
 * Run: node tests/lib/session-state-cli.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const LIB = path.join(__dirname, '..', '..', 'lib', 'session-state.js');
const session = require(LIB);

let passed = 0;
let failed = 0;
const tmpDirs = [];

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

/** Temp git repo with a seeded session for issue 7 and a tasks file. */
function seed({ branch = 'feature/7-x', sessionTasks, issueTasks }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-cli-'));
  tmpDirs.push(dir);
  execFileSync('git', ['init', '-q', '-b', branch], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.envoy', 'pickup'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.envoy-tasks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.envoy', 'pickup', 'session.json'), JSON.stringify({
    $schemaVersion: '1', branch: 'unknown', plan: 'issue #7', issueNumber: 7,
    tasks: sessionTasks, decisions: [], nextSteps: [],
  }));
  fs.writeFileSync(path.join(dir, '.envoy-tasks', '7.json'), JSON.stringify({ tasks: issueTasks }));
  return dir;
}

const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.envoy', 'pickup', 'session.json'), 'utf8'));
const cli = (dir, ...args) => spawnSync('node', [LIB, ...args], { cwd: dir, encoding: 'utf8' });

section('reconcileTasks: the session follows the issue task list by id');

test('keeps status of kept tasks, renames, adds new as pending, drops removed', () => {
  const r = session.reconcileTasks(
    [
      { id: 't1', name: 'One', status: 'done', summary: 'did it' },
      { id: 't2', name: 'Two', status: 'in_progress' },
      { id: 't3', name: 'Three', status: 'pending' },
    ],
    [{ id: 't1', title: 'One' }, { id: 't2', title: 'Two, renamed' }, { id: 't4', title: 'Four' }],
  );
  assert.deepStrictEqual(r.tasks.map((t) => [t.id, t.name, t.status]), [
    ['t1', 'One', 'done'], ['t2', 'Two, renamed', 'in_progress'], ['t4', 'Four', 'pending'],
  ]);
  assert.strictEqual(r.tasks[0].summary, 'did it');
  assert.deepStrictEqual(r.added, ['t4']);
  assert.deepStrictEqual(r.removed, ['t3']);
  assert.deepStrictEqual(r.renamed, ['t2']);
  assert.strictEqual(r.changed, true);
});

test('an unchanged list reports no change', () => {
  const r = session.reconcileTasks([{ id: 't1', name: 'One', status: 'done' }], [{ id: 't1', title: 'One' }]);
  assert.strictEqual(r.changed, false);
});

section('CLI');

test('sync sets the branch from git and reconciles with .envoy-tasks/<issue>.json', () => {
  const dir = seed({
    sessionTasks: [{ id: 't1', name: 'One', status: 'done' }, { id: 't3', name: 'Three', status: 'pending' }],
    issueTasks: [{ id: 't1', title: 'One' }, { id: 't2', title: 'Two' }],
  });
  const r = cli(dir, 'sync');
  assert.strictEqual(r.status, 0, r.stderr);
  const s = read(dir);
  assert.strictEqual(s.branch, 'feature/7-x');
  assert.deepStrictEqual(s.tasks.map((t) => t.id), ['t1', 't2']);
  assert.match(r.stdout, /1\/2 tasks done/);
  assert.match(r.stdout, /added t2/);
  assert.match(r.stdout, /removed t3/);
});

test('next-steps replaces the next steps', () => {
  const dir = seed({ sessionTasks: [], issueTasks: [] });
  const r = cli(dir, 'next-steps', 'Run envoy:review', 'Run envoy:finalize');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(read(dir).nextSteps, ['Run envoy:review', 'Run envoy:finalize']);
});

test('task sets a task status and summary', () => {
  const dir = seed({ sessionTasks: [{ id: 't1', name: 'One', status: 'pending' }], issueTasks: [] });
  const r = cli(dir, 'task', 't1', 'done', 'Added the parser');
  assert.strictEqual(r.status, 0, r.stderr);
  const t = read(dir).tasks[0];
  assert.strictEqual(t.status, 'done');
  assert.strictEqual(t.summary, 'Added the parser');
});

test('decision appends a decision note', () => {
  const dir = seed({ sessionTasks: [], issueTasks: [] });
  assert.strictEqual(cli(dir, 'decision', 'Used batch strategy').status, 0);
  assert.strictEqual(read(dir).decisions[0].note, 'Used batch strategy');
});

test('an invalid status is a usage error (exit 64) and writes nothing', () => {
  const dir = seed({ sessionTasks: [{ id: 't1', name: 'One', status: 'pending' }], issueTasks: [] });
  const before = fs.readFileSync(path.join(dir, '.envoy', 'pickup', 'session.json'), 'utf8');
  const r = cli(dir, 'task', 't1', 'finished');
  assert.strictEqual(r.status, 64);
  assert.strictEqual(fs.readFileSync(path.join(dir, '.envoy', 'pickup', 'session.json'), 'utf8'), before);
});

test('a corrupt session file fails (exit 1) with the path, and is left untouched', () => {
  const dir = seed({ sessionTasks: [], issueTasks: [] });
  const file = path.join(dir, '.envoy', 'pickup', 'session.json');
  fs.writeFileSync(file, '{nope');
  const r = cli(dir, 'sync');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /session\.json/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{nope');
});

test('lib/session-state.js starts with a node shebang', () => {
  assert.ok(fs.readFileSync(LIB, 'utf8').startsWith('#!/usr/bin/env node'));
});

for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
