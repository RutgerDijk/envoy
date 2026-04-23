# Pickup — Steps 9–13: Session state, parse tasks, search-first, dependencies, execute

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
2. Dispatch implementer agent (see `prompts.md`)
3. Dispatch spec compliance reviewer (see `prompts.md`)
4. If spec issues: implementer fixes, then re-review.
5. Dispatch code quality reviewer (see `prompts.md`)
6. If quality issues: implementer fixes, then re-review.
7. Commit.
8. Update session state and progress: `[===-------] N/Total tasks complete`

See `prompts.md` for the three subagent prompt templates (implementer, spec compliance reviewer, code quality reviewer).
