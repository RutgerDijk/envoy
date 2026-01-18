---
name: verification
description: Verify changes work before claiming done. Use before committing fixes or completing tasks. Evidence before assertions.
---

# Verification Before Completion

## Overview

**Never claim something is fixed or working without verification.** Run tests, check the actual behavior, provide evidence.

**Announce at start:** "I'm using envoy:verification to verify these changes work."

## The Iron Law

**NO COMPLETION CLAIMS WITHOUT VERIFICATION EVIDENCE.**

Evidence before assertions. Always.

- Don't say "this should work" — **prove it works**
- Don't say "I fixed it" — **show it's fixed**
- Don't say "tests should pass" — **run them and show output**

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

## Verification Checklist

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

## Verification Commands

### Backend (.NET)

```bash
# Run all tests
cd backend && dotnet test

# Run specific test project
dotnet test HybridFit.Api.Tests

# Run tests with filter
dotnet test --filter "FullyQualifiedName~UserService"

# Build (catches compilation errors)
dotnet build

# Check for warnings
dotnet build --warnaserror
```

### Frontend (React/TypeScript)

```bash
# Type checking
cd frontend && npx tsc --noEmit

# Linting
npm run lint

# Unit tests (if configured)
npm test

# E2E tests
npm run test:e2e
```

### E2E (Playwright)

```bash
# Run all E2E tests
cd frontend && npm run test:e2e

# Run specific test file
npx playwright test tests/user-flow.spec.ts

# Run in headed mode (see the browser)
npx playwright test --headed

# Run with UI mode (interactive)
npx playwright test --ui
```

## Verification Patterns

### Pattern 1: Test-Driven Verification

```
1. Write/identify the test that should pass
2. Run it — confirm it fails (if new test)
3. Make the change
4. Run it — confirm it passes
5. Run full suite — confirm no regression
```

### Pattern 2: Manual Verification

```
1. Start the application
2. Navigate to the affected feature
3. Perform the action
4. Observe the result
5. Compare to expected behavior
6. Document the verification
```

### Pattern 3: Before/After Comparison

```
1. Document current (broken) behavior
2. Make the change
3. Document new (fixed) behavior
4. Compare and confirm fix
```

## Evidence Format

When reporting verification, provide evidence:

```
**Verification Complete**

## Tests
```
$ dotnet test
Passed: 147
Failed: 0
Skipped: 0
```

## Build
```
$ dotnet build
Build succeeded.
0 Warning(s)
0 Error(s)
```

## Manual Verification
- Navigated to /users
- Created new user "Test User"
- User appeared in list
- Clicked on user, details loaded correctly

## Conclusion
All verifications passed. Ready to commit.
```

## Common Verification Failures

### Tests Fail

```
**Verification Failed: Tests**

Failed tests:
- UserServiceTests.CreateUser_WithInvalidEmail_ThrowsException
  Expected: ArgumentException
  Actual: No exception thrown

Action needed:
- Add email validation in UserService.CreateUser
- Re-run verification after fix
```

### Build Fails

```
**Verification Failed: Build**

Error: CS1002 - ; expected
  at UserService.cs:45

Action needed:
- Fix syntax error at line 45
- Re-run verification after fix
```

### Manual Verification Fails

```
**Verification Failed: Manual Test**

Expected: User list shows new user after creation
Actual: User list is empty, no error shown

Observations:
- Network request to POST /api/users succeeded (201)
- GET /api/users returns empty array
- Database shows user was NOT inserted

Likely cause: Transaction not committed

Action needed:
- Check SaveChangesAsync is called
- Verify DbContext lifecycle
```

## Never Skip Verification

❌ **Don't say:**
- "This should fix it"
- "I updated the code"
- "The change has been made"

✅ **Do say:**
- "Tests pass: 147/147"
- "Verified: user creation works"
- "Evidence: [screenshot/output]"

## Integration with Other Skills

- **After executing-plans tasks:** Verify each task
- **Before layered-review:** Ensure basic verification passes
- **Before finishing-branch:** Final verification of all changes
