---
name: doctor
description: Check for tracked Envoy runtime-state files and missing .gitignore entries
---

Use the `envoy:doctor` skill exactly as written.

Supported flags:
- `--fix` - Stage `git rm --cached` for tracked `.envoy-tasks/*.json` /
  `.envoy/**` files and append missing entries to `.gitignore`. Requires a
  clean worktree. Never commits.
