# Fix CI Skill and Finishing-Branch CI Integration Issues

> **For Claude:** Use envoy:executing-plans to implement this spec task-by-task.

## Overview

Address 7 issues found during review of the fix-ci skill and finishing-branch CI integration: timing discrepancy, unclear pseudocode, API scope gaps, non-executable commands, ambiguous strategy, sleep timeouts, and stale skill count.

## Architecture

All changes are edits to existing files — no new files. Three skill files and three documentation/config files affected:

- `skills/fix-ci/SKILL.md` — Issues #2, #3, #4, #5
- `skills/finishing-branch/SKILL.md` — Issues #1, #4, #6
- `docs/wiki/Skills-Reference.md` — Issue #7
- `docs/wiki/Home.md` — Issue #7
- `.claude-plugin/plugin.json` — Issue #7

## Acceptance Criteria

- [ ] CodeRabbit backoff intervals `[2, 2, 4, 6, 8]` stay intact; all "20-minute" references updated to "22 minutes"
- [ ] fix-ci Step 8 uses a state machine (POLL_CI / FIX / CONFIRM / DONE / ESCALATE) instead of nested loops
- [ ] fix-ci documents that `gh pr checks` detects all failures but `gh run list` only downloads GitHub Actions logs; external check failures → `infra-issue`
- [ ] All `git add -p` replaced with `git add <changed-files>`
- [ ] fix-ci Step 5 explicitly states: fix all failures, verify all locally, push once per cycle
- [ ] finishing-branch CodeRabbit polling uses seconds-based intervals with elapsed tracking (22-min / 1320s ceiling)
- [ ] Skills-Reference says "27 skills", lists `pressure-test-scenarios` in Advanced Patterns table
- [ ] Home.md and plugin.json updated to "27 skills"

---

## Implementation Plan

**Execution Strategy:** `sequential`

Tasks touch overlapping files, so sequential avoids merge conflicts.

### Task 1: Fix timing discrepancy (finishing-branch)

**Files:**
- Modify: `skills/finishing-branch/SKILL.md`

**Steps:**
1. In Step 4 description (line ~101), change "20-minute max" to "22-minute max"
2. In the comment block (line ~113), update cumulative comment to show correct total: `# cumulative = 2  4  8  14  22 min`
3. In the "If 20 minutes pass" block (line ~131), change "20 minutes" to "22 minutes"
4. In the Checklist (line ~379), change "20min max" to "22min max"
5. Commit: `git commit -m "fix(skills): update CodeRabbit timeout to 22min matching backoff intervals"`

### Task 2: Rewrite CodeRabbit polling to seconds-based (finishing-branch)

**Files:**
- Modify: `skills/finishing-branch/SKILL.md`

**Steps:**
1. Replace the Step 4 polling code block (lines ~104-126) with seconds-based polling:
   ```bash
   OWNER=$(gh repo view --json owner -q '.owner.login')
   REPO=$(gh repo view --json name -q '.name')
   PR_NUMBER=<number>

   # Exponential backoff in seconds — 22min (1320s) max
   # intervals = [120s, 120s, 240s, 360s, 480s]
   # cumulative =  2     4     8    14    22 min
   ELAPSED=0
   for WAIT in 120 120 240 360 480; do
     sleep $WAIT
     ELAPSED=$((ELAPSED + WAIT))

     COMMENTS=$(gh api repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments \
       --jq '[.[] | select(.user.login == "coderabbitai")] | length')

     if [ "$COMMENTS" -gt 0 ]; then
       echo "CodeRabbit left $COMMENTS comments after $((ELAPSED / 60))min. Addressing..."
       break
     fi

     echo "No CodeRabbit comments yet. $((ELAPSED / 60))min elapsed."
     if [ "$ELAPSED" -ge 1320 ]; then break; fi
   done
   ```
2. Commit: `git commit -m "fix(skills): rewrite CodeRabbit polling with seconds-based intervals"`

### Task 3: Replace git add -p in finishing-branch

**Files:**
- Modify: `skills/finishing-branch/SKILL.md`

