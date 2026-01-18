---
description: Pick up a GitHub issue, create worktree, and start implementation
---

# Pickup Command

Use the envoy:pickup skill to implement issue #$ARGUMENTS.

**Default behavior:** Creates worktree, loads context, and automatically starts execution if a plan exists.

**Flags:**
- `--plan-only` — Stop after setup, don't auto-execute

If no issue number provided, show recent issues:

```bash
gh issue list --limit 10
```

Then ask: "Which issue number would you like to pick up?"
