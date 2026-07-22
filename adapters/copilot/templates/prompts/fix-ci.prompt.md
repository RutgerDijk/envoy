---
agent: 'agent'
description: 'Diagnose and fix failing CI checks on the current PR: classify, fix root cause, push, re-poll'
---

# Fix CI Failures

Diagnose and fix CI/CD failures on the pull request for the current branch. Classify each failure, fix the root cause, verify locally, push, and re-poll — maximum 3 fix cycles before escalating to the user.

**Usage:** `/fix-ci [pr-number]`

## Step 1: Identify the PR and Its Checks

```bash
# Use the argument if given, otherwise detect from the current branch
PR_NUMBER=$(gh pr view --json number -q '.number')
BRANCH=$(git branch --show-current)

gh pr checks $PR_NUMBER
```

If no PR exists for the current branch, stop and ask for a PR number. If all checks pass, report "All CI checks are passing" and stop.

## Step 2: Wait for Checks to Complete

If checks are still running, poll `gh pr checks $PR_NUMBER` at increasing intervals (30s, 60s, 120s, 240s) until every check has a conclusion, up to 15 minutes. If checks are still pending after that, report which ones and stop.

## Step 3: Download and Classify Failure Logs

```bash
# Failed workflow runs for this branch
gh run list --branch $BRANCH --status failure --json databaseId,name

# For each failed run, read only the failing steps
gh run view <run-id> --log-failed
```

Classify each failure:

| Type | Signal | Action |
|------|--------|--------|
| Test failure | Failed test names, assertion errors, `Expected X but got Y` | Fix the source code the test exercises |
| Build error | Compiler errors with file:line (`error CS`, `error TS`, `Cannot find module`) | Fix the compilation error at that location |
| Lint violation | ESLint/Prettier/formatter errors with rule name + file:line | Auto-fix (`--fix`, `dotnet format`) or fix manually |
| Infrastructure | Runner unavailable, permission/secret errors, Docker pull failures, OOM, network timeouts | Escalate — do not attempt a fix |

A failed check with no matching workflow run (an external status check such as a deploy preview) counts as infrastructure: report it and point the user at the service directly.

## Step 4: Escalate Infrastructure Failures

If any failure is infrastructure, report it to the user with the workflow name and error excerpt, and stop for that check. These are not code issues — do not retry or work around them.

## Step 5: Fix Root Causes

For each code failure, in order of severity (test → build → lint):

1. Parse the failing test name or file:line from the log.
2. Read the failing test and the source it exercises; check recent commits for what changed.
3. Fix the source code. Only change a test when the test itself is wrong — never delete, skip, or weaken a test to make CI green, and never add suppression comments to silence a linter.
4. Reproduce and verify the fix locally before moving on.

Fix all failures from the run before pushing, then commit once:

```bash
git add <changed-files>
git commit -m "fix: resolve CI failures — <brief summary>"
```

## Step 6: Verify Locally

Run the same checks CI runs (adjust for the project):

```bash
dotnet test
dotnet build
npm test
npm run lint
npm run build
```

All local checks must pass before pushing. If any fail, return to Step 5.

## Step 7: Push and Re-poll

```bash
git push
```

Poll the checks again as in Step 2. One push counts as one fix cycle.

## Step 8: Loop or Escalate

- If checks pass: report success — which workflows were fixed, what each fix was, and how many cycles were used.
- If checks still fail and fewer than 3 cycles are used: return to Step 3.
- After 3 cycles: stop and report each still-failing workflow, its failure type, an error excerpt, what was tried in each cycle, and your best diagnosis of the root cause. Let the user decide how to proceed.
