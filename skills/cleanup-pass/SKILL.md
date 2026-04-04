---
name: cleanup-pass
description: Use after implementation and before review to remove AI-generated slop from the diff
---

# De-Sloppify Cleanup Pass

## Overview

A fresh agent reviews the diff and removes common AI-generated slop: unnecessary defensive checks, over-engineering, redundant tests, excessive comments, dead code. Runs AFTER implementation, BEFORE review.

**Key principle:** Never add "don't do X" instructions to the implementing agent — that makes it hesitant. Let it implement freely, then run this focused cleanup.

**Announce at start:** "I'm using envoy:cleanup-pass to clean up the implementation."

## Why a Separate Pass

| Approach | Problem |
|----------|---------|
| Tell implementing agent "don't over-engineer" | Makes it second-guess every decision, produces timid code |
| Tell implementing agent "don't add unnecessary comments" | It skips useful comments too |
| Review agent flags slop | Reviewer doesn't have edit access, creates back-and-forth |
| **Cleanup agent with fresh context** | **Sees only the diff, focused mandate, direct edit access** |

## Process

### Step 1: Spawn Fresh Cleanup Agent

The cleanup agent receives ONLY the diff — no implementation context, no conversation history:

```
Agent({
  description: "Cleanup pass",
  prompt: `You are a code cleanup agent. Your job is to remove slop
  from a recent implementation.

  Read the diff:
  git diff main...HEAD

  Then read each changed file in full to understand context.

  Remove the categories below. Edit files directly.
  Commit after each category with a clear message.

  IMPORTANT:
  - Only remove things that are genuinely unnecessary
  - If in doubt, leave it
  - Never change functionality — only remove noise
  - Never touch test assertions that verify real behavior
  - Run tests after each edit to confirm nothing broke

  Tools: Read, Edit, Write, Bash, Grep, Glob
  `
})
```

### Step 2: Remove by Category

Work through each category in order. After each category, run tests to confirm nothing broke.

#### Category 1: Unnecessary Defensive Checks

Remove:
- Null checks on parameters that can't be null (required params, just-constructed objects)
- Try/catch around code that can't throw (simple assignments, arithmetic)
- Redundant type guards (checking type after TypeScript already narrowed)
- `if (x !== undefined)` when x is always defined
- Empty catch blocks that swallow errors silently

**Keep:**
- Null checks on external input (API responses, user input, database results)
- Try/catch around I/O operations (file, network, database)
- Defensive checks documented as intentional (explicit comment explaining why)

```bash
# After removing
dotnet test && npm test
git add -p && git commit -m "cleanup: remove unnecessary defensive checks"
```

#### Category 2: Over-Engineering

Remove:
- Interfaces/abstractions with only one implementation (and no documented plan for more)
- Generic type parameters that are always the same concrete type
- Factory functions that just call `new`
- Configuration objects for values that never change
- Premature caching/memoization without evidence of performance need
- Feature flags for non-optional features
- Backwards-compatibility shims for code that was just written

**Keep:**
- Abstractions required by the framework (dependency injection, etc.)
- Generics that genuinely serve multiple types
- Configuration that's documented as user-facing

```bash
dotnet test && npm test
git add -p && git commit -m "cleanup: remove over-engineering"
```

#### Category 3: Redundant Tests

Remove:
- Tests that just assert the mock returns what you told it to return
- Tests that duplicate another test with trivially different input (keep one, parameterize if needed)
- Tests for framework behavior (e.g., testing that React renders a div)
- Tests that only verify the test setup (e.g., "service is defined")

**Keep:**
- Tests for actual business logic
- Edge case tests that exercise different code paths
- Integration tests that verify real behavior
- Tests for error handling

```bash
dotnet test && npm test
git add -p && git commit -m "cleanup: remove redundant tests"
```

#### Category 4: Excessive Comments

Remove:
- Comments that restate the code (`// increment counter` above `counter++`)
- JSDoc/XML-doc on private methods with obvious signatures
- `// TODO` comments for things that are already done
- Commented-out code (it's in git history if needed)
- Section dividers that don't add information (`// ---- Helper Functions ----`)
- "This function does X" when the function name already says X

**Keep:**
- Comments explaining WHY (not what)
- Comments marking intentional trade-offs or workarounds
- JSDoc/XML-doc on public API methods
- Regulatory/compliance comments

```bash
dotnet test && npm test
git add -p && git commit -m "cleanup: remove excessive comments"
```

#### Category 5: Dead Code and Unused Imports

Remove:
- Imports not referenced anywhere in the file
- Functions/methods defined but never called
- Variables assigned but never read
- Type definitions not used
- Files created but not imported anywhere

**Keep:**
- Exports that are part of the public API (even if not used internally)
- Types used only in test files

```bash
dotnet test && npm test
git add -p && git commit -m "cleanup: remove dead code and unused imports"
```

### Step 3: Report

```
**Cleanup Pass Complete**

| Category | Items Removed | Examples |
|----------|--------------|---------|
| Defensive checks | 3 | Null check on required param in UserService |
| Over-engineering | 1 | IUserRepository interface with single impl |
| Redundant tests | 2 | Mock-returns-mock assertions |
| Comments | 5 | "// create user" above CreateUser() |
| Dead code | 1 | Unused DateHelper import |

Total: 12 items cleaned up
Diff: +0 -47 lines (net reduction)
Tests: All passing after each change
```

## Integration with Envoy

Slot in the workflow between implementation and review:

```
executing-plans → cleanup-pass → layered-review → finalize
```

- Called automatically by `executing-plans` after all tasks complete (if cleanup-pass is available)
- Can also be invoked manually: `/envoy:cleanup-pass`
- Review agent sees the cleaned-up code, not the slop
