---
name: pickup
description: Use when ready to implement a GitHub issue — creates worktree, writes plan, executes with TDD
---

# Pickup Issue

## Overview

Pick up a GitHub issue, create a worktree, verify the implementation plan in the issue body, and execute tasks with TDD. This is the single entry point for going from issue to working code.

**Announce at start:** "I'm using envoy:pickup to implement issue #<number>."

**Discipline rule:** This is a rigid skill. The spec is the contract. Execute every task. Do NOT narrate, skip, or adapt steps. See `contexts/discipline-scope.md`, `contexts/discipline-tdd.md`, `contexts/discipline-blocker.md`, `contexts/discipline-task-granularity.md`, and `contexts/execution-announce.md`.

## Arguments

| Flag | Effect |
|------|--------|
| `<issue-number>` | Required: GitHub issue to pick up |
| `--plan-only` | Stop after approval (Step 8) |

---

## Iron Laws (Injected into All Subagent Prompts)

This skill loads the following discipline files once and injects them verbatim into every subagent prompt. Single source of truth — edit the context file to change the rule everywhere:

- `contexts/discipline-scope.md` — Scope Iron Law (spec is contract)
- `contexts/discipline-tdd.md` — TDD Iron Law (no production code without failing test first)
- `contexts/discipline-blocker.md` — Blocker Protocol
- `contexts/discipline-task-granularity.md` — 2–5 min per task
- `contexts/execution-announce.md` — announcement discipline

```bash
SCOPE_LAW=$(cat contexts/discipline-scope.md)
TDD_LAW=$(cat contexts/discipline-tdd.md)
BLOCKER_PROTOCOL=$(cat contexts/discipline-blocker.md)
TASK_GRANULARITY=$(cat contexts/discipline-task-granularity.md)
EXECUTION_ANNOUNCE=$(cat contexts/execution-announce.md)
```

---

## Process

### Step 1: Fetch Issue

```bash
gh issue view <issue-number> --json title,body,labels,state
```

Parse the response to extract:
- **Title** (for branch naming)
- **Body** (design content, acceptance criteria, task list)
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

```bash
cd .worktrees/<N>-$TOPIC
```

### Step 6: Detect Stack Profiles

#### 6a: Run Detection

