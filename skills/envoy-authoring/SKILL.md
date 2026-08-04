---
name: envoy-authoring
description: Use when authoring, testing, or scaling Envoy itself — creating/editing skills, finding an existing solution before building, running eval scenarios, pressure-testing discipline, or dispatching parallel agents
---

# Envoy Authoring

## Overview

This is the single entry point for the "build and validate Envoy" concerns.
It does not replace its five underlying skills — each still works exactly as
before, standalone (`envoy:writing-skills`, `envoy:eval-harness`,
`envoy:pressure-test-scenarios`, `envoy:dispatching-parallel-agents`,
`envoy:search-first` remain independently invocable). This skill exists so
that browsing the catalog surfaces one meta/authoring concept instead of
five separate entries, and points you to the right one.

**Announce at start:** "I'm using envoy:envoy-authoring to route to the right authoring workflow."

## Which sub-skill applies

| Situation | Use |
|---|---|
| Before building anything new, check whether it already exists (codebase, package registry, GitHub) | `envoy:search-first` |
| Creating a new Envoy skill, editing an existing one, or verifying a skill works before deployment | `envoy:writing-skills` |
| Testing whether a skill behaves correctly across a defined set of scenarios (pass@1 / pass@3) | `envoy:eval-harness` |
| Testing whether a skill maintains discipline under pressure (time pressure, sunk cost, authority) | `envoy:pressure-test-scenarios` |
| Facing 2+ independent tasks with no shared state — want to fan them out concurrently | `envoy:dispatching-parallel-agents` |

## Workflow

1. **Search first.** Before writing a new skill or new lib code, invoke
   `envoy:search-first` to confirm nothing already covers it.
2. **Write the skill.** Invoke `envoy:writing-skills` — skill-authoring IS
   TDD applied to process docs: write pressure scenarios, watch them fail
   without the skill, write the skill, watch them pass.
3. **Validate at scale.** Once the skill exists, invoke `envoy:eval-harness`
   to run it across scenarios and get pass@1/pass@3 metrics, and
   `envoy:pressure-test-scenarios` to check it holds up under pressure.
4. **Parallelize the work.** If validating or authoring spans 2+ independent
   skills/scenarios with no shared state, invoke
   `envoy:dispatching-parallel-agents` to fan them out instead of working
   sequentially.

Each sub-skill's own SKILL.md is the source of truth for its workflow —
this page only routes you to the right one and shows how they compose.

## Integration with Envoy

**Invokes (by name, as routed above):**
- `envoy:search-first`
- `envoy:writing-skills`
- `envoy:eval-harness`
- `envoy:pressure-test-scenarios`
- `envoy:dispatching-parallel-agents`
