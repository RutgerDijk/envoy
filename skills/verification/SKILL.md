---
name: verification
description: Use when changes need verification before committing or claiming a task is complete
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

If a PR exists, verify zero unresolved conversations:

```bash
OWNER=$(gh repo view --json owner -q '.owner.login')
REPO=$(gh repo view --json name -q '.name')
PR_NUMBER=<number>

# Count unresolved review threads
UNRESOLVED=$(gh api graphql -f query='
  query {
    repository(owner: "'$OWNER'", name: "'$REPO'") {
      pullRequest(number: '$PR_NUMBER') {
        reviewThreads(first: 100) {
          nodes { isResolved }
        }
      }
    }
  }
' --jq '.data.repository.pullRequest.reviewThreads.nodes | map(select(.isResolved == false)) | length')

echo "Unresolved PR conversations: $UNRESOLVED"
```

### New CodeRabbit Comments Check

After pushing fixes, verify no new CodeRabbit comments appeared:

```bash
# Get comments since last push
LAST_PUSH=$(git log -1 --format=%cI)
gh api repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments \
  --jq "[.[] | select(.user.login == \"coderabbitai\") | select(.created_at > \"$LAST_PUSH\")] | length"
```

## Fix-and-Verify Cycle (Max 3)

When addressing review findings, use a bounded cycle:

```
CYCLE = 0
MAX_CYCLES = 3

while CYCLE < MAX_CYCLES:
  1. Run full verification suite
  2. If ALL checks pass AND zero unresolved comments:
     → DONE. Report success with evidence.
  3. If new CodeRabbit comments appeared:
     → Address findings, push, increment CYCLE
  4. If verification failed:
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

## Verification Commands

### Backend (.NET)

```bash
cd backend && dotnet test
dotnet build
dotnet build --warnaserror
```

### Frontend (React/TypeScript)

```bash
cd frontend && npx tsc --noEmit
npm run lint
npm test
npm run test:e2e
```

## Evidence Format

When reporting verification, provide evidence:

```
**Verification Complete**

## Tests
$ dotnet test
Passed: 147, Failed: 0, Skipped: 0

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
New CodeRabbit comments since last push: 0

## Conclusion
All verifications passed. Ready for human review.
```

## Never Skip Verification

- **Don't say:** "This should fix it", "I updated the code", "The change has been made"
- **Do say:** "Tests pass: 147/147", "Verified: user creation works", "Evidence: [output]"

## Integration with Other Skills

- **After executing-plans tasks:** Verify each task
- **Before layered-review:** Ensure basic verification passes
- **Before finishing-branch:** Final verification of all changes
- **During fix-and-verify cycles:** Bounded verification with escalation
