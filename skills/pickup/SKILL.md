---
name: pickup
description: Pick up a GitHub issue and prepare workspace for implementation. Use when another developer created the issue and you're implementing it.
---

# Pickup Issue

## Overview

Pick up a GitHub issue created by envoy:brainstorming. Creates a worktree, loads the linked spec, and prepares for execution.

**Announce at start:** "I'm using envoy:pickup to prepare issue #<number> for implementation."

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
git worktree add ../envoy-worktrees/$TOPIC -b feature/$TOPIC
cd ../envoy-worktrees/$TOPIC
```

### Step 5: Load Context

1. **Read the linked spec document** — Understand what needs to be built
2. **Detect project stack** — Auto-load relevant stack profiles
3. **Check for existing plan** — Look for `*-plan.md` matching the design doc

### Step 6: Report Ready State

"**Workspace ready for issue #<number>: <title>**

- **Worktree:** `../envoy-worktrees/<topic>`
- **Branch:** `feature/<topic>`
- **Spec:** `<spec-path>`
- **Stack profiles:** `<detected-stacks>`
- **Plan exists:** Yes/No

**Next steps:**"

If no plan exists:
"1. `/envoy:write-plan` — Create implementation plan from the spec"

If plan exists:
"1. `/envoy:execute-plan` — Execute the implementation plan"

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
Worktree for this issue already exists at: ../envoy-worktrees/<topic>

To continue working:
  cd ../envoy-worktrees/<topic>

To start fresh:
  git worktree remove ../envoy-worktrees/<topic>
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
