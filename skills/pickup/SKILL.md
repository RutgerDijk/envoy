---
name: pickup
description: Pickup expert. ALWAYS invoke when the /envoy:pickup command fires or when starting a GitHub issue. Creates worktree, verifies plan, executes tasks with TDD. Do not implement without invoking the skill.
when_to_use:
  - When the user types /envoy:pickup <issue>
  - When ready to implement a GitHub issue with a brainstorm-generated plan
  - When resuming after a context compaction mid-execution
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - Skill
  - Agent
---

## Briefing

!`node ${CLAUDE_SKILL_DIR}/preflight.js`

### Checklist

- [ ] Step 1–6: Fetch issue, create worktree, detect stacks (`steps/worktree.md`)
- [ ] Step 7–8: Viability check, pause for approval (`steps/plan.md`)
- [ ] Step 9–13: Session state, search-first, dependency analysis, execute (`steps/tdd.md`)
- [ ] Step 14: Spec compliance sweep (`steps/verify.md`)
- [ ] Step 15: Handoff to review (`steps/handoff.md`)

# Pickup Issue

## Overview

Pick up a GitHub issue, create a worktree, verify the implementation plan in the issue body, and execute tasks with TDD. This is the single entry point for going from issue to working code.

**Announce at start:** "I'm using envoy:pickup to implement issue #<number>."

**Discipline rule:** This is a rigid skill. The spec is the contract. Execute every task. Do NOT narrate, skip, or adapt steps. See `contexts/discipline-scope.md`, `contexts/discipline-tdd.md`, `contexts/discipline-blocker.md`, `contexts/discipline-task-granularity.md`, and `contexts/execution-announce.md`.

## Arguments

| Flag | Effect |
|------|--------|
| `<issue-number>` | Required: GitHub issue to pick up |
| `--plan-only` | Stop after approval (Step 8) |

---

## Iron Laws (Injected into All Subagent Prompts)

This skill loads the following discipline files once and injects them verbatim into every subagent prompt. Single source of truth — edit the context file to change the rule everywhere:

- `contexts/discipline-scope.md` — Scope Iron Law (spec is contract)
- `contexts/discipline-tdd.md` — TDD Iron Law (no production code without failing test first)
- `contexts/discipline-blocker.md` — Blocker Protocol
- `contexts/discipline-task-granularity.md` — 2–5 min per task
- `contexts/execution-announce.md` — announcement discipline

```bash
SCOPE_LAW=$(cat contexts/discipline-scope.md)
TDD_LAW=$(cat contexts/discipline-tdd.md)
BLOCKER_PROTOCOL=$(cat contexts/discipline-blocker.md)
TASK_GRANULARITY=$(cat contexts/discipline-task-granularity.md)
EXECUTION_ANNOUNCE=$(cat contexts/execution-announce.md)
```

---

## Process

Read each referenced step file in order. Each file is short (<120 lines) and covers a specific phase.

| Steps | File | Purpose |
|-------|------|---------|
| 1–6 | `steps/worktree.md` | Fetch issue, set in-progress label, create branch and worktree, merge permissions, detect stacks |
| 7–8 | `steps/plan.md` | Viability check, pause for approval (and error handling) |
| 9–13 | `steps/tdd.md` | Session state, parse tasks, search-first, dependency analysis, execute loop |
| 14 | `steps/verify.md` | Spec compliance sweep + completion report |
| 15 | `steps/handoff.md` | Handoff to `/envoy:review` |
| — | `steps/prompts.md` | Implementer, spec-compliance, and code-quality reviewer prompt templates |

Do not reorder steps and do not skip a file — each encodes a contract checked by later steps.

---

## Integration with Envoy

**Invokes:**
- `envoy:using-git-worktrees` — Worktree creation conventions
- `envoy:systematic-debugging` — For investigating issues during execution
- `envoy:test-driven-development` — TDD Iron Law applies to all tasks (enforced via `contexts/discipline-tdd.md`)

**Spawns (leaf subagents only — no nested spawning):**
- Implementer agent (per task)
- Spec compliance reviewer (per task)
- Code quality reviewer (per task)

**Libraries used:**
- `lib/session-state.js` — Persist task progress across context compactions and sessions

**After pickup completes:**
- `envoy:review` — Run comprehensive review (auto-invoked)
- `envoy:finalize` — Complete development, create PR (clears session state)

**Platform constraint:** Claude Code subagents cannot spawn subagents (the `Agent` tool is silently stripped from subagent tool allowlists). This skill therefore orchestrates directly rather than delegating to an execution agent.
