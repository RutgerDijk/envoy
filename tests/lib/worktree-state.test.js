#!/usr/bin/env node
/**
 * Worktree State — Test Suite
 *
 * Run: node tests/lib/worktree-state.test.js
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

function makeTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ═══════════════════════════════════════════════════════════════════
// Load module
// ═══════════════════════════════════════════════════════════════════

const worktreeState = require(path.join(LIB, 'worktree-state'));

// ═══════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════

section('exports');

test('migrateEnvoyState is exported', () => {
  assert.strictEqual(typeof worktreeState.migrateEnvoyState, 'function');
});

test('assertInWorktree is exported', () => {
  assert.strictEqual(typeof worktreeState.assertInWorktree, 'function');
});

// ═══════════════════════════════════════════════════════════════════
// migrateEnvoyState
// ═══════════════════════════════════════════════════════════════════

section('migrateEnvoyState: move .envoy main → worktree');

test('moves .envoy from main into worktree and removes from main', () => {
  const root = makeTmp('wt-migrate-');
  const mainDir = path.join(root, 'main');
  const worktreeDir = path.join(root, 'wt');
  fs.mkdirSync(mainDir, { recursive: true });
  fs.mkdirSync(worktreeDir, { recursive: true });
  fs.mkdirSync(path.join(mainDir, '.envoy'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.envoy', 'state.json'), '{"a":1}');

  worktreeState.migrateEnvoyState(mainDir, worktreeDir);

  assert.ok(!fs.existsSync(path.join(mainDir, '.envoy')), 'main/.envoy should be gone');
  assert.ok(fs.existsSync(path.join(worktreeDir, '.envoy')), 'worktree/.envoy should exist');
  assert.strictEqual(
    fs.readFileSync(path.join(worktreeDir, '.envoy', 'state.json'), 'utf8'),
    '{"a":1}',
    'contents should be preserved'
  );
  cleanup(root);
});

test('no-op when main has no .envoy (does not throw)', () => {
  const root = makeTmp('wt-migrate-');
  const mainDir = path.join(root, 'main');
  const worktreeDir = path.join(root, 'wt');
  fs.mkdirSync(mainDir, { recursive: true });
  fs.mkdirSync(worktreeDir, { recursive: true });

  assert.doesNotThrow(() => worktreeState.migrateEnvoyState(mainDir, worktreeDir));
  assert.ok(!fs.existsSync(path.join(worktreeDir, '.envoy')), 'no .envoy created');
  cleanup(root);
});

test('replaces pre-existing worktree/.envoy without crashing', () => {
  const root = makeTmp('wt-migrate-');
  const mainDir = path.join(root, 'main');
  const worktreeDir = path.join(root, 'wt');
  fs.mkdirSync(path.join(mainDir, '.envoy'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.envoy', 'state.json'), '{"fresh":true}');
  fs.mkdirSync(path.join(worktreeDir, '.envoy'), { recursive: true });
  fs.writeFileSync(path.join(worktreeDir, '.envoy', 'stale.json'), '{"stale":true}');

  worktreeState.migrateEnvoyState(mainDir, worktreeDir);

  assert.ok(!fs.existsSync(path.join(mainDir, '.envoy')), 'main/.envoy should be gone');
  assert.ok(
    fs.existsSync(path.join(worktreeDir, '.envoy', 'state.json')),
    'migrated state.json should be present'
  );
  assert.ok(
    !fs.existsSync(path.join(worktreeDir, '.envoy', 'stale.json')),
    'stale target file should be replaced'
  );
  cleanup(root);
});

test('falls back to copy+delete when rename fails cross-device (EXDEV)', () => {
  const root = makeTmp('wt-migrate-');
  const mainDir = path.join(root, 'main');
  const worktreeDir = path.join(root, 'wt');
  fs.mkdirSync(path.join(mainDir, '.envoy'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.envoy', 'state.json'), '{"x":1}');
  fs.mkdirSync(worktreeDir, { recursive: true });

  const realRename = fs.renameSync;
  fs.renameSync = () => {
    const e = new Error('cross-device link not permitted');
    e.code = 'EXDEV';
    throw e;
  };
  try {
    worktreeState.migrateEnvoyState(mainDir, worktreeDir);
  } finally {
    fs.renameSync = realRename;
  }

  assert.ok(!fs.existsSync(path.join(mainDir, '.envoy')), 'main/.envoy removed after EXDEV fallback');
  assert.strictEqual(
    fs.readFileSync(path.join(worktreeDir, '.envoy', 'state.json'), 'utf8'),
    '{"x":1}',
    'contents copied via the EXDEV fallback'
  );
  cleanup(root);
});

// ═══════════════════════════════════════════════════════════════════
// assertInWorktree
// ═══════════════════════════════════════════════════════════════════

section('assertInWorktree: guard cwd against registered worktree');

test('passes when cwd matches a registered worktree', () => {
  const root = makeTmp('wt-guard-');
  const wt = path.join(root, 'wt');
  fs.mkdirSync(wt, { recursive: true });

  assert.doesNotThrow(() =>
    worktreeState.assertInWorktree(wt, {
      cwd: wt,
      listWorktrees: () => [wt],
    })
  );
  cleanup(root);
});

test('throws when cwd is not the expected worktree', () => {
  const root = makeTmp('wt-guard-');
  const wt = path.join(root, 'wt');
  const elsewhere = path.join(root, 'elsewhere');
  fs.mkdirSync(wt, { recursive: true });
  fs.mkdirSync(elsewhere, { recursive: true });

  assert.throws(
    () =>
      worktreeState.assertInWorktree(wt, {
        cwd: elsewhere,
        listWorktrees: () => [wt],
      }),
    /worktree/i
  );
  cleanup(root);
});

test('throws when expected path is not a registered worktree', () => {
  const root = makeTmp('wt-guard-');
  const wt = path.join(root, 'wt');
  fs.mkdirSync(wt, { recursive: true });

  assert.throws(
    () =>
      worktreeState.assertInWorktree(wt, {
        cwd: wt,
        listWorktrees: () => [], // not registered
      }),
    /worktree/i
  );
  cleanup(root);
});

test('resolves a symlinked cwd against the real registered path (macOS /tmp pitfall)', () => {
  const root = makeTmp('wt-guard-');
  const real = path.join(root, 'real-wt');
  fs.mkdirSync(real, { recursive: true });
  const link = path.join(root, 'link-wt');
  fs.symlinkSync(real, link);

  // cwd + expected given via the symlink, registered via the real path — realpath
  // resolution must make them compare equal so a legit worktree does not false-abort.
  assert.doesNotThrow(() =>
    worktreeState.assertInWorktree(link, {
      cwd: link,
      listWorktrees: () => [real],
    })
  );
  cleanup(root);
});

// ═══════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
