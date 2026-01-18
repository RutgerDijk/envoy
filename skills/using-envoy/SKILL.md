---
name: using-envoy
description: Use when starting any conversation - establishes how to find and use Envoy skills
---

# Using Envoy Skills

## The Rule

**Check for skills BEFORE ANY RESPONSE.** This includes clarifying questions. Even 1% chance a skill applies means invoke it first.

## Skill Discovery

When you receive a task, check if any Envoy skill applies:

| Task Type | Skill to Use |
|-----------|--------------|
| New feature idea | `envoy:brainstorming` |
| Create implementation plan | `envoy:writing-plans` |
| Execute a plan | `envoy:executing-plans` or `envoy:subagent-driven-development` |
| Pick up GitHub issue | `envoy:pickup` |
| Bug or test failure | `envoy:systematic-debugging` |
| Multiple independent tasks | `envoy:dispatching-parallel-agents` |
| Create git worktree | `envoy:using-git-worktrees` |
| Review code changes | `envoy:layered-review` or `envoy:requesting-code-review` |
| Received review feedback | `envoy:receiving-code-review` |
| Visual/UI verification | `envoy:visual-review` |
| Verify before claiming done | `envoy:verification` |
| Finish branch and create PR | `envoy:finishing-branch` |
| Clean up after PR merge | `envoy:cleanup` |
| Add API documentation | `envoy:docstrings` |
| Sync wiki documentation | `envoy:wiki-sync` |
| Create new Envoy skill | `envoy:writing-skills` |

## Red Flags

These thoughts mean STOP - you're rationalizing:

| Thought | Reality |
|---------|---------|
| "This is just a simple question" | Questions are tasks. Check for skills. |
| "Let me explore first" | Skills tell you HOW to explore. Check first. |
| "This doesn't need a skill" | If a skill exists, use it. |
| "I remember this skill" | Skills evolve. Read current version. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |

## Skill Priority

When multiple skills could apply:

1. **Process skills first** (brainstorming, debugging) - determine HOW to approach
2. **Implementation skills second** (executing-plans) - guide execution
3. **Review skills last** (layered-review, verification) - validate work

Examples:
- "Build feature X" → brainstorming first, then writing-plans, then executing-plans
- "Fix this bug" → systematic-debugging first
- "I'm done" → verification first, then finishing-branch

## Skill Types

**Rigid** (TDD in executing-plans, systematic-debugging): Follow exactly. Don't adapt away discipline.

**Flexible** (brainstorming, writing-plans): Adapt principles to context.

The skill itself tells you which.

## Announcements

Every skill has an "Announce at start" directive. Use it:

```
"I'm using envoy:systematic-debugging to investigate this issue."
"I'm using envoy:brainstorming to design this feature."
```

This keeps the user informed and commits you to following the skill.

## Commands Quick Reference

| Command | Purpose |
|---------|---------|
| `/envoy:brainstorm` | Turn idea into GitHub issue + spec |
| `/envoy:write-plan` | Create implementation plan |
| `/envoy:execute-plan` | Execute plan with strategy |
| `/envoy:pickup` | Pick up GitHub issue |
| `/envoy:review` | Full 4-layer review |
| `/envoy:quick-review` | Fast review (AI only) |
| `/envoy:visual-review` | Chrome DevTools verification |
| `/envoy:finalize` | Review, docs, wiki, PR |
| `/envoy:docstrings` | Add API documentation |
| `/envoy:wiki-sync` | Sync docs to wiki |
| `/envoy:cleanup` | Remove worktree after PR merge |
