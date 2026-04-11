---
name: pickup
description: Use when ready to implement a GitHub issue — creates worktree, writes plan, executes with TDD
---

# Pickup Issue

## Overview

Pick up a GitHub issue, create a worktree, write a spec with implementation plan, and execute tasks with TDD. This is the single entry point for going from issue to working code.

**Announce at start:** "I'm using envoy:pickup to implement issue #<number>."

## Arguments

| Flag | Effect |
|------|--------|
| `<issue-number>` | Required: GitHub issue to pick up |
| `--plan-only` | Stop after approval (Step 8) |

---

## Process

### Step 1: Fetch Issue

```bash
gh issue view <issue-number> --json title,body,labels,state
```

Parse the response to extract:
- **Title** (for branch naming)
- **Body** (design content, acceptance criteria)
- **Labels** (for context)
- **State** (verify it's open)

### Step 2: Set In Progress

Mark the issue as being actively worked on:

```bash
# Add "in progress" label (create if doesn't exist)
gh issue edit <issue-number> --add-label "in progress"

# Comment with branch name
gh issue comment <issue-number> --body "Started working on this issue in branch \`feature/<N>-$TOPIC\`"
```

### Step 3: Create Feature Branch

Create a new branch from main:

```bash
TOPIC=$(echo "<title>" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-' | head -c 40)
git checkout -b feature/<N>-$TOPIC main
```

### Step 4: Create Worktree

Use envoy:using-git-worktrees. **Worktrees are ALWAYS created in `.worktrees/`** — no exceptions.

```bash
# Ensure .worktrees/ is gitignored
grep -q "^\.worktrees/$" .gitignore 2>/dev/null || echo ".worktrees/" >> .gitignore

# Create worktree from the new branch
# ALWAYS in .worktrees/ - never use /tmp or other locations
git worktree add .worktrees/<N>-$TOPIC feature/<N>-$TOPIC

# Copy Claude settings to worktree
cp -r .claude .worktrees/<N>-$TOPIC/
```

### Step 5: Merge Permissions (REQUIRED)

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
cd .worktrees/<N>-$TOPIC
```

### Step 6: Detect Stack Profiles

After creating the worktree, detect and load stack profiles.

#### 6a: Run Detection

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

#### 6b: Read Detected Stack Profiles

For each detected stack, read the profile from `../../stacks/<stack-name>.md`.

Extract from each stack profile:
- **Common mistakes** — Avoid these during implementation
- **Best practices** — Follow these patterns
- **Review checklist** — Will be checked during review

Keep this context loaded for the implementation phase.

### Step 7: Viability Check

The implementation plan is in the GitHub issue body (fetched in Step 1). Read it now.

Verify the plan is still viable against the current repo state:
1. Do referenced file paths exist? (Or will be created as part of the plan — that's fine)
2. Have any referenced APIs, interfaces, or database schemas changed since the plan was written?
3. Are any referenced external dependencies missing?

**If viable:** proceed to Step 8.

**If stale:** surface specific staleness concerns:
```
Plan viability issue detected:
- <specific file/API that has changed>
- <what the plan expects vs. what exists now>

Options:
  A) Proceed anyway — the change is minor and the plan still holds
  B) Update the issue plan first, then re-run pickup

Awaiting your decision.
```

### Step 8: Pause for Approval

Show the plan summary:

```
**Plan verified** (from issue body)

| Item | Value |
|------|-------|
| Issue | #<number> (In Progress) |
| Branch | `feature/<N>-<topic>` |
| Worktree | `.worktrees/<N>-<topic>` |
| Tasks | N tasks |
| Strategy | parallel/batch/sequential |
| Stack profiles | <detected-stacks> |

**Task overview:**
1. Task 1: <name>
2. Task 2: <name>
...

**Execution strategy defaults** (if not specified in issue):
- 1–3 tasks → sequential
- 4–8 tasks → batch  
- 9+ tasks → parallel

