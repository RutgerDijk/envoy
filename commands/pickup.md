---
description: Pick up a GitHub issue and prepare workspace for implementation
---

# Pickup Command

Use the envoy:pickup skill to prepare issue #$ARGUMENTS for implementation.

If no issue number provided, show recent issues:

```bash
gh issue list --limit 10
```

Then ask: "Which issue number would you like to pick up?"