**Steps:**
1. Replace `git add -p` on line ~48 (Step 1 docstrings) with `git add <changed-files>`
2. Replace `git add -p` on line ~148 (Step 5 CodeRabbit fixes) with `git add <changed-files>`
3. Commit: `git commit -m "fix(skills): replace interactive git add -p with git add <changed-files>"`

### Task 4: Rewrite fix-ci Step 8 as state machine

**Files:**
- Modify: `skills/fix-ci/SKILL.md`

**Steps:**
1. Replace Step 8 (lines ~155-191) with state machine pseudocode:
   ```
   ### Step 8: Loop or Escalate (Max 3 Fix Cycles)

   Uses a state machine with two counters:
   - **FIX_CYCLE** — code fix pushes (max 3)
   - **CONFIRM_COUNT** — consecutive passing confirmations (need 3 per `lib/loop-safeguards.js`)

   ```
   state = POLL_CI
   FIX_CYCLE = 0
   CONFIRM_COUNT = 0

   loop:
     case state:

       POLL_CI:
         Poll CI checks with backoff (Step 2)
         If any check FAILED  → state = FIX
         If all checks PASSED → state = CONFIRM

       FIX:
         If FIX_CYCLE >= 3 → state = ESCALATE
         Classify + fix ALL failures (Steps 3-6)
         Verify locally (Step 6)
         Push (Step 7)
         FIX_CYCLE += 1
         CONFIRM_COUNT = 0
         → state = POLL_CI

       CONFIRM:
         CONFIRM_COUNT += 1
         Output: ENVOY_LOOP_COMPLETE with evidence
         If CONFIRM_COUNT >= 3 → state = DONE
         → state = POLL_CI

       DONE:
         Proceed to Step 9 (Report Success)

       ESCALATE:
         Report failures + attempted fixes (see Escalation Format)
   ```
   ```
2. Commit: `git commit -m "fix(skills): rewrite fix-ci Step 8 as state machine"`

### Task 5: Add gh pr checks vs gh run list scope note (fix-ci)

**Files:**
- Modify: `skills/fix-ci/SKILL.md`

**Steps:**
1. After the Step 3 classification table, add a scope note:
   ```
   **Scope note:** Step 1 uses `gh pr checks` to detect all failures — this includes
   both GitHub Actions workflow runs and external status checks (e.g., Vercel, Netlify).
   However, log download via `gh run list` / `gh run view --log-failed` only works for
   GitHub Actions runs. If a failed check has no corresponding workflow run, classify it
   as `infra-issue` with the note: "External status check — check the service directly."
   ```
2. Commit: `git commit -m "fix(skills): document gh pr checks vs gh run list scope gap"`

### Task 6: Fix git add -p and multi-failure strategy (fix-ci)

**Files:**
- Modify: `skills/fix-ci/SKILL.md`

**Steps:**
1. Replace `git add -p` in Step 5 (line ~128) with `git add <changed-files>`
2. Move the per-fix commit out of Step 5. Replace with explicit strategy paragraph after the lint section:
   ```
   **Fix all failures from the current CI run before pushing.** Diagnose and fix each
   failure in order of severity (test → build → lint), verify all fixes locally (Step 6),
   then commit and push once. One push = one fix cycle.

   ```bash
   # After ALL failures are fixed and verified
   git add <changed-files>
   git commit -m "fix: resolve CI failures — <brief summary of all fixes>"
   ```
   ```
3. Commit: `git commit -m "fix(skills): explicit multi-failure strategy, replace git add -p"`

### Task 7: Update skill count to 27

**Files:**
- Modify: `docs/wiki/Skills-Reference.md`
- Modify: `docs/wiki/Home.md`
- Modify: `.claude-plugin/plugin.json`

**Steps:**
1. In `docs/wiki/Skills-Reference.md` line 3: change "25 skills" to "27 skills"
2. In the Advanced Patterns table, add row: `| \`envoy:pressure-test-scenarios\` | Testing whether skills maintain discipline under pressure |`
3. In `docs/wiki/Home.md` line 9: change "All 25 skills" to "All 27 skills"
4. In `.claude-plugin/plugin.json` line 4: change "25 skills" to "27 skills"
5. Commit: `git commit -m "docs: update skill count to 27, add pressure-test-scenarios to reference"`

---

*Generated by Envoy*
