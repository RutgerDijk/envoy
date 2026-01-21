# Defense-in-Depth Validation

## Overview

When you fix a bug caused by invalid data, adding validation at one place feels sufficient. But that single check can be bypassed by different code paths, refactoring, or mocks.

**Core principle:** Validate at EVERY layer data passes through. Make the bug structurally impossible.

## Why Multiple Layers

Single validation: "We fixed the bug"
Multiple layers: "We made the bug impossible"

Different layers catch different cases:
- Entry validation catches most bugs
- Business logic catches edge cases
- Environment guards prevent context-specific dangers
- Debug logging helps when other layers fail

## The Four Layers

### Layer 1: Entry Point Validation (API/Controller)

**Purpose:** Reject obviously invalid input at API boundary

**.NET Controller:**
```csharp
[HttpPost]
public async Task<IActionResult> CreateUser([FromBody] CreateUserDto dto)
{
    // Layer 1: Entry validation
    if (string.IsNullOrWhiteSpace(dto.Email))
        return BadRequest("Email is required");

    if (!EmailValidator.IsValid(dto.Email))
        return BadRequest("Invalid email format");

    if (dto.Email.Length > 255)
        return BadRequest("Email too long");

    // Proceed to service...
}
```

**React Form:**
```typescript
function CreateUserForm() {
  const onSubmit = (data: FormData) => {
    // Layer 1: Entry validation
    if (!data.email?.trim()) {
      setError('Email is required');
      return;
    }
    if (!isValidEmail(data.email)) {
      setError('Invalid email format');
      return;
    }
    // Proceed to API call...
  };
}
```

### Layer 2: Business Logic Validation (Service)

**Purpose:** Ensure data makes sense for this operation

```csharp
public class UserService
{
    public async Task<User> CreateUserAsync(CreateUserDto dto)
    {
        // Layer 2: Business logic validation
        if (string.IsNullOrWhiteSpace(dto.Email))
            throw new ArgumentException("Email required for user creation");

        var existingUser = await _userRepository.GetByEmailAsync(dto.Email);
        if (existingUser != null)
            throw new BusinessException("User with this email already exists");

        // Proceed to repository...
    }
}
```

### Layer 3: Environment Guards

**Purpose:** Prevent dangerous operations in specific contexts

```csharp
public class DatabaseSeeder
{
    public async Task SeedTestDataAsync()
    {
        // Layer 3: Environment guard
        var env = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        if (env == "Production")
        {
            throw new InvalidOperationException(
                "Refusing to seed test data in Production environment");
        }

        // Proceed with seeding...
    }
}
```

```typescript
// React: Prevent debug tools in production
function DebugPanel() {
  // Layer 3: Environment guard
  if (process.env.NODE_ENV === 'production') {
    console.error('DebugPanel should not be rendered in production');
    return null;
  }

  return <div>Debug info...</div>;
}
```

### Layer 4: Debug Instrumentation

**Purpose:** Capture context for forensics when other layers fail

```csharp
public async Task<User> GetByIdAsync(int userId)
{
    // Layer 4: Debug instrumentation
    _logger.LogDebug(
        "GetByIdAsync called: UserId={UserId}, RequestId={RequestId}",
        userId,
        _httpContext.TraceIdentifier);

    var user = await _dbContext.Users.FindAsync(userId);

    if (user == null)
    {
        _logger.LogWarning(
            "User not found: UserId={UserId}, Stack={Stack}",
            userId,
            Environment.StackTrace);
    }

    return user;
}
```

## Applying the Pattern

When you find a bug:

1. **Trace the data flow** - Where does bad value originate? Where used? (see root-cause-tracing.md)
2. **Map all checkpoints** - List every point data passes through
3. **Add validation at each layer** - Entry, business, environment, debug
4. **Test each layer** - Try to bypass layer 1, verify layer 2 catches it

## Example: Full Stack

Bug: Empty email caused database constraint violation

**Data flow:**
1. React form → 2. API controller → 3. UserService → 4. UserRepository → 5. Database

**Four layers added:**

```
Layer 1 (React Form):
  if (!email.trim()) return setError('Email required');

Layer 2 (Controller):
  if (string.IsNullOrWhiteSpace(dto.Email)) return BadRequest(...);

Layer 3 (Service):
  if (string.IsNullOrWhiteSpace(dto.Email)) throw new ArgumentException(...);

Layer 4 (Repository - Debug):
  _logger.LogDebug("Creating user with email={Email}", email);
```

**Result:** Bug impossible to reproduce at any layer

## Common Validation Patterns

### .NET

```csharp
// Guard clauses at method start
public void ProcessOrder(Order order)
{
    ArgumentNullException.ThrowIfNull(order);
    ArgumentNullException.ThrowIfNull(order.Items);

    if (order.Items.Count == 0)
        throw new ArgumentException("Order must have items", nameof(order));

    // Now safe to process...
}
```

### TypeScript

```typescript
// Type guards + runtime checks
function processUser(user: User | null): void {
  if (!user) {
    throw new Error('User is required');
  }
  if (!user.email) {
    throw new Error('User must have email');
  }
  // TypeScript now knows user and user.email are defined
}
```

## Key Insight

All four layers are necessary. During testing, each layer catches bugs the others miss:
- Different code paths bypass entry validation
- Mocks bypass business logic checks
- Edge cases on different environments need guards
- Debug logging identifies structural misuse

**Don't stop at one validation point.** Add checks at every layer.

## Integration with Envoy

After adding defense-in-depth:
1. Write tests that try to bypass each layer
2. Use `envoy:verification` to prove all layers work
3. Document the validation in code comments
