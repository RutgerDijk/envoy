---
name: using-git-worktrees
description: Create isolated workspaces for feature development. Use when starting implementation to avoid polluting main workspace.
---

# Using Git Worktrees

## Overview

Create isolated git worktrees for feature development. Keeps main workspace clean while allowing parallel work on multiple features.

**Announce at start:** "I'm using envoy:using-git-worktrees to create an isolated workspace."

## Creating a Worktree

### Step 1: Determine Worktree Location

Default location: `.worktrees/<branch-name>`

This keeps worktrees inside the repo in a `.worktrees/` folder (add to `.gitignore`).

### Step 2: Create Worktree with New Branch

```bash
git worktree add .worktrees/<branch-name> -b feature/<branch-name>
```

### Step 3: Navigate to Worktree

```bash
cd .worktrees/<branch-name>
```

### Step 4: Verify Setup

```bash
git branch --show-current
pwd
```

Expected: On `feature/<branch-name>` in worktree directory.

## Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Worktree dir | `.worktrees/<topic>` | `.worktrees/user-auth` |
| Feature branch | `feature/<topic>` | `feature/user-auth` |
| Bugfix branch | `fix/<topic>` | `fix/login-error` |
| Refactor branch | `refactor/<topic>` | `refactor/api-cleanup` |

## Working in a Worktree

Once in the worktree:

1. **Install dependencies** (if needed):
   ```bash
   # For .NET
   dotnet restore

   # For Node.js
   npm install
   ```

2. **Start development** — The worktree is a full clone, work normally

3. **Commit frequently** — Push to remote for backup:
   ```bash
   git push -u origin HEAD
   ```

## Listing Worktrees

```bash
git worktree list
```

## Switching Between Worktrees

Just `cd` to the worktree directory — each is independent.

## Cleanup

After merging the feature branch, remove the worktree:

```bash
# From main repo
git worktree remove .worktrees/<branch-name>

# Or force remove if dirty
git worktree remove --force .worktrees/<branch-name>
```

Then optionally delete the branch:

```bash
git branch -d feature/<branch-name>
```

## Tips

- **One worktree per feature** — Keeps work isolated
- **Commit frequently** — Worktrees can be removed, commits persist
- **Push to remote** — Backup your work
- **Don't delete worktree until merged** — Ensure work is preserved
- **Use descriptive names** — Makes `git worktree list` useful
