---
name: subagent-driven-development
description: Use when executing implementation plans with independent tasks in the current session
---

# Subagent-Driven Development

Execute plan by dispatching fresh subagent per task, with two-stage review after each: spec compliance review first, then code quality review.

**Core principle:** Fresh subagent per task + two-stage review (spec then quality) = high quality, fast iteration

**Announce at start:** "I'm using envoy:subagent-driven-development to execute this plan."

## When to Use

**Use when:**
- Have implementation plan from `envoy:writing-plans`
- Tasks are mostly independent
- Want to stay in current session (no context switch)

**vs. envoy:executing-plans:**
- Same session (no context switch)
- Fresh subagent per task (no context pollution)
- Two-stage review after each task
- Faster iteration (no human-in-loop between tasks)

## The Process

```
1. Read plan, extract all tasks with full text
2. Create TodoWrite with all tasks

For each task:
  3. Dispatch implementer subagent with full task text + context
  4. If subagent asks questions → answer, then continue
  5. Subagent implements using TDD, commits, self-reviews
  6. Dispatch spec reviewer → confirms code matches spec
  7. If spec issues → implementer fixes → re-review
  8. Dispatch code quality reviewer
  9. If quality issues → implementer fixes → re-review
  10. Mark task complete in TodoWrite

After all tasks:
  11. Dispatch final code reviewer for entire implementation
  12. Use envoy:finishing-branch
```

## Implementer Subagent Prompt

```markdown
Implement Task N: <task title>

**Context:**
<Brief description of where this fits in the overall plan>

**Full task specification:**
<Copy the complete task text from the plan>

**TDD IRON LAW — NO EXCEPTIONS:**

> **NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.**

Write code before test? **Delete it. Start over.**
- Don't keep as "reference"
- Don't "adapt" while writing tests
- Don't look at it
- **Delete means delete**

**Before writing ANY implementation code, ask yourself:**
- "Do I have a failing test for this behavior?"
- If NO → **STOP. Write the test first.**

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. Write it. |
| "I'll write tests after" | Tests passing immediately prove nothing. Test first shows the test CAN fail. |
| "I already know how to implement it" | Good. You'll implement it faster after writing the test. |
| "It's just a small fix" | Small fixes break things. Test first. |
| "Time pressure" | Skipping tests costs MORE time. Always. |

**TDD Cycle:**
1. RED — Write failing test(s) for expected behavior
   - Run tests to confirm they FAIL
   - Commit: `test(<scope>): add tests for <feature>`
2. GREEN — Write MINIMAL code to make tests pass
   - Run tests to confirm they PASS
   - Commit: `feat(<scope>): implement <feature>`
3. REFACTOR — Clean up while keeping tests green
   - Commit: `refactor(<scope>): clean up <feature>`

**Commit scopes:** `backend`, `frontend`, `api`, `db`, `auth`, `tests`, `docs`

**Requirements:**
1. Follow TDD cycle above — this is NON-NEGOTIABLE
2. Use envoy:systematic-debugging if you encounter issues
3. Two commits minimum: test commit BEFORE implementation commit
4. Self-review your changes before returning

**Return:**
- Summary of what you implemented
- Git log showing test commit preceded implementation commit
- Any questions or concerns
- List of files changed
```

## Spec Reviewer Prompt

```markdown
Review this implementation for spec compliance.

**What was implemented:** <summary from implementer>
**Original spec:** <task specification>
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
   - If you can't find it → MISSING
   - If code exists but doesn't match spec → WRONG
3. **Check for extras:**
   - Any code/behavior NOT in the spec?
   - YAGNI violation = issue
4. **Check for TDD evidence:**
   - Does git log show test commit before implementation commit?
   - If not → FAIL (TDD violation trumps all)

**Return format:**

| Requirement | Status | Evidence |
|-------------|--------|----------|
| <req 1> | ✅/❌ | <file:line or MISSING> |
| <req 2> | ✅/❌ | <file:line or MISSING> |

Extras found: <list or "none">
TDD compliance: ✅/❌

**Final verdict:** ✅ Spec compliant OR ❌ Issues: <numbered list>
```

