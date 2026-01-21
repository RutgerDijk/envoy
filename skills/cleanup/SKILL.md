---
name: cleanup
description: Use after your PR has been merged to main, before starting new work
---

# Cleanup After Merge

## Overview

Remove the worktree and feature branch after a PR has been merged. Keeps your workspace clean.

**Announce at start:** "I'm using envoy:cleanup to remove the worktree and branch."

## Preconditions

Before cleanup, verify:

```bash
# 1. PR is actually merged
gh pr view --json state,mergedAt | jq -r '.state, .mergedAt'
# Should show: MERGED and a timestamp

# 2. You're in the worktree (not main repo)
pwd
# Should be in .worktrees/<topic>
```

**If PR is not merged, do NOT clean up.**

## Process

### Step 1: Get Current Branch and Worktree Info

```bash
BRANCH=$(git branch --show-current)
WORKTREE_PATH=$(pwd)
MAIN_REPO=$(git worktree list | grep -v ".worktrees" | awk '{print $1}')
```

### Step 2: Switch to Main Repository

```bash
cd "$MAIN_REPO"
```

### Step 3: Update Main Branch

```bash
git checkout main
git pull origin main
```

### Step 4: Remove Worktree

```bash
git worktree remove "$WORKTREE_PATH"
```

If there are uncommitted changes (shouldn't happen if PR is merged):
```bash
git worktree remove --force "$WORKTREE_PATH"
```

### Step 5: Delete Feature Branch

**Local branch:**
```bash
git branch -d "$BRANCH"
```

**Remote branch (if not auto-deleted by GitHub):**
```bash
git push origin --delete "$BRANCH"
```

### Step 6: Close Linked Issue

Find and close the GitHub issue linked to this PR:

```bash
# Get the PR number for this branch
PR_NUMBER=$(gh pr list --head "$BRANCH" --state merged --json number --jq '.[0].number')

# Get the linked issue number from the PR body
ISSUE_NUMBER=$(gh pr view "$PR_NUMBER" --json body --jq '.body' | grep -oE 'Closes #[0-9]+|Fixes #[0-9]+|Resolves #[0-9]+' | grep -oE '[0-9]+' | head -1)

if [ -n "$ISSUE_NUMBER" ]; then
  # Close the issue if not already closed
  ISSUE_STATE=$(gh issue view "$ISSUE_NUMBER" --json state --jq '.state')
  if [ "$ISSUE_STATE" != "CLOSED" ]; then
    gh issue close "$ISSUE_NUMBER" --comment "Completed via PR #$PR_NUMBER"
    echo "✓ Issue #$ISSUE_NUMBER closed"
  else
    echo "✓ Issue #$ISSUE_NUMBER already closed"
  fi
else
  echo "⚠ No linked issue found in PR"
fi
```

### Step 7: Verify Cleanup

```bash
# Worktree removed
git worktree list

# Branch deleted
git branch -a | grep "$BRANCH"
# Should return nothing

# Issue closed
gh issue view "$ISSUE_NUMBER" --json state --jq '.state'
# Should show: CLOSED
```

### Step 9: Report Completion

```
**Cleanup complete**

| Item | Status |
|------|--------|
| Worktree | ✓ Removed |
| Local branch | ✓ Deleted |
| Remote branch | ✓ Deleted |
| Issue #<number> | ✓ Closed |

You're now on `main` with a clean workspace.
Ready for next task.
```

## Error Handling

### PR Not Merged

```
**Cannot cleanup: PR not merged**

PR state: <state>

Wait for PR to be merged before cleaning up.
To check PR status: gh pr view
```

### Worktree Has Uncommitted Changes

```
**Worktree has uncommitted changes**

Changes:
<git status output>

Options:
1. Commit and push (then re-run cleanup)
2. Discard changes (git checkout .)
3. Force remove (loses changes)

Choice?
```

### Branch Delete Fails

```
**Could not delete branch: <branch>**

This might happen if:
- Branch has unmerged commits
- Branch is protected

To force delete: git branch -D <branch>
```

## Arguments

| Flag | Effect |
|------|--------|
| (none) | Clean up current worktree/branch |
| `<branch-name>` | Clean up specific branch |
| `--force` | Force remove even with uncommitted changes |
| `--all` | Clean up ALL merged worktrees |

## Clean Up All Merged Worktrees

With `--all` flag, find and clean all worktrees whose PRs are merged:

```bash
# List all worktrees
git worktree list

# For each worktree (except main):
#   Check if branch's PR is merged
#   If merged, remove worktree and branch
```
