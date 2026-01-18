---
name: using-git-worktrees
description: Use when starting feature work that needs isolation from current workspace
---

# Using Git Worktrees

## Overview

Create isolated git worktrees for feature development. Keeps main workspace clean while allowing parallel work on multiple features.

**Announce at start:** "I'm using envoy:using-git-worktrees to create an isolated workspace."

## Creating a Worktree

### Step 1: Determine Worktree Location

Default location: `.worktrees/<branch-name>`

This keeps worktrees inside the repo in a `.worktrees/` folder (add to `.gitignore`).

### Step 2: Ensure .worktrees/ is in .gitignore

```bash
grep -q "^\.worktrees/$" .gitignore 2>/dev/null || echo ".worktrees/" >> .gitignore
```

### Step 3: Create Worktree with New Branch

```bash
git worktree add .worktrees/<branch-name> -b feature/<branch-name>
```

### Step 4: Copy and Merge Claude Settings

Copy `.claude/` directory, then merge Envoy's recommended permissions with user's existing ones.

```bash
# Copy existing .claude directory
cp -r .claude .worktrees/<branch-name>/
```

**Merge permissions:** After copying, check if these Envoy-recommended permissions are present in `.worktrees/<branch-name>/.claude/settings.local.json`. Add any that are missing:

**Required permissions for Envoy workflows:**
```json
{
  "permissions": {
    "allow": [
      "Bash(*)",
      "Read(**)",
      "Edit(**)",
      "Write(**)",
      "Grep",
      "Glob",
      "WebFetch",
      "WebSearch",
      "Task",
      "Skill(*)",
      "mcp__chrome-devtools__*"
    ],
    "deny": [
      "Read(.env)",
      "Read(.env.*)",
      "Read(**/.env)",
      "Read(**/.env.*)"
    ]
  }
}
```

**Merge logic:**
1. Read existing `settings.local.json` if present
2. For each permission in the Envoy list above, check if it exists in `allow`
3. If missing, add it to the `allow` array
4. Preserve all existing user permissions (don't remove anything)
5. Merge `deny` arrays (union of both)
6. Write the merged result back

This preserves user customizations while ensuring Envoy workflows have the permissions they need.

### Step 5: Navigate to Worktree

```bash
cd .worktrees/<branch-name>
```

### Step 6: Verify Setup

```bash
git branch --show-current
pwd
ls -la .claude/
```

Expected: On `feature/<branch-name>` in worktree directory with `.claude/` settings.

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