## Code Quality Reviewer Prompt

```markdown
Review this implementation for code quality.

**What was implemented:** <summary>
**Changes:** git diff <base_sha>..<head_sha>
**Stack profiles:** Load relevant from ../../stacks/

**Check:**
1. **TDD compliance (CRITICAL):**
   - Run: `git log --oneline <base_sha>..HEAD`
   - Verify test commit (`test: ...`) precedes implementation commit (`feat: ...`)
   - If implementation committed WITHOUT prior test commit → **FAIL REVIEW**
   - This is non-negotiable. No exceptions.
2. Code follows project standards
3. Tests are meaningful (not just for coverage)
4. No obvious bugs or issues
5. Matches existing codebase patterns

**Return:**
- TDD Compliance: ✅ Test-first verified / ❌ VIOLATION: implementation before tests
- Strengths: <what's good>
- Issues (Critical/Important/Minor): <list>
- Assessment: Approved / Needs fixes / **TDD Violation - Redo task**
```

## Example Workflow

```
You: I'm using envoy:subagent-driven-development to execute this plan.

[Read spec file: docs/plans/user-auth.md]
[Extract 5 tasks, create TodoWrite]

Task 1: Add User entity and migration

[Dispatch implementer with full task text + TDD Iron Law]
Implementer: "Implemented User entity with EF Core migration.
  Git log:
  - abc1234 test(backend): add User entity tests
  - def5678 feat(backend): implement User entity and migration
  3 tests passing."

[Dispatch spec reviewer]
Spec reviewer: ✅ Spec compliant

[Dispatch code quality reviewer]
Code reviewer:
  TDD Compliance: ✅ Test-first verified (test commit abc1234 precedes feat commit def5678)
  Strengths: Clean.
  Issues: None.
  Assessment: Approved.

[Mark Task 1 complete, continue to Task 2...]
```

### TDD Violation Example

```
[Dispatch implementer]
Implementer: "Implemented feature. Git log:
  - xyz9999 feat(frontend): implement feature"

[Dispatch code quality reviewer]
Code reviewer:
  TDD Compliance: ❌ VIOLATION - no test commit before implementation
  Assessment: **TDD Violation - Redo task**

[Dispatch implementer to REDO task]
You: "TDD violation detected. Delete your implementation and start over:
  1. Write failing tests FIRST
  2. Commit tests
  3. THEN implement to make tests pass
  4. Commit implementation"
```

## Red Flags

**Never:**
- Skip reviews (spec compliance OR code quality)
- Proceed with unfixed issues
- Dispatch multiple implementers in parallel (conflicts)
- Let implementer self-review replace actual review
- Start code quality review before spec compliance is ✅
- Move to next task while either review has open issues
- Accept TDD violations — if implementation committed before tests, **task must be redone**
- Accept excuses for skipping TDD ("too simple", "time pressure", etc.)

**If subagent asks questions:**
- Answer clearly and completely
- Don't rush them into implementation

**If reviewer finds issues:**
- Implementer fixes them
- Reviewer reviews again
- Repeat until approved

**If TDD violation detected:**
- Implementer must DELETE implementation (not just add tests after)
- Start fresh: write tests first, commit, then implement
- This is non-negotiable — "fixing" by adding tests after misses the point

## Integration with Envoy

**Required:**
- `envoy:writing-plans` — Creates the plan this skill executes
- `envoy:finishing-branch` — Complete development after all tasks

**Subagents should use:**
- `envoy:test-driven-development` — TDD Iron Law applies to all tasks
- `envoy:systematic-debugging` — For investigating issues
- `envoy:pressure-test-scenarios` — All scenarios apply during execution

**Reviewers should apply:**
- `envoy:receiving-code-review` — Skeptical evaluation of implementer claims
