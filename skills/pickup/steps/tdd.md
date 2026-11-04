# Pickup — Steps 9–13: Session state, parse tasks, search-first, dependencies, execute

### Step 9: Initialize Session State

Session state lives in `.envoy/pickup/session.json` (schema `lib/schemas/session.json`). Preflight seeds it with every task `pending`, `issueNumber`, and `branch: "unknown"` — or, when a valid session for the same issue already exists (re-invocation after a compaction), keeps it as-is so completed tasks, decisions and next steps survive. `session.load()` throws (naming the path) if the file is corrupt or schema-invalid — stop and surface that error rather than recreating the file. `session.save()` validates and throws on an invalid shape. Decisions are stored as `decisions[].note` (via `session.addDecision`).

Run from the worktree root (self-contained — the lib is resolved from the plugin root, the branch from git, the tasks from `.envoy-tasks/<issue>.json`):

```bash
node - "${CLAUDE_PLUGIN_ROOT:-${CLAUDE_SKILL_DIR}/../..}/lib/session-state" <<'EOF'
const fs = require('fs');
const { execSync } = require('child_process');
const session = require(process.argv[2]);
const state = session.load(); // .envoy/pickup/session.json (preflight seed)

if (state.branch === 'unknown') {
  state.branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim() || 'unknown';
}
const tasksFile = `.envoy-tasks/${state.issueNumber}.json`;
if (state.issueNumber && fs.existsSync(tasksFile)) {
  for (const task of JSON.parse(fs.readFileSync(tasksFile, 'utf8')).tasks || []) {
    if (!state.tasks.some(t => t.id === task.id)) {
      state.tasks.push({ id: task.id, name: task.title, status: 'pending' });
    }
  }
}

if (state.tasks.some(t => t.status !== 'pending')) {
  const done = state.tasks.filter(t => t.status === 'done').length;
  console.log(`Resuming: ${done}/${state.tasks.length} tasks complete`);
  console.log('Recent decisions:', state.decisions.slice(-3).map(d => d.note));
}
session.save(state);
EOF
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

**Record the outcome:** write `.envoy/search-decisions/<task-id>.json` conforming to `lib/schemas/search-decision.json` (decision ∈ build-new|adopt|extend|compose; optional matches, rationale, decidedAt). The review layer reads this to verify the team's search-first conclusions were recorded.

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
2. Dispatch implementer agent (see `prompts.md`). Build its payload with
   `lib/task-payload.js`: `buildTaskSlice(task)` for the full task
   specification (structured `intent`/`behavior`/`files`/`acceptance`/
   `contracts`/`outOfScope` fields per `lib/schemas/tasks.json` — never
   an ad-hoc format) plus `buildSiblingIndex(allTasks, task.id)` for a
   one-line-per-task index of siblings. Siblings never get their full
   spec injected — only id + title. Also fill `${RESOLVED_TEST_COMMAND}`
   from preflight's `### Test Command` output — the concrete filtered
   command when resolved, or the explicit "determine and report the
   narrowest command yourself" instruction when not; never default to
   the full suite.
3. Once the implementer completes, dispatch BOTH reviewers — spec
   compliance and code quality — **in the same message/turn**, so they
   run concurrently. Both are read-only (review-only prompts, no
   Edit/Write in their tool surface), so running them concurrently is
   safe: neither can touch the other's or the implementer's files.
   Give each reviewer the same sibling index so they have equivalent
   context awareness to the implementer.
4. **Merge** both reviewers' findings into ONE consolidated issue list
   (dedupe overlapping points; keep each reviewer's verdict attached to
   its findings).

   **Arbitrating contradictions:** if the two reviewers genuinely
   contradict each other on the same specific point (e.g.
   spec-compliance says X is fine, code-quality says X is a bug), the
   ORCHESTRATOR (this pickup session) resolves it — NEVER the
   implementer. Resolve BEFORE dispatching the fix round; the
   implementer must never receive two contradictory instructions and
   be left to pick a side itself. Default heuristic (guidance, not a
   hard rule): spec-compliance findings win on "does this match the
   spec" questions, code-quality findings win on "is this
   well-implemented" questions. If a genuine disagreement on the same
   point can't be reconciled by that split, don't silently pick a
   side — raise it to the user and wait for a decision before
   dispatching the fix round.
5. If the merged list has issues: dispatch ONE fix round to the
   implementer with the full merged list (not two separate
   fix-and-re-review cycles).
6. If fixes were made: re-review, but ONLY with the reviewer(s) whose
   findings were addressed and remain relevant to re-check — this
   mirrors the "failed reviewer only" re-review rule already used
   across this pickup run's task loop (e.g., if only the code-quality
   reviewer raised issues, only code-quality re-reviews; don't re-run a
   reviewer that already approved).
7. Commit.
8. Update session state and progress: `[===-------] N/Total tasks complete`

This collapses the critical path from five serial agent turns
(implementer → spec-review → fix → quality-review → fix) to roughly
three (implementer → reviewers-concurrently → one fix round),
without weakening review — both reviewers still see the full diff and
the full task spec, just not each other's turn to wait on.

See `prompts.md` for the three subagent prompt templates (implementer, spec compliance reviewer, code quality reviewer).
