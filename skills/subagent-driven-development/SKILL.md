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

**Requirements:**
1. Follow TDD - write failing tests BEFORE implementation
2. Use envoy:systematic-debugging if you encounter issues
3. Commit after tests (test: ...) and after implementation (feat: ...)
4. Self-review your changes before returning

**Return:**
- Summary of what you implemented
- Any questions or concerns
- List of files changed
```

## Spec Reviewer Prompt

```markdown
Review this implementation for spec compliance.

**What was implemented:** <summary from implementer>
**Original spec:** <task specification>
**Changes:** git diff <base_sha>..<head_sha>

**Check:**
1. Does implementation match ALL spec requirements?
2. Is anything MISSING from the spec?
3. Is anything EXTRA that wasn't requested?

**Return:** ✅ Spec compliant OR ❌ Issues: <list>
```

## Code Quality Reviewer Prompt

```markdown
Review this implementation for code quality.

**What was implemented:** <summary>
**Changes:** git diff <base_sha>..<head_sha>
**Stack profiles:** Load relevant from stacks/

**Check:**
1. Code follows project standards
2. Tests are meaningful (not just for coverage)
3. No obvious bugs or issues
4. Matches existing codebase patterns

**Return:**
- Strengths: <what's good>
- Issues (Critical/Important/Minor): <list>
- Assessment: Approved / Needs fixes
```

## Example Workflow

```
You: I'm using envoy:subagent-driven-development to execute this plan.

[Read plan file: docs/plans/user-auth-plan.md]
[Extract 5 tasks, create TodoWrite]

Task 1: Add User entity and migration

[Dispatch implementer with full task text]
Implementer: "Implemented User entity with EF Core migration. 3 tests passing."

[Dispatch spec reviewer]
Spec reviewer: ✅ Spec compliant

[Dispatch code quality reviewer]
Code reviewer: Strengths: Clean. Issues: None. Approved.

[Mark Task 1 complete, continue to Task 2...]
```

## Red Flags

**Never:**
- Skip reviews (spec compliance OR code quality)
- Proceed with unfixed issues
- Dispatch multiple implementers in parallel (conflicts)
- Let implementer self-review replace actual review
- Start code quality review before spec compliance is ✅
- Move to next task while either review has open issues

**If subagent asks questions:**
- Answer clearly and completely
- Don't rush them into implementation

**If reviewer finds issues:**
- Implementer fixes them
- Reviewer reviews again
- Repeat until approved

## Integration with Envoy

**Required:**
- `envoy:writing-plans` — Creates the plan this skill executes
- `envoy:finishing-branch` — Complete development after all tasks

**Subagents should use:**
- `envoy:systematic-debugging` — For investigating issues
- TDD cycle from `envoy:executing-plans`
