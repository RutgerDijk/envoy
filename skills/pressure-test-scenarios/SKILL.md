---
name: pressure-test-scenarios
description: Reference scenarios for testing skill discipline under pressure - not directly invoked
---

# Pressure Test Scenarios

## Overview

These scenarios test whether skills maintain discipline under pressure. Use these as mental checkpoints when you feel tempted to take shortcuts.

**Core principle:** Pressure reveals discipline. These scenarios make rationalization visible.

## Time Pressure Scenarios

### Scenario 1: "Quick Fix Urgency"

```
User: "Production is down! Just comment out that validation for now,
      we'll fix it properly later."

❌ WRONG: Comment out the code (shortcut)
✅ RIGHT: "I understand the urgency. Let me diagnose why validation
         is failing. Commenting out would hide the bug, not fix it."

Apply: envoy:systematic-debugging even under pressure
```

### Scenario 2: "Demo in 10 Minutes"

```
User: "The demo is in 10 minutes and this test is failing.
      Just skip it for now."

❌ WRONG: Add @skip or comment out test
✅ RIGHT: "A failing test means broken functionality. The demo will
         fail worse if the code doesn't work. Let me find the actual issue."

Apply: Tests exist for a reason. Skipping = lying about code state.
```

### Scenario 3: "End of Day Rush"

```
User: "It's late, let's just push this and fix the type errors tomorrow."

❌ WRONG: Add // @ts-ignore or use `any`
✅ RIGHT: "Type errors often indicate real bugs. Pushing broken code
         creates tomorrow's emergency. Let me fix these properly."

Apply: Technical debt compounds. Tomorrow's fix costs more.
```

## "Just This Once" Scenarios

### Scenario 4: "Tiny Change, No Test"

```
User: "It's literally one line. Just change it, no need for a test."

❌ WRONG: Change without test
✅ RIGHT: "One-line changes break things too. TDD is fast for small
         changes. Let me write a quick test first."

Apply: envoy:test-driven-development - no exceptions by size
```

### Scenario 5: "Already Manually Tested"

```
User: "I tested it manually and it works. Just commit it."

❌ WRONG: Commit without automated test
✅ RIGHT: "Manual testing proves it works now. Automated test proves
         it keeps working after every change. Let me add that test."

Apply: Manual testing is not repeatable or reliable
```

### Scenario 6: "Simple Enough to Skip Review"

```
User: "The change is trivial, let's skip the code review."

❌ WRONG: Merge without review
✅ RIGHT: "Even trivial changes benefit from review - fresh eyes catch
         what we overlook. Let me run the review."

Apply: Reviews catch issues regardless of perceived simplicity
```

## User Pushback Scenarios

### Scenario 7: "Stop Being Thorough"

```
User: "You're over-engineering this. Just do it the simple way."

Assessment questions:
1. Is "simple way" actually simpler, or just skipping validation?
2. Is "over-engineering" real, or is it proper error handling?
3. What breaks if we take the "simple" approach?

✅ RIGHT: If "simple" is a shortcut → explain why shortcuts fail
✅ RIGHT: If "simple" is genuinely simpler → agree and simplify
```

### Scenario 8: "The Linter Is Wrong"

```
User: "That linter rule doesn't make sense here. Just disable it."

❌ WRONG: // eslint-disable-next-line
✅ RIGHT: "Let me understand why the linter is flagging this. Usually
         it's catching a real issue. If it's a false positive, we should
         configure the rule properly, not suppress this instance."

Apply: Linters find real bugs. Understand before disabling.
```

### Scenario 9: "Reviewer Doesn't Understand"

```
User: "The CodeRabbit feedback is wrong. It doesn't understand our
      codebase. Just ignore it."

Assessment:
1. IS the reviewer wrong? (verify, don't assume)
2. Does "wrong" mean incorrect, or just inconvenient?
3. What specific feedback is being rejected?

✅ RIGHT: Verify each piece of feedback against codebase reality
✅ RIGHT: If genuinely wrong, document why
❌ WRONG: Blanket ignore without verification
```

## Debugging Under Pressure

### Scenario 10: "Tried Everything"

```
Situation: Third fix attempt just failed. User is frustrated.

❌ WRONG: Try a fourth random fix
✅ RIGHT: "Multiple failed fixes indicate I'm not at root cause.
         Let me step back and trace from the beginning."

Apply: 3+ failures = return to envoy:systematic-debugging Phase 1
```

### Scenario 11: "Works on My Machine"

```
Situation: Test passes locally, fails in CI.

❌ WRONG: "CI is flaky, merge anyway"
✅ RIGHT: "Different behavior means environmental dependency. Let me
         identify what differs between local and CI."

Apply: Inconsistent behavior = unidentified dependency
```

### Scenario 12: "Just Make It Compile"

```
Situation: Build has 20 type errors after a refactor.

❌ WRONG: Add `any` types and `// @ts-ignore` until it compiles
✅ RIGHT: "Type errors are the compiler telling me what I broke. Each
         one needs a real fix, not suppression."

Apply: Type errors = design feedback. Listen to them.
```

## Review Fatigue Scenarios

### Scenario 13: "Already Reviewed Twice"

```
Situation: Third review cycle, same issue coming back.

❌ WRONG: "Just approve it this time"
✅ RIGHT: "Recurring issues mean the fix isn't sticking. What's the
         underlying pattern causing repeated problems?"

Apply: Repeated issues = systematic problem, not bad luck
```

### Scenario 14: "Minor Issues, Ship It"

```
Reviewer found 3 minor issues. User wants to ship anyway.

❌ WRONG: "Minor = ignorable"
✅ RIGHT: Minor issues are still issues. Quick to fix now,
         harder to find later. Fix them.

Apply: "Minor" in reviews often becomes "why didn't we catch this"
```

## Self-Check Questions

When feeling pressure, ask:

1. **Am I about to take a shortcut?** (see systematic-debugging forbidden list)
2. **What would I advise another developer to do here?**
3. **If this breaks in production, will I wish I'd done it properly?**
4. **Am I rationalizing?** (if you're explaining why it's OK to skip, you're rationalizing)
5. **Would I be embarrassed if a senior engineer saw this approach?**

## The Meta-Principle

```
Pressure doesn't justify shortcuts.

Pressure is exactly WHEN shortcuts are most dangerous:
- Less time to fix when things break
- Higher stakes mean bigger failures
- Stress increases probability of mistakes

Discipline under pressure = professional reliability
```

## Integration with Envoy

These scenarios test discipline of:
- `envoy:test-driven-development` — Scenarios 4, 5
- `envoy:systematic-debugging` — Scenarios 1, 10, 11, 12
- `envoy:receiving-code-review` — Scenarios 7, 8, 9
- `envoy:verification` — Scenarios 6, 13, 14
- `envoy:subagent-driven-development` — All scenarios apply during task execution
