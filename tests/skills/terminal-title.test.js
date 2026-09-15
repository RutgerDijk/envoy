#!/usr/bin/env node
/**
 * Terminal session title from issue — contract test (Task 11).
 *
 * Worktree terminal tabs should be identifiable: when pickup creates (or
 * resumes into) a worktree for issue #N with slug S, the interactive
 * terminal's tab title becomes `#N S` via the OSC 0 escape sequence. This
 * must never fire in non-interactive contexts (piped output, hook logs),
 * and cleanup must reset the title when the worktree is removed.
 *
 * These are markdown-embedded bash snippets (matching the rest of
 * worktree.md / cleanup/SKILL.md, which are raw bash rather than
 * `node -e` calls), so this is a content-assertion test on the .md files,
 * following the same convention as tests/skills/cleanup-git-aware.test.js.
 *
 * Run: node tests/skills/terminal-title.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..', '..');
const WORKTREE_MD = path.join(REPO_ROOT, 'skills', 'pickup', 'steps', 'worktree.md');
const PLAN_MD = path.join(REPO_ROOT, 'skills', 'pickup', 'steps', 'plan.md');
const CLEANUP_MD = path.join(REPO_ROOT, 'skills', 'cleanup', 'SKILL.md');

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

const worktreeMd = fs.readFileSync(WORKTREE_MD, 'utf8');
const planMd = fs.readFileSync(PLAN_MD, 'utf8');
const cleanupMd = fs.readFileSync(CLEANUP_MD, 'utf8');

const OSC0_PATTERN = /\[ -t 1 \] && printf '\\033\]0;#%s %s\\007' "<N>" "\$TOPIC"/;

section('pickup worktree.md: title set on creation (Step 5, after cd)');

test('Step 5 sets the OSC 0 title guarded on [ -t 1 ]', () => {
  assert.ok(
    OSC0_PATTERN.test(worktreeMd),
    'expected `[ -t 1 ] && printf \'\\033]0;#%s %s\\007\' "<N>" "$TOPIC"` after the Step 5 cd'
  );
});

test('title-set snippet appears after the Step 5 cd into the worktree, not before', () => {
  const step5Index = worktreeMd.indexOf('### Step 5: Merge Permissions');
  const cdIndex = worktreeMd.indexOf('cd .worktrees/<N>-$TOPIC', step5Index);
  const titleIndex = worktreeMd.search(OSC0_PATTERN);
  assert.ok(step5Index !== -1 && cdIndex !== -1, 'expected Step 5 and its cd to exist');
  assert.ok(titleIndex > cdIndex, 'title-set must come after the cd into the worktree');
});

section('pickup plan.md: title re-emitted on resume');

test('resume path (worktree already exists) re-emits the title', () => {
  assert.ok(
    /\[ -t 1 \] && printf '\\033\]0;#%s %s\\007' "<N>" "<topic>"/.test(planMd),
    'resuming into an existing worktree must re-set the title, not just on fresh creation'
  );
});

section('cleanup SKILL.md: title reset on worktree removal');

test('cleanup resets the title (guarded on [ -t 1 ]) after switching back to main', () => {
  assert.ok(
    /\[ -t 1 \] && printf '\\033\]0;\\007'/.test(cleanupMd),
    'expected `[ -t 1 ] && printf \'\\033]0;\\007\'` to reset the title back to default'
  );
});

test('title reset happens in Step 2 (Switch to Main Repository), after the cd', () => {
  const step2Index = cleanupMd.indexOf('### Step 2: Switch to Main Repository');
  const step3Index = cleanupMd.indexOf('### Step 3: Update Main Branch');
  assert.ok(step2Index !== -1 && step3Index !== -1, 'expected Steps 2 and 3 to exist');
  const step2Body = cleanupMd.slice(step2Index, step3Index);
  assert.ok(
    /\[ -t 1 \] && printf '\\033\]0;\\007'/.test(step2Body),
    'title reset must live inside Step 2, right after cd "$MAIN_REPO"'
  );
});

section('Summary');
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
