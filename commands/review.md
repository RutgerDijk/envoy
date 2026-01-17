---
description: Run full 4-layer code review (CodeRabbit, AI, visual, docs)
---

# Review Command

Use the envoy:layered-review skill to run a comprehensive 4-layer review.

**Layers:**
1. CodeRabbit static analysis
2. Documentation-informed AI review
3. Chrome DevTools visual verification
4. Documentation gap detection

**Flags:**
- `--check-docs` — Deep documentation analysis
- `--no-check-docs` — Skip documentation checking

Pass through flags from $ARGUMENTS.
