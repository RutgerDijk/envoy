---
mode: 'agent'
description: 'Remove worktree and feature branch after a PR has been merged'
---

# Cleanup After Merge

Remove the worktree and feature branch after a PR has been merged to main.

## Verify PR is Merged

```bash
gh pr view --json state,mergedAt | jq -r '.state, .mergedAt'
```

**If the PR is not in MERGED state, do not continue.**

## Get Current Context

```bash
BRANCH=$(git branch --show-current)
WORKTREE_PATH=$(pwd)
MAIN_REPO=$(git worktree list | head -1 | awk '{print $1}')
```

## Switch to Main Repository

```bash
cd "$MAIN_REPO"
git checkout main
git pull origin main
```

## Remove the Worktree

```bash
git worktree remove "$WORKTREE_PATH"
```

If there are uncommitted changes preventing removal:
```bash
git worktree remove --force "$WORKTREE_PATH"
```

## Delete the Feature Branch

```bash
# Delete local branch
git branch -d "$BRANCH"

# Delete remote branch (if not auto-deleted by GitHub)
git push origin --delete "$BRANCH" 2>/dev/null || echo "Remote branch already deleted"
```

## Close the Linked Issue

Find and close the GitHub issue linked to this PR:

```bash
# Get the issue number from the PR (if linked via "Closes #N")
ISSUE=$(gh pr view --json body -q '.body' | grep -oE 'Closes? #[0-9]+' | grep -oE '[0-9]+' | head -1)

if [ -n "$ISSUE" ]; then
  gh issue close "$ISSUE" --comment "✅ Implemented and merged via PR."
  echo "Closed issue #$ISSUE"
fi
```

## Summary

Output a summary:
```
✅ Cleanup complete

- Worktree removed: <path>
- Branch deleted: <branch>
- Issue closed: #<number>
- Main branch updated to: <commit hash>
```
