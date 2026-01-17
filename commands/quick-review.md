---
description: Run quick review (CodeRabbit + AI only, skip visual verification)
---

# Quick Review Command

Use the envoy:layered-review skill but only run Layers 1 and 2:

1. **Layer 1:** CodeRabbit static analysis
2. **Layer 2:** Documentation-informed AI review

Skips:
- Layer 3 (visual verification)
- Layer 4 (documentation gaps)

Use this for:
- Backend-only changes
- Non-UI changes
- Quick feedback before full review
