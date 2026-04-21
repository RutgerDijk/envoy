# TDD Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Write code before the test? **Delete it. Start over.**

**No exceptions:**
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- **Delete means delete**

**Before writing ANY implementation code, ask yourself:**
- "Do I have a failing test for this behavior?"
- If NO — STOP. Write the test first.

## TDD Cycle

1. RED — Write failing test(s) for expected behavior
   - Run tests to confirm they FAIL
   - Commit: `test(<scope>): add tests for <feature>`
2. GREEN — Write MINIMAL code to make tests pass
   - Run tests to confirm they PASS
   - Commit: `feat(<scope>): implement <feature>`
3. REFACTOR — Clean up while keeping tests green
   - Commit: `refactor(<scope>): clean up <feature>`

**Commit scopes:** `backend`, `frontend`, `api`, `db`, `auth`, `tests`, `docs`

## Rationalization Table

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. Write it. |
| "I'll write tests after" | Tests passing immediately prove nothing. Test first shows the test CAN fail. |
| "I already know how to implement it" | Good. You'll implement it faster after writing the test. |
| "Existing code has no tests" | You're improving it now. Add tests. |
| "It's just a small fix" | Small fixes break things. Test first. |
| "I'm just exploring" | Explore with tests. Delete exploration code. |
| "Time pressure" | Skipping tests costs MORE time. Always. |

## Violations = Start Over

- Writing implementation without tests — Delete code, write test first.
- Tests written after implementation — Delete both, start with test.
- "Just this once" — No. The answer is always no.

## TDD Scope

- NEW code: always write failing test first.
- Modified existing code with no tests: write test FIRST, then change.
- Refactoring without behavior change: refactor first, add tests if missing.
- Existing tests that don't cover the change: add coverage for new behavior only.
