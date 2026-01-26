---
name: requesting-code-review
description: Use when completing tasks, implementing major features, or before merging to verify work meets requirements
---

# Requesting Code Review

Dispatch code-reviewer subagent to catch issues before they cascade.

**Core principle:** Review early, review often.

**Announce at start:** "I'm using envoy:requesting-code-review to get feedback on these changes."

## When to Request Review

**Mandatory:**
- After each task in subagent-driven development
- After completing major feature
- Before merge to main

**Optional but valuable:**
- When stuck (fresh perspective)
- Before refactoring (baseline check)
- After fixing complex bug

## How to Request

### 1. Get git SHAs

```bash
BASE_SHA=$(git merge-base HEAD main)  # or specific commit
HEAD_SHA=$(git rev-parse HEAD)
```

### 2. Dispatch code-reviewer subagent

```markdown
Review this implementation.

**What was implemented:** <description>
**Requirements/Spec:** <link to spec or inline requirements>
**Base commit:** <BASE_SHA>
**Head commit:** <HEAD_SHA>

**Stack context:** Load relevant profiles from ../../stacks/

**Review for:**
1. Spec compliance - does it meet requirements?
2. Code quality - follows standards, patterns?
3. Test coverage - meaningful tests?
4. Security - any vulnerabilities?
5. Performance - any obvious issues?

**Return:**
- Strengths: <what's good>
- Issues:
  - Critical: <must fix>
  - Important: <should fix>
  - Minor: <nice to fix>
- Assessment: Ready to merge / Needs work
```

### 3. Act on feedback

- Fix **Critical** issues immediately
- Fix **Important** issues before proceeding
- Note **Minor** issues for later
- Push back if reviewer is wrong (with reasoning)

## Example

```
[Just completed Task 2: Add verification function]

You: Let me request code review before proceeding.

BASE_SHA=$(git log --oneline | grep "Task 1" | head -1 | cut -d' ' -f1)
HEAD_SHA=$(git rev-parse HEAD)

[Dispatch code-reviewer subagent]
  What: Verification and repair functions for data index
  Spec: Task 2 from docs/plans/feature.md
  Base: a7981ec
  Head: 3df7661

[Subagent returns]:
  Strengths: Clean architecture, real tests
  Issues:
    Important: Missing null check in VerifyIndex
    Minor: Magic number (100) for batch size
  Assessment: Ready after fixing Important issue

You: [Fix null check, continue to Task 3]
```

## Integration with Envoy Workflows

**envoy:subagent-driven-development:**
- Review after EACH task (two-stage: spec then quality)
- Catch issues before they compound

**envoy:executing-plans (batch mode):**
- Review after each batch
- Get feedback, apply, continue

**envoy:layered-review:**
- More comprehensive 4-layer review
- Use for final review before PR

## Red Flags

**Never:**
- Skip review because "it's simple"
- Ignore Critical issues
- Proceed with unfixed Important issues
- Argue with valid technical feedback

**If reviewer wrong:**
- Push back with technical reasoning
- Show code/tests that prove it works
- Use envoy:receiving-code-review skill
