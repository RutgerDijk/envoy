#!/usr/bin/env node
/**
 * Worktree Migration — Real git-worktree integration test.
 *
 * Exercises lib/worktree-state against an actual `git worktree add` (not a
 * tmpdir-only stub): seeds .envoy/ in the main checkout, migrates it, and
 * asserts it lands in the worktree and leaves main. Also drives assertInWorktree
 * with the REAL default `git worktree list` so the guard genuinely proves the
 * git integration. Finally a contract check that skills/pickup/steps/worktree.md
 * wires migrateEnvoyState in, so the pickup step can't silently regress.
 *
 * Run: node tests/scripts/worktree-migration.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'lib');
const WORKTREE_STEP = path.join(REPO_ROOT, 'skills', 'pickup', 'steps', 'worktree.md');

const worktreeState = require(path.join(LIB, 'worktree-state'));

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

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/**
 * Build a throwaway git repo with a real feature worktree.
 * Returns { root, mainCheckout, worktreeDir }.
 */
function makeRepoWithWorktree() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-integ-')));
  const mainCheckout = path.join(root, 'main');
  fs.mkdirSync(mainCheckout, { recursive: true });

  git(mainCheckout, 'init', '-q', '-b', 'main');
  git(mainCheckout, 'config', 'user.email', 'test@example.com');
  git(mainCheckout, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(mainCheckout, 'README.md'), '# seed\n');
  git(mainCheckout, 'add', 'README.md');
  git(mainCheckout, 'commit', '-q', '-m', 'initial');

  git(mainCheckout, 'branch', 'feature/42-topic');
  const worktreeDir = path.join(mainCheckout, '.worktrees', '42-topic');
  git(mainCheckout, 'worktree', 'add', '-q', worktreeDir, 'feature/42-topic');

  return { root, mainCheckout, worktreeDir };
}

// ═══════════════════════════════════════════════════════════════════
// Migration against a real worktree
// ═══════════════════════════════════════════════════════════════════

section('migrateEnvoyState against a real git worktree');

test('.envoy migrates into the worktree and leaves the main checkout', () => {
  const { root, mainCheckout, worktreeDir } = makeRepoWithWorktree();
  try {
    fs.mkdirSync(path.join(mainCheckout, '.envoy'), { recursive: true });
    fs.writeFileSync(path.join(mainCheckout, '.envoy', 'marker.txt'), 'MIGRATED_MARKER');

    worktreeState.migrateEnvoyState(mainCheckout, worktreeDir);

    assert.ok(
      !fs.existsSync(path.join(mainCheckout, '.envoy')),
      'main checkout .envoy should be gone'
    );
    const migrated = path.join(worktreeDir, '.envoy', 'marker.txt');
    assert.ok(fs.existsSync(migrated), 'worktree .envoy/marker.txt should exist');
    assert.strictEqual(
      fs.readFileSync(migrated, 'utf8'),
      'MIGRATED_MARKER',
      'marker contents preserved through migration'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Guard against the REAL `git worktree list`
// ═══════════════════════════════════════════════════════════════════

section('assertInWorktree with the real git-worktree list');

test('passes when cwd is the real registered worktree', () => {
  const { root, worktreeDir } = makeRepoWithWorktree();
  try {
    assert.doesNotThrow(
      () => worktreeState.assertInWorktree(worktreeDir, { cwd: worktreeDir }),
      'the registered worktree must pass the guard using real `git worktree list`'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('aborts when cwd is the main checkout (a different registered path)', () => {
  const { root, mainCheckout, worktreeDir } = makeRepoWithWorktree();
  try {
    assert.throws(
      () => worktreeState.assertInWorktree(worktreeDir, { cwd: mainCheckout }),
      /worktree/i,
      'running from the main checkout must abort the worktree guard'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Wiring contract — pickup step must invoke the migration
// ═══════════════════════════════════════════════════════════════════

section('pickup worktree step wires the migration');

test('worktree.md references migrateEnvoyState', () => {
  const md = fs.readFileSync(WORKTREE_STEP, 'utf8');
  assert.ok(
    /migrateEnvoyState/.test(md),
    'skills/pickup/steps/worktree.md must call migrateEnvoyState so state is relocated into the worktree'
  );
});

test('worktree.md documents the assertInWorktree guard on state writes', () => {
  const md = fs.readFileSync(WORKTREE_STEP, 'utf8');
  assert.ok(
    /assertInWorktree/.test(md),
    'worktree.md must reference assertInWorktree so the state-write invariant is documented'
  );
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
