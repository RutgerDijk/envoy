# Condition-Based Waiting

## Overview

Flaky tests often guess at timing with arbitrary delays. This creates race conditions where tests pass on fast machines but fail under load or in CI.

**Core principle:** Wait for the actual condition you care about, not a guess about how long it takes.

## When to Use

**Use when:**
- Tests have arbitrary delays (`Task.Delay`, `setTimeout`, `Thread.Sleep`)
- Tests are flaky (pass sometimes, fail under load)
- Tests timeout when run in parallel
- Waiting for async operations to complete

**Don't use when:**
- Testing actual timing behavior (debounce, throttle intervals)
- Always document WHY if using arbitrary timeout

## The Problem

```csharp
// ❌ BEFORE: Guessing at timing
await Task.Delay(500);
var result = await _service.GetResultAsync();
Assert.NotNull(result);
// Fails on slow CI, passes locally
```

```typescript
// ❌ BEFORE: Guessing at timing
await new Promise(r => setTimeout(r, 500));
const result = await getResult();
expect(result).toBeDefined();
// Flaky - sometimes 500ms isn't enough
```

## The Solution

```csharp
// ✅ AFTER: Waiting for condition
var result = await WaitForAsync(
    () => _service.GetResultAsync(),
    r => r != null,
    "result to be available");
Assert.NotNull(result);
```

```typescript
// ✅ AFTER: Waiting for condition
const result = await waitFor(
    () => getResult() !== undefined,
    'result to be available'
);
expect(result).toBeDefined();
```

## Implementation

### .NET

```csharp
public static async Task<T> WaitForAsync<T>(
    Func<Task<T>> getter,
    Func<T, bool> condition,
    string description,
    int timeoutMs = 5000,
    int pollIntervalMs = 50)
{
    var stopwatch = Stopwatch.StartNew();

    while (true)
    {
        var result = await getter();
        if (condition(result))
            return result;

        if (stopwatch.ElapsedMilliseconds > timeoutMs)
        {
            throw new TimeoutException(
                $"Timeout waiting for {description} after {timeoutMs}ms");
        }

        await Task.Delay(pollIntervalMs);
    }
}

// Synchronous version
public static T WaitFor<T>(
    Func<T> getter,
    Func<T, bool> condition,
    string description,
    int timeoutMs = 5000)
{
    var stopwatch = Stopwatch.StartNew();

    while (true)
    {
        var result = getter();
        if (condition(result))
            return result;

        if (stopwatch.ElapsedMilliseconds > timeoutMs)
        {
            throw new TimeoutException(
                $"Timeout waiting for {description} after {timeoutMs}ms");
        }

        Thread.Sleep(50);
    }
}
```

### TypeScript

```typescript
async function waitFor<T>(
  condition: () => T | undefined | null | false,
  description: string,
  timeoutMs = 5000
): Promise<T> {
  const startTime = Date.now();

  while (true) {
    const result = condition();
    if (result) return result;

    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Timeout waiting for ${description} after ${timeoutMs}ms`);
    }

    await new Promise(r => setTimeout(r, 50)); // Poll every 50ms
  }
}
```

### Playwright (Already Built-in)

```typescript
// Playwright has condition-based waiting built-in
await page.waitForSelector('.user-loaded');
await expect(page.locator('.result')).toBeVisible();
await page.waitForResponse(resp => resp.url().includes('/api/users'));
```

## Quick Patterns

| Scenario | .NET | TypeScript |
|----------|------|------------|
| Wait for not null | `WaitForAsync(() => GetAsync(), r => r != null, "result")` | `waitFor(() => getResult(), "result")` |
| Wait for count | `WaitFor(() => items.Count, c => c >= 5, "5 items")` | `waitFor(() => items.length >= 5, "5 items")` |
| Wait for state | `WaitFor(() => machine.State, s => s == "Ready", "ready")` | `waitFor(() => state === 'ready', "ready")` |
| Wait for file | `WaitFor(() => File.Exists(path), e => e, "file")` | `waitFor(() => fs.existsSync(path), "file")` |

## Common Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| Polling too fast | `Thread.Sleep(1)` wastes CPU | Poll every 50ms |
| No timeout | Loop forever if condition never met | Always include timeout |
| Stale data | Cache result before loop | Call getter inside loop |
| Wrong condition | Wait for wrong thing | Think: "What MUST be true?" |

## When Arbitrary Timeout IS Correct

Sometimes you genuinely need to wait for time-based behavior:

```csharp
// Debounce test - need to verify it waits 300ms
await WaitForAsync(() => _service.GetStateAsync(), s => s == "Started", "started");
await Task.Delay(350); // Wait for debounce interval (300ms + buffer)
// 350ms = debounce(300ms) + 50ms buffer - documented and justified
Assert.Equal("Debounced", await _service.GetStateAsync());
```

**Requirements for arbitrary timeout:**
1. First wait for triggering condition
2. Based on known timing (not guessing)
3. Comment explaining WHY

## Real-World Example

**Before (Flaky):**
```csharp
[Fact]
public async Task OrderProcessing_UpdatesStatus()
{
    await _service.ProcessOrderAsync(orderId);
    await Task.Delay(500); // 🚨 Flaky - sometimes not enough
    var order = await _repository.GetAsync(orderId);
    Assert.Equal("Completed", order.Status);
}
```

**After (Reliable):**
```csharp
[Fact]
public async Task OrderProcessing_UpdatesStatus()
{
    await _service.ProcessOrderAsync(orderId);

    var order = await WaitForAsync(
        () => _repository.GetAsync(orderId),
        o => o.Status == "Completed",
        "order to complete",
        timeoutMs: 10000);

    Assert.Equal("Completed", order.Status);
}
```

## Impact

From fixing flaky tests:
- Pass rate: 60% → 100%
- Execution time: Often faster (no waiting longer than needed)
- CI reliability: No more random failures
- Developer trust: Tests mean something again

## Integration with Envoy

When debugging flaky tests:
1. Identify arbitrary delays (`Task.Delay`, `setTimeout`, `Thread.Sleep`)
2. Ask: "What condition am I actually waiting for?"
3. Replace with condition-based waiting
4. Add clear timeout and description
5. Use `envoy:verification` to confirm fix
