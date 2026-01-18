---
description: Clean up worktree and feature branch after PR is merged
---

# Cleanup Command

Use the envoy:cleanup skill to remove the worktree and branch after your PR has been merged.

**Flags:**
- `--force` — Force remove even with uncommitted changes
- `--all` — Clean up ALL merged worktrees

**Prerequisites:** PR must be merged first.

If not in a worktree, ask: "Which branch/worktree would you like to clean up?"
