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

The implementer prompt is NOT hand-assembled. Write its sections as
`buildAgentPrompt` parameters (`lib/context-budget.js`) to a params file
in the scratchpad / a temp dir (never the repo's `.envoy/`), then build
it with the task's tier from preflight's `### Complexity` table:

```bash
node ${CLAUDE_SKILL_DIR}/../../lib/context-budget.js build <params.json> --tier <tier> --task <task-id> --issue <issue>
```

The CLI builds the prompt with `buildAgentPrompt(params)` (LITM-ordered
sections), checks it with `checkBudget` for that tier, and prints a
`BUDGET: within|over (...)` verdict followed by the final prompt after
`===== PROMPT =====`. Pass everything after that line to the Agent call
unchanged. The file is read with `fs` — no shell interpolation of any
field.

Mapping of the existing injections onto `buildAgentPrompt` sections:

```json
{
  "objective": "Implement Task N: <task title>\n\n**Full task specification:**\n<buildTaskSlice(task) — intent, behavior, files, acceptance, contracts, outOfScope for THIS task only>",
  "constraintsFiles": [
    "<absolute path to the plugin>/contexts/execution-announce.md",
    "<absolute path to the plugin>/contexts/discipline-scope.md",
    "<absolute path to the plugin>/contexts/discipline-tdd.md",
    "<absolute path to the plugin>/contexts/discipline-blocker.md",
    "<absolute path to the plugin>/contexts/discipline-task-granularity.md"
  ],
  "constraints": "**Requirements:**\n1. Follow TDD Iron Law above — NON-NEGOTIABLE\n2. Use envoy:systematic-debugging if you encounter issues\n3. Two commits minimum: test commit BEFORE implementation commit\n4. Self-review your changes before returning\n\n**Test command:** ${RESOLVED_TEST_COMMAND}",
  "acceptance": "<task.acceptance as a bullet list>\n\n**Return:**\n- Summary of what you implemented\n- Git log showing test commit preceded implementation commit\n- Any questions or concerns (do not reduce scope — surface blockers via Blocker Protocol)\n- List of files changed",
  "learnings": "<${KNOWN_PATTERNS} — preflight's ### Known patterns body, verbatim: avoid the patterns, follow the corrections>",
  "scratchpad": "<shared scratchpad briefing when implementers run in parallel; omit otherwise>",
  "context": "<Brief description of where this fits in the overall plan>\n\n**Sibling tasks (context only — not in scope):**\n<${SIBLING_INDEX} — buildSiblingIndex(allTasks, taskId), id + title only, never their full specs>",
  "reference": "<Stack context: detected stack profiles — common mistakes and best practices>"
}
```

| Section | Carries |
|---------|---------|
| `objective` | task title + `buildTaskSlice(task)` (intent/behavior/files/…) |
| `constraints` | `${EXECUTION_ANNOUNCE}` `${SCOPE_LAW}` `${TDD_LAW}` `${BLOCKER_PROTOCOL}` `${TASK_GRANULARITY}` (verbatim, via `constraintsFiles` — read by the CLI, so the Iron Laws are never hand-escaped into JSON) + Requirements + `${RESOLVED_TEST_COMMAND}` |
| `acceptance` | task acceptance + the Return list |
| `learnings` | `${KNOWN_PATTERNS}` |
| `scratchpad` | shared-state briefing (parallel strategy only) |
| `context` | plan context + `${SIBLING_INDEX}` |
| `reference` | stack context |

**Budget rules.**

- The Iron Laws in `constraints` are fixed, mandatory overhead (SKILL.md
  injects them verbatim) — about 118 lines, which alone would put every
  prompt over the `standard` 120-line budget. They are therefore
  **excluded from the budgeted count**; the verdict line states
  `constraints excluded (N fixed lines)`. The budget measures everything
  else.
- **Over budget → Reference is trimmed first**, then Context if still
  over. `${RESOLVED_TEST_COMMAND}` therefore lives in `constraints`, not
  `context` — the implementer must never lose the test-command
  instruction to a trim. Objective, constraints, acceptance, learnings and scratchpad are
  never trimmed. Every trim is recorded in the ledger
  (`.envoy/ledger.jsonl`, event `prompt-budget-trimmed` with `task`,
  `tier`, `trimmed`, `lines`, `maxLines`) — the CLI writes it, the
  dispatcher does not hand-edit the ledger.
- A prompt still over budget after both trims is dispatched as-is with
  the `BUDGET: over` verdict noted; the tier is advisory.
- The model tier (haiku/sonnet/opus) is **advisory text only** — it does
  not change the Agent tool's model.

```
Agent({
  subagent_type: "general-purpose",
  description: "Implement Task N",
  prompt: `<everything after ===== PROMPT ===== from the build CLI>`
})
```

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
