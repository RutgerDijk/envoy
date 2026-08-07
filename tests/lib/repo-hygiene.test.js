#!/usr/bin/env node
/**
 * repo-hygiene — Test Suite.
 *
 * Run: node tests/lib/repo-hygiene.test.js
 *
 * Backs the /envoy:doctor skill: finds tracked Envoy runtime-state files
 * that predate the .gitignore rules landed in #71/#72, checks whether
 * .gitignore has the required entries, and plans (without executing) the
 * `--fix` remediation.
 *
 * findTrackedEnvoyFiles() shells out to `git ls-files` and needs a real
 * scratch git repo — those tests are integration-style. checkGitignoreEntries,
 * planFix, and parseIssueNumberFromTaskFile are pure/near-pure and tested
 * with fixture strings/dirs, no real git required.
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

const LIB = path.join(__dirname, '..', '..', 'lib');
const {
  findTrackedEnvoyFiles,
  checkGitignoreEntries,
  planFix,
  parseIssueNumberFromTaskFile,
} = require(path.join(LIB, 'repo-hygiene'));

const tmpRoots = [];
function makeTmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-hygiene-'));
  tmpRoots.push(d);
  return d;
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function initScratchRepo() {
  const dir = makeTmpDir();
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  return dir;
}

// ---------------------------------------------------------------------------
// checkGitignoreEntries — pure, fixture-based
// ---------------------------------------------------------------------------

test('checkGitignoreEntries: missing .gitignore reports both entries missing', () => {
  const dir = makeTmpDir();
  const gaps = checkGitignoreEntries(dir);
  assert.deepStrictEqual(gaps.sort(), ['.envoy-tasks/', '.envoy/'].sort());
});

test('checkGitignoreEntries: .gitignore with both entries reports no gaps', () => {
  const dir = makeTmpDir();
  fs.writeFileSync(path.join(dir, '.gitignore'), '.envoy/\n.envoy-tasks/\n');
  const gaps = checkGitignoreEntries(dir);
  assert.deepStrictEqual(gaps, []);
});

test('checkGitignoreEntries: .gitignore with only one entry reports the other missing', () => {
  const dir = makeTmpDir();
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n.envoy/\n');
  const gaps = checkGitignoreEntries(dir);
  assert.deepStrictEqual(gaps, ['.envoy-tasks/']);
});

// ---------------------------------------------------------------------------
// parseIssueNumberFromTaskFile — pure
// ---------------------------------------------------------------------------

test('parseIssueNumberFromTaskFile: extracts issue number from filename', () => {
  assert.strictEqual(parseIssueNumberFromTaskFile('.envoy-tasks/42.json'), 42);
  assert.strictEqual(parseIssueNumberFromTaskFile('42.json'), 42);
});

test('parseIssueNumberFromTaskFile: returns null for non-matching filename', () => {
  assert.strictEqual(parseIssueNumberFromTaskFile('.envoy-tasks/not-a-number.json'), null);
});

// ---------------------------------------------------------------------------
// planFix — pure, no git side effects
// ---------------------------------------------------------------------------

test('planFix: no tracked files, no gaps -> empty plan', () => {
  const plan = planFix([], []);
  assert.deepStrictEqual(plan.rmCached, []);
  assert.deepStrictEqual(plan.gitignoreAppend, []);
});

test('planFix: tracked files -> rmCached lists them verbatim', () => {
  const plan = planFix(['.envoy-tasks/42.json', '.envoy/ledger.jsonl'], []);
  assert.deepStrictEqual(plan.rmCached, ['.envoy-tasks/42.json', '.envoy/ledger.jsonl']);
});

test('planFix: gitignore gaps -> gitignoreAppend lists missing entries', () => {
  const plan = planFix([], ['.envoy/', '.envoy-tasks/']);
  assert.deepStrictEqual(plan.gitignoreAppend, ['.envoy/', '.envoy-tasks/']);
});

test('planFix: does not touch the filesystem or git', () => {
  const dir = makeTmpDir();
  const before = fs.readdirSync(dir);
  planFix(['.envoy-tasks/42.json'], ['.envoy/']);
  const after = fs.readdirSync(dir);
  assert.deepStrictEqual(before, after);
});

// ---------------------------------------------------------------------------
// findTrackedEnvoyFiles — integration-style, real scratch git repo
// ---------------------------------------------------------------------------

test('findTrackedEnvoyFiles: returns tracked .envoy-tasks/*.json and .envoy/** paths', () => {
  const dir = initScratchRepo();
  fs.mkdirSync(path.join(dir, '.envoy-tasks'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.envoy'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.envoy-tasks', '42.json'), '{}');
  fs.writeFileSync(path.join(dir, '.envoy', 'active-skill.json'), '{}');
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), '// ok');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);

  const tracked = findTrackedEnvoyFiles(dir);
  assert.deepStrictEqual(
    tracked.sort(),
    ['.envoy-tasks/42.json', '.envoy/active-skill.json'].sort(),
  );
});

test('findTrackedEnvoyFiles: returns empty array when nothing tracked under those paths', () => {
  const dir = initScratchRepo();
  fs.writeFileSync(path.join(dir, 'README.md'), '# hi');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);

  const tracked = findTrackedEnvoyFiles(dir);
  assert.deepStrictEqual(tracked, []);
});

for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