If the issue plan specifies a strategy, use that. If uncertain, ask — do NOT assume.

**Ready to execute? (yes / edit / abort)**
```

**Branching logic:**
- If `--plan-only` flag: **Stop here.** Report the issue plan and exit.
- If user says **abort**: Stop. Remove "in progress" label.
- If user says **edit**: Let user modify the plan, then re-show the summary.
- If user says **yes**: Continue to Step 9.

### Step 9: Execute Tasks

#### 9a: Initialize Session State

Initialize session state for cross-session continuity:

```javascript
const session = require('../../lib/session-state');
const state = session.exists() ? session.load() : session.createEmpty();

if (state.tasks.length > 0) {
  // Resuming — report progress
  const done = state.tasks.filter(t => t.status === 'done').length;
  console.log(`Resuming: ${done}/${state.tasks.length} tasks complete`);
  console.log('Recent decisions:', state.decisions.slice(-3));
} else {
  // Fresh start
  state.branch = currentBranch;
  state.plan = `issue #${issueNumber}`;
  for (const task of planTasks) {
    session.updateTask(state, task.id, 'pending');
  }
  session.save(state);
}
```

#### 9b: Spawn Pickup Execution Agent

Collect context to pass:
- Issue body (full text — the execution agent parses the task plan from this)
- Branch name
- Detected stack profiles (from Step 6)

**YOU MUST spawn the Agent tool call below. Do NOT execute tasks inline. The execution agent enforces the Scope Iron Law, Blocker Protocol, and TDD Iron Law.**

```
Agent({
  subagent_type: "envoy:pickup-execution",
  description: "Execute implementation plan for issue #<number>",
  prompt: `Issue #<number>: <title>

Issue body:
<full issue body text>

Branch: <branch>
Stack profiles: <detected stacks>

Execute all tasks from the implementation plan in the issue body.`
})
```

The pickup-execution agent handles: task parsing, dependency analysis, TDD enforcement, two-stage review per task, Scope Iron Law, Blocker Protocol, and spec compliance verification.

---

## Report Completion

When all tasks complete:

```
**Execution complete for issue #<number>: <title>**

| Metric | Value |
|--------|-------|
| Tasks completed | N/N |
| Commits | M |
| Tests | All passing |
| Build | Success |
| Strategy | parallel/batch/sequential |

Next steps:
1. `/envoy:review` — Run comprehensive review
2. `/envoy:finalize` — Prepare PR (clears session state)
```

Update session state with next steps:
```javascript
const session = require('../../lib/session-state');
const state = session.load();
state.nextSteps = ['Run envoy:review', 'Run envoy:finalize'];
session.save(state);
```

---

## Error Handling

### Issue Not Found

```
Issue #<number> not found.

Check:
- Is the issue number correct?
- Do you have access to the repository?

Run `gh issue list` to see available issues.
```

### Issue Has No Acceptance Criteria

```
Issue #<number> has no acceptance criteria in the body.

Cannot write an implementation plan without clear acceptance criteria.

Options:
1. Add acceptance criteria to the issue and retry
2. Run /envoy:brainstorm to create a proper design first
```

### Worktree Already Exists

```
Worktree for this issue already exists at: .worktrees/<N>-<topic>

To continue working:
  cd .worktrees/<N>-<topic>

To start fresh:
  git worktree remove .worktrees/<N>-<topic>
  Then run /envoy:pickup <number> again
```

---

## Integration with Envoy

**Invokes:**
- `envoy:using-git-worktrees` — Worktree creation conventions
- `envoy:systematic-debugging` — For investigating issues during execution
- `envoy:test-driven-development` — TDD Iron Law applies to all tasks (enforced by pickup-execution agent)

**Libraries used:**
- `lib/session-state.js` — Persist task progress across context compactions and sessions

**After pickup completes:**
- `envoy:review` — Run comprehensive review
- `envoy:finalize` — Complete development, create PR (clears session state)
