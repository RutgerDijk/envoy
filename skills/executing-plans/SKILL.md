---
name: executing-plans
description: Use when you have an implementation plan and are ready to start coding
---

# Executing Implementation Plans

## Overview

Execute implementation plans created by envoy:writing-plans. Supports three execution strategies: parallel, batch, and sequential.

**Announce at start:** "I'm using envoy:executing-plans to implement this plan."

## Load the Spec

### Step 1: Find the Spec

If spec path provided, use it. Otherwise:

```bash
# Find most recent spec in docs/plans/
ls -t docs/plans/*.md | head -1
```

The spec file contains both design AND implementation tasks in one document.

### Step 2: Parse Execution Strategy

Look for the execution configuration in the plan:

```yaml
execution:
  strategy: parallel | batch | sequential
  batches:  # For batch strategy
    - tasks: [1, 2, 3]
      checkpoint: true
```

### Step 3: Load Stack Profiles

Detect and load relevant stack profiles for context during execution.

### Step 4: Analyze Dependencies

**Before executing ANY plan, analyze task dependencies to identify parallelization opportunities.**

#### 4.1 Parse Task Dependencies

For each task, identify:
- **Explicit dependencies**: "Depends on Task X", "After Phase Y completes"
- **Implicit dependencies**: Sequential numbering within phases
- **Cross-layer dependencies**: "Frontend needs backend API", "Tests need implementation"
- **File dependencies**: Tasks touching same files must be sequential

```
Dependency signals to look for:
- "depends on", "requires", "after", "once X is complete"
- Phase/batch groupings in the plan
- Shared file paths between tasks
- API contracts (backend must exist before frontend consumes it)
- Database migrations (must run before code using new schema)
```

#### 4.2 Build Dependency Graph

Create a DAG (Directed Acyclic Graph) of tasks:

```
Task 1 (DB Migration)
    ↓
Task 2 (Entity Model) ──────────────────┐
    ↓                                    │
Task 3 (Repository)                      │
    ↓                                    │
Task 4 (Service) ←───────────────────────┤
    ↓                                    │
Task 5 (Controller)      Task 10 (UI Component A)
    ↓                         ↓
Task 6 (API Tests)       Task 11 (UI Component B)  ← Can run in parallel
                              ↓
                         Task 12 (Integration)
```

#### 4.3 Identify Parallel Opportunities

**Parallelization heuristics:**

| Pattern | Parallelizable? | Rationale |
|---------|-----------------|-----------|
| Different features/pages | ✓ Yes | No shared state or components |
| Backend vs Frontend (no new APIs) | ✓ Yes | Existing contracts, no blocking |
| Independent UI components | ✓ Yes | Different files, no shared state |
| Multiple test files | ✓ Yes | Tests are isolated by design |
| Same entity, different layers | ✗ No | Repository → Service → Controller is sequential |
| Frontend consuming new API | ✗ No | API must exist first |
| Migration + code using it | ✗ No | Schema must exist first |
| Shared utility/hook changes | ✗ No | Affects multiple consumers |

#### 4.4 Present Parallelization Plan

Before execution, show the user the dependency analysis:

```
**Dependency Analysis**

Phase 1 (Tasks 1-5): Sequential
  └─ Each task depends on the previous (DB → Model → Repo → Service → Controller)

Phase 2 (Tasks 6-9) and Phase 5 (Tasks 17-20): PARALLEL ✓
  └─ Phase 2: Backend API tests (independent of UI)
  └─ Phase 5: Settings page (different feature, no shared components)

Phase 3 (Tasks 10-13): Sequential, depends on Phase 2
  └─ Frontend consumes APIs built in Phase 2

Phase 4 (Tasks 14-16): PARALLEL with Phase 3 ✓
  └─ Documentation tasks (no code dependencies)

**Recommended Execution:**

1. Run Phase 1 sequentially (5 tasks)
2. Run Phase 2 + Phase 5 in parallel (2 agents, 8 tasks total)
3. Run Phase 3 sequentially after Phase 2 (4 tasks)
4. Run Phase 4 in parallel with Phase 3 (3 tasks)

Estimated speedup: ~35% faster than fully sequential

**Proceed with parallel execution? [Y/n]**
```

