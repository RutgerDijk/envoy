---
name: executing-plans
description: Execute implementation plans with configurable strategies (parallel, batch, sequential). Use when you have a plan and are ready to implement.
---

# Executing Implementation Plans

## Overview

Execute implementation plans created by envoy:writing-plans. Supports three execution strategies: parallel, batch, and sequential.

**Announce at start:** "I'm using envoy:executing-plans to implement this plan."

## Load the Plan

### Step 1: Find the Plan

If plan path provided, use it. Otherwise:

```bash
# Find most recent plan for current branch
BRANCH=$(git branch --show-current)
ls -t docs/plans/*-plan.md | head -1
```

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

## Execution Strategies

### Sequential (Default)

Execute tasks one at a time, in order:

```
For each task in plan:
  1. Announce: "**Task N: <name>**"
  2. Execute each step in the task
  3. Verify completion (run tests, check files)
  4. Commit changes
  5. Update progress: "Task N complete. (N/Total)"
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

### Parallel

Spawn independent agents for tasks that don't share files:

```
1. Analyze tasks for dependencies
2. Group independent tasks (no shared files)
3. For each independent group:
   - Spawn subagent using Task tool
   - Agent executes task autonomously
4. Wait for all agents to complete
5. Review results
6. Resolve any conflicts
7. Commit combined changes
```

**Parallel execution output:**
```
Spawning 3 parallel agents:
- Agent 1: Task 4 (UserService)
- Agent 2: Task 5 (UserController)
- Agent 3: Task 6 (UserDto)

Waiting for completion...

Results:
- Agent 1: ✓ Complete
- Agent 2: ✓ Complete
- Agent 3: ✓ Complete

No conflicts detected. Committing changes.
```

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
