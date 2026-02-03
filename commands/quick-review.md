---
name: quick-review
description: Fast code review (CodeRabbit + AI only, no visual)
---

Use the `envoy:layered-review` skill but only run Layers 0, 1, and 2:
- Layer 0: Automated linting (`npm run lint`)
- Layer 1: CodeRabbit static analysis
- Layer 2: Documentation-informed AI review

Skip Layer 3 (Visual Review) and Layer 4 (Documentation Gap Detection).
