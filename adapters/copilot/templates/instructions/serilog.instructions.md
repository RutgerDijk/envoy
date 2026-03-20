---
applyTo: '**/{Program.cs,**/Logging/**,appsettings*.json}'
---

# Serilog Best Practices

## Setup in Program.cs

```csharp
Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
    .MinimumLevel.Override("Microsoft.Hosting.Lifetime", LogEventLevel.Information)
    .Enrich.FromLogContext()
    .Enrich.WithMachineName()
    .WriteTo.Console(outputTemplate:
        "[{Timestamp:HH:mm:ss} {Level:u3}] {Message:lj} {Properties:j}{NewLine}{Exception}")
    .CreateBootstrapLogger();

builder.Host.UseSerilog((context, services, configuration) =>
    configuration.ReadFrom.Configuration(context.Configuration)
                 .ReadFrom.Services(services));
```

## appsettings.json

```json
{
  "Serilog": {
    "MinimumLevel": {
      "Default": "Information",
      "Override": {
        "Microsoft": "Warning",
        "System": "Warning"
      }
    },
    "WriteTo": [
      { "Name": "Console" },
      { "Name": "ApplicationInsights", "Args": { "telemetryConverter": "Serilog.Sinks.ApplicationInsights.TelemetryConverters.TraceTelemetryConverter, Serilog.Sinks.ApplicationInsights" } }
    ],
    "Enrich": ["FromLogContext", "WithMachineName", "WithEnvironmentName"]
  }
}
```

## Structured Logging

```csharp
// Good: structured properties
_logger.LogInformation("User {UserId} created order {OrderId} for {Amount:C}", userId, orderId, amount);

// Good: use LogContext for scoped properties
using (LogContext.PushProperty("UserId", userId))
using (LogContext.PushProperty("RequestId", requestId))
{
    _logger.LogInformation("Processing request");
    // All logs in this scope include UserId and RequestId
}

// Bad: string interpolation (loses structure)
_logger.LogInformation($"User {userId} created order {orderId}");
```

## Log Levels

| Level | When to use |
|-------|-------------|
| `Debug` | Diagnostics during development |
| `Information` | Normal operations (user created, order processed) |
| `Warning` | Unexpected but recoverable (retry, fallback used) |
| `Error` | Operation failed, needs attention |
| `Fatal` | Application cannot continue |

## Common Mistakes to Avoid

- ❌ String interpolation in log messages → use structured message templates
- ❌ Logging sensitive data (passwords, tokens, PII)
- ❌ Same minimum level for all namespaces → configure overrides for noisy Microsoft namespaces
- ❌ Not calling `Log.CloseAndFlush()` on application exit → logs may be lost
- ❌ `{@Object}` on large objects → serializes the whole object; select specific properties
