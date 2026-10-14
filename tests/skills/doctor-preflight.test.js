#!/usr/bin/env node
/**
 * Doctor preflight — Test Suite.
 *
 * Run: node tests/skills/doctor-preflight.test.js
 *
 * doctor is a new rigid skill for repo-hygiene reporting/fixing (consumer
 * repos onboarded before #71/#72 may still track .envoy-tasks/*.json and
 * .envoy/** in git). preflight.js gates entry:
 *   - not run inside a git repo                        -> fatal
 *   - --fix requested on a dirty worktree               -> fatal (--fix only)
 *   - otherwise                                         -> ok (report-only
 *     works even on a dirty worktree, since it mutates nothing)
 *
 * --fix is requested as a skill argument (the Briefing line forwards
 * "$ARGUMENTS") or via the ENVOY_DOCTOR_FIX=1 env-var fallback.
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
const PREFLIGHT = path.join(REPO_ROOT, 'skills', 'doctor', 'preflight.js');

const tmpRoots = [];
function makeTmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-preflight-'));
  tmpRoots.push(d);
  return d;
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function initRepo() {
  const dir = makeTmpDir();
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# hi\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

function runPreflight(cwd, extraEnv = {}, args = []) {
  const env = { ...process.env, ENVOY_REPO_ROOT: REPO_ROOT, ...extraEnv };
  if (!('ENVOY_DOCTOR_FIX' in extraEnv)) delete env.ENVOY_DOCTOR_FIX;
  let out;
  try {
    out = execFileSync('node', [PREFLIGHT, ...args], { cwd, env, encoding: 'utf8' });
  } catch (err) {
    out = (err.stdout || '') + (err.stderr || '');
  }
  const status = (out.match(/## STATUS: (\w+)/) || [])[1];
  return { status, out };
}

test('outside a git repo -> fatal', () => {
  const dir = makeTmpDir(); // not a git repo
  const { status, out } = runPreflight(dir);
  assert.strictEqual(status, 'fatal');
  assert.ok(/git repo/i.test(out));
});

test('clean worktree, no --fix -> ok', () => {
  const dir = initRepo();
  const { status } = runPreflight(dir);
  assert.strictEqual(status, 'ok');
});

test('dirty worktree, no --fix -> ok (report-only works regardless)', () => {
  const dir = initRepo();
  fs.writeFileSync(path.join(dir, 'README.md'), '# changed\n');
  const { status } = runPreflight(dir);
  assert.strictEqual(status, 'ok');
});

test('dirty worktree, --fix -> fatal', () => {
  const dir = initRepo();
  fs.writeFileSync(path.join(dir, 'README.md'), '# changed\n');
  const { status, out } = runPreflight(dir, { ENVOY_DOCTOR_FIX: '1' });
  assert.strictEqual(status, 'fatal');
  assert.ok(/uncommitted|dirty/i.test(out));
});

test('clean worktree, --fix -> ok', () => {
  const dir = initRepo();
  const { status } = runPreflight(dir, { ENVOY_DOCTOR_FIX: '1' });
  assert.strictEqual(status, 'ok');
});

test('SKILL.md Briefing forwards $ARGUMENTS to preflight (#89)', () => {
  const md = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'doctor', 'SKILL.md'), 'utf8');
  assert.match(md, /!`node \$\{CLAUDE_SKILL_DIR\}\/preflight\.js "\$ARGUMENTS"`/);
});

test('dirty worktree, --fix as skill argument -> fatal (#89)', () => {
  const dir = initRepo();
  fs.writeFileSync(path.join(dir, 'README.md'), '# changed\n');
  const { status, out } = runPreflight(dir, {}, ['--fix']);
  assert.strictEqual(status, 'fatal', out);
  assert.ok(/uncommitted|dirty/i.test(out));
});

test('dirty worktree, --fix inside a quoted "$ARGUMENTS" string -> fatal (#89)', () => {
  const dir = initRepo();
  fs.writeFileSync(path.join(dir, 'README.md'), '# changed\n');
  const { status } = runPreflight(dir, {}, ['--verbose --fix']);
  assert.strictEqual(status, 'fatal');
});

test('dirty worktree, empty quoted argument -> ok (report-only) (#89)', () => {
  const dir = initRepo();
  fs.writeFileSync(path.join(dir, 'README.md'), '# changed\n');
  const { status } = runPreflight(dir, {}, ['']);
  assert.strictEqual(status, 'ok');
});

for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
