# Development Anti-Patterns

Common violations with gate functions to prevent them. Before taking any action that matches these patterns, run the gate function.

---

## Anti-Pattern 1: Code Before Test

**The Violation:** Writing implementation code before writing a failing test.

**Why It's Wrong:**
- Tests written after can't prove they would have failed
- You miss edge cases the test would reveal
- Implementation biases the test design

**Gate Function:**

```
BEFORE writing any implementation code:
  Ask: "Do I have a failing test for this behavior?"
  
  IF no:
    STOP
    Write the test first
    Run it to confirm it fails
    THEN write implementation
  
  IF yes:
    Proceed with implementation
```

**If You Already Violated:** Delete the implementation code. Write the test. Watch it fail. Then rewrite the implementation.

---

## Anti-Pattern 2: Fix Without Root Cause

**The Violation:** Attempting fixes before understanding the root cause.

**Why It's Wrong:**
- Fixes may mask the real issue
- Creates new bugs through side effects
- Wastes time with guess-and-check

**Gate Function:**

```
BEFORE proposing any fix:
  Ask: "Have I completed Phase 1 (Root Cause Investigation)?"
  
  Checklist:
  - [ ] Read all error messages completely
  - [ ] Reproduced the issue consistently
  - [ ] Checked recent changes (git diff)
  - [ ] Traced data flow to find source
  
  IF any unchecked:
    STOP
    Complete investigation first
  
  IF all checked:
    State hypothesis, then fix
```

**If You Already Violated:** Revert the fix. Complete investigation. Then fix properly.

---

## Anti-Pattern 3: Claim Without Evidence

**The Violation:** Saying "it works" or "it's fixed" without verification evidence.

**Why It's Wrong:**
- Assertions without evidence are worthless
- Creates false confidence
- Bugs slip through to later stages

**Gate Function:**

```
BEFORE claiming any task is complete:
  Ask: "Do I have verification evidence?"
  
  Evidence required:
  - [ ] Test output showing tests pass
  - [ ] Build output showing no errors
  - [ ] Manual verification documented
  
  IF no evidence:
    STOP
    Run verification first
    Capture output
    THEN claim completion
```

**If You Already Violated:** Run verification now. Update your claim with evidence.

---

## Anti-Pattern 4: Testing Mock Behavior

**The Violation:** Writing tests that verify mock behavior rather than real behavior.

**Why It's Wrong:**
- Tests pass even when real code is broken
- Mocks don't represent actual behavior
- False confidence in test coverage

**Gate Function:**

```
BEFORE asserting on any value:
  Ask: "Is this value from a mock?"
  
  IF yes:
    Ask: "Am I testing the mock or the real code?"
    
    IF testing the mock:
      STOP
      Either:
      - Test real behavior instead
      - Or remove the mock
```

**Example:**
```csharp
// BAD: Testing mock behavior
mockUserService.Setup(x => x.GetUser(1)).Returns(testUser);
var result = mockUserService.Object.GetUser(1);
Assert.Equal(testUser, result);  // Just tests the mock!

// GOOD: Testing real behavior with mock dependency
var service = new UserController(mockUserService.Object);
var result = service.GetUserDetails(1);
Assert.Equal(testUser.Name, result.Name);  // Tests real controller logic
```

---

## Anti-Pattern 5: Test-Only Methods in Production

**The Violation:** Adding methods to production classes that only exist for testing.

**Why It's Wrong:**
- Pollutes production API
- Creates maintenance burden
- Indicates poor design (testing should use public API)

**Gate Function:**

```
BEFORE adding any method to a production class:
  Ask: "Is this method only used by tests?"
  
  IF yes:
    STOP
    Don't add it to production class
    Instead:
    - Use existing public API
    - Create test utility class
    - Refactor to make testing easier
```

**Example:**
```csharp
// BAD: Test-only method in production
public class UserService
{
    public void SetUserForTesting(User user) { ... }  // Never do this
}

// GOOD: Use proper patterns
public class UserServiceTests
{
    private UserService CreateServiceWithUser(User user)
    {
        var mockRepo = new Mock<IUserRepository>();
        mockRepo.Setup(x => x.Get(user.Id)).Returns(user);
        return new UserService(mockRepo.Object);
    }
}
```

---

## Anti-Pattern 6: Incomplete Error Handling

