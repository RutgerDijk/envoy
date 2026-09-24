# Pickup — Subagent prompt templates

Three subagent prompts used during Step 13 execution.

Per Step 13, the two reviewer prompts are dispatched together in the
same message/turn (concurrent, not sequential) once the implementer
completes. Both reviewer prompts below are read-only: no Edit/Write
in their tool surface, no instruction to modify files — findings only.
This is what makes running them concurrently safe.

Every prompt below includes a **Sibling Tasks** section built with
`lib/task-payload.js`'s `buildSiblingIndex(allTasks, taskId)` — a
one-line-per-task index (id + title only) of the other tasks in the
plan. This gives agents awareness that sibling work exists without
ever injecting another task's full spec.

## Implementer Agent Prompt

Built with `buildAgentPrompt` + `checkBudget` (see below). Injects: `${EXECUTION_ANNOUNCE}`, `${SCOPE_LAW}`, `${TDD_LAW}`, `${BLOCKER_PROTOCOL}`, `${TASK_GRANULARITY}`, `${SIBLING_INDEX}`, `${RESOLVED_TEST_COMMAND}`, `${KNOWN_PATTERNS}`

`${RESOLVED_TEST_COMMAND}` is populated from preflight's `### Test
Command` output (preflight.js resolves it once via
`lib/test-commands.js`'s `resolveTestCommands()` and prints it under
that heading). Two cases:

- **Resolved** — preflight printed a concrete filtered command
  containing a `{{test}}` placeholder, e.g. `dotnet test --filter
  "FullyQualifiedName~{{test}}"`. Do NOT paste it with the placeholder
  still in it — that runs no test. Tell the implementer explicitly:
  `Test command template: <the resolved command>. Before running it,
  replace {{test}} with the actual name of the test you just wrote
  (e.g. the fully-qualified test method name), then run the
  substituted command — never the raw template.`
- **Unresolved** — preflight found no CLAUDE.md or stack profile Test
  Command section. Substitute the explicit instruction below — never
  silently default to a full-suite command:
  `No test command was resolved for this repo. Determine the
  narrowest command that runs just your new/changed test(s) yourself,
  and report what you used.`

`${KNOWN_PATTERNS}` is populated from preflight's `### Known patterns`
output (preflight.js loads it once via `lib/learning-loader.js` —
`loadConfirmedPatterns()` filtered to the detected stacks,
`loadCorrections()` for `memory/corrections.md` and
`~/.claude/learnings/corrections.md` — renders it with
`formatReminders()`, and prints it under that heading). Paste the
section body verbatim: its `**Known patterns (avoid these):**` and
`**Team corrections:**` subsections, `(none recorded)` when nothing
exists, and any "could not be read" line naming an unreadable learnings
file (the task proceeds either way — the STATUS banner is unaffected).

### Assembled with `buildAgentPrompt` and budget-checked

The implementer prompt is NOT hand-assembled. Its sections are
`buildAgentPrompt` parameters (`lib/context-budget.js`), each written as
a **plain markdown file** — no JSON escaping of multi-line text or
quotes. The build CLI reads them with `fs` (no shell interpolation of any
field), runs `checkBudget` for the task's tier from preflight's
`### Complexity` table, and prints the final prompt.

**Recipe** — run from the **worktree root**: a trim's ledger event is
appended to `.envoy/ledger.jsonl` under the current directory, so the
cwd must be the worktree root.

```bash
D=$(mktemp -d)
# 1. Write one markdown file per section into "$D" with the Write tool
#    (see the table below): objective.md, constraints.md, acceptance.md,
#    learnings.md, context.md, reference.md (+ scratchpad.md when parallel).
# 2. Point params.json at them. The Iron Laws come straight from the plugin.
cat > "$D/params.json" <<JSON
{
  "objectiveFile": "objective.md",
  "constraintsFiles": [
    "${CLAUDE_SKILL_DIR}/../../contexts/execution-announce.md",
    "${CLAUDE_SKILL_DIR}/../../contexts/discipline-scope.md",
    "${CLAUDE_SKILL_DIR}/../../contexts/discipline-tdd.md",
    "${CLAUDE_SKILL_DIR}/../../contexts/discipline-blocker.md",
    "${CLAUDE_SKILL_DIR}/../../contexts/discipline-task-granularity.md"
  ],
  "constraintsFile": "constraints.md",
  "acceptanceFile": "acceptance.md",
  "learningsFile": "learnings.md",
  "contextFile": "context.md",
  "referenceFile": "reference.md"
}
JSON
# 3. Build and budget-check; the prompt is printed after ===== PROMPT =====.
node ${CLAUDE_SKILL_DIR}/../../lib/context-budget.js build "$D/params.json" \
  --tier <tier> --task <task-id> --issue <issue>
# 4. After the Agent call is dispatched, clean up.
rm -rf "$D"
```

