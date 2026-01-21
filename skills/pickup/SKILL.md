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

### Step 3: Extract Linked Spec

Look for the "Linked Spec" section in the issue body:

```
## Linked Spec

[View full design](docs/plans/YYYY-MM-DD-<topic>-design.md)
```

Extract the path: `docs/plans/YYYY-MM-DD-<topic>-design.md`

### Step 4: Create Topic Name

Convert issue title to branch-friendly name:

```bash
# "Add User Authentication" → "add-user-authentication"
TOPIC=$(echo "<issue-title>" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-')
```

### Step 5: Create Worktree

Use envoy:using-git-worktrees:

```bash
# Ensure .worktrees/ is gitignored
grep -q "^\.worktrees/$" .gitignore 2>/dev/null || echo ".worktrees/" >> .gitignore

# Create worktree
git worktree add .worktrees/$TOPIC -b feature/$TOPIC

# Copy Claude settings to worktree
cp -r .claude .worktrees/$TOPIC/
```

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

1. **Read the linked spec document** — Understand what needs to be built
2. **Detect project stack** — Auto-load relevant stack profiles
3. **Check for existing plan** — Look for `*-plan.md` matching the design doc

### Step 7: Report Ready State and Continue

"**Workspace ready for issue #<number>: <title>**

| Item | Value |
|------|-------|
| Issue status | 🚀 In Progress |
| Worktree | `.worktrees/<topic>` |
| Branch | `feature/<topic>` |
| Spec | `<spec-path>` |
| Plan | `<plan-path>` (or 'None') |
| Stack profiles | `<detected-stacks>` |"

### Step 8: Auto-Continue to Execution

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
