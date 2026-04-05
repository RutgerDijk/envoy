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
| `--plan-only` | Stop after spec writing (Step 9) |

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

Create a NEW branch from main. Brainstorm no longer creates branches — pickup owns branch creation.

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

### Step 7: Run Search-First

Before planning, invoke `envoy:search-first` against the acceptance criteria from the issue body.

This checks for existing solutions, patterns, or utilities that could be reused instead of building from scratch. Feed the acceptance criteria as the search query.

### Step 8: Write Spec with Implementation Plan

Read the issue body and write a spec document to `docs/plans/YYYY-MM-DD-<topic>.md`.

#### Spec Structure

```markdown
# [Feature Name]

> **For Claude:** Use envoy:pickup to execute this spec task-by-task.

## Overview

[One sentence describing what this builds — from issue body]

## Architecture

[2-3 sentences about approach, key technologies — from issue body]

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

[Extracted from the issue body. If the issue has no acceptance criteria, STOP — see error handling.]

---

## Implementation Plan

**Execution Strategy:** parallel | batch | sequential
**Rationale:** [Why this strategy was chosen]

[Tasks go here...]
```

#### Task Structure

Each task follows TDD and is bite-sized (2-5 minutes per task):

```markdown
### Task N: <Name>

**Files:**
- Create: `exact/path/to/file.ext`
- Test: `tests/exact/path/to/test.ext`
- Modify: `exact/path/to/existing.ext:123-145`

**Step 1: Write failing test** [code]

[Exact test code]

**Step 2: Run test (expect FAIL)** [command]

```bash
[exact command]
```
Expected: [what failure looks like]

**Step 3: Implement minimal code** [code]

[Exact implementation code]

**Step 4: Run test (expect PASS)** [command]

```bash
[exact command]
```
Expected: [what success looks like]

**Step 5: Commit** [git commands]

```bash
git add [test files]
git commit -m "test(<scope>): add tests for <feature>"
git add [implementation files]
git commit -m "feat(<scope>): implement <feature>"
```
```

#### Execution Strategy Selection

Each plan MUST specify an execution strategy:

- **`parallel`** — Independent tasks across different files/features
- **`batch`** — Logical phases (data model -> API -> UI)
- **`sequential`** — Tightly coupled changes

Include the rationale for the chosen strategy.

#### Task Granularity Rules

- Each step is one action (2-5 minutes)
- "Create the file" — step
- "Add the function" — step
- "Run the test" — step
- "Commit" — step
- Exact file paths always
- Complete code in plan (not "add validation")
- Exact commands with expected output

#### Commit the Spec

```bash
git add docs/plans/YYYY-MM-DD-<topic>.md
git commit -m "docs: add implementation plan for <feature>"
```

### Step 9: Pause for Approval

Show the plan summary:

```
**Spec written:** `docs/plans/YYYY-MM-DD-<topic>.md`

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

**Ready to execute? (yes / edit / abort)**
```

**Branching logic:**
- If `--plan-only` flag: **Stop here.** Report the spec path and exit.
- If user says **abort**: Stop. Remove "in progress" label.
- If user says **edit**: Let user modify the plan, then re-show the summary.
- If user says **yes**: Continue to Step 10.

### Step 10: Execute Tasks

#### 10a: Initialize Session State

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
  state.plan = specPath;
  for (const task of planTasks) {
    session.updateTask(state, task.id, 'pending');
  }
  session.save(state);
}
```

#### 10b: Load Implementation Reminders

Before executing tasks, load confirmed patterns and team corrections:

```javascript
const { loadConfirmedPatterns, loadCorrections, formatReminders } = require('../../lib/learning-loader');
const patterns = loadConfirmedPatterns(detectedStacks);
const corrections = loadCorrections();
const reminders = formatReminders(patterns, corrections);
```

If reminders are non-empty, include them in each implementing agent's prompt:

```
**Known patterns (avoid these):**
- [dotnet] Always check null on API response DTOs before mapping
- [react] Use useCallback for event handlers passed as props

