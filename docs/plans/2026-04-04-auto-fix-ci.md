# Auto-Fix CI/CD Failures & Updated CodeRabbit Polling

> **For Claude:** Use envoy:executing-plans to implement this spec task-by-task.

## Overview

Extend Envoy's finalize workflow to automatically detect and fix CI/CD failures (tests, build, lint) after PR creation. Add a standalone `fix-ci` skill for independent use. Update CodeRabbit polling to use exponential backoff with a 20-minute maximum wait time.

## Architecture

Three components:

1. **New `fix-ci` skill** — Core CI diagnosis/fix logic. Polls GitHub Actions, parses failed logs, applies fixes, verifies locally, pushes. Max 3 fix cycles before escalation. Usable standalone or called from finalize.

2. **Extended finalize flow** — After CodeRabbit resolution, polls GitHub Actions status. If failures detected, invokes fix-ci logic inline. Proceeds to final verification only when CI passes.

3. **Updated CodeRabbit polling** — Replace fixed initial wait with exponential backoff (2min → 4min → 8min → 14min → 22min cumulative). If no comments after 20 minutes, proceed without CodeRabbit.

### CI Failure Classification

| Type | Signal | Action |
|------|--------|--------|
| `test-failure` | Failed test names + assertion errors in logs | Read test + source, fix, verify locally |
| `build-error` | Compiler errors with file:line | Fix compilation at error location |
| `lint-violation` | Linter rule + file:line | Auto-fix or manual fix |
| `infra-issue` | Runner unavailable, permissions, timeouts | Escalate immediately to user |

### fix-ci Skill Flow

1. **Identify PR and failed runs** — `gh run list --branch <branch>` + `gh run view <id> --log-failed`
2. **Classify failures** — Parse logs, categorize as test/build/lint/infra
3. **Diagnose and fix** — Read failing source, apply targeted fix
4. **Verify locally** — Run same commands CI uses (test, build, lint)
5. **Push and re-poll** — Push fixes, wait for new CI run with exponential backoff
6. **Loop or escalate** — Max 3 fix cycles, then present diagnosis summary

### Updated Finalize Flow

1. Run `envoy:docstrings`
2. Push branch + create PR
3. Update wiki docs
4. **Poll for CodeRabbit (exponential backoff, 20min max)** — *updated*
5. Address CodeRabbit findings (max 3 cycles) — *existing*
6. **Poll GitHub Actions status (15min timeout)** — *new*
7. **If CI failures: fix-ci loop (max 3 cycles)** — *new*
8. Final verification (local tests, build, lint, zero unresolved conversations)
9. Wiki sync
10. Handoff

### CodeRabbit Exponential Backoff

```
intervals = [2min, 2min, 4min, 6min, 8min]
cumulative =  2     4     8    14    22 min

For each interval:
  - Sleep for interval duration
  - Check for CodeRabbit comments via gh api
  - If comments found: break and start addressing
  - If not: report progress, continue to next interval
  
If 20min exceeded with no comments:
  - Log "CodeRabbit did not comment within 20 minutes, proceeding"
  - Skip to CI checks
```

### CI Polling (After CodeRabbit)

```
Poll gh pr checks until all checks resolve (pass or fail):
  - Exponential backoff: 30s, 60s, 120s, 240s...
  - Timeout: 15 minutes
  - If all pass: proceed to final verification
  - If any fail: invoke fix-ci logic
```

## Acceptance Criteria

- [ ] New `skills/fix-ci/SKILL.md` skill with full diagnosis/fix/verify loop
- [ ] New `commands/fix-ci.md` command wrapper
- [ ] Finalize skill updated with CI polling step after CodeRabbit
- [ ] CodeRabbit polling updated to exponential backoff (20min max)
- [ ] Fix-ci uses existing loop safeguards (ENVOY_LOOP_COMPLETE, 3 confirmations)
- [ ] Max 3 fix cycles before escalation with diagnosis summary
- [ ] Infrastructure failures escalated immediately (not auto-fixed)
- [ ] Local verification before every push
- [ ] Standalone `/envoy:fix-ci <pr-number>` works independently
- [ ] Progress reporting at each polling interval

