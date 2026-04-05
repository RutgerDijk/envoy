---
name: finalize
description: Push, create PR, handle CodeRabbit, fix CI, verify
---

Use the `envoy:finalize` skill exactly as written.

This runs the shipping workflow:
1. Push branch and create PR
2. Poll and address CodeRabbit comments
3. Poll CI and auto-fix failures
4. Final verification
