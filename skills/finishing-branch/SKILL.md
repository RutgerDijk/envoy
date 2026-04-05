---
name: finishing-branch
description: Use when implementation is complete and you're ready to create a PR
---

# Finishing a Development Branch

## Overview

Ship the work: create PR, handle GitHub CodeRabbit comments, verify, done. This skill assumes `/envoy:review` has already been run — it does NOT re-run local reviews.

**Announce at start:** "I'm using envoy:finishing-branch to create a PR and ship this work."

## Preconditions

```bash
# 1. On a feature branch (not main/master)
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" == "main" || "$BRANCH" == "master" ]]; then
  echo "ERROR: Cannot finalize on main/master branch"
  exit 1
fi

# 2. Working directory is clean
if [[ -n $(git status --porcelain) ]]; then
  echo "ERROR: Uncommitted changes — commit or stash first"
  exit 1
fi

# 3. Tests pass
dotnet test
npm test
```

**If any precondition fails, stop and resolve.**

## Process

### Step 1: Docstrings

Use envoy:docstrings to document public APIs:

```
/envoy:docstrings
```

```bash
git add -p
git commit -m "docs: add docstrings to public APIs"
```

### Step 2: Update Documentation

If needed:
1. **New features** → Add to relevant wiki pages
2. **API changes** → Update API docs
3. **Configuration changes** → Update setup docs

```bash
git add docs/wiki/
git commit -m "docs: update wiki documentation"
```

### Step 3: Push and Create PR

```bash
git push -u origin HEAD
```

```bash
gh pr create --title "<title>" --body "$(cat <<'PREOF'
## Summary

<Brief description of changes>

## Changes

- **Implementation:** <main work summary>
- **Documentation:** <what was updated>

## Test Plan

- [ ] Unit tests pass
- [ ] E2E tests pass
- [ ] Visual review passed

## Linked Issue

Closes #<issue-number>

---

*Created with Envoy*
PREOF
)"
```

Save the PR number.

### Step 4: Poll for GitHub CodeRabbit Comments

GitHub CodeRabbit App reviews the PR asynchronously. Poll for comments:

```bash
OWNER=$(gh repo view --json owner -q '.owner.login')
REPO=$(gh repo view --json name -q '.name')
PR_NUMBER=<number>

# Wait briefly for CodeRabbit to start (usually 1-2 minutes)
# Then poll for comments
gh api repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments \
  --jq '.[] | select(.user.login == "coderabbitai") | {id, path, line, body}'
```

If no comments after 3-5 minutes, CodeRabbit may not be installed or the PR is clean. Continue to verification.

### Step 5: Address All CodeRabbit Findings

**No skipping — address everything including nitpicks.**

For each CodeRabbit comment:
1. Read the suggestion
2. Apply the fix (or explain why not)
3. Commit

```bash
git add -p
git commit -m "fix: address CodeRabbit feedback — <summary>"
```

### Step 6: Reply and Resolve Each Comment

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

### Step 7: Push Fixes

```bash
git push
```

### Step 8: Re-poll (Max 3 Cycles, with Completion Signal)

After pushing, CodeRabbit may leave new comments on the fixes. Use the **completion signal protocol** from `lib/loop-safeguards.js`:

"No new comments" must be confirmed 3 consecutive times (`ENVOY_LOOP_COMPLETE`) before the loop stops — a single check could miss comments still being posted.

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

**If new comments:** address → reply → resolve → push → re-poll. Reset completion counter.

**Max 3 address-and-push cycles.** After 3 cycles with remaining issues:

```
**Escalation: CodeRabbit cycle limit reached**

After 3 cycles, these comments remain unresolved:
- <comment 1>
- <comment 2>

Please review and decide how to proceed.
```

### Step 9: Final Verification

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

# Health check
curl -sf http://localhost:5000/health && echo "✓ Backend" || echo "✗ Backend"
curl -sf http://localhost:5173 && echo "✓ Frontend" || echo "✗ Frontend"

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

### Step 10: Clear Session State

Clean up session state and scratchpad files — the work is shipped:

```javascript
const session = require('../../lib/session-state');
const scratchpad = require('../../lib/agent-scratchpad');
session.clear();     // Remove .envoy-session.json
scratchpad.clear();  // Remove .envoy-scratchpad.json (if exists)
```

### Step 11: Wiki Sync

```
/envoy:wiki-sync
```

### Step 12: Report

```
**Branch finalized**

| Step | Status |
|------|--------|
| Docstrings | ✓ Added |
| PR | ✓ Created (#<number>) |
| GitHub CodeRabbit | ✓ <N> comments resolved |
| Verification | ✓ Tests, build, lint, health pass |
| Unresolved conversations | 0 |
| Session state | ✓ Cleared |
| Wiki | ✓ Synced |
| CodeRabbit cycles | <N>/3 used |

**Pull Request:** <URL>

**Next steps:**
1. Wait for CI to pass
2. Request human reviewers
3. Address any human feedback
4. Merge when approved
5. `/envoy:cleanup` to remove worktree and branch
```

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

### Wiki Sync Conflict

```
**Wiki sync conflict**

Options:
1. Overwrite with docs/wiki/ content
2. Merge manually
3. Skip wiki sync
```

## Checklist

- [ ] **Preconditions:** Feature branch, clean state, tests pass
- [ ] **Docstrings:** Public APIs documented
- [ ] **PR created**
- [ ] **GitHub CodeRabbit:** All comments addressed, replied to, resolved
- [ ] **Verification:** Tests, build, lint, health, zero unresolved
- [ ] **Session state:** Cleared (.envoy-session.json, .envoy-scratchpad.json)
- [ ] **Wiki:** Synced
