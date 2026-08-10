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

### Step 12.5: Worker Model Selection

Before dispatching any implementer (Step 13), pick ONE model that every
parallel implementer agent in this pickup run will use. This is a
per-pickup-run choice, not per-task — see `lib/model-dispatch.js` (task
#76) for the dispatch mechanics this selection feeds.

**Resume check — session state wins over asking again:**

```javascript
const session = require('../../lib/session-state');
const state = session.exists() ? session.load() : session.createEmpty();

if (state.workerModel) {
  // Already chosen earlier this run, or restored after compaction/
  // restart — reuse it. Do NOT ask again.
  workerModel = state.workerModel;
} else {
  // ... AskUserQuestion flow below ...
}
```

**Ask once, kimi is opt-in:**

Only when `state.workerModel` is unset, call `checkKimi()` from
`lib/model-dispatch.js` to compute the kimi menu label. `checkKimi()`
short-circuits with no network call whenever `MOONSHOT_API_KEY` is unset
— so a pickup run that never touches kimi generates zero Moonshot
traffic, matching today's default behavior exactly.

Use `AskUserQuestion` with:

| Option | Label |
|--------|-------|
| `fable` | Fable |
| `opus` | Opus |
| `sonnet` | Sonnet |
| `haiku` | Haiku |
| `kimi` | Kimi — plain label when `checkKimi()` returns `ok: true`; **"Kimi (needs setup)"** when it returns `ok: false` |

**If the user picks kimi and it is NOT yet configured ("needs setup"):**

1. Prompt for the Moonshot API key: "Get a key at https://platform.moonshot.ai — paste it here, or type `skip` to pick a different model."
2. `skip` → return to the `AskUserQuestion` model menu above. Do not fall through to dispatch with no model chosen.
3. A key provided → call `installKimi(key)` from `lib/model-dispatch.js`.
   - `probe.ok === false` → report `probe.reason` and return to the model menu (do not silently substitute a different model).
   - `probe.ok === true` → kimi is now configured and is the chosen worker model.

**Persist the choice before Step 13 dispatches anything:**

```javascript
session.setWorkerModel(state, workerModel);
session.save(state);
```

Step 13's dispatch loop reads `state.workerModel` — it never re-derives
or re-asks for the model.

### Step 13: Execute Tasks

For each task:

1. Announce: `Task N: <name> (N/Total)`
2. Build the implementer prompt (see `prompts.md`) with
   `lib/task-payload.js`: `buildTaskSlice(task)` for the full task
   specification (structured `intent`/`behavior`/`files`/`acceptance`/
   `contracts`/`outOfScope` fields per `lib/schemas/tasks.json` — never
   an ad-hoc format) plus `buildSiblingIndex(allTasks, task.id)` for a
   one-line-per-task index of siblings. Siblings never get their full
   spec injected — only id + title. The prompt template itself is
   identical regardless of which model runs it — see `prompts.md`.
3. Dispatch the implementer through `lib/model-dispatch.js`'s
   `dispatch({ model: state.workerModel, prompt, taskId: task.id })`:
   - **Anthropic tiers** (fable/opus/sonnet/haiku) — `descriptor.kind === 'agent'`. Call the `Agent` tool with `model: descriptor.model` and `prompt: descriptor.prompt`. This is the same Agent-tool call pickup has always made, with one addition: an explicit `model` override instead of the implicit default.
   - **kimi** — `descriptor.kind === 'bash'`. Run `descriptor.command` via `Bash` with `run_in_background: true` (per the descriptor — `dispatch()` already wrote the prompt to `descriptor.promptFile` and points the command at it via stdin redirection). Never re-embed task prompt text into a shell command yourself — that is a command-injection risk `dispatch()` exists specifically to avoid. Once the background process exits, read `descriptor.outputFile` (`.envoy/agent-output/<task-id>.md`) as the implementer's report, in place of an Agent-tool return value.
4. Once the implementer completes, dispatch BOTH reviewers — spec
   compliance and code quality — **in the same message/turn**, so they
   run concurrently. Both are read-only (review-only prompts, no
   Edit/Write in their tool surface), so running them concurrently is
   safe: neither can touch the other's or the implementer's files.
   Give each reviewer the same sibling index so they have equivalent
   context awareness to the implementer.
5. **Merge** both reviewers' findings into ONE consolidated issue list
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
6. If the merged list has issues: dispatch ONE fix round to the
   implementer with the full merged list (not two separate
   fix-and-re-review cycles).
7. If fixes were made: re-review, but ONLY with the reviewer(s) whose
   findings were addressed and remain relevant to re-check — this
   mirrors the "failed reviewer only" re-review rule already used
   across this pickup run's task loop (e.g., if only the code-quality
   reviewer raised issues, only code-quality re-reviews; don't re-run a
   reviewer that already approved).
8. Commit.
9. Update session state and progress: `[===-------] N/Total tasks complete`

This collapses the critical path from five serial agent turns
(implementer → spec-review → fix → quality-review → fix) to roughly
three (implementer → reviewers-concurrently → one fix round),
without weakening review — both reviewers still see the full diff and
the full task spec, just not each other's turn to wait on.

See `prompts.md` for the three subagent prompt templates (implementer, spec compliance reviewer, code quality reviewer).
