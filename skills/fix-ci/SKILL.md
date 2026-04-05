---
name: fix-ci
description: Use when CI/CD checks fail on a PR and you need to diagnose and fix test, build, or lint failures
---

# Fix CI/CD Failures

## Overview

Auto-diagnose and fix CI/CD failures from GitHub Actions. Polls for failed runs, parses logs, classifies failures, applies targeted fixes, verifies locally, and pushes. Max 3 fix cycles before escalation. Usable standalone or called from finalize.

**Announce at start:** "I'm using envoy:fix-ci to diagnose and fix CI failures."

## Arguments

| Flag | Effect |
|------|--------|
| `<pr-number>` | PR to check (default: detect from current branch or `/tmp/envoy-active-pr.txt`) |

## Process

### Step 1: Identify PR and Failed Runs

```bash
# Detect PR number
if [ -n "$1" ]; then
  PR_NUMBER=$1
elif [ -f /tmp/envoy-active-pr.txt ]; then
  PR_NUMBER=$(cat /tmp/envoy-active-pr.txt)
else
  PR_NUMBER=$(gh pr view --json number -q '.number' 2>/dev/null)
fi

OWNER=$(gh repo view --json owner -q '.owner.login')
REPO=$(gh repo view --json name -q '.name')
BRANCH=$(git branch --show-current)

# Get latest check runs
gh pr checks $PR_NUMBER --json name,state,conclusion 2>/dev/null
```

If no PR found, report error and stop.

### Step 2: Poll for Check Completion

Checks may still be running. Poll with exponential backoff:

```
intervals = [30s, 60s, 120s, 240s]
timeout = 15 minutes

For each interval:
  - Query: gh pr checks $PR_NUMBER --json name,state,conclusion
  - If all checks resolved (pass or fail): break
  - If still running: report progress, sleep, continue
  - If timeout: report which checks are still pending
```

### Step 3: Classify Failures

For each failed check, download the log and classify:

```bash
# Get failed run IDs
FAILED_RUNS=$(gh run list --branch $BRANCH --status failure --json databaseId,name -q '.[] | .databaseId')

# For each failed run, get the failed log
gh run view $RUN_ID --log-failed 2>&1
```

Classify each failure:

| Type | Signal | Action |
|------|--------|--------|
| `test-failure` | Failed test names, assertion errors, `FAIL`, `Expected X but got Y` | Read test + source, fix, verify locally |
| `build-error` | `error CS`, `error TS`, `Cannot find module`, compilation errors with file:line | Fix compilation at error location |
| `lint-violation` | ESLint/Prettier errors, `warning`/`error` with rule name + file:line | Auto-fix (`--fix`) or manual fix |
| `infra-issue` | Runner unavailable, permissions, timeouts, Docker pull failures, OOM | **Escalate immediately** — don't try to fix |

**Scope note:** Step 1 uses `gh pr checks` to detect all failures — this includes
both GitHub Actions workflow runs and external status checks (e.g., Vercel, Netlify).
However, log download via `gh run list` / `gh run view --log-failed` only works for
GitHub Actions runs. If a failed check has no corresponding workflow run, classify it
as `infra-issue` with the note: "External status check — check the service directly."

### Step 4: Handle Infrastructure Failures

If ANY failure is classified as `infra-issue`, escalate immediately:

```
**CI Infrastructure Failure — Cannot Auto-Fix**

| Workflow | Error | Type |
|----------|-------|------|
| <name> | <error excerpt> | infra-issue |

This is not a code issue. Possible causes:
- GitHub Actions runner unavailable
- Docker image pull failure
- Permission/secret configuration issue
- Resource limit (OOM, disk space)
- Network timeout

Please investigate the CI infrastructure.
```

**Do not attempt to fix infrastructure issues.** Stop here for these.

### Step 5: Diagnose and Fix Code Failures

For each non-infra failure, in order of severity:

**Test failures:**
1. Parse test name and assertion error from log
2. Read the failing test file
3. Read the source file the test exercises
4. Understand what changed (check recent commits)
5. Fix the source code (not the test, unless the test is wrong)
6. Run the test locally to verify

**Build errors:**
1. Parse file path and line number from error
2. Read the file at that location
3. Fix the compilation error
4. Run build locally to verify

**Lint violations:**
1. Try auto-fix first: `npm run lint -- --fix` or `dotnet format`
2. If auto-fix doesn't resolve: read the file and fix manually
3. Run lint locally to verify

**Fix all failures from the current CI run before pushing.** Diagnose and fix each
failure in order of severity (test → build → lint), verify all fixes locally (Step 6),
then commit and push once. One push = one fix cycle.

```bash
# After ALL failures are fixed and verified
git add <changed-files>
git commit -m "fix: resolve CI failures — <brief summary of all fixes>"
```

### Step 6: Verify Locally

Before pushing, run the same checks CI uses:

```bash
# Run what CI runs (adjust for project)
dotnet test
dotnet build
npm test
npm run lint
npm run build
```

**All local checks must pass before pushing.** If they don't, go back to Step 5.

### Step 7: Push and Re-poll

```bash
git push
```

Poll for new CI run results with exponential backoff (same as Step 2).

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

### Escalation Format

```
**Escalation: CI fix cycle limit reached**

After 3 fix-and-push cycles, these CI checks still fail:

| Workflow | Failure Type | Error | Attempted Fixes |
|----------|-------------|-------|-----------------|
| <name> | test-failure | <excerpt> | Fixed X, Y |
| <name> | build-error | <excerpt> | Fixed Z |

**What was tried:**
1. Cycle 1: Fixed <description>
2. Cycle 2: Fixed <description>
3. Cycle 3: Fixed <description>

**Possible root cause:** <diagnosis>

Please review and decide how to proceed.
```

### Step 9: Report Success

```
**CI Failures Fixed**

| Workflow | Status | Fix |
|----------|--------|-----|
| <name> | ✓ Passing | <what was fixed> |
| <name> | ✓ Passing | <what was fixed> |

Fix cycles used: <N>/3
Commits: <N> fix commits pushed
All CI checks passing.
```

## Error Handling

### No PR Found

```
**Cannot find PR for current branch.**

Specify PR number: /envoy:fix-ci <pr-number>
```

### No Failed Checks

```
**All CI checks are passing.** Nothing to fix.
```

### Checks Still Running

```
**CI checks still running after 15-minute timeout.**

Pending checks:
- <check name> (running for Xmin)

Wait for completion or check GitHub Actions directly:
gh pr checks <pr-number>
```

## Integration with Envoy

- Invoked by `envoy:finalize` as `/envoy:fix-ci $PR_NUMBER` after CodeRabbit resolution
- Uses `envoy:verification` principles (evidence before assertions)
- Uses `lib/loop-safeguards.js` completion signal protocol
- Standalone usage: `/envoy:fix-ci <pr-number>`
