#!/usr/bin/env node
/**
 * Pickup preflight — issue number from skill arguments — Test Suite (#89).
 *
 * Run: node tests/skills/pickup-issue-arg.test.js
 *
 * `/envoy:pickup 2497` must reach preflight.js: the Briefing line forwards
 * $ARGUMENTS, and preflight reads the issue number from argv (`2497` or
 * `#2497`), falling back to ENVOY_ISSUE_NUMBER. Anything non-numeric is
 * rejected fatal before it can be used in a path.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

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

const REPO_ROOT = path.join(__dirname, '..', '..');
const PREFLIGHT = path.join(REPO_ROOT, 'skills', 'pickup', 'preflight.js');
const SKILL_MD = path.join(REPO_ROOT, 'skills', 'pickup', 'SKILL.md');

const tmpRoots = [];
function makeTmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pickup-issue-arg-'));
  tmpRoots.push(d);
  return d;
}

function writeTasksFile(dir, issueNumber) {
  const tasks = {
    $schemaVersion: '1',
    issueNumber,
    strategy: 'batch',
    tasks: [{ id: 'task-1', title: 'Add feature', files: ['src/foo.ts'], acceptance: ['works'] }],
  };
  fs.mkdirSync(path.join(dir, '.envoy-tasks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.envoy-tasks', `${issueNumber}.json`), JSON.stringify(tasks));
}

function runPreflight(cwd, args = [], extraEnv = {}) {
  const env = {
    ...process.env,
    ENVOY_REPO_ROOT: REPO_ROOT,
    ENVOY_ISSUE_BODY_FILE: '/nonexistent/no-issue-body.md',
    ...extraEnv,
  };
  if (!('ENVOY_ISSUE_NUMBER' in extraEnv)) delete env.ENVOY_ISSUE_NUMBER;
  let out;
  try {
    out = execFileSync('node', [PREFLIGHT, ...args], { cwd, env, encoding: 'utf8' });
  } catch (err) {
    out = (err.stdout || '') + (err.stderr || '');
  }
  const status = (out.match(/## STATUS: (\w+)/) || [])[1];
  return { status, out };
}

test('SKILL.md Briefing forwards $ARGUMENTS to preflight', () => {
  const md = fs.readFileSync(SKILL_MD, 'utf8');
  assert.match(md, /!`node \$\{CLAUDE_SKILL_DIR\}\/preflight\.js "\$ARGUMENTS"`/);
});

test('bare issue number in argv -> ok, no env var needed', () => {
  const dir = makeTmpDir();
  writeTasksFile(dir, 2497);
  const { status, out } = runPreflight(dir, ['2497']);
  assert.strictEqual(status, 'ok', out);
  assert.ok(fs.existsSync(path.join(dir, '.envoy', 'pickup', 'session.json')), 'session.json written');
});

test('#-prefixed issue number in argv -> ok', () => {
  const dir = makeTmpDir();
  writeTasksFile(dir, 2497);
  const { status, out } = runPreflight(dir, ['#2497']);
  assert.strictEqual(status, 'ok', out);
});

test('quoted single-arg form "#2497 --plan-only" -> ok', () => {
  const dir = makeTmpDir();
  writeTasksFile(dir, 2497);
  const { status, out } = runPreflight(dir, ['#2497 --plan-only']);
  assert.strictEqual(status, 'ok', out);
});

test('empty quoted argument -> falls back to ENVOY_ISSUE_NUMBER', () => {
  const dir = makeTmpDir();
  writeTasksFile(dir, 41);
  const { status, out } = runPreflight(dir, [''], { ENVOY_ISSUE_NUMBER: '41' });
  assert.strictEqual(status, 'ok', out);
});

test('no argv -> falls back to ENVOY_ISSUE_NUMBER', () => {
  const dir = makeTmpDir();
  writeTasksFile(dir, 41);
  const { status, out } = runPreflight(dir, [], { ENVOY_ISSUE_NUMBER: '41' });
  assert.strictEqual(status, 'ok', out);
});

test('neither argv nor env -> fatal with usage hint', () => {
  const dir = makeTmpDir();
  const { status, out } = runPreflight(dir, []);
  assert.strictEqual(status, 'fatal', out);
  assert.match(out, /\/envoy:pickup <issue-number>/);
});

test('non-numeric argument -> fatal, never touches .envoy-tasks', () => {
  const dir = makeTmpDir();
  const { status, out } = runPreflight(dir, ['../../etc/passwd']);
  assert.strictEqual(status, 'fatal', out);
  assert.match(out, /not a valid issue number/);
  assert.ok(!fs.existsSync(path.join(dir, '.envoy')), 'no runtime state written');
});

test('re-invoking pickup for the same issue keeps completed tasks and decisions (resume)', () => {
  const dir = makeTmpDir();
  writeTasksFile(dir, 2497);
  assert.strictEqual(runPreflight(dir, ['2497']).status, 'ok');
  const file = path.join(dir, '.envoy', 'pickup', 'session.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.tasks[0].status = 'done';
  saved.decisions.push({ note: 'chose batch strategy', at: new Date().toISOString() });
  saved.nextSteps.push('run review');
  fs.writeFileSync(file, JSON.stringify(saved, null, 2));
  const { status, out } = runPreflight(dir, ['2497']);
  assert.strictEqual(status, 'ok', out);
  assert.match(out, /Resumed existing session/);
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(after.tasks[0].status, 'done');
  assert.strictEqual(after.decisions.length, 1);
  assert.deepStrictEqual(after.nextSteps, ['run review']);
});

test('session for a different issue is replaced by a fresh seed', () => {
  const dir = makeTmpDir();
  writeTasksFile(dir, 41);
  writeTasksFile(dir, 2497);
  assert.strictEqual(runPreflight(dir, ['41']).status, 'ok');
  const file = path.join(dir, '.envoy', 'pickup', 'session.json');
  const { status, out } = runPreflight(dir, ['2497']);
  assert.strictEqual(status, 'ok', out);
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).issueNumber, 2497);
});

test('invalid existing session -> fatal, file left untouched (progress is never overwritten)', () => {
  const dir = makeTmpDir();
  writeTasksFile(dir, 2497);
  fs.mkdirSync(path.join(dir, '.envoy', 'pickup'), { recursive: true });
  const file = path.join(dir, '.envoy', 'pickup', 'session.json');
  fs.writeFileSync(file, '{not json');
  const { status, out } = runPreflight(dir, ['2497']);
  assert.strictEqual(status, 'fatal', out);
  assert.match(out, /corrupt session state/);
  assert.match(out, /\.envoy\/pickup\/session\.json/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{not json', 'invalid file not overwritten');
});

test('schema-invalid existing session -> fatal, file left untouched', () => {
  const dir = makeTmpDir();
  writeTasksFile(dir, 2497);
  fs.mkdirSync(path.join(dir, '.envoy', 'pickup'), { recursive: true });
  const file = path.join(dir, '.envoy', 'pickup', 'session.json');
  const bad = JSON.stringify({ $schemaVersion: '1', issueNumber: 2497, tasks: 'nope' });
  fs.writeFileSync(file, bad);
  const { status, out } = runPreflight(dir, ['2497']);
  assert.strictEqual(status, 'fatal', out);
  assert.match(out, /invalid session state/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), bad);
});

test('preflight seeds session.json through session-state save() (schema-validated), not a raw write', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'pickup', 'preflight.js'), 'utf8');
  assert.ok(/save:\s*saveSession/.test(src), 'imports save from lib/session-state');
  assert.ok(!/writeJson\('\.envoy\/pickup\/session\.json'/.test(src), 'no raw writeJson of session.json');
  assert.ok(!/existsSession/.test(src), 'no redundant exists() check');
});

test('seeded session validates against lib/schemas/session.json', () => {
  const dir = makeTmpDir();
  writeTasksFile(dir, 2497);
  assert.strictEqual(runPreflight(dir, ['2497']).status, 'ok');
  const { validateFile } = require(path.join(__dirname, '..', '..', 'lib', 'validate-schema'));
  const r = validateFile('session', path.join(dir, '.envoy', 'pickup', 'session.json'));
  assert.ok(r.valid, (r.errors || []).join('; '));
});

for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true });

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
