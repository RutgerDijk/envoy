---
name: pickup
description: Use when ready to implement a GitHub issue that was created via brainstorming
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
gh issue view <issue-number> --json title,body,labels,state
```

Parse the response to extract:
- Title (for branch naming)
- Body (for linked spec path)
- Labels (for context)
- State (to verify it's open)

### Step 2: Set Issue to In Progress

Mark the issue as being actively worked on:

```bash
# Add "in progress" label (create if doesn't exist)
gh issue edit <issue-number> --add-label "in progress"

# If your project uses GitHub Projects, move to "In Progress" column
# gh project item-edit --project-id <id> --id <item-id> --field-id <status-field> --single-select-option-id <in-progress-id>

# Add a comment to track when work started
gh issue comment <issue-number> --body "🚀 Started working on this issue in branch \`feature/$TOPIC\`"
```

### Step 3: Extract Feature Branch

Look for the "Feature Branch" section in the issue body:

```
## Feature Branch

`feature/42-add-user-authentication` — spec is committed here, ready for implementation
```

Extract the branch name: `feature/42-add-user-authentication`

Also extract the spec path from the "Linked Spec" section (points to file on the branch).

### Step 4: Fetch Feature Branch

The feature branch was created by brainstorming and contains the spec. Fetch it:

```bash
# Fetch the feature branch from remote
git fetch origin feature/<issue-number>-<topic>

# Extract topic for worktree directory name
TOPIC="<issue-number>-<topic>"
BRANCH="feature/$TOPIC"
```

### Step 5: Create Worktree from Existing Branch

Use envoy:using-git-worktrees. **Worktrees are ALWAYS created in `.worktrees/`** — no exceptions.

```bash
# Ensure .worktrees/ is gitignored
grep -q "^\.worktrees/$" .gitignore 2>/dev/null || echo ".worktrees/" >> .gitignore

# Create worktree from EXISTING remote branch (not -b for new branch)
# ALWAYS in .worktrees/ - never use /tmp or other locations
git worktree add .worktrees/$TOPIC origin/$BRANCH

# Copy Claude settings to worktree
cp -r .claude .worktrees/$TOPIC/
```

**Note:** We use `origin/$BRANCH` without `-b` because the branch already exists on remote (created by brainstorming).

### Step 5b: Merge Permissions (REQUIRED)

**After copying .claude/, merge Envoy's required permissions into the worktree's settings.**

Read `.worktrees/$TOPIC/.claude/settings.local.json` and ensure these permissions exist in `allow`:

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
2. For each permission above, check if it exists in `allow`
3. If missing, add it to the `allow` array
4. **Preserve all existing user permissions** (don't remove anything)
5. Merge `deny` arrays (union of both)
6. Write the merged result back

This ensures Envoy workflows work while keeping user customizations.

```bash
# Navigate to worktree
cd .worktrees/$TOPIC
```

### Step 6: Load Context

1. **Read the linked spec document** — Contains both design AND implementation tasks
2. **Detect project stack** — Auto-load relevant stack profiles
3. **Check for Implementation Plan section** — Verify spec has tasks to execute

### Step 7: Report Ready State and Continue

"**Workspace ready for issue #<number>: <title>**

| Item | Value |
|------|-------|
| Issue | #<number> 🚀 In Progress |
| Branch | `feature/<number>-<topic>` (fetched from remote) |
| Worktree | `.worktrees/<number>-<topic>` |
| Spec | `<spec-path>` (design + N tasks) |
| Stack profiles | `<detected-stacks>` |

The spec was created during brainstorming and is already committed to the feature branch."

### Step 8: Auto-Continue to Execution

**If spec has Implementation Plan section AND not `--plan-only`:**
- Announce: "Spec has implementation tasks. Continuing with execution..."
- Invoke `envoy:executing-plans` with the spec path
- Continue through the full implementation

**If spec has no Implementation Plan section:**
- Stop and report:
  "Spec has no implementation tasks. Add them first:
  `/envoy:writing-plans <spec-path>`"

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

### No Feature Branch

```
Issue #<number> has no feature branch specified.

This issue may not have been created with /envoy:brainstorming.

Options:
1. Create spec and branch manually:
   /envoy:brainstorming (start fresh)

2. Work directly from issue description:
   git checkout -b feature/<number>-<topic>
   git worktree add .worktrees/<topic> feature/<number>-<topic>
```

### Feature Branch Not Found on Remote

```
Feature branch not found: feature/<number>-<topic>

The branch may have been deleted or not pushed.

Check:
- git branch -r | grep <topic>
- Was the brainstorming completed successfully?

To create the branch manually:
  git checkout -b feature/<number>-<topic>
  git push -u origin feature/<number>-<topic>
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

Or create a new spec with /envoy:brainstorming.
```

### Spec Has No Implementation Tasks

```
Spec found but has no Implementation Plan section: <path>

The spec only contains design, not implementation tasks.

To add tasks:
  /envoy:writing-plans <spec-path>
```

## Stack Detection and Loading

After creating the worktree, detect and load stack profiles:

### Step 1: Run Detection Script

```bash
# From the Envoy plugin directory
~/.claude/plugins/cache/envoy-marketplace/envoy/*/stacks/detect-stacks.sh --json
```

Or manually detect by checking for:

| File | Stack Profiles |
|------|----------------|
| `*.csproj` | dotnet, entity-framework, testing-dotnet |
| `package.json` with "react" | react, typescript, shadcn-radix, react-query |
| `tsconfig.json` | typescript |
| `docker-compose*.yml` | docker-compose |
| `*.bicep` | bicep, azure-container-apps |
| `.github/workflows/` | github-actions |

### Step 2: Read Detected Stack Profiles

For each detected stack, read the profile from `stacks/<stack-name>.md`:

```bash
# Example: If dotnet, react, postgresql detected
cat stacks/dotnet.md
cat stacks/react.md
cat stacks/postgresql.md
```

### Step 3: Extract Key Information

From each stack profile, note:
- **Common mistakes** — Avoid these during implementation
- **Best practices** — Follow these patterns
- **Review checklist** — Will be checked during review

Keep this context loaded for the implementation phase.