## Execution Strategies

## Test-Driven Development (TDD)

### The Iron Law

**NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.**

Write code before test? **Delete it. Start over.**

No exceptions:
- Don't keep as "reference"
- Don't "adapt" while writing tests
- Don't look at it
- **Delete means delete**

### TDD Cycle for Each Task

```
For each task:
  1. RED — Write failing test(s) for the expected behavior
     - Run tests to confirm they fail
     - Commit: "test(<scope>): add tests for <feature>"

  2. GREEN — Write minimal code to make tests pass
     - Run tests to confirm they pass
     - Commit: "feat(<scope>): implement <feature>"

  3. REFACTOR — Clean up while keeping tests green
     - Run tests after each change
     - Commit: "refactor(<scope>): clean up <feature>"

Scopes: backend, frontend, api, db, auth, tests, docs
```

### TDD Enforcement

Before writing ANY implementation code, ask:
- "Do I have a failing test for this behavior?"
- If NO → **STOP. Write the test first.**

### Rationalization Table

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. Write it. |
| "I'll write tests after" | Tests passing immediately prove nothing. Test first shows the test CAN fail. |
| "I already know how to implement it" | Good. You'll implement it faster after writing the test. |
| "Existing code has no tests" | You're improving it now. Add tests. |
| "It's just a small fix" | Small fixes break things. Test first. |
| "I'm just exploring" | Explore with tests. Delete exploration code. |
| "Time pressure" | Skipping tests costs MORE time. Always. |

### Violations = Start Over

- Writing implementation without tests → **Delete code, write test first**
- Tests written after implementation → **Delete both, start with test**
- "Just this once" → **No. The answer is always no.**

### Sequential (Default)

Execute tasks one at a time, in order:

```
For each task in plan:
  1. Announce: "**Task N: <name>**"
  2. TDD RED: Write failing tests for this task
  3. TDD GREEN: Execute steps to make tests pass
  4. TDD REFACTOR: Clean up code
  5. Verify all tests pass
  6. Commit changes (test commit + implementation commit)
  7. Update progress: "Task N complete. (N/Total)"
```

**Progress tracking:**
```
[■■■■□□□□□□] 4/10 tasks complete
```

### Batch

Execute tasks in groups with checkpoints between batches:

```
For each batch:
  1. Announce: "**Batch N: <name>** (Tasks <list>)"
  2. Execute all tasks in the batch
  3. Run verification for all batch changes
  4. Commit batch changes
  5. If checkpoint: true
     - Pause and ask: "Batch N complete. Review changes and continue?"
     - Wait for approval before next batch
  6. Continue to next batch
```

**Checkpoint prompt:**
```
**Batch 1 complete: Foundation**

Tasks completed:
- [x] Task 1: Create database schema
- [x] Task 2: Add migrations
- [x] Task 3: Create repository

Changes:
- 5 files created
- 2 files modified

**Review and continue to Batch 2?** (y/n)
```

### Parallel (Automatic Dispatching)

**Use dependency analysis from Step 4 to automatically dispatch parallel agents.**

#### Parallel Execution Flow

```
1. User confirms parallelization plan
2. For each execution wave:
   a. Identify tasks that can start (all dependencies met)
   b. Group into parallel batches (max 3-4 agents recommended)
   c. Dispatch agents using Task tool
   d. Wait for all agents in wave to complete
   e. Verify no conflicts
   f. Commit combined changes
   g. Move to next wave
3. Report final results
```

#### Dispatching Agents

For each parallel batch, use the Task tool with clear boundaries:

