---
mode: 'agent'
description: 'Pick up a GitHub issue and implement it in a worktree with TDD'
---

# Pickup Issue

Pick up a GitHub issue (created via `/brainstorm`) and implement it from start to finish.

**Usage:** `/pickup <issue-number>`

## Step 1: Fetch and Validate Issue

```bash
gh issue view <issue-number> --json title,body,labels,state
```

Verify the issue is open. Extract:
- Title (for branch naming)
- Linked spec path from the "Linked Spec" section
- Feature branch name from the "Feature Branch" section

## Step 2: Mark as In Progress

```bash
gh issue edit <issue-number> --add-label "in progress"
gh issue comment <issue-number> --body "🚀 Started working on this issue in branch \`feature/<topic>\`"
```

## Step 3: Fetch the Feature Branch

```bash
git fetch origin feature/<topic>
TOPIC="<issue-number>-<short-topic>"
BRANCH="feature/$TOPIC"
```

## Step 4: Create Worktree

Worktrees are **always** created in `.worktrees/`. No exceptions.

```bash
# Ensure .worktrees/ is gitignored
grep -q "^\.worktrees/$" .gitignore 2>/dev/null || echo ".worktrees/" >> .gitignore

# Create worktree from the existing remote branch
git worktree add .worktrees/$TOPIC origin/feature/<original-topic>
```

## Step 5: Load the Spec

Read the spec file linked in the issue (on the feature branch):

```bash
cat .worktrees/$TOPIC/docs/plans/<spec-file>.md
```

Identify:
- Execution strategy (`parallel`, `batch`, or `sequential`)
- All tasks with their files and steps
- Acceptance criteria

## Step 6: Execute the Plan

Follow the `/execute-plan` workflow for the loaded spec, using the worktree as working directory.

All implementation must follow TDD:
1. Write failing test
2. Confirm test fails
3. Write minimal code to pass
4. Confirm test passes
5. Commit test + implementation together

## Step 7: When All Tasks Are Done

Run the full verification:

```bash
cd .worktrees/$TOPIC
dotnet test          # All .NET tests
npm test             # All frontend tests
dotnet build         # Build succeeds
npm run build        # Frontend build succeeds
npm run lint         # No lint errors
```

Then use `/finalize` to review, add docstrings, sync wiki, and create the PR.
