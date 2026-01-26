---
name: test-driven-development
description: Use when implementing any feature or bugfix, before writing implementation code
---

# Test-Driven Development (TDD)

## Overview

Write the test first. Watch it fail. Write minimal code to pass.

**Core principle:** If you didn't watch the test fail, you don't know if it tests the right thing.

**Announce at start:** "I'm using envoy:test-driven-development to implement this feature."

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Write code before the test? **Delete it. Start over.**

**No exceptions:**
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- **Delete means delete**

Implement fresh from tests. Period.

## When to Use

**Always:**
- New features
- Bug fixes
- Refactoring
- Behavior changes

**Rare exceptions (ask user first):**
- Throwaway prototypes
- Generated code
- Pure configuration

Thinking "skip TDD just this once"? Stop. That's rationalization.

## Red-Green-Refactor Cycle

```
┌─────────────────────────────────────────────────────────────┐
│  RED                                                        │
│  Write ONE failing test                                     │
│  Run it → Confirm it FAILS                                  │
│  (If it passes, you're testing existing behavior)           │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  GREEN                                                      │
│  Write MINIMAL code to pass                                 │
│  Run test → Confirm it PASSES                               │
│  Run ALL tests → Confirm no regression                      │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  REFACTOR                                                   │
│  Clean up code (keep tests green!)                          │
│  Run ALL tests → Still passing                              │
└────────────────────────┬────────────────────────────────────┘
                         ▼
                    [Next test]
```

### RED - Write Failing Test

Write ONE minimal test showing what should happen.

**.NET (xUnit + FluentAssertions):**
```csharp
[Fact]
public async Task CreateUser_WithValidEmail_ReturnsUser()
{
    // Arrange
    var service = new UserService(_mockRepo.Object);
    var dto = new CreateUserDto { Email = "test@example.com", Name = "Test" };

    // Act
    var result = await service.CreateUserAsync(dto);

    // Assert
    result.Should().NotBeNull();
    result.Email.Should().Be("test@example.com");
}
```

**React (Vitest + Testing Library):**
```typescript
test('displays user name after loading', async () => {
  render(<UserProfile userId={1} />);

  await waitFor(() => {
    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });
});
```

**Requirements:**
- One behavior per test
- Clear, descriptive name
- Real code (minimal mocks)

### Verify RED - Watch It Fail

**MANDATORY. Never skip.**

```bash
# .NET
dotnet test --filter "CreateUser_WithValidEmail_ReturnsUser"

# React
npm test -- --grep "displays user name"
```

Confirm:
- Test **fails** (not errors)
- Failure message is what you expect
- Fails because feature is missing (not typos)

**Test passes immediately?** You're testing existing behavior. Fix the test.

**Test errors?** Fix the error, re-run until it fails correctly.

### GREEN - Minimal Code

Write the **simplest** code to pass the test.

**.NET:**
```csharp
public async Task<User> CreateUserAsync(CreateUserDto dto)
{
    var user = new User
    {
        Email = dto.Email,
        Name = dto.Name
    };
    await _repository.AddAsync(user);
    return user;
}
```

**React:**
```typescript
function UserProfile({ userId }: { userId: number }) {
  const { data: user } = useQuery(['user', userId], () => fetchUser(userId));

  if (!user) return <div>Loading...</div>;

  return <div>{user.name}</div>;
}
```

**Don't:**
- Add features not required by the test
- Refactor other code
- "Improve" beyond what's needed

### Verify GREEN - Watch It Pass

**MANDATORY.**

```bash
# .NET - run specific test
dotnet test --filter "CreateUser_WithValidEmail_ReturnsUser"

# .NET - run all tests (check for regression)
dotnet test

# React
npm test
```

Confirm:
- Test passes
- **All other tests still pass**
- Output is clean (no warnings)

**Test fails?** Fix the code, not the test.

**Other tests fail?** Fix the regression now.

### REFACTOR - Clean Up

**Only after green:**
- Remove duplication
- Improve names
- Extract helpers
- Simplify logic

**Keep tests green.** Run after each change.

**Don't add behavior.** That requires a new test first.

## Good Tests

