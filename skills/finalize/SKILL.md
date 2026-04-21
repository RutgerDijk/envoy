---
name: finalize
description: Use when review is complete and you're ready to push, create PR, and ship
---

# Finalize

## Overview

Ships the work: push, create PR, handle CodeRabbit, fix CI, verify, wiki-sync. Assumes `envoy:review` has already been run. The skill runs the full pipeline directly — no delegation to an execution agent.

**Announce at start:** "I'm using envoy:finalize to create a PR and ship this work."

**Discipline rule:** This is a rigid skill. Every step MUST be executed as written. Do NOT skip, narrate, or reorder steps. See `contexts/execution-announce.md`.

## Context

```bash
BRANCH=$(git branch --show-current)
OWNER=$(gh repo view --json owner -q '.owner.login')
REPO=$(gh repo view --json name -q '.name')
EXECUTION_ANNOUNCE=$(cat contexts/execution-announce.md)
```

## Preconditions

Run these checks BEFORE proceeding. If any fail, stop and resolve first.

```bash
# 1. On a feature branch (not main/master)
if [[ "$BRANCH" == "main" || "$BRANCH" == "master" ]]; then
  echo "ERROR: Cannot finalize on main/master branch"
  exit 1
fi

# 2. Working directory is clean
if [[ -n $(git status --porcelain) ]]; then
  echo "ERROR: Uncommitted changes — commit or stash first"
  exit 1
fi

# 3. Tests pass (only run when tool + project are present)
if command -v dotnet >/dev/null 2>&1 && find . \( -name '*.sln' -o -name '*.csproj' \) -print -quit | grep -q .; then
  dotnet test
else
  echo "Skipping dotnet tests: dotnet or .NET project not present"
fi

if command -v npm >/dev/null 2>&1 && [[ -f package.json ]]; then
  npm test
else
  echo "Skipping npm tests: npm or package.json not present"
fi
```

**If any precondition fails, stop and resolve.**

---

## Process

### Step 1: Preconditions Check

Announce: `Running Step 1: Preconditions check...`

Run the preconditions above. All must pass before proceeding.

### Step 2: Push and Create PR

Announce: `Running Step 2: Push and create PR...`

```bash
git push -u origin HEAD
```

```bash
gh pr create --title "<title>" --body "$(cat <<'PREOF'
## Summary

<Brief description of changes>

## Changes

- **Implementation:** <main work summary>

## Test Plan

- [ ] Unit tests pass
- [ ] E2E tests pass

## Linked Issue

Closes #<issue-number>

---

*Created with Envoy*
PREOF
)"
```

```bash
# Store PR number for fix-ci auto-detection
PR_NUMBER=$(gh pr view --json number -q .number)
echo "$PR_NUMBER" > /tmp/envoy-active-pr.txt
```

### Step 3: Poll for CodeRabbit Comments (Exponential Backoff)

Announce: `Running Step 3: Poll for CodeRabbit comments...`

GitHub CodeRabbit App reviews the PR asynchronously. Poll with exponential backoff (22-minute max).

```bash
# CodeRabbit: 22min max (async review — GitHub App processes PR asynchronously)
PR_NUMBER=$(cat /tmp/envoy-active-pr.txt)

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

**If 22 minutes pass with no comments:**
```
CodeRabbit did not comment within 22 minutes. Proceeding without CodeRabbit.
(CodeRabbit may not be installed, or the PR is clean.)
```

Skip to CI checks (Step 8).

### Step 4: Address All CodeRabbit Findings

Announce: `Running Step 4: Address CodeRabbit findings...`

**No skipping — address everything including nitpicks.**

For each CodeRabbit comment:
1. Read the suggestion
2. Apply the fix (or explain why not)
3. Commit

```bash
git add <changed-files>
git commit -m "fix: address CodeRabbit feedback — <summary>"
```

### Step 5: Reply and Resolve Each Comment

Announce: `Running Step 5: Reply and resolve comments...`

```bash
# Reply with fix + commit hash
COMMIT=$(git rev-parse --short HEAD)
gh api repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments/<id>/replies \
  --method POST \
  --field body="Fixed in \`$COMMIT\`. <explanation>"
```

Resolve threads via GraphQL:

```bash
gh api graphql -f query='
  mutation {
    resolveReviewThread(input: {threadId: "<thread-node-id>"}) {
      thread { isResolved }
    }
  }
'
```

For suggestions not applied:

```bash
gh api repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments/<id>/replies \
  --method POST \
  --field body="Not applied: <reason>. The current approach <explanation>."
```

### Step 6: Push Fixes

Announce: `Running Step 6: Push fixes...`

```bash
git push
```

### Step 7: Re-poll (Max 3 Cycles, with Completion Signal)

Announce: `Running Step 7: Re-poll for new comments...`

After pushing, CodeRabbit may leave new comments on the fixes. Use the **completion signal pattern** (inline):

"No new comments" must be confirmed 3 consecutive times before the loop stops — a single check could miss comments still being posted. Output `ENVOY_LOOP_COMPLETE` on each clean check; reset the counter when new comments appear.

```bash
LAST_PUSH=$(git log -1 --format=%cI)
NEW_COMMENTS=$(gh api repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments \
  --jq "[.[] | select(.user.login == \"coderabbitai\") | select(.created_at > \"$LAST_PUSH\")] | length")