```typescript
// Dispatch parallel agents
Task({
  description: "Execute Task 6-9 (API Tests)",
  prompt: `
    You are executing Tasks 6-9 from the implementation plan.

    **Context:**
    - Working directory: ${cwd}
    - Branch: ${branch}
    - Plan: ${planPath}

    **Your tasks:**
    - Task 6: Write UserService unit tests
    - Task 7: Write UserController integration tests
    - Task 8: Write validation tests
    - Task 9: Add test fixtures

    **Constraints:**
    - Follow TDD: Write failing test first, then make it pass
    - Only modify files in: tests/*, src/Services/*, src/Controllers/*
    - DO NOT modify: src/Models/*, src/Data/*
    - Commit after each task with proper message

    **Verification:**
    - All tests must pass: dotnet test
    - No lint errors: dotnet build

    Report completion with summary of changes.
  `,
  subagent_type: "general-purpose"
})
```

#### Agent Boundaries

**CRITICAL:** Each agent must have clear, non-overlapping scope:

```
Agent 1 (Backend Tests)     Agent 2 (Settings UI)
├── tests/UserTests.cs      ├── src/pages/Settings.tsx
├── tests/OrderTests.cs     ├── src/components/Settings/*
└── tests/fixtures/*        └── src/hooks/useSettings.ts

NO OVERLAP - agents cannot touch same files
```

#### Conflict Detection

After parallel agents complete:

```bash
# Check for conflicts
git status --porcelain

# If same file modified by multiple agents:
# 1. Review changes manually
# 2. Merge carefully
# 3. Run full test suite
```

#### Coordination Output

```
**Wave 1: Sequential Foundation (Tasks 1-5)**
Executing sequentially... ✓ Complete (5/5)

**Wave 2: Parallel Execution**
Dispatching 2 agents:
  ├── Agent A: Tasks 6-9 (Backend Tests)
  └── Agent B: Tasks 17-20 (Settings Page)

Waiting for completion...
  ├── Agent A: ✓ Complete (12 files, 4 commits)
  └── Agent B: ✓ Complete (8 files, 4 commits)

Conflict check: No overlapping files ✓
Verification: All tests pass ✓

**Wave 3: Sequential (Tasks 10-13)**
Depends on Wave 2... Starting now.
Executing sequentially... ✓ Complete (4/4)

**Wave 4: Parallel with Wave 3**
Dispatching 1 agent:
  └── Agent C: Tasks 14-16 (Documentation)

Agent C: ✓ Complete (3 files, 3 commits)

**Execution Complete**
- Total tasks: 20
- Parallel waves: 2
- Time saved: ~40% vs sequential
- All tests passing
- No conflicts

Next: /envoy:review
```

#### Fallback to Sequential

If parallelization fails (conflicts, errors):

```
**Parallel execution failed**

Agent B encountered conflicts with Agent A:
- src/shared/types.ts modified by both

Options:
1. Resolve conflicts manually and continue parallel
2. Fallback to sequential execution
3. Abort and review plan

Choice? [1/2/3]
```

#### When NOT to Parallelize

Even if technically possible, avoid parallel execution when:
- Plan has < 5 tasks (overhead not worth it)
- High uncertainty about file boundaries
- Critical shared state (auth, global config)
- First time implementing this type of feature

## Progress Tracking

Use TodoWrite to track task progress:

```
- [x] Task 1: Create database schema
- [x] Task 2: Add migrations
- [ ] Task 3: Create repository (in progress)
- [ ] Task 4: Add service layer
- [ ] Task 5: Create controller
```

## Verification

After each task (or batch):

1. **Run relevant tests:**
   ```bash
   dotnet test  # For backend changes
   npm test     # For frontend changes
   ```

2. **Check for lint errors:**
   ```bash
   npm run lint  # Frontend
   dotnet build  # Backend (warnings as errors)
   ```

3. **Verify expected files exist:**
   ```bash
   ls -la <expected-files>
   ```

## Handling Failures

### Test Failure

```
**Task N failed: Tests not passing**

Failed tests:
- TestName1: Expected X but got Y
- TestName2: NullReferenceException

Options:
1. Fix the issue and retry task
2. Skip task and continue (mark as incomplete)
3. Abort execution

Choice?
```

### Build Error

```
**Task N failed: Build error**

Error: CS1002 - Missing semicolon at line 45

Fix the error and retry, or abort execution.
```

## Completion

When all tasks complete:

```
**Plan execution complete**

Summary:
- Tasks completed: 10/10
- Commits made: 10
- Tests: All passing
- Build: Success

Next steps:
1. `/envoy:review` — Run 4-layer review
2. `/envoy:finalize` — Prepare PR
```

## Resuming Execution

If execution was interrupted:

```bash
# Check git log for last completed task
git log --oneline -10

# Check TodoWrite for progress
```

Resume from the next incomplete task.
