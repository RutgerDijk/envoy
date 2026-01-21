---
name: receiving-code-review
description: Use when receiving code review feedback, before implementing suggestions - requires technical verification, not blind implementation
---

# Receiving Code Review

## Overview

Code review requires technical evaluation, not emotional performance or blind implementation.

**Core principle:** Verify before implementing. Ask before assuming. Technical correctness over social comfort.

**Announce at start:** "I'm using envoy:receiving-code-review to evaluate this feedback."

## The Response Pattern

```
WHEN receiving code review feedback:

1. READ: Complete feedback without reacting
2. UNDERSTAND: Restate requirement in own words (or ask)
3. VERIFY: Check against codebase reality
4. EVALUATE: Technically sound for THIS codebase?
5. RESPOND: Technical acknowledgment or reasoned pushback
6. IMPLEMENT: One item at a time, test each
```

## Forbidden Responses

**NEVER:**
- "You're absolutely right!"
- "Great point!" / "Excellent feedback!"
- "Let me implement that now" (before verification)

**INSTEAD:**
- Restate the technical requirement
- Ask clarifying questions
- Push back with technical reasoning if wrong
- Just start working (actions > words)

## Handling Unclear Feedback

```
IF any item is unclear:
  STOP - do not implement anything yet
  ASK for clarification on unclear items

WHY: Items may be related. Partial understanding = wrong implementation.
```

**Example:**
```
Reviewer: "Fix items 1-6"
You understand 1,2,3,6. Unclear on 4,5.

❌ WRONG: Implement 1,2,3,6 now, ask about 4,5 later
✅ RIGHT: "I understand items 1,2,3,6. Need clarification on 4 and 5 before proceeding."
```

## Handling External Reviewers (CodeRabbit, AI, etc.)

```
BEFORE implementing:
  1. Check: Technically correct for THIS codebase?
  2. Check: Does it break existing functionality?
  3. Check: Is there a reason for current implementation?
  4. Check: Does reviewer understand full context?

IF suggestion seems wrong:
  Push back with technical reasoning

IF conflicts with user's prior decisions:
  Stop and discuss with user first
```

## YAGNI Check

```
IF reviewer suggests "implementing properly" or adding features:
  grep codebase for actual usage

  IF unused: "This isn't called anywhere. Remove it (YAGNI)?"
  IF used: Then implement properly
```

**Common YAGNI violations from reviewers:**
- "Add error handling for edge case X" → Does X happen in practice?
- "Make this configurable" → Is configuration actually needed?
- "Add logging here" → Is anyone going to read these logs?
- "This should be more generic" → Are there other use cases today?

**The test:** Would removing this code break anything that works today? If no → YAGNI.

## Technical Verification Before Implementation

```
BEFORE implementing ANY suggestion:

1. REPRODUCE: Can you see the problem the reviewer claims?
   - If claim is "this will break when X", test X
   - If claim is "performance issue", measure it

2. CONTEXT: Does reviewer have full context?
   - Check if they see the test file
   - Check if they see related code
   - Check git history for WHY current approach exists

3. ALTERNATIVES: Is their suggestion the best fix?
   - Their fix may be correct but suboptimal
   - You know this codebase better than external reviewers

4. INTEGRATION: Does fix work with existing code?
   - Run tests before and after
   - Check related functionality
```

## Implementation Order

```
FOR multi-item feedback:
  1. Clarify anything unclear FIRST
  2. Then implement in this order:
     - Blocking issues (breaks, security)
     - Simple fixes (typos, imports)
     - Complex fixes (refactoring, logic)
  3. Test each fix individually
  4. Verify no regressions
```

## When To Push Back

Push back when:
- Suggestion breaks existing functionality
- Reviewer lacks full context
- Violates YAGNI (unused feature)
- Technically incorrect for this stack
- Conflicts with documented architectural decisions

**How to push back:**
- Use technical reasoning, not defensiveness
- Reference working tests/code
- Ask specific questions

## Acknowledging Correct Feedback

When feedback IS correct:
```
✅ "Fixed. [Brief description of what changed]"
✅ "Good catch - [specific issue]. Fixed in [location]."
✅ [Just fix it and show in the code]

❌ "You're absolutely right!"
❌ "Great point!"
❌ "Thanks for catching that!"
```

**Why no thanks:** Actions speak. Just fix it. The code itself shows you heard the feedback.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Performative agreement | State requirement or just act |
| Blind implementation | Verify against codebase first |
| Batch without testing | One at a time, test each |
| Assuming reviewer is right | Check if breaks things |
| Avoiding pushback | Technical correctness > comfort |
| Partial implementation | Clarify all items first |

## The Bottom Line

**External feedback = suggestions to evaluate, not orders to follow.**

Verify. Question. Then implement.

## Integration with Envoy

**Related skills:**
- `envoy:verification` — Verify fixes after implementing feedback
- `envoy:systematic-debugging` — If feedback reveals bug, debug properly
- `envoy:pressure-test-scenarios` — Scenarios 7, 8, 9 test review discipline
