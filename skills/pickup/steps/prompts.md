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

Injects: `${EXECUTION_ANNOUNCE}`, `${SCOPE_LAW}`, `${TDD_LAW}`, `${BLOCKER_PROTOCOL}`, `${TASK_GRANULARITY}`, `${SIBLING_INDEX}`

The prompt text below is **identical regardless of which worker model
runs it** — Step 12.5 chooses the model once for the whole pickup run
(`state.workerModel`), and `lib/model-dispatch.js`'s `dispatch()` is
what changes based on that choice, not the prompt. Build the prompt
string first, then dispatch it:

```javascript
const { dispatch } = require('../../lib/model-dispatch');

const implementerPrompt = `${EXECUTION_ANNOUNCE}

${SCOPE_LAW}

${TDD_LAW}

${BLOCKER_PROTOCOL}

${TASK_GRANULARITY}

---

Implement Task N: <task title>
...`; // full template below

// An implementer writes code, runs tests and commits, so it needs a
// write-capable surface. State it explicitly: dispatch() fails CLOSED
// (read-only) for callers that name no tools, and on the kimi path this
// becomes a real `--allowed-tools` restriction on an unsupervised
// background process rather than prompt text the worker may ignore.
const descriptor = dispatch({
  model: state.workerModel,
  prompt: implementerPrompt,
  taskId: task.id,
  allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'],
});

if (descriptor.kind === 'agent') {
  // fable/opus/sonnet/haiku — Agent tool can name the model directly.
  Agent({
    subagent_type: "general-purpose",
    description: "Implement Task N",
    model: descriptor.model,
    prompt: descriptor.prompt,
  });
} else {
  // kimi — descriptor.kind === 'bash'. dispatch() already wrote the
  // prompt to descriptor.promptFile; the command reads it via stdin
  // redirection, so no prompt text is interpolated into the command
  // string. Never build this command by hand.
  const { shell_id } = Bash({
    command: descriptor.command,
    run_in_background: true,
    description: descriptor.description,
  });
  // WAIT for exit before reading. descriptor.outputFile is written
  // incrementally, so reading it early yields a truncated report — and
  // for a parallel wave, every task's shell must have exited before the
  // wave's reports are merged. Poll BashOutput(shell_id) until it
  // reports the shell has exited (or use Monitor to block on that
  // condition), THEN read descriptor.outputFile (run-unique, under
  // .envoy/agent-output/) as the implementer's report.
}
```

Full implementer prompt template (`implementerPrompt` above — identical
text whether `dispatch()` routes it to the `Agent` tool or to kimi):

```
${EXECUTION_ANNOUNCE}

${SCOPE_LAW}

${TDD_LAW}

${BLOCKER_PROTOCOL}

${TASK_GRANULARITY}

---

Implement Task N: <task title>

**Context:**
<Brief description of where this fits in the overall plan>

**Full task specification:**
<Built with lib/task-payload.js buildTaskSlice(task) — intent, behavior,
files, acceptance, contracts, outOfScope for THIS task only>

**Sibling tasks (context only — not in scope):**
<${SIBLING_INDEX} — one line per other task, id + title only, via
buildSiblingIndex(allTasks, taskId). Never their full specs.>

**Stack context:**
<Detected stack profiles — common mistakes and best practices>

**Known patterns (avoid these):**
<Confirmed patterns and team corrections from learning-loader>

**Requirements:**
1. Follow TDD Iron Law above — NON-NEGOTIABLE
2. Use envoy:systematic-debugging if you encounter issues
3. Two commits minimum: test commit BEFORE implementation commit
4. Self-review your changes before returning

**Return:**
- Summary of what you implemented
- Git log showing test commit preceded implementation commit
- Any questions or concerns (do not reduce scope — surface blockers via Blocker Protocol)
- List of files changed
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