**Team corrections:**
- Use IResult not ActionResult in this API
- DTOs go in the Contracts folder
```

#### 10c: Analyze Dependencies

**Before executing ANY task, analyze dependencies to identify parallelization opportunities.**

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

#### 10d: Classify Complexity

Before execution, classify each task's complexity:

```javascript
const { classifyComplexity, buildAgentPrompt } = require('../../lib/context-budget');

const tier = classifyComplexity({
  filesChanged: estimatedFiles,
  servicesAffected: task.touchesMultipleProjects ? 2 : 1,
  isMechanical: task.type === 'rename' || task.type === 'config',
});
```

| Tier | Criteria | Pipeline |
|------|----------|----------|
| **Trivial** | Docs, config, typos, simple renames | implement -> verify |
| **Small** | Single file logic, 1-3 files | implement -> test -> lightweight check |
| **Medium** | 4-10 files, multi-component | implement -> test -> lightweight check |
| **Large** | 10+ files, cross-cutting, new patterns | research -> implement -> test -> lightweight check |

#### 10e: Execute with Chosen Strategy

Based on the execution strategy from the plan:

##### Sequential Execution

Execute tasks one at a time, in order:

```
For each task in plan:
  1. Announce: "**Task N: <name>**"
  2. TDD RED: Write failing tests for this task
  3. TDD GREEN: Execute steps to make tests pass
  4. TDD REFACTOR: Clean up while keeping tests green
  5. Verify all tests pass
  6. Commit changes (test commit + implementation commit)
  7. Run per-task lightweight check
  8. Update session state
  9. Update progress: "Task N complete. (N/Total)"
```

Progress tracking:
```
[===-------] 3/10 tasks complete
```

##### Batch Execution

Execute tasks in groups with checkpoints between batches:

```
For each batch:
  1. Announce: "**Batch N: <name>** (Tasks <list>)"
  2. Execute all tasks in the batch (can parallelize within batch)
  3. Run verification for all batch changes
  4. Run per-task lightweight check for each task
  5. Commit batch changes
  6. If checkpoint: Pause and ask user to review
  7. Continue to next batch
```

##### Parallel Execution

Dispatch fresh subagent per task using TaskCreate. Use dependency analysis to group tasks into waves.

```
1. For each execution wave:
   a. Identify tasks that can start (all dependencies met)
   b. Group into parallel batches (max 3-4 agents recommended)
   c. Build LITM-aware prompts and dispatch agents
   d. Wait for all agents in wave to complete
   e. Verify no conflicts, run lightweight checks
   f. Commit combined changes
   g. Move to next wave
2. Report final results
```

**Building agent prompts (LITM-aware):**

```javascript
const { buildAgentPrompt } = require('../../lib/context-budget');
const { scoreTaskRelevance, formatForPrompt } = require('../../lib/relevance-scorer');
const { register, postFinding, checkOwnership } = require('../../lib/agent-scratchpad');

// Score file relevance for agent context
const relevance = scoreTaskRelevance(taskFiles, projectRoot);
const relevanceBriefing = formatForPrompt(relevance);

// Register agent in scratchpad for coordination
register(agentId, taskFiles);

const prompt = buildAgentPrompt({
  objective: `Implement Task ${n}: ${task.title}\n\n${task.fullSpec}`,
  constraints: tddIronLaw + toolRestrictions,
  context: `Plan: ${specPath}\nProgress: ${done}/${total} tasks complete`,
  reference: relevanceBriefing + '\n' + stackProfiles,
  acceptance: `All tests pass. No lint errors. Report: summary, git log, files changed.`,
  learnings: reminders,
});
```

**Dispatching agents:**

```
Task({
  description: "Execute Task N: <task name>",
  prompt: prompt,
  subagent_type: "general-purpose"
})
```

**Agent boundaries (CRITICAL):** Each agent must have clear, non-overlapping file scope. No two agents touch the same files.

**Conflict detection after parallel agents:**

```bash
# Check for conflicts
git status --porcelain

