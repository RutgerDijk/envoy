# Serilog Stack Profile

## Detection

```bash
# Detect Serilog
grep -E "Serilog" *.csproj **/*.csproj 2>/dev/null | head -1
```

## Best Practices

### Configuration

```csharp
// Program.cs
Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
    .MinimumLevel.Override("Microsoft.Hosting.Lifetime", LogEventLevel.Information)
    .Enrich.FromLogContext()
    .Enrich.WithMachineName()
    .Enrich.WithEnvironmentName()
    .WriteTo.Console(outputTemplate:
        "[{Timestamp:HH:mm:ss} {Level:u3}] {Message:lj} {Properties:j}{NewLine}{Exception}")
    .WriteTo.ApplicationInsights(
        services.GetRequiredService<TelemetryConfiguration>(),
        TelemetryConverter.Traces)
    .CreateLogger();

builder.Host.UseSerilog();
```

### Configuration via appsettings.json

```json
{
  "Serilog": {
    "MinimumLevel": {
      "Default": "Information",
      "Override": {
        "Microsoft": "Warning",
        "Microsoft.Hosting.Lifetime": "Information",
        "System": "Warning"
      }
    },
    "WriteTo": [
      {
        "Name": "Console",
        "Args": {
          "outputTemplate": "[{Timestamp:HH:mm:ss} {Level:u3}] {Message:lj}{NewLine}{Exception}"
        }
      }
    ],
    "Enrich": ["FromLogContext", "WithMachineName", "WithEnvironmentName"]
  }
}
```

```csharp
// Load from configuration
Log.Logger = new LoggerConfiguration()
    .ReadFrom.Configuration(configuration)
    .CreateLogger();
```

### Structured Logging

```csharp
// Good: Structured with named properties
_logger.LogInformation("User {UserId} created order {OrderId} for {Amount:C}",
    userId, orderId, amount);

// Good: Include context objects
_logger.LogInformation("Order created {@Order}", new { order.Id, order.Total, order.Items.Count });

// Good: Use scopes for correlation
using (_logger.BeginScope(new Dictionary<string, object>
{
    ["OrderId"] = orderId,
    ["UserId"] = userId
}))
{
    _logger.LogInformation("Processing order");
    await ProcessOrderAsync(orderId);
    _logger.LogInformation("Order processed");
}
```

### Log Levels

```csharp
// Verbose: Detailed debugging
_logger.LogTrace("Entering method {Method} with parameters {@Parameters}", method, parameters);

// Debug: Development diagnostics
_logger.LogDebug("Cache miss for key {CacheKey}", cacheKey);

// Information: Normal operations
_logger.LogInformation("User {UserId} logged in", userId);

// Warning: Unexpected but handled
_logger.LogWarning("Rate limit approaching for user {UserId}: {Current}/{Max}", userId, current, max);

// Error: Failures that affect operation
_logger.LogError(exception, "Failed to process order {OrderId}", orderId);

// Critical: System-wide failures
_logger.LogCritical(exception, "Database connection lost");
```

### Request Logging Middleware

```csharp
// Program.cs
app.UseSerilogRequestLogging(options =>
{
    options.MessageTemplate = "HTTP {RequestMethod} {RequestPath} responded {StatusCode} in {Elapsed:0.0000} ms";

    options.EnrichDiagnosticContext = (diagnosticContext, httpContext) =>
    {
        diagnosticContext.Set("RequestHost", httpContext.Request.Host.Value);
        diagnosticContext.Set("UserAgent", httpContext.Request.Headers.UserAgent.ToString());

        if (httpContext.User.Identity?.IsAuthenticated == true)
        {
            diagnosticContext.Set("UserId", httpContext.User.FindFirst("sub")?.Value);
        }
    };

    options.GetLevel = (httpContext, elapsed, ex) =>
    {
        if (ex != null || httpContext.Response.StatusCode >= 500)
            return LogEventLevel.Error;
        if (httpContext.Response.StatusCode >= 400)
            return LogEventLevel.Warning;
        return LogEventLevel.Information;
    };
});
```

### Correlation IDs

```csharp
// Middleware to add correlation ID
public class CorrelationIdMiddleware
{
    private readonly RequestDelegate _next;

    public CorrelationIdMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context)
    {
        var correlationId = context.Request.Headers["X-Correlation-Id"].FirstOrDefault()
            ?? Guid.NewGuid().ToString();

        context.Response.Headers.Append("X-Correlation-Id", correlationId);

        using (LogContext.PushProperty("CorrelationId", correlationId))
        {
            await _next(context);
        }
    }
}
```

## Common Mistakes

### Mistake: String Interpolation

```csharp
// Bad: String interpolation loses structure
_logger.LogInformation($"User {userId} created order {orderId}");

// Good: Message template with placeholders
_logger.LogInformation("User {UserId} created order {OrderId}", userId, orderId);
```

### Mistake: Logging Sensitive Data

```csharp
// Bad: Logging passwords or tokens
_logger.LogInformation("User login with password {Password}", password);

// Good: Never log sensitive data
_logger.LogInformation("User {UserId} login attempt", userId);
```

### Mistake: Not Using Destructuring

```csharp
// Bad: Object becomes ToString()
_logger.LogInformation("Order: {Order}", order);
// Output: "Order: MyApp.Models.Order"

// Good: Destructure with @
_logger.LogInformation("Order: {@Order}", order);
// Output: "Order: {Id: 1, Total: 99.99, ...}"

// Good: Selective destructuring
_logger.LogInformation("Order: {@Order}",
    new { order.Id, order.Total, ItemCount = order.Items.Count });
```

### Mistake: Missing Exception Parameter

```csharp
// Bad: Exception details lost
_logger.LogError("Failed to process order: " + ex.Message);

// Good: Pass exception as first parameter
_logger.LogError(ex, "Failed to process order {OrderId}", orderId);
```

### Mistake: Excessive Logging in Loops

```csharp
// Bad: Floods logs
foreach (var item in items)
{
    _logger.LogInformation("Processing item {ItemId}", item.Id);
    Process(item);
}

// Good: Log summary
_logger.LogInformation("Processing {Count} items", items.Count);
foreach (var item in items)
{
    Process(item);
}
_logger.LogInformation("Processed {Count} items", items.Count);
```

### Mistake: Wrong Log Level

```csharp
// Bad: Information for errors
_logger.LogInformation("Order failed: {Error}", error);

// Bad: Error for normal operations
_logger.LogError("User logged in"); // Not an error!

// Good: Appropriate levels
_logger.LogError(ex, "Order processing failed for {OrderId}", orderId);
_logger.LogInformation("User {UserId} logged in", userId);
```

## Review Checklist

- [ ] Message templates used (not string interpolation)
- [ ] Sensitive data excluded from logs
- [ ] Destructuring (@) used for objects
- [ ] Exception passed as first parameter
- [ ] Appropriate log levels used
- [ ] Correlation IDs included
- [ ] Log context enriched with relevant data
- [ ] Request logging configured
- [ ] Excessive logging avoided in loops
- [ ] Structured properties named consistently

## Resources

- [Serilog Documentation](https://serilog.net/)
- [Structured Logging Best Practices](https://messagetemplates.org/)
- [Serilog.AspNetCore](https://github.com/serilog/serilog-aspnetcore)
