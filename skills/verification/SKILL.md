---
name: verification
description: Verification expert. ALWAYS invoke before committing work or claiming a task is complete. Runs tests, build, lint, and real-world smoke checks with evidence. Do not assert done without evidence.
when_to_use:
  - Before committing work
  - Before claiming a task is complete
  - When the user asks "is this working?" or "did it pass?"
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
---

# Verification Before Completion

## Overview

**Never claim something is fixed or working without verification.** Run tests, check the actual behavior, provide evidence.

**Announce at start:** "I'm using envoy:verification to verify these changes work."

## The Iron Laws

**NO COMPLETION CLAIMS WITHOUT VERIFICATION EVIDENCE.**

Evidence before assertions. Always.

- Don't say "this should work" — **prove it works**
- Don't say "I fixed it" — **show it's fixed**
- Don't say "tests should pass" — **run them and show output**

**WORKAROUNDS ARE NOT FIXES.**

If verification "passes" because you:
- Commented out failing code
- Disabled lint rules or tests
- Used type suppressions (`@ts-ignore`, `any`, `!`)
- Added empty catch blocks
- Suppressed warnings (`#pragma warning disable`, `[SuppressMessage]`)
- Used `default!` or null-forgiving operator in C#
- Used `dynamic` or `object` instead of proper types
- Disabled or deleted failing tests

**You have NOT fixed the issue. You have hidden it.**

Return to the problem. Fix it properly.

## The Gate Function

```
BEFORE claiming any status:

1. IDENTIFY: What command proves this claim?
2. RUN: Execute the command (fresh, complete)
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
   - If NO: State actual status with evidence
   - If YES: State claim WITH evidence
5. CHECK: Did I use any shortcuts to make it pass?
   - If YES: That's not a fix. Return to debugging.
   - If NO: Proceed

Skip any step = lying, not verifying
```

### Red Flags — STOP

If you catch yourself saying:
- "It should be fixed"
- "I believe this works"
- "I didn't see the error this time"
- "The change has been made"

**STOP.** These are assertions without evidence. Run verification first.

### Rationalization Table

| Excuse | Reality |
|--------|---------|
| "I'm confident this works" | Confidence is not evidence. Run the tests. |
| "It's a trivial change" | Trivial changes break things. Verify anyway. |
| "Tests take too long" | Skipping verification takes LONGER when bugs slip through. |
| "I'll verify after committing" | Unverified commits waste everyone's time. Verify first. |
| "The code is obviously correct" | Obviously correct code fails all the time. Prove it. |
| "I commented out the failing test" | You broke verification. Uncomment it and fix the code. |
| "I disabled the lint rule" | You hid the problem. Re-enable and fix the code. |
| "It passes now (with @ts-ignore)" | No it doesn't. Remove the suppression and fix the type. |
| "The warning doesn't matter" | Then why did you suppress it? Understand it, then decide. |
| "It works even though tests fail" | Tests exist because manual verification misses things. Fix the tests. |

## Full Verification Checklist

### For Any Code Change

- [ ] **Tests pass** — Run relevant test suite
- [ ] **Build succeeds** — No compilation errors
- [ ] **Lint passes** — No new lint errors
- [ ] **Behavior verified** — Actually tested the functionality

### For Bug Fixes

- [ ] **Bug reproduced** — Confirmed the bug exists (or existed)
- [ ] **Bug no longer occurs** — Verified after the fix
- [ ] **No regression** — Related functionality still works
- [ ] **Test added** — Prevents future regression

### For New Features

- [ ] **Feature works** — Happy path verified
- [ ] **Edge cases handled** — Boundary conditions tested
- [ ] **Error states handled** — Graceful failure
- [ ] **Tests cover scenarios** — Unit and/or integration tests

### Application Health Check

After any non-trivial change, verify the application is still running:

```bash
# Backend health check
curl -sf http://localhost:5000/health && echo "✓ Backend healthy" || echo "✗ Backend health check failed"

# Frontend health check
curl -sf http://localhost:5173 && echo "✓ Frontend healthy" || echo "✗ Frontend health check failed"

# Or check process is running
pgrep -f "dotnet run" > /dev/null && echo "✓ Backend running" || echo "✗ Backend not running"
pgrep -f "vite" > /dev/null && echo "✓ Frontend running" || echo "✗ Frontend not running"
```

### PR Conversation Check

If a PR exists, verify zero unresolved conversations. Read the count from the
single status source (`lib/pr-status.js`) — its `.threads.unresolved` field
counts unresolved review threads from every author via GraphQL (REST comment
counts miss inline threads):

```bash
PR_NUMBER=<number>
PR_STATUS="node ${CLAUDE_SKILL_DIR}/../../lib/pr-status.js"

# Probe is non-fatal: a pr-status failure must not abort under set -e/pipefail.
SNAP=$($PR_STATUS "$PR_NUMBER" 2>/dev/null || true)

# Check for an empty snapshot before jq so jq never runs on empty input.
if [ -z "$SNAP" ]; then
  echo "PR status unavailable — could not read unresolved conversation count."
else
  UNRESOLVED=$(echo "$SNAP" | jq -r '.threads.unresolved // empty')
  echo "Unresolved PR conversations: $UNRESOLVED"
fi
```

