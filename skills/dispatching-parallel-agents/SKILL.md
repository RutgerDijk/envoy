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

### 2. Initialize Scratchpad

Before dispatching agents, create a shared scratchpad for coordination:

```javascript
const scratchpad = require('../../lib/agent-scratchpad');
const pad = scratchpad.createEmpty();
// Register each agent with their scope
scratchpad.registerAgent(pad, 'agent-backend', 'Fix UserService', ['backend/']);
scratchpad.registerAgent(pad, 'agent-frontend', 'Fix UserCard', ['frontend/src/components/']);
scratchpad.registerAgent(pad, 'agent-db', 'Fix migration', ['backend/Migrations/']);
scratchpad.save(pad);
```

### 3. Size Prompts to Task Complexity

Use `lib/context-budget.js` to right-size each agent's prompt:

```javascript
const { classifyComplexity, buildAgentPrompt, checkBudget } = require('../../lib/context-budget');

const tier = classifyComplexity({
  filesChanged: 2,
  isMechanical: false,
});
// tier.modelTier → 'sonnet', tier.maxPromptLines → 60
```

Use `buildAgentPrompt()` for LITM-aware section ordering — objective and constraints at the start (high attention), reference material in the middle, acceptance criteria at the end (high attention):

```javascript
const prompt = buildAgentPrompt({
  objective: 'Fix the 3 failing tests in CoachServiceTests.cs',
  constraints: 'Follow TDD. Do NOT change files outside backend/.',
  context: scratchpadBriefing, // Shared state awareness
  reference: stackMistakes,     // Middle (low attention) — reference only
  acceptance: 'All 3 tests pass. Return summary of root cause and fix.',
  learnings: reminders,
});
```

### 4. Create Focused Agent Tasks

Each agent gets:
- **Specific scope:** One test file, one component, one service
- **Clear goal:** Make these tests pass / implement this feature
- **Constraints:** Don't change other code
- **Scratchpad briefing:** What other agents are working on
- **Expected output:** Summary of what you found and fixed

### 5. Dispatch in Parallel

```
Agent({
  description: "Fix UserService.GetById null reference",
  prompt: `Fix the failing tests in backend/tests/UserServiceTests.cs`
})
Agent({
  description: "Fix UserCard component not rendering",
  prompt: `Fix the failing tests in frontend/src/components/__tests__/UserCard.test.tsx`
})
Agent({
  description: "Fix migration rollback issue",
  prompt: `Fix the migration rollback issue in backend/Migrations/`
})
// All three run concurrently
```

Include scratchpad instructions in each prompt:
```
If you discover something that affects other agents' work (shared utility
changes, new dependencies, interface changes), write it to .envoy-scratchpad.json:

const scratchpad = require('../../lib/agent-scratchpad');
const pad = scratchpad.load();
scratchpad.post(pad, '<your-agent-id>', 'discovery', '<what you found>', ['affected/file.ts']);
scratchpad.save(pad);
```

### 6. Review and Integrate

When agents return:
- Check scratchpad for conflicts: `scratchpad.getConflicts(pad)`
- Read each summary
- Verify fixes don't conflict
- Run full test suite
- Clear scratchpad: `scratchpad.clear()`
- Integrate all changes

## Agent Prompt Structure

Use `lib/context-budget.js` → `buildAgentPrompt()` for LITM-aware prompt assembly. Good agent prompts are:
1. **Focused** - One clear problem domain
2. **Self-contained** - All context needed to understand the problem
3. **Right-sized** - Complexity tier determines prompt length and model
4. **Attention-aware** - Critical info at start/end, reference in middle

**Example prompt (using buildAgentPrompt):**
```javascript
const prompt = buildAgentPrompt({
  objective: `Fix the 3 failing tests in CoachServiceTests.cs:
    1. "GetCoachById_WithInvalidId_ReturnsNull" - expects null but throws exception
    2. "CreateCoach_WithDuplicateEmail_ThrowsConflict" - wrong exception type
    3. "UpdateCoach_WithNonExistent_ReturnsNotFound" - test timing out`,
  constraints: `Follow TDD. Use envoy:systematic-debugging for root cause.
    Do NOT modify files outside backend/Services/ and backend/Tests/.`,
  context: scratchpad.formatBriefing(pad, 'agent-backend'),
  acceptance: `All 3 tests pass. Return: summary of root cause and what you fixed.`,
});
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
- `envoy:pickup` — Parallel strategy for independent tasks
- `envoy:systematic-debugging` — Each agent uses this for their domain

**Libraries used:**
- `lib/agent-scratchpad.js` — Coordination between parallel agents
- `lib/context-budget.js` — Right-size prompts per task complexity, LITM-aware ordering

**After parallel work:**
- Check scratchpad for conflicts before integrating
- Run `envoy:review` on combined changes
- Use `envoy:verification` before claiming complete
- Clear scratchpad: `require('../../lib/agent-scratchpad').clear()`
