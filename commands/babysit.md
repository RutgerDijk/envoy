---
name: babysit
description: Shepherd open PRs in one pass — re-trigger CodeRabbit, fix CI, resolve threads
---

Use the `envoy:babysit` skill exactly as written.

Pass any arguments provided by the user to the skill.

Babysit makes a single pass and returns — it does not sleep. To run it on an
interval, compose it with loop, e.g. `/loop 15m /envoy:babysit`.