### Unresolved CodeRabbit Threads Check

After pushing fixes, verify no unresolved CodeRabbit threads remain. Read the
CodeRabbit-only count from the same snapshot — `.coderabbit.unresolvedThreads`:

```bash
PR_NUMBER=<number>
PR_STATUS="node ${CLAUDE_SKILL_DIR}/../../lib/pr-status.js"

# Probe is non-fatal: a pr-status failure must not abort under set -e/pipefail.
SNAP=$($PR_STATUS "$PR_NUMBER" 2>/dev/null || true)

# Check for an empty snapshot before jq so jq never runs on empty input.
if [ -z "$SNAP" ]; then
  echo "PR status unavailable — could not read CodeRabbit thread count."
else
  CR_UNRESOLVED=$(echo "$SNAP" | jq -r '.coderabbit.unresolvedThreads // empty')
  echo "Unresolved CodeRabbit threads: $CR_UNRESOLVED"
fi
```

## Fix-and-Verify Cycle (Max 3, with Completion Signal)

When addressing review findings, use a bounded cycle with the **completion signal protocol** from `lib/loop-safeguards.js`:

A single "I'm done" could be hallucinated. Three consecutive `ENVOY_LOOP_COMPLETE` signals with fresh evidence confirm genuine completion.

```
CYCLE = 0
MAX_CYCLES = 3
COMPLETION_COUNT = 0

while CYCLE < MAX_CYCLES:
  1. Run full verification suite
  2. If ALL checks pass AND zero unresolved comments:
     → Output: ENVOY_LOOP_COMPLETE with evidence
     → COMPLETION_COUNT += 1
     → If COMPLETION_COUNT >= 3: DONE (genuinely complete)
     → Else: Run verification AGAIN (fresh check)
  3. If new CodeRabbit comments appeared:
     → COMPLETION_COUNT = 0 (reset!)
     → Address findings, push, increment CYCLE
  4. If verification failed:
     → COMPLETION_COUNT = 0 (reset!)
     → Fix the issue, re-verify

if CYCLE >= MAX_CYCLES:
  → ESCALATE to user with remaining issues
```

### Escalation Format

```
**Escalation: Verification cycle limit reached**

After 3 fix-and-verify cycles, these issues remain:

| Issue | Status | Details |
|-------|--------|---------|
| <issue 1> | Unresolved | <details> |
| <issue 2> | Unresolved | <details> |

Completed verification evidence:
- Tests: ✓ 147/147 passing
- Build: ✓ Clean
- Lint: ✓ Clean
- Health: ✓ Backend + Frontend responding

Please review the remaining items and decide how to proceed.
```

**After escalating: STOP.** Do not proceed to the next workflow step (finalize, etc.). Surface the escalation to the user and wait for explicit direction. Options to present:
- A) Investigate the root cause and continue with a fresh approach
- B) Accept the remaining issues with documented rationale
- C) Create a follow-up issue for the unresolved items — requires explicit user confirmation before creating; do NOT create it and proceed in the same step

## Verification Commands

Test commands come from `lib/test-commands.js`'s `resolveTestCommands(projectDir)` — never hardcode a repo layout (e.g. `cd backend && dotnet test`) here, since the layout varies per repo. "Tests pass" during task work means the relevant/filtered tests for the change; the full suite is a separate gate enforced at `/envoy:review`, not something this skill runs per task.

Other verification commands (build, lint, type-check, e2e) remain project-specific — resolve them from the detected stack profile(s) in `stacks/` for this repo rather than assuming a fixed layout.

## Evidence Format

When reporting verification, provide evidence:

```
**Verification Complete**

## Tests
$ dotnet test --filter "FullyQualifiedName~CreateUser"
Passed: 3, Failed: 0, Skipped: 0
(Full suite runs at /envoy:review, not here.)

## Build
$ dotnet build
Build succeeded. 0 Warning(s), 0 Error(s)

## Lint
$ npm run lint
No errors found

## Health Check
$ curl -sf http://localhost:5000/health
✓ Backend healthy
$ curl -sf http://localhost:5173
✓ Frontend healthy

## PR Status
Unresolved conversations: 0
Unresolved CodeRabbit threads: 0

## Conclusion
All verifications passed. Ready for human review.
```

## Never Skip Verification

- **Don't say:** "This should fix it", "I updated the code", "The change has been made"
- **Do say:** "Tests pass: 147/147", "Verified: user creation works", "Evidence: [output]"

## Integration with Other Skills

- **After pickup tasks:** Verify each task
- **Before review:** Ensure basic verification passes
- **Before finalize:** Final verification of all changes
- **During fix-and-verify cycles:** Bounded verification with escalation
