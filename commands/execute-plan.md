---
description: Execute an implementation plan with configurable strategy
---

# Execute Plan Command

Use the envoy:executing-plans skill to execute the plan.

If "$ARGUMENTS" contains a file path, use that plan.
Otherwise, look for the most recent plan in `docs/plans/` matching the current branch, or ask which one to use.

The execution strategy (parallel, batch, sequential) is defined in the plan itself.
