---
name: dispatching-parallel-agents
description: Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies
---

# Dispatching Parallel Agents

## Overview

When you have multiple unrelated failures or independent tasks, investigating them sequentially wastes time. Each investigation is independent and can happen in parallel.

**Core principle:** Dispatch one agent per independent problem domain. Let them work concurrently.

**Announce at start:** "I'm using envoy:dispatching-parallel-agents to handle these independent tasks."

## When to Use

**Use when:**
- 3+ test files failing with different root causes
- Multiple subsystems broken independently
- Independent tasks in an implementation plan
- Each problem can be understood without context from others
- No shared state between investigations

**Don't use when:**
- Failures are related (fix one might fix others)
- Need to understand full system state
- Agents would interfere with each other (editing same files)

## The Pattern

### 1. Identify Independent Domains

Group tasks/failures by what's broken:
- Backend API: UserService issues
- Frontend: Component rendering issues
- Database: Migration problems

Each domain is independent - fixing UserService doesn't affect component tests.

### 2. Create Focused Agent Tasks

Each agent gets:
- **Specific scope:** One test file, one component, one service
- **Clear goal:** Make these tests pass / implement this feature
- **Constraints:** Don't change other code
- **Expected output:** Summary of what you found and fixed

### 3. Dispatch in Parallel

```
Task("Fix UserService.GetById null reference - backend/tests/UserServiceTests.cs")
Task("Fix UserCard component not rendering - frontend/src/components/__tests__/UserCard.test.tsx")
Task("Fix migration rollback issue - backend/Migrations/")
// All three run concurrently
```

### 4. Review and Integrate

When agents return:
- Read each summary
- Verify fixes don't conflict
- Run full test suite
- Integrate all changes

## Agent Prompt Structure

Good agent prompts are:
1. **Focused** - One clear problem domain
2. **Self-contained** - All context needed to understand the problem
3. **Specific about output** - What should the agent return?

**Example prompt:**
```markdown
Fix the 3 failing tests in backend/HybridFit.Api.Tests/Services/CoachServiceTests.cs:

1. "GetCoachById_WithInvalidId_ReturnsNull" - expects null but throws exception
2. "CreateCoach_WithDuplicateEmail_ThrowsConflict" - wrong exception type
3. "UpdateCoach_WithNonExistent_ReturnsNotFound" - test timing out

Your task:
1. Read the test file and understand what each test verifies
2. Identify root cause using envoy:systematic-debugging
3. Fix the issues following TDD
4. Run tests to verify

Return: Summary of root cause and what you fixed.
```

## Common Mistakes

**Too broad:** "Fix all the tests" - agent gets lost
**Specific:** "Fix CoachServiceTests.cs" - focused scope

**No context:** "Fix the race condition" - agent doesn't know where
**Context:** Paste the error messages and test names

**No constraints:** Agent might refactor everything
**Constraints:** "Do NOT change production code" or "Fix tests only"

## When NOT to Use

- **Related failures:** Fixing one might fix others - investigate together first
- **Need full context:** Understanding requires seeing entire system
- **Exploratory debugging:** You don't know what's broken yet
- **Shared state:** Agents would interfere (editing same files)

## Integration with Envoy

**Works well with:**
- `envoy:executing-plans` — Parallel strategy for independent tasks
- `envoy:systematic-debugging` — Each agent uses this for their domain

**After parallel work:**
- Run `envoy:layered-review` on combined changes
- Use `envoy:verification` before claiming complete
