---
agent: 'agent'
description: 'Execute an implementation plan from a spec file, task by task with TDD'
---

# Execute Plan

Execute an implementation plan from a spec file. Follow every task exactly as written.

## Load the Spec

If a path is provided, use it. Otherwise find the most recent:

```bash
ls -t docs/plans/*.md | head -1
```

Read the entire spec file. Identify:
- **Execution strategy** (`parallel`, `batch`, or `sequential`)
- All tasks with files, steps, and commands
- Acceptance criteria

## Understand the Strategy

### Parallel
All tasks are independent. Work through them in order, but note that in a real parallel execution these could run simultaneously. If subagents are available, dispatch them separately per task. Otherwise, execute sequentially.

### Batch
Tasks are grouped in phases. Complete all tasks in Batch 1 before moving to Batch 2. After each batch, pause and verify output before continuing.

### Sequential
Tasks have strict dependencies. Complete each task fully before starting the next.

## Execute Each Task

For every task, in order:

### TDD Cycle (non-negotiable)

Every task must follow this exact cycle:

1. **Read the test code** in the task
2. **Create the test file** and write the test
3. **Run the test** — it must fail
4. **Confirm it fails** — if it passes, the test is wrong
5. **Write the minimal implementation** to make it pass
6. **Run the test again** — it must pass
7. **Commit** test + implementation together

```
STOP if you skip to implementation without a failing test first.
STOP if a test passes before you write any implementation.
These are signs of wrong test setup — fix before continuing.
```

### Example Execution Sequence

```
▶ Task 1: Add User entity

  ✍️  Writing test: tests/Unit/Domain/UserTests.cs
  🔴  Running test: dotnet test --filter "User_WithValidEmail"
      → FAILED (expected — User class does not exist)
  ✍️  Writing implementation: src/Domain/Entities/User.cs
  🟢  Running test: dotnet test --filter "User_WithValidEmail"
      → PASSED
  📦  Committing: feat(domain): add User entity

✅ Task 1 complete

▶ Task 2: ...
```

## After All Tasks Complete

Run the full verification suite:

```bash
dotnet test          # All .NET tests
npm test             # All frontend tests
dotnet build         # Clean build
npm run build        # Frontend build
npm run lint         # No lint errors
```

Then check acceptance criteria from the spec — confirm each one is satisfied.

## Output Summary

```
✅ Plan execution complete

Tasks completed: N/N
All tests: passing
Build: successful
Lint: clean

Acceptance criteria:
✅ Criterion 1
✅ Criterion 2

Next step: /finalize
```

If anything failed, list what failed and what to do to fix it. Do not mark the plan as complete if tests are failing.