Relative paths in `params.json` resolve against `$D`. Add
`"scratchpadFile": "scratchpad.md"` only when implementers run in
parallel (see **Parallel implementers** below). The CLI prints
`BUDGET: within|over (...)`, a `Trimmed: …` line when it dropped a section, then `===== PROMPT =====` and the
prompt. Constraints are assembled in order: the Iron Laws
(`constraintsFiles`), then `constraints.md`. `--out <file>` is an
optional convenience for inspecting the built prompt on disk (relative
paths resolve against `$D`; parent dirs are created) — it is never a
substitute for pasting the prompt into the dispatch.

| File | Section | Carries |
|------|---------|---------|
| `objective.md` | `objective` | `Implement Task N: <task title>` + `**Full task specification:**` from `buildTaskSlice(task)` (intent, behavior, files, acceptance, contracts, outOfScope for THIS task only) |
| `constraints.md` | `constraints` | follows the Iron Laws (`${EXECUTION_ANNOUNCE}` `${SCOPE_LAW}` `${TDD_LAW}` `${BLOCKER_PROTOCOL}` `${TASK_GRANULARITY}`, verbatim via `constraintsFiles`): the **Requirements** list (1. Follow TDD Iron Law above — NON-NEGOTIABLE; 2. Use envoy:systematic-debugging if you encounter issues; 3. Two commits minimum: test commit BEFORE implementation commit; 4. Self-review your changes before returning) + `**Test command:** ${RESOLVED_TEST_COMMAND}` |
| `acceptance.md` | `acceptance` | task acceptance as bullets + the **Return** list (summary of what you implemented; git log showing test commit preceded implementation commit; questions or concerns — do not reduce scope, surface blockers via Blocker Protocol; list of files changed) |
| `learnings.md` | `learnings` | `${KNOWN_PATTERNS}` — preflight's `### Known patterns` body, verbatim: avoid the patterns, follow the corrections |
| `scratchpad.md` | `scratchpad` | shared-state briefing — `formatBriefing(pad, taskId)` from `--scratchpad-briefing` (parallel strategy only; omit otherwise) |
| `context.md` | `context` | where this fits in the overall plan + `**Sibling tasks (context only — not in scope):**` `${SIBLING_INDEX}` (`buildSiblingIndex(allTasks, taskId)`, id + title only, never their full specs) |
| `reference.md` | `reference` | stack context: detected stack profiles — common mistakes and best practices |

**Parallel implementers.** Under strategy parallel, Step 13 has already
created `.envoy-scratchpad.json` with `--init-scratchpad` (agent id = task
id). For each implementer, from the worktree root, write its briefing
straight into the section file — the command prints
`formatBriefing(pad, taskId)` from `lib/agent-scratchpad.js` and rejects
any id that is not a registered agent (single-quote the id):

```bash
node ${CLAUDE_SKILL_DIR}/preflight.js --scratchpad-briefing '<task-id>' > "$D/scratchpad.md"
```