```bash
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

### Step 9: Initialize Session State

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

### Step 10: Parse Issue Body for Tasks

The issue body (fetched in Step 1) contains the implementation plan. Extract all tasks — full text, file paths, acceptance criteria per task.

Do NOT make agents read the plan file. Extract task text here and pass it directly into each implementer agent's prompt.

### Step 11: Search-First Pattern Check

Before executing any task, check whether the functionality already exists in the codebase:

1. Search for existing similar patterns, utilities, or components referenced in the issue.
2. Use keywords from the task titles and acceptance criteria to grep/glob the repo.

Decision tree:

| Search result | Response |
|---------------|----------|
| **Nothing found** | Continue. This is a Build. |
| **Partial match — could extend** | STOP. Surface: "Found `<file>` which may cover part of this. Options: A) Extend it, B) Build new alongside it, C) Proceed as planned." Wait for user decision. |
| **Strong match — could adopt** | STOP. Surface: "Found `<file>` which appears to already implement `<capability>`. Options: A) Adopt it, B) Compose it into the new solution, C) Proceed as planned (build new)." Wait for user decision. |

**If user chooses Adopt or Extend or Compose:** update the plan accordingly, then continue.
**If user chooses Build (or no match found):** proceed to Step 12.

### Step 12: Dependency Analysis

Before executing ANY task, analyze dependencies to identify parallelization opportunities.

For each task, identify:
- **Explicit dependencies**: "Depends on Task X", "After Phase Y"
- **Implicit dependencies**: Sequential numbering within phases
- **File dependencies**: Tasks touching same files must be sequential
- **Cross-layer dependencies**: API contracts, database migrations

**Parallelization heuristics:**

| Pattern | Parallelizable? | Rationale |
|---------|-----------------|-----------|
| Different features/pages | Yes | No shared state or components |
| Backend vs Frontend (no new APIs) | Yes | Existing contracts, no blocking |
| Independent UI components | Yes | Different files, no shared state |
| Multiple test files | Yes | Tests are isolated by design |
| Same entity, different layers | No | Repository -> Service -> Controller is sequential |
| Frontend consuming new API | No | API must exist first |
| Migration + code using it | No | Schema must exist first |
| Shared utility/hook changes | No | Affects multiple consumers |

**When NOT to parallelize** (even if technically possible):
- Plan has fewer than 5 tasks (overhead not worth it)
- High uncertainty about file boundaries
- Critical shared state (auth, global config)
- First time implementing this type of feature

Choose a strategy — sequential, batch, or parallel — and state rationale before proceeding.

### Step 13: Execute Tasks

For each task:

1. Announce: `Task N: <name> (N/Total)`
2. Dispatch implementer agent (see prompt below)
3. Dispatch spec compliance reviewer (see prompt below)
4. If spec issues: implementer fixes, then re-review.
5. Dispatch code quality reviewer (see prompt below)
6. If quality issues: implementer fixes, then re-review.
7. Commit.
8. Update session state and progress: `[===-------] N/Total tasks complete`

### Step 14: Spec Compliance Check (after ALL tasks)

Before calling envoy:review, verify all tasks were implemented:
- Count tasks in issue body.
- Check git log for commits corresponding to each task.
- If any task has no commits: STOP. Surface discrepancy. Do not proceed to review.

### Step 15: Handoff

When all tasks pass spec compliance:

```
All N tasks implemented. Running envoy:review for code quality.
```

Invoke: `/envoy:review`

---

## Implementer Agent Prompt

Injects: `${EXECUTION_ANNOUNCE}`, `${SCOPE_LAW}`, `${TDD_LAW}`, `${BLOCKER_PROTOCOL}`, `${TASK_GRANULARITY}`

```
Agent({
  subagent_type: "general-purpose",
  description: "Implement Task N",
  prompt: `${EXECUTION_ANNOUNCE}

${SCOPE_LAW}

${TDD_LAW}

${BLOCKER_PROTOCOL}

${TASK_GRANULARITY}

---

Implement Task N: <task title>

**Context:**
<Brief description of where this fits in the overall plan>

**Full task specification:**
<Copy the complete task text from the plan>

**Stack context:**
<Detected stack profiles — common mistakes and best practices>

**Known patterns (avoid these):**
<Confirmed patterns and team corrections from learning-loader>

**Requirements:**
1. Follow TDD Iron Law above — NON-NEGOTIABLE
2. Use envoy:systematic-debugging if you encounter issues
3. Two commits minimum: test commit BEFORE implementation commit
4. Self-review your changes before returning

**Return:**
- Summary of what you implemented
- Git log showing test commit preceded implementation commit
- Any questions or concerns (do not reduce scope — surface blockers via Blocker Protocol)
- List of files changed
`
})
```

---

## Spec Compliance Reviewer Prompt

```
Agent({
  subagent_type: "general-purpose",
  description: "Spec compliance review for Task N",
  prompt: `${EXECUTION_ANNOUNCE}

---

Review this implementation for spec compliance.

**What was implemented:** <summary from implementer>
**Original spec:** <full task specification>
**Changes:** git diff <base_sha>..<head_sha>

---

**CRITICAL: Do Not Trust the Report**

The implementer's summary describes what they BELIEVE they did, not what the code ACTUALLY does.

Your job is skeptical verification:
- READ THE CODE YOURSELF
- Don't trust claims like "3 tests passing" — verify test output
- Don't trust "all requirements met" — check each one against code
- Implementers rationalize. Code doesn't lie.

---

**Verification Process:**

1. **List spec requirements** — Extract EVERY requirement from the original spec
2. **For EACH requirement:**
   - Find the code that implements it (file:line)
   - If you can't find it — MISSING
   - If code exists but doesn't match spec — WRONG
3. **Check for extras:**
   - Any code/behavior NOT in the spec?
   - YAGNI violation = issue
4. **Check for TDD evidence:**
   - Run: git log --oneline <base_sha>..HEAD
   - Does git log show test commit before implementation commit?
   - If not — FAIL (TDD violation trumps all)

**Return format:**

| Requirement | Status | Evidence |
|-------------|--------|----------|
| <req 1> | ✅/❌ | <file:line or MISSING> |
| <req 2> | ✅/❌ | <file:line or MISSING> |

Extras found: <list or "none">
TDD compliance: ✅/❌

**Final verdict:** ✅ Spec compliant OR ❌ Issues: <numbered list>
`
})
```

---

## Code Quality Reviewer Prompt

```
Agent({
  subagent_type: "general-purpose",
  description: "Code quality review for Task N",
  prompt: `${EXECUTION_ANNOUNCE}

${TDD_LAW}

---

Review this implementation for code quality.

**What was implemented:** <summary>
**Changes:** git diff <base_sha>..<head_sha>
**Stack profiles:** Load relevant from ../../stacks/

**Check:**

1. **TDD compliance (CRITICAL):**
   - Run: git log --oneline <base_sha>..HEAD
   - Verify test commit (test: ...) precedes implementation commit (feat: ...)
   - If implementation committed WITHOUT prior test commit — **FAIL REVIEW**
   - This is non-negotiable. No exceptions.

2. **Stack common mistakes:**
   - Load relevant stack profile(s) from ../../stacks/
   - Check each item in the "Common Mistakes" section against the diff

3. **Pattern consistency:**
   - Does the code match naming conventions, folder structure, and error handling patterns already established in this branch or codebase?

4. **Code quality fundamentals:**
   - Tests are meaningful (not just for coverage)
   - No obvious bugs or issues
   - No unnecessary code not required by the spec

**Return:**
- TDD Compliance: ✅ Test-first verified / ❌ VIOLATION: implementation before tests
- Stack issues: <list by category or "none">
- Pattern issues: <list or "none">
- General issues (Critical/Important/Minor): <list>
- Assessment: Approved / Needs fixes / **TDD Violation - Redo task**
`
})
```

---

## Report Completion

When all tasks complete:

```
**Execution complete for issue #<number>: <title>**

| Metric | Value |
|--------|-------|
| Tasks completed | N/N |
| Spec compliance | ✓ all tasks verified |
| Commits | M |
| Tests | All passing |
| Build | Success |
| Strategy | parallel/batch/sequential |

Next steps:
1. `/envoy:review` — Run comprehensive review (invoked above)
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

Cannot execute an implementation plan without clear acceptance criteria.

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
- `envoy:test-driven-development` — TDD Iron Law applies to all tasks (enforced via `contexts/discipline-tdd.md`)

**Spawns (leaf subagents only — no nested spawning):**
- Implementer agent (per task)
- Spec compliance reviewer (per task)
- Code quality reviewer (per task)

**Libraries used:**
- `lib/session-state.js` — Persist task progress across context compactions and sessions

**After pickup completes:**
- `envoy:review` — Run comprehensive review (auto-invoked)
- `envoy:finalize` — Complete development, create PR (clears session state)

**Platform constraint:** Claude Code subagents cannot spawn subagents (the `Agent` tool is silently stripped from subagent tool allowlists). This skill therefore orchestrates directly rather than delegating to an execution agent.
