#!/usr/bin/env node
/**
 * Main-drift check — Test Suite
 *
 * Pure logic for detecting breaking merges into origin/main since the branch
 * point that touch files also changed on this branch (finalize Preconditions
 * + re-checked before each Step 6 push). No network — file lists / commit
 * counts are passed in; only the thin git-shelling wrapper (computeDrift) is
 * exercised in a real scratch git repo (integration-style).
 * Run: node tests/lib/main-drift.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const mainDrift = require(path.join(__dirname, '..', '..', 'lib', 'main-drift.js'));

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

// ═══════════════════════════════════════════════════════════════════
// intersectFiles: sorted-unique intersection (comm-equivalent, pure JS)
// ═══════════════════════════════════════════════════════════════════

section('intersectFiles: set-intersection of two file lists');

test('returns files present in both lists', () => {
  const result = mainDrift.intersectFiles(['a.js', 'b.js', 'c.js'], ['b.js', 'c.js', 'd.js']);
  assert.deepStrictEqual(result, ['b.js', 'c.js']);
});

test('returns empty array when no overlap', () => {
  assert.deepStrictEqual(mainDrift.intersectFiles(['a.js'], ['b.js']), []);
});

test('dedupes and sorts the result', () => {
  const result = mainDrift.intersectFiles(['b.js', 'a.js', 'a.js'], ['a.js', 'b.js', 'b.js']);
  assert.deepStrictEqual(result, ['a.js', 'b.js']);
});

test('handles empty input lists', () => {
  assert.deepStrictEqual(mainDrift.intersectFiles([], []), []);
  assert.deepStrictEqual(mainDrift.intersectFiles(['a.js'], []), []);
});

// ═══════════════════════════════════════════════════════════════════
// evaluateDrift: hasDrift decision from commit count + overlap
// ═══════════════════════════════════════════════════════════════════

section('evaluateDrift: hasDrift only when overlapping files present');

test('no drift when there are zero new main commits', () => {
  const result = mainDrift.evaluateDrift(0, []);
  assert.strictEqual(result.hasDrift, false);
  assert.strictEqual(result.driftCommits, 0);
  assert.deepStrictEqual(result.overlappingFiles, []);
});

test('drift commits with NO file overlap is informational only (hasDrift false)', () => {
  const result = mainDrift.evaluateDrift(5, []);
  assert.strictEqual(result.hasDrift, false);
  assert.strictEqual(result.driftCommits, 5);
  assert.match(result.message, /informational|no overlap|no action/i);
});

test('drift commits WITH file overlap sets hasDrift true and offers A/B/C', () => {
  const result = mainDrift.evaluateDrift(3, ['shared/lib/foo.js']);
  assert.strictEqual(result.hasDrift, true);
  assert.strictEqual(result.driftCommits, 3);
  assert.deepStrictEqual(result.overlappingFiles, ['shared/lib/foo.js']);
  assert.match(result.message, /rebase/i);
  assert.match(result.message, /merge/i);
  assert.match(result.message, /proceed/i);
});

test('overlap message enumerates the overlapping files', () => {
  const result = mainDrift.evaluateDrift(2, ['a.js', 'b.js']);
  assert.match(result.message, /a\.js/);
  assert.match(result.message, /b\.js/);
});

// ═══════════════════════════════════════════════════════════════════
// computeDrift: integration test against a real scratch git repo
// ═══════════════════════════════════════════════════════════════════

section('computeDrift: merge-base + rev-list + overlap against a real repo');

function makeScratchRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envoy-main-drift-'));
  const git = (args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString();
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  // Simulate a remote by using a bare clone that we push origin/main to.
  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'envoy-main-drift-remote-'));
  execFileSync('git', ['init', '-q', '--bare', remoteDir]);
  git(['remote', 'add', 'origin', remoteDir]);
  git(['push', '-q', 'origin', 'main']);
  return { dir, git };
}

test('no drift when origin/main has not moved since the branch point', () => {
  const { dir, git } = makeScratchRepo();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(dir, 'feature.txt'), 'feature\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'feature work']);

  const result = mainDrift.computeDrift(dir);
  assert.strictEqual(result.hasDrift, false);
  assert.strictEqual(result.driftCommits, 0);
  assert.deepStrictEqual(result.overlappingFiles, []);
});

test('drift with no overlapping files is informational only', () => {
  const { dir, git } = makeScratchRepo();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(dir, 'feature.txt'), 'feature\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'feature work']);

  // Advance main independently, touching an unrelated file.
  git(['checkout', '-q', 'main']);
  fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'unrelated\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'unrelated main work']);
  git(['push', '-q', 'origin', 'main']);
  git(['checkout', '-q', 'feature']);

  const result = mainDrift.computeDrift(dir);
  assert.strictEqual(result.hasDrift, false);
  assert.strictEqual(result.driftCommits, 1);
  assert.deepStrictEqual(result.overlappingFiles, []);
});

test('drift touching a shared file sets hasDrift true with overlap listed', () => {
  const { dir, git } = makeScratchRepo();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(dir, 'base.txt'), 'feature change\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'feature touches base.txt']);

  // Advance main, ALSO touching base.txt — conflicting drift.
  git(['checkout', '-q', 'main']);
  fs.writeFileSync(path.join(dir, 'base.txt'), 'main change\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'main also touches base.txt']);
  git(['push', '-q', 'origin', 'main']);
  git(['checkout', '-q', 'feature']);

  const result = mainDrift.computeDrift(dir);
  assert.strictEqual(result.hasDrift, true);
  assert.strictEqual(result.driftCommits, 1);
  assert.deepStrictEqual(result.overlappingFiles, ['base.txt']);
});

// ═══════════════════════════════════════════════════════════════════
// computeDrift: fetches origin/main first so stale remote-tracking refs
// don't silently under-report drift (Task 10 fix-round)
// ═══════════════════════════════════════════════════════════════════

section('computeDrift: fetches origin before computing (avoids stale ref)');

test('picks up commits pushed to origin AFTER the local clone, without a manual fetch', () => {
  const { dir, git } = makeScratchRepo();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(dir, 'feature.txt'), 'feature\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'feature work']);

  // Get origin url, clone it separately, push a NEW commit touching base.txt
  // straight to the bare remote. The scratch repo's local origin/main
  // tracking ref is now stale — computeDrift must fetch before it can see this.
  const originUrl = git(['remote', 'get-url', 'origin']).trim();
  const otherClone = fs.mkdtempSync(path.join(os.tmpdir(), 'envoy-main-drift-clone-'));
  execFileSync('git', ['clone', '-q', originUrl, otherClone], { stdio: 'pipe' });
  const gitOther = (args) => execFileSync('git', args, { cwd: otherClone, stdio: 'pipe' }).toString();
  gitOther(['config', 'user.email', 'test@example.com']);
  gitOther(['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(otherClone, 'base.txt'), 'main change from elsewhere\n');
  gitOther(['add', '.']);
  gitOther(['commit', '-q', '-m', 'main also touches base.txt, pushed from elsewhere']);
  gitOther(['push', '-q', 'origin', 'main']);

  // Local scratch repo's origin/main tracking ref has NOT been told about
  // this push. computeDrift must fetch origin/main itself to catch it.
  const result = mainDrift.computeDrift(dir);
  assert.strictEqual(result.hasDrift, true);
  assert.strictEqual(result.driftCommits, 1);
  assert.deepStrictEqual(result.overlappingFiles, ['base.txt']);
});

test('fetch failure (unreachable origin) does not throw and marks fetchFailed', () => {
  const { dir, git } = makeScratchRepo();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(dir, 'feature.txt'), 'feature\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'feature work']);

  // Point origin at a URL that cannot be reached — simulates offline/no-network.
  git(['remote', 'set-url', 'origin', '/nonexistent/path/does-not-exist.git']);

  let result;
  assert.doesNotThrow(() => {
    result = mainDrift.computeDrift(dir);
  });
  assert.strictEqual(result.fetchFailed, true);
  // Falls back to whatever local ref state exists (no drift, since branch
  // point equals the stale origin/main here) rather than crashing.
  assert.strictEqual(result.hasDrift, false);
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
