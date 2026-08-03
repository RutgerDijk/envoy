#!/usr/bin/env node
/**
 * Cleanup Step 4 git-aware .envoy removal — contract test.
 *
 * Guards against the tracked-file-deletion bug: Step 4 must use
 * `git clean -fdx -- .envoy .envoy-session.json .envoy-scratchpad.json` (which only
 * removes UNTRACKED files) instead of `rm -rf "$WORKTREE_PATH/.envoy"` (which
 * deletes tracked files too, in repos that commit .envoy/ contents).
 *
 * Step 10 must verify "no untracked .envoy residue" rather than asserting the
 * .envoy directory no longer exists (it may legitimately still exist with
 * tracked files after cleanup).
 *
 * Run: node tests/skills/cleanup-git-aware.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SKILL = path.join(REPO_ROOT, 'skills', 'cleanup', 'SKILL.md');

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

const md = fs.readFileSync(SKILL, 'utf8');

section('cleanup Step 4: git-aware .envoy removal');

test('Step 4 uses git clean -fdx for .envoy removal (does not force-delete tracked files)', () => {
  assert.ok(
    md.includes('git -C "$WORKTREE_PATH" clean -fdx -- .envoy .envoy-session.json .envoy-scratchpad.json'),
    'expected exact git clean command replacing the unconditional rm -rf'
  );
});

test('Step 4 no longer unconditionally rm -rf\'s .envoy (would delete tracked files)', () => {
  assert.ok(
    !md.includes('rm -rf "$WORKTREE_PATH/.envoy"'),
    'unconditional rm -rf "$WORKTREE_PATH/.envoy" must be removed'
  );
});

section('cleanup Step 10: verify no untracked residue (not "directory gone")');

test('Step 10 no longer asserts .envoy/ directory does not exist', () => {
  assert.ok(
    !md.includes('[ ! -d "$WORKTREE_PATH/.envoy" ] && echo "✓ .envoy/ gone"'),
    'the "directory gone" check is wrong once .envoy/ can legitimately contain tracked files'
  );
});

test('Step 10 checks for untracked .envoy residue via git status --porcelain --ignored', () => {
  assert.ok(
    /git -C "\$WORKTREE_PATH" status --porcelain --ignored -- \.envoy/.test(md),
    'expected a git status --porcelain --ignored check scoped to .envoy paths'
  );
});

section('cleanup residue check: correct git-status marker + ordering (Step 4 vs Step 10)');

test('residue grep matches both untracked (??) and ignored-untracked (!!) markers', () => {
  assert.ok(
    md.includes("grep -qE '^(\\?\\?|!!)'"),
    '.envoy/ is gitignored, so untracked residue shows as "!!" not "??" under --ignored; ' +
    'grep must match both markers or the check is a silent no-op'
  );
  assert.ok(
    !md.includes("grep -q '^??'"),
    'the old ??-only grep can never match ignored-untracked residue and must be removed'
  );
});

test('the residue check runs before Step 6 removes the worktree, not after', () => {
  const step4Index = md.indexOf('### Step 4: Clear Session State');
  const step6Index = md.indexOf('### Step 6: Remove Worktree');
  const step10Index = md.indexOf('### Step 10: Verify Cleanup');
  assert.ok(step4Index !== -1 && step6Index !== -1 && step10Index !== -1, 'expected Steps 4, 6, 10 to exist');

  const step4Body = md.slice(step4Index, step6Index);
  assert.ok(
    /grep -qE '\^\(\\\?\\\?\|!!\)'/.test(step4Body),
    'the git-status residue check must run inside Step 4, before Step 6 removes the worktree ' +
    '(once removed, `git -C "$WORKTREE_PATH" status` fails since the directory no longer exists)'
  );

  const step10Body = md.slice(step10Index);
  assert.ok(
    !/status --porcelain --ignored/.test(step10Body),
    'Step 10 must not re-run the git status residue check against a worktree that Step 6 already removed'
  );
});

section('Summary');
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