---

## Implementation Plan

**Execution Strategy:** `sequential`

Tasks are sequential because later tasks depend on earlier ones (fix-ci skill must exist before finalize can reference it, CodeRabbit polling changes affect finalize flow).

### Task 1: Create fix-ci Skill

**Files:**
- Create: `skills/fix-ci/SKILL.md`

**Steps:**

1. Create `skills/fix-ci/SKILL.md` with YAML frontmatter (`name`, `description`)
2. Write the full skill definition covering:
   - PR identification (from arg, `/tmp/envoy-active-pr.txt`, or current branch)
   - GitHub Actions polling via `gh run list` and `gh run view --log-failed`
   - Failure classification (test, build, lint, infra)
   - Diagnosis and fix flow per failure type
   - Local verification before push
   - Loop safeguards integration (ENVOY_LOOP_COMPLETE, 3 confirmations)
   - Max 3 fix cycles with escalation
   - Announce at start directive
   - Integration with Envoy section
3. Commit: `git commit -m "feat(skills): add fix-ci skill for auto-fixing CI/CD failures"`

### Task 2: Create fix-ci Command Wrapper

**Files:**
- Create: `commands/fix-ci.md`

**Steps:**

1. Create `commands/fix-ci.md` with YAML frontmatter (`description`)
2. Command should invoke the `fix-ci` skill, passing through any arguments (PR number)
3. Commit: `git commit -m "feat(commands): add fix-ci command wrapper"`

### Task 3: Update CodeRabbit Polling in Finalize

**Files:**
- Modify: `skills/finishing-branch/SKILL.md` (CodeRabbit polling section)

**Steps:**

1. Read current `skills/finishing-branch/SKILL.md`
2. Find the CodeRabbit polling section (Step 4 area — initial wait + comment checking)
3. Replace fixed wait time with exponential backoff schedule:
   - Intervals: 2min, 2min, 4min, 6min, 8min (22min cumulative max, effective 20min cutoff)
   - Progress reporting at each interval
   - Graceful skip if 20min exceeded with no comments
4. Verify the rest of the CodeRabbit fix cycle (Steps 5-8) still flows correctly
5. Commit: `git commit -m "feat(finalize): update CodeRabbit polling to exponential backoff with 20min max"`

### Task 4: Add CI Polling and Fix Step to Finalize

**Files:**
- Modify: `skills/finishing-branch/SKILL.md` (add new steps after CodeRabbit)

**Steps:**

1. Read current `skills/finishing-branch/SKILL.md` (post Task 3 changes)
2. After the CodeRabbit resolution steps, add new steps:
   - **Poll GitHub Actions**: `gh pr checks $PR --json name,state,conclusion` with exponential backoff (30s, 60s, 120s, 240s) and 15min timeout
   - **If failures detected**: invoke fix-ci skill logic inline (classify, diagnose, fix, verify, push, re-poll — max 3 cycles)
   - **If all pass**: proceed to final verification
   - **On escalation**: present failure summary with workflow names, error excerpts, and attempted fixes
3. Update the final verification step to confirm CI status as part of the "all clear" check
4. Update the handoff message to include CI status
5. Commit: `git commit -m "feat(finalize): add CI/CD failure detection and auto-fix after CodeRabbit"`

### Task 5: Add Brainstorming Skill Entry for fix-ci

**Files:**
- Modify: `skills/writing-skills/SKILL.md` (if skill registry exists) or relevant registration file

**Steps:**

1. Check if there's a skill registry or if skills are auto-discovered
2. If manual registration needed: add fix-ci to the registry
3. Verify `/envoy:fix-ci` is invocable in a test session
4. Commit: `git commit -m "feat(skills): register fix-ci skill"`

---

*Generated by Envoy*