if [ "$NEW_COMMENTS" -eq 0 ]; then
  echo "ENVOY_LOOP_COMPLETE — no new comments (check N/3)"
else
  echo "New comments found: $NEW_COMMENTS — reset completion counter"
fi
```

**If new comments:** address -> reply -> resolve -> push -> re-poll. Reset completion counter.

**Max 3 address-and-push cycles.** After 3 cycles with remaining issues:

```
**Escalation: CodeRabbit cycle limit reached**

After 3 cycles, these comments remain unresolved:
- <comment 1>
- <comment 2>

Please review and decide how to proceed.
```

### Step 8: Poll CI and Auto-Fix Failures

Announce: `Running Step 8: Poll CI...`

After CodeRabbit is resolved, poll GitHub Actions for CI status:

```bash
# CI: 15min max (synchronous checks, faster feedback loop)
# Poll with exponential backoff — 15min timeout
# intervals: 30s, 60s, 120s, 240s, 240s, 240s (cumulative: 15.5min)
ELAPSED=0
for WAIT in 30 60 120 240 240 240; do
  CHECKS=$(gh pr checks $PR_NUMBER --json name,state,conclusion 2>/dev/null)
  PENDING=$(echo "$CHECKS" | jq '[.[] | select(.state == "PENDING" or .state == "QUEUED")] | length')

  if [ "$PENDING" -eq 0 ]; then
    break  # All checks resolved
  fi

  ELAPSED=$((ELAPSED + WAIT))
  if [ "$ELAPSED" -ge 900 ]; then
    echo "CI checks still running after 15 minutes. Pending: $PENDING"
    break
  fi

  echo "CI checks still running ($PENDING pending, ${ELAPSED}s elapsed). Next poll in ${WAIT}s..."
  sleep $WAIT
done

FAILED=$(echo "$CHECKS" | jq '[.[] | select(.conclusion == "FAILURE")] | length')
```

**If all checks pass:** proceed to final verification (Step 9).

**If any checks fail:** invoke fix-ci logic:

```
/envoy:fix-ci $PR_NUMBER
```

This runs the full fix-ci cycle: classify failures, diagnose, fix, verify locally, push, re-poll. Max 3 fix cycles before escalation.

**After fix-ci completes (or escalates):** proceed to final verification.

### Step 9: Final Verification

Announce: `Running Step 9: Final verification...`

Run envoy:verification with evidence:

```bash
# Tests
dotnet test
npm test

# Build
dotnet build
npm run build

# Lint
npm run lint

# CI status (exclude pending/queued — only show actual failures)
gh pr checks $PR_NUMBER --json name,state,conclusion \
  --jq '.[] | select(.state != "PENDING" and .state != "QUEUED") | select(.conclusion != "SUCCESS") | .name + ": " + .conclusion'

# Zero unresolved PR conversations
gh api graphql -f query='
  query {
    repository(owner: "'$OWNER'", name: "'$REPO'") {
      pullRequest(number: '$PR_NUMBER') {
        reviewThreads(first: 100) {
          nodes { isResolved }
        }
      }
    }
  }
' --jq '.data.repository.pullRequest.reviewThreads.nodes | map(select(.isResolved == false)) | length'
```

**All checks must pass with evidence.**

### Step 10: Wiki Sync

Announce: `Running Step 10: Wiki sync...`

Check if docs/wiki/ has changes on this branch:

```bash
git diff main...HEAD --name-only | grep "^docs/wiki/"
```

**If docs/wiki/ was changed:**

**YOU MUST invoke `/envoy:wiki-sync` here. Do NOT look for a shell script. Do NOT skip this step. Use the skill.**

```
/envoy:wiki-sync
```

If wiki-sync fails: do NOT proceed to Step 11. Diagnose and fix the wiki-sync error first.

**If docs/wiki/ was NOT changed:** skip to Step 11.

### Step 11: Report

```
**Branch finalized**

| Step | Status |
|------|--------|
| PR | ✓ Created (#<number>) |
| GitHub CodeRabbit | ✓ <N> comments resolved |
| CI/CD | ✓ All checks passing |
| CI fix cycles | <N>/3 used |
| CodeRabbit cycles | <N>/3 used |
| Verification | ✓ Tests, build, lint pass |
| Unresolved conversations | 0 |
| Wiki sync | ✓ Synced / — No docs/wiki/ changes |

**Pull Request:** <URL>

**Next steps:**
1. Request human reviewers
2. Address any human feedback
3. Merge when approved
4. `/envoy:cleanup` to remove worktree and branch
```

---

## Error Handling

### Tests Fail

```
**Cannot finalize: Tests failing**

Failed tests:
- <test names>

Fix tests before finalizing.
```

### PR Creation Fails

```
**PR creation failed:** <error>

Try: gh pr create --web
```

---

## Integration with Envoy

- Assumes `envoy:review` (layered review) has already been run
- Invokes `envoy:fix-ci` for CI failure auto-remediation
- Invokes `envoy:wiki-sync` when docs/wiki/ changes are detected
- Uses `envoy:verification` principles (evidence before assertions)
- Uses `lib/loop-safeguards.js` completion signal protocol
- Follow with `/envoy:cleanup` after PR is merged

**Platform constraint:** Claude Code subagents cannot spawn subagents (the `Agent` tool is silently stripped from subagent tool allowlists). This skill therefore orchestrates directly rather than delegating to an execution agent.
