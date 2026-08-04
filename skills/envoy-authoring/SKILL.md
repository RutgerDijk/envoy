---
name: envoy-authoring
description: Use when authoring, testing, or scaling Envoy itself — creating/editing skills, finding an existing solution before building, running eval scenarios, pressure-testing discipline, or dispatching parallel agents
when_to_use:
  - Before writing a new Envoy skill or new lib code
  - When creating or editing a skill's SKILL.md
  - When verifying a skill works before deployment
  - When testing whether a skill behaves correctly across defined scenarios
  - When testing whether a skill maintains discipline under pressure
  - When facing 2+ independent tasks with no shared state
---

# Envoy Authoring

## Overview

Single entry point for the "build and validate Envoy" concerns: searching
for an existing solution, writing/editing a skill, evaluating it at scale,
pressure-testing its discipline, and dispatching independent authoring work
in parallel. These five concerns used to be five separate skill
directories; they are now one skill with lazy-loaded step files — read only
the step file for the phase you're in, not all five.

**Announce at start:** "I'm using envoy:envoy-authoring to <search-first|write-skill|eval|pressure-test|dispatch>."

## Which step file applies

| Situation | Read |
|---|---|
| Before building anything new, check whether it already exists (codebase, package registry, GitHub) | `steps/search-first.md` |
| Creating a new Envoy skill or editing an existing one | `steps/writing-skills.md` |
| Before shipping any new/edited skill — RED-GREEN-REFACTOR cycle, rationalization table, deployment checklist | `steps/writing-skills-testing.md` |
| Testing whether a skill behaves correctly across a defined set of scenarios (pass@1 / pass@3) | `steps/eval-harness.md` |
| Testing whether a skill maintains discipline under pressure (time pressure, sunk cost, authority) | `steps/pressure-test-scenarios.md` |
| Facing 2+ independent tasks with no shared state — want to fan them out concurrently | `steps/dispatching-parallel-agents.md` |

## Workflow

1. **Search first.** Before writing a new skill or new lib code, read
   `steps/search-first.md` and confirm nothing already covers it.
2. **Write the skill.** Read `steps/writing-skills.md` — skill-authoring IS
   TDD applied to process docs: write pressure scenarios, watch them fail
   without the skill, write the skill, watch them pass. Then read
   `steps/writing-skills-testing.md` before shipping.
3. **Validate at scale.** Once the skill exists, read `steps/eval-harness.md`
   to run it across scenarios and get pass@1/pass@3 metrics, and
   `steps/pressure-test-scenarios.md` to check it holds up under pressure.
4. **Parallelize the work.** If validating or authoring spans 2+ independent
   skills/scenarios with no shared state, read
   `steps/dispatching-parallel-agents.md` to fan them out instead of working
   sequentially.

Do not preload every step file — read the one for the phase you're actually
in, the same lazy-loading discipline `pickup`/`review`/`finalize` use for
their own `steps/`.

## Integration with Envoy

**Required background:**
- `envoy:test-driven-development` — the Iron Law the writing-skills step adapts to documentation

**Works well with:**
- `envoy:pickup` — search-first runs before each implementation task; dispatching-parallel-agents is its parallel execution strategy
- `envoy:systematic-debugging` — each dispatched agent uses this for its own domain
- `envoy:verification` — verify a skill works before claiming it's done

**Libraries used:**
- `lib/agent-scratchpad.js` — coordination between parallel agents (dispatching-parallel-agents step)
- `lib/context-budget.js` — right-size prompts per task complexity