and add `"scratchpadFile": "scratchpad.md"` to `params.json` (it lands in
the prompt's Shared State section, never trimmed). Also append to
`constraints.md`: `Other implementers are working in this worktree at the
same time. Stage only your own files (git add <your files>,
never git add -A or git add .) and commit serially — if a commit fails on
the index lock, wait and retry; never commit another task's files.` Under
sequential or batch there is no scratchpad: omit both.

**Budget rules.**

- The Iron Laws are fixed, mandatory overhead (SKILL.md injects them
  verbatim) — about 118 lines, which alone would put every prompt over
  the `standard` 120-line budget. They are therefore **excluded from the
  budgeted count**; the verdict line states `constraints excluded (N
  fixed lines)`. The budget measures everything else.
- **Over budget → Reference is trimmed first**, then Context if still
  over. Objective, constraints, acceptance, learnings and scratchpad are
  never trimmed. `${RESOLVED_TEST_COMMAND}` therefore lives in
  `constraints.md`, not `context.md` — the implementer must never lose
  the test-command instruction to a trim. Every trim is recorded in the
  ledger (`.envoy/ledger.jsonl`, event `prompt-budget-trimmed` with
  `task`, `tier`, `trimmed`, `lines`, `maxLines`) — the CLI writes it;
  the dispatcher does not hand-edit the ledger.
- A prompt still over budget after both trims is dispatched as-is with
  the `BUDGET: over` verdict noted; the tier is advisory.
- The model tier (haiku/sonnet/opus) is **advisory text only** — it does
  not change the Agent tool's model.

**Dispatch — paste the printed prompt.** Pass everything after the
`===== PROMPT =====` line to the Agent call unchanged:

```
Agent({
  subagent_type: "general-purpose",
  description: "Implement Task N",
  prompt: `<everything after ===== PROMPT ===== from the build CLI>`
})
```

Do NOT dispatch with a pointer-only prompt (e.g. "your instructions are
in <file>"). `skills/pickup/contract.json`'s agent invariant matches
prompts containing `Implement Task` and requires the `TDD Iron Law` and
`Scope Iron Law` text in the prompt itself; a pointer prompt never
matches, so it silently bypasses the plugin's only Iron-Law check (and a
temp-dir file may also trigger Read permission prompts for the
subagent).

---

## Spec Compliance Reviewer Prompt

Dispatched in the SAME message/turn as the Code Quality Reviewer
(concurrent, not sequential) — safe because this prompt is read-only:
verification and reporting only, no Edit/Write.

```
Agent({
  subagent_type: "general-purpose",
  description: "Spec compliance review for Task N",
  prompt: `${EXECUTION_ANNOUNCE}

**Read-only review.** Do not edit or write any files — report findings only.

---

Review this implementation for spec compliance.

**What was implemented:** <summary from implementer>
**Original spec:** <task slice via buildTaskSlice(task) — this task only>
**Sibling tasks (context only):** <${SIBLING_INDEX} — one line per other task>
**Changes:** git diff <base_sha>..<head_sha>

---

**CRITICAL: Do Not Trust the Report**

The implementer's summary describes what they BELIEVE they did, not what the code ACTUALLY does.

Your job is skeptical verification:
- READ THE CODE YOURSELF
- Don't trust claims like "3 tests passing" — verify test output
- Don't trust "all requirements met" — check each one against code
- Implementers rationalize. Code doesn't lie.

---

**Verification Process:**

1. **List spec requirements** — Extract EVERY requirement from the original spec
2. **For EACH requirement:**
   - Find the code that implements it (file:line)
   - If you can't find it — MISSING
   - If code exists but doesn't match spec — WRONG
3. **Check for extras:**
   - Any code/behavior NOT in the spec?
   - YAGNI violation = issue
4. **Check for TDD evidence:**
   - Run: git log --oneline <base_sha>..HEAD
   - Does git log show test commit before implementation commit?
   - If not — FAIL (TDD violation trumps all)

**Return format:**

| Requirement | Status | Evidence |
|-------------|--------|----------|
| <req 1> | ✅/❌ | <file:line or MISSING> |
| <req 2> | ✅/❌ | <file:line or MISSING> |

Extras found: <list or "none">
TDD compliance: ✅/❌

**Final verdict:** ✅ Spec compliant OR ❌ Issues: <numbered list>
`
})
```

---

## Code Quality Reviewer Prompt

Dispatched in the SAME message/turn as the Spec Compliance Reviewer
(concurrent, not sequential) — safe because this prompt is read-only:
verification and reporting only, no Edit/Write.

```
Agent({
  subagent_type: "general-purpose",
  description: "Code quality review for Task N",
  prompt: `${EXECUTION_ANNOUNCE}

**Read-only review.** Do not edit or write any files — report findings only.

${TDD_LAW}

---

Review this implementation for code quality.

**What was implemented:** <summary>
**Sibling tasks (context only):** <${SIBLING_INDEX} — one line per other task>
**Changes:** git diff <base_sha>..<head_sha>
**Stack profiles:** Load relevant from ../../stacks/

**Check:**

1. **TDD compliance (CRITICAL):**
   - Run: git log --oneline <base_sha>..HEAD
   - Verify test commit (test: ...) precedes implementation commit (feat: ...)
   - If implementation committed WITHOUT prior test commit — **FAIL REVIEW**
   - This is non-negotiable. No exceptions.

2. **Stack common mistakes:**
   - Load relevant stack profile(s) from ../../stacks/
   - Check each item in the "Common Mistakes" section against the diff

3. **Pattern consistency:**
   - Does the code match naming conventions, folder structure, and error handling patterns already established in this branch or codebase?

4. **Code quality fundamentals:**
   - Tests are meaningful (not just for coverage)
   - No obvious bugs or issues
   - No unnecessary code not required by the spec

**Return:**
- TDD Compliance: ✅ Test-first verified / ❌ VIOLATION: implementation before tests
- Stack issues: <list by category or "none">
- Pattern issues: <list or "none">
- General issues (Critical/Important/Minor): <list>
- Assessment: Approved / Needs fixes / **TDD Violation - Redo task**
`
})
```
