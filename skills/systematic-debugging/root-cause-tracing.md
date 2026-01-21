# Root Cause Tracing

## Overview

Bugs often manifest deep in the call stack (API returning wrong data, database query failing, React component not updating). Your instinct is to fix where the error appears, but that's treating a symptom.

**Core principle:** Trace backward through the call chain until you find the original trigger, then fix at the source.

## When to Use

**Use when:**
- Error happens deep in execution (not at entry point)
- Stack trace shows long call chain
- Unclear where invalid data originated
- Need to find which component triggers the problem

**Don't use when:**
- Error is clearly at the entry point
- Root cause is already obvious

## The Tracing Process

### 1. Observe the Symptom

```
Error: User not found
  at UserRepository.GetByIdAsync (UserRepository.cs:45)
```

### 2. Find Immediate Cause

**What code directly causes this?**
```csharp
var user = await _dbContext.Users.FindAsync(userId);
if (user == null) throw new NotFoundException("User not found");
```

### 3. Ask: What Called This?

```
UserRepository.GetByIdAsync(userId)
  → called by UserService.GetUserProfile(userId)
  → called by UserController.GetProfile(userId)
  → called by React useEffect with userId from URL params
```

### 4. Keep Tracing Up

**What value was passed?**
- `userId = 0` (invalid!)
- Where did 0 come from?
- React component parsed URL param as string, not int
- `parseInt("abc")` returns `NaN`, which becomes 0

### 5. Find Original Trigger

**Root cause:** Missing validation in React route handler

**Fix at source:**
```typescript
// Before: const userId = parseInt(params.id);
// After:
const userId = parseInt(params.id);
if (isNaN(userId) || userId <= 0) {
  navigate('/404');
  return;
}
```

## Adding Stack Traces

When you can't trace manually, add instrumentation:

### .NET Backend

```csharp
public async Task<User> GetByIdAsync(int userId)
{
    _logger.LogDebug("GetByIdAsync called with userId={UserId}, StackTrace={StackTrace}",
        userId,
        Environment.StackTrace);

    // ... rest of method
}
```

### React Frontend

```typescript
function useUser(userId: number) {
  console.debug('useUser called', {
    userId,
    stack: new Error().stack,
    location: window.location.href
  });

  // ... rest of hook
}
```

## Real Example: Null Reference in .NET

**Symptom:** `NullReferenceException` in `OrderService.CalculateTotal`

**Trace chain:**
1. `order.Items` is null when accessed
2. `OrderService.CalculateTotal(order)` received order with null Items
3. `OrderController.CreateOrder(dto)` mapped DTO to Order
4. AutoMapper mapped `null` Items because DTO had empty array
5. AutoMapper config: `CreateMap<OrderDto, Order>()` - no null handling

**Root cause:** AutoMapper config doesn't handle empty collections

**Fix at source:**
```csharp
CreateMap<OrderDto, Order>()
    .ForMember(dest => dest.Items,
        opt => opt.MapFrom(src => src.Items ?? new List<OrderItemDto>()));
```

## Key Principle

```
Found immediate cause
       ↓
Can trace one level up? ──no──→ STOP - Add defense-in-depth here
       ↓ yes
Trace backwards
       ↓
Is this the source? ──no──→ Keep tracing up
       ↓ yes
Fix at source
       ↓
Add validation at each layer (see defense-in-depth.md)
       ↓
Bug impossible to reproduce
```

**NEVER fix just where the error appears.** Trace back to find the original trigger.

## Stack Trace Tips

| Context | Method | Notes |
|---------|--------|-------|
| .NET | `Environment.StackTrace` | Full managed stack |
| .NET | `_logger.LogDebug` with stack | Structured logging |
| TypeScript | `new Error().stack` | Complete call chain |
| React | `console.debug` in hooks | Include component context |

**Best practices:**
- Log BEFORE the dangerous operation, not after it fails
- Include context: IDs, state, environment
- Use structured logging (not string concatenation)

## Integration with Envoy

After finding root cause:
1. Fix at the source location
2. Add `defense-in-depth.md` validation at each layer
3. Write regression test
4. Use `envoy:verification` before claiming fixed