**The Violation:** Catching exceptions without proper handling or logging.

**Why It's Wrong:**
- Hides bugs
- Makes debugging impossible
- Creates silent failures

**Gate Function:**

```
BEFORE writing any catch block:
  Ask: "What am I doing with this exception?"
  
  Valid answers:
  - Logging it with full context
  - Transforming to domain exception
  - Recovering with fallback behavior
  - Re-throwing after cleanup
  
  Invalid answers:
  - Ignoring it
  - Just returning null
  - Empty catch block
  
  IF invalid:
    STOP
    Design proper error handling first
```

**Example:**
```csharp
// BAD: Swallowing exceptions
try { await SaveUser(user); }
catch { }  // Never do this

// BAD: Silent null return
try { return await GetUser(id); }
catch { return null; }  // Hides the real problem

// GOOD: Proper handling
try { return await GetUser(id); }
catch (UserNotFoundException)
{
    return null;  // Expected case, OK to return null
}
catch (Exception ex)
{
    _logger.LogError(ex, "Failed to get user {UserId}", id);
    throw;  // Re-throw unexpected errors
}
```

---

## Anti-Pattern 7: Hardcoded Configuration

**The Violation:** Hardcoding URLs, connection strings, or environment-specific values.

**Why It's Wrong:**
- Breaks in different environments
- Requires code changes for config changes
- May expose secrets in source control

**Gate Function:**

```
BEFORE hardcoding any value:
  Ask: "Will this value change between environments?"
  
  Environment-specific values:
  - URLs and endpoints
  - Connection strings
  - API keys and secrets
  - Feature flags
  - Timeouts and limits
  
  IF environment-specific:
    STOP
    Use configuration instead:
    - appsettings.json / environment variables
    - Azure Key Vault for secrets
    - Never commit to source control
```

---

## Anti-Pattern 8: N+1 Queries

**The Violation:** Loading related data in a loop instead of using eager loading.

**Why It's Wrong:**
- Causes massive performance issues
- Gets worse with data growth
- Database becomes bottleneck

**Gate Function:**

```
BEFORE accessing navigation property in a loop:
  Ask: "Is this property already loaded?"
  
  IF no:
    STOP
    Use Include() to eager load:
    
    // Instead of:
    foreach (var user in users)
    {
        var orders = user.Orders;  // N queries!
    }
    
    // Do this:
    var users = context.Users
        .Include(u => u.Orders)
        .ToList();
```

---

## Anti-Pattern 9: Sync Over Async

**The Violation:** Using `.Result` or `.Wait()` on async methods.

**Why It's Wrong:**
- Can cause deadlocks
- Blocks threads unnecessarily
- Defeats purpose of async

**Gate Function:**

```
BEFORE using .Result or .Wait():
  Ask: "Can this be awaited instead?"
  
  IF yes (almost always):
    STOP
    Make calling method async
    Use await instead
  
  IF no (rare, e.g., Main method):
    Use .GetAwaiter().GetResult() with comment explaining why
```

---

## Anti-Pattern 10: Skipping Code Review Feedback

**The Violation:** Implementing review feedback without understanding or verifying it.

**Why It's Wrong:**
- Reviewer may be wrong
- Blind implementation causes new bugs
- Misses opportunity to learn

**Gate Function:**

```
BEFORE implementing any review feedback:
  Ask: "Do I understand and agree with this feedback?"
  
  IF don't understand:
    Ask for clarification first
  
  IF understand but disagree:
    Discuss with reviewer
    Provide evidence for your position
  
  IF understand and agree:
    Implement with verification
    
  NEVER blindly implement
```

---

## Quick Reference

| Anti-Pattern | Gate Question |
|--------------|---------------|
| Code Before Test | "Do I have a failing test?" |
| Fix Without Root Cause | "Have I completed investigation?" |
| Claim Without Evidence | "Do I have verification evidence?" |
| Testing Mock Behavior | "Am I testing mock or real code?" |
| Test-Only Methods | "Is this only used by tests?" |
| Incomplete Error Handling | "What am I doing with this exception?" |
| Hardcoded Config | "Will this change between environments?" |
| N+1 Queries | "Is this property already loaded?" |
| Sync Over Async | "Can this be awaited instead?" |
| Skipping Review Feedback | "Do I understand and agree?" |