# If same file modified by multiple agents:
# 1. Review changes manually
# 2. Merge carefully
# 3. Run full test suite
```

**Fallback to sequential:** If parallelization fails (conflicts, errors), offer to fall back to sequential execution.

**When NOT to parallelize** (even if technically possible):
- Plan has < 5 tasks (overhead not worth it)
- High uncertainty about file boundaries
- Critical shared state (auth, global config)
- First time implementing this type of feature

#### TDD Iron Law (ALL strategies)

**NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.**

Write code before test? **Delete it. Start over.**

No exceptions:
- Don't keep as "reference"
- Don't "adapt" while writing tests
- Don't look at it
- **Delete means delete**

**Before writing ANY implementation code, ask:**
- "Do I have a failing test for this behavior?"
- If NO -> **STOP. Write the test first.**

**TDD Cycle for each task:**

```
1. RED — Write failing test(s) for expected behavior
   - Run tests to confirm they FAIL
   - Commit: "test(<scope>): add tests for <feature>"

2. GREEN — Write MINIMAL code to make tests pass
   - Run tests to confirm they PASS
   - Commit: "feat(<scope>): implement <feature>"

3. REFACTOR — Clean up while keeping tests green
   - Run tests after each change
   - Commit: "refactor(<scope>): clean up <feature>"

Scopes: backend, frontend, api, db, auth, tests, docs
```

**Rationalization Table:**

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. Write it. |
| "I'll write tests after" | Tests passing immediately prove nothing. Test first shows the test CAN fail. |
| "I already know how to implement it" | Good. You'll implement it faster after writing the test. |
| "Existing code has no tests" | You're improving it now. Add tests. |
| "It's just a small fix" | Small fixes break things. Test first. |
| "I'm just exploring" | Explore with tests. Delete exploration code. |
| "Time pressure" | Skipping tests costs MORE time. Always. |

**Violations = Start Over:**
- Writing implementation without tests -> **Delete code, write test first**
- Tests written after implementation -> **Delete both, start with test**
- "Just this once" -> **No. The answer is always no.**

#### Per-Task Lightweight Check

After each task completes, run a lightweight check instead of a full review:

1. **TDD compliance** — Does git log show test commit before implementation commit?
   ```bash
   git log --oneline -5
   ```
   Verify `test(...)` commit precedes `feat(...)` commit. If not -> **TDD violation, redo task.**

2. **Spec match** — Does the output match the task description? Compare files created/modified against the task's `Files:` section.

3. **Pattern propagation** — If a pattern was established in earlier tasks (naming conventions, folder structure, error handling approach), is it followed consistently in this task?

If any check fails, fix before moving to the next task.

#### Session State Updates

After each task completes, persist progress:

```javascript
const session = require('../../lib/session-state');
const state = session.load();
session.updateTask(state, taskId, 'done', 'Implemented User entity with migration');
session.trackFile(state, 'src/Models/User.cs', 'New entity');
session.addDecision(state, 'Used Guid for User PK - matches existing entities');
session.save(state);
```

If context compacts or session restarts, `session-start.sh` auto-detects `.envoy-session.json` and restores progress.

Also check git log for commit-level progress:
```bash
git log --oneline -10
```

Resume from the next incomplete task.

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
- `envoy:search-first` — Check for existing solutions before planning
- `envoy:using-git-worktrees` — Worktree creation conventions
- `envoy:systematic-debugging` — For investigating issues during execution
- `envoy:test-driven-development` — TDD Iron Law applies to all tasks

**Libraries used:**
- `lib/session-state.js` — Persist task progress across context compactions and sessions
- `lib/context-budget.js` — Right-size prompts per task complexity, LITM-aware ordering
- `lib/relevance-scorer.js` — Score file relevance for agent context
- `lib/agent-scratchpad.js` — Multi-agent coordination for parallel dispatch
- `lib/learning-loader.js` — Load confirmed patterns and team corrections

**After pickup completes:**
- `envoy:review` — Run comprehensive review
- `envoy:finalize` — Complete development, create PR (clears session state)
