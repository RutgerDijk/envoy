---
name: pickup
description: Pick up a GitHub issue, create worktree, and start implementation. Use when ready to implement an issue.
---

# Pickup Issue

## Overview

Pick up a GitHub issue created by envoy:brainstorming. Creates a worktree, loads context, and **automatically continues to execution** if a plan exists.

**Announce at start:** "I'm using envoy:pickup to implement issue #<number>."

## Arguments

| Flag | Effect |
|------|--------|
| `<issue-number>` | Required: GitHub issue to pick up |
| `--plan-only` | Stop after setup, don't auto-execute |

## Process

### Step 1: Fetch Issue Details

```bash
gh issue view <issue-number> --json title,body,labels
```

Parse the response to extract:
- Title (for branch naming)
- Body (for linked spec path)
- Labels (for context)

### Step 2: Extract Linked Spec

Look for the "Linked Spec" section in the issue body:

```
## Linked Spec

[View full design](docs/plans/YYYY-MM-DD-<topic>-design.md)
```

Extract the path: `docs/plans/YYYY-MM-DD-<topic>-design.md`

### Step 3: Create Topic Name

Convert issue title to branch-friendly name:

```bash
# "Add User Authentication" → "add-user-authentication"
TOPIC=$(echo "<issue-title>" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-')
```

### Step 4: Create Worktree

Use envoy:using-git-worktrees:

```bash
# Ensure .worktrees/ is gitignored
grep -q "^\.worktrees/$" .gitignore 2>/dev/null || echo ".worktrees/" >> .gitignore

# Create worktree
git worktree add .worktrees/$TOPIC -b feature/$TOPIC

# Copy Claude settings to worktree
cp -r .claude .worktrees/$TOPIC/
```

**After copying:** Merge Envoy's recommended permissions into the worktree's `.claude/settings.local.json`:
- Read existing permissions
- Add any missing Envoy permissions (see envoy:using-git-worktrees for full list)
- Preserve all user's existing permissions
- Key additions: `Bash(*)`, `Skill(*)`, `Task`, `mcp__chrome-devtools__*`

```bash
# Navigate to worktree
cd .worktrees/$TOPIC
```

### Step 5: Load Context

1. **Read the linked spec document** — Understand what needs to be built
2. **Detect project stack** — Auto-load relevant stack profiles
3. **Check for existing plan** — Look for `*-plan.md` matching the design doc

### Step 6: Report Ready State and Continue

"**Workspace ready for issue #<number>: <title>**

- **Worktree:** `.worktrees/<topic>`
- **Branch:** `feature/<topic>`
- **Spec:** `<spec-path>`
- **Plan:** `<plan-path>` (or 'None')
- **Stack profiles:** `<detected-stacks>`"

### Step 7: Auto-Continue to Execution

**If plan exists AND not `--plan-only`:**
- Announce: "Plan found. Continuing with execution..."
- Invoke `envoy:executing-plans` with the plan path
- Continue through the full implementation

**If no plan exists:**
- Stop and report:
  "No implementation plan found. Create one first:
  `/envoy:write-plan <spec-path>`"

**If `--plan-only` flag:**
- Stop after setup, let user decide next step

## Error Handling

### Issue Not Found

```
Issue #<number> not found.

Check:
- Is the issue number correct?
- Do you have access to the repository?

Run `gh issue list` to see available issues.
```

### No Linked Spec

```
Issue #<number> has no linked spec document.

This issue may not have been created with /envoy:brainstorm.
You can still create a worktree manually and work from the issue description.
```

### Worktree Already Exists

```
Worktree for this issue already exists at: .worktrees/<topic>

To continue working:
  cd .worktrees/<topic>

To start fresh:
  git worktree remove .worktrees/<topic>
  Then run /envoy:pickup <number> again
```

### Spec File Not Found

```
Linked spec not found: <path>

The spec may have been moved or deleted. Check:
- `docs/plans/` for similar files
- Git history for the file

Or create a new spec with /envoy:brainstorm.
```

## Stack Detection

After creating the worktree, detect the project stack by checking for:

| File | Stack Profile |
|------|---------------|
| `*.csproj` | dotnet, entity-framework, testing-dotnet |
| `package.json` with "react" | react, typescript |
| `tsconfig.json` | typescript |
| `Dockerfile` | docker-compose |
| `*.bicep` | bicep, azure |
| `.github/workflows/` | github-actions |

Load detected profiles to inform implementation.