| Quality | Good | Bad |
|---------|------|-----|
| **Minimal** | One thing. "and" in name? Split it. | `CreateUser_ValidatesEmailAndNameAndPhone` |
| **Clear** | Name describes behavior | `Test1`, `TestCreateUser` |
| **Real** | Tests actual code path | Mocks everything, tests mock behavior |
| **Fast** | Runs in milliseconds | Needs database/network |

## Why Order Matters

### "I'll write tests after"

Tests written after code pass immediately. Passing immediately proves nothing:
- Might test wrong thing
- Might test implementation, not behavior
- Might miss edge cases you forgot
- **You never saw it catch the bug**

Test-first forces you to see the test fail, proving it actually tests something.

### "I already manually tested"

Manual testing is ad-hoc:
- No record of what you tested
- Can't re-run when code changes
- Easy to forget cases under pressure
- "It worked when I tried it" ≠ comprehensive

Automated tests are systematic. They run the same way every time.

### "Deleting X hours of work is wasteful"

Sunk cost fallacy. The time is already gone. Your choice now:
- Delete and rewrite with TDD (high confidence)
- Keep it and add tests after (low confidence, likely bugs)

The "waste" is keeping code you can't trust.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll test after" | Tests passing immediately prove nothing. |
| "Tests after achieve same goals" | Tests-after = "what does this do?" Tests-first = "what should this do?" |
| "Already manually tested" | Ad-hoc ≠ systematic. No record, can't re-run. |
| "Deleting X hours is wasteful" | Sunk cost fallacy. Keeping unverified code is technical debt. |
| "Keep as reference, write tests first" | You'll adapt it. That's testing after. Delete means delete. |
| "Need to explore first" | Fine. Throw away exploration, start with TDD. |
| "Test hard = design unclear" | Listen to test. Hard to test = hard to use. |
| "TDD will slow me down" | TDD faster than debugging. |
| "Existing code has no tests" | You're improving it. Add tests for new code. |

## Red Flags - STOP and Start Over

If you catch yourself:
- Writing code before test
- Test passes immediately (didn't see it fail)
- Can't explain why test failed
- Adding tests "later"
- "Just this once"
- "I already manually tested it"
- "Keep as reference"
- "This is different because..."

**All of these mean: Delete code. Start over with TDD.**

## Verification Checklist

Before marking work complete:

- [ ] Every new function/method has a test
- [ ] Watched each test fail before implementing
- [ ] Each test failed for expected reason (feature missing, not typo)
- [ ] Wrote minimal code to pass each test
- [ ] All tests pass
- [ ] Output clean (no errors, warnings)
- [ ] Tests use real code (mocks only if unavoidable)
- [ ] Edge cases and errors covered

Can't check all boxes? **You skipped TDD. Start over.**

## Integration with Envoy

**Use TDD with:**
- `envoy:executing-plans` — TDD enforced per task
- `envoy:subagent-driven-development` — TDD enforced per subagent task
- `envoy:systematic-debugging` — Write failing test to prove bug exists
- `envoy:verification` — Verify all tests pass before claiming done
- `envoy:pressure-test-scenarios` — Scenarios 4, 5 test TDD discipline

**Stack profiles:**
- `../../stacks/testing-dotnet.md` — xUnit, Moq, FluentAssertions patterns
- `../../stacks/testing-playwright.md` — E2E testing patterns
- `../../stacks/react.md` — React Testing Library patterns

## Example: Bug Fix with TDD

**Bug:** Empty email accepted in form

**RED:**
```csharp
[Fact]
public async Task CreateUser_WithEmptyEmail_ThrowsValidationError()
{
    var service = new UserService(_mockRepo.Object);
    var dto = new CreateUserDto { Email = "", Name = "Test" };

    var act = () => service.CreateUserAsync(dto);

    await act.Should().ThrowAsync<ValidationException>()
        .WithMessage("*email*required*");
}
```

**Verify RED:**
```
$ dotnet test --filter "WithEmptyEmail"
FAIL: Expected ValidationException but no exception was thrown
```

**GREEN:**
```csharp
public async Task<User> CreateUserAsync(CreateUserDto dto)
{
    if (string.IsNullOrWhiteSpace(dto.Email))
        throw new ValidationException("Email is required");

    // ... rest of method
}
```

**Verify GREEN:**
```
$ dotnet test
PASS (all tests)
```

## The Bottom Line

```
Production code → test exists AND you watched it fail first
Otherwise → not TDD
```

No exceptions without user permission.
