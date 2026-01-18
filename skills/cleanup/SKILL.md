---
name: cleanup
description: Clean up worktree and feature branch after PR is merged. Use after your PR has been merged to main.
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

### Step 6: Verify Cleanup

```bash
# Worktree removed
git worktree list

# Branch deleted
git branch -a | grep "$BRANCH"
# Should return nothing
```

### Step 7: Report Completion

```
**Cleanup complete**

| Item | Status |
|------|--------|
| Worktree | ✓ Removed |
| Local branch | ✓ Deleted |
| Remote branch | ✓ Deleted |

You're now on `main` with a clean workspace.
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
