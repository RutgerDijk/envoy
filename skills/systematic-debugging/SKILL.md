---
name: systematic-debugging
description: Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes
---

# Systematic Debugging

## Overview

Random fixes waste time and create new bugs. Quick patches mask underlying issues.

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

**Announce at start:** "I'm using envoy:systematic-debugging to investigate this issue."

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes.

## When to Use

Use for ANY technical issue:
- Test failures
- Bugs in production
- Unexpected behavior
- Performance problems
- Build failures
- Integration issues

**Use ESPECIALLY when:**
- Under time pressure (emergencies make guessing tempting)
- "Just one quick fix" seems obvious
- You've already tried multiple fixes
- Previous fix didn't work

## The Four Phases

You MUST complete each phase before proceeding to the next.

### Phase 1: Root Cause Investigation

**BEFORE attempting ANY fix:**

1. **Read Error Messages Carefully**
   - Don't skip past errors or warnings
   - Read stack traces completely
   - Note line numbers, file paths, error codes

2. **Reproduce Consistently**
   - Can you trigger it reliably?
   - What are the exact steps?
   - If not reproducible → gather more data, don't guess

3. **Check Recent Changes**
   - What changed that could cause this?
   - Git diff, recent commits
   - New dependencies, config changes

4. **Gather Evidence in Multi-Component Systems**

   For .NET/React stack, check each layer:
   ```bash
   # Frontend
   echo "=== Browser Console ==="
   # Check DevTools console for errors

   # API Layer
   echo "=== API Response ==="
   curl -v http://localhost:5000/api/endpoint

   # Backend Logs
   echo "=== .NET Logs ==="
   # Check Serilog output

   # Database
   echo "=== Database State ==="
   # Check PostgreSQL for data issues
   ```

5. **Trace Data Flow**
   - Where does bad value originate?
   - Trace backward through call stack
   - Fix at source, not at symptom

### Phase 2: Pattern Analysis

1. **Find Working Examples**
   - Locate similar working code in same codebase
   - What works that's similar to what's broken?

2. **Compare Against References**
   - Check stack profiles in `stacks/` for common mistakes
   - Read the relevant profile completely

3. **Identify Differences**
   - What's different between working and broken?
   - List every difference, however small

### Phase 3: Hypothesis and Testing

1. **Form Single Hypothesis**
   - State clearly: "I think X is the root cause because Y"
   - Be specific, not vague

2. **Test Minimally**
   - Make the SMALLEST possible change to test hypothesis
   - One variable at a time
   - Don't fix multiple things at once

3. **Verify Before Continuing**
   - Did it work? Yes → Phase 4
   - Didn't work? Form NEW hypothesis
   - DON'T add more fixes on top

### Phase 4: Implementation

1. **Create Failing Test Case**
   - Follow TDD: write test BEFORE fix
   - Test must fail without the fix
   - Commit: `test(<scope>): add test for <issue>`

2. **Implement Single Fix**
   - Address the root cause identified
   - ONE change at a time
   - Commit: `fix(<scope>): <description>`

**Scopes:** `backend`, `frontend`, `api`, `db`, `auth`, `tests`, `docs`

3. **Verify Fix**
   - Test passes now?
   - No other tests broken?
   - Issue actually resolved?

4. **If 3+ Fixes Failed: Question Architecture**

   Pattern indicating architectural problem:
   - Each fix reveals new shared state/coupling
   - Fixes require "massive refactoring"
   - Each fix creates new symptoms elsewhere

   **STOP and discuss with user before attempting more fixes**

## Red Flags - STOP and Follow Process

If you catch yourself thinking:
- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "It's probably X, let me fix that"
- "I don't fully understand but this might work"
- Proposing solutions before tracing data flow

**ALL of these mean: STOP. Return to Phase 1.**

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Issue is simple, don't need process" | Simple issues have root causes too. Process is fast for simple bugs. |
| "Emergency, no time for process" | Systematic debugging is FASTER than guess-and-check thrashing. |
| "Just try this first, then investigate" | First fix sets the pattern. Do it right from the start. |
| "I'll write test after confirming fix works" | Untested fixes don't stick. Test first proves it. |
| "One more fix attempt" (after 2+ failures) | 3+ failures = architectural problem. Question pattern, don't fix again. |

## Quick Reference

| Phase | Key Activities | Success Criteria |
|-------|---------------|------------------|
| **1. Root Cause** | Read errors, reproduce, check changes, gather evidence | Understand WHAT and WHY |
| **2. Pattern** | Find working examples, compare | Identify differences |
| **3. Hypothesis** | Form theory, test minimally | Confirmed or new hypothesis |
| **4. Implementation** | Create test, fix, verify | Bug resolved, tests pass |

## Integration with Envoy

After fixing, use:
- `envoy:verification` — Verify fix before claiming success
- `envoy:layered-review` — Review changes before finalizing
