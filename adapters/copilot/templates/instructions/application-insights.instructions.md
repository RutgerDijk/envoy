---
applyTo: '**/{*TelemetryClient*,*ApplicationInsights*,appsettings*.json}'
---

# Application Insights Best Practices

## Setup

```csharp
// Program.cs
builder.Services.AddApplicationInsightsTelemetry(options =>
{
    options.ConnectionString = builder.Configuration["ApplicationInsights:ConnectionString"];
    options.EnableAdaptiveSampling = true;
});

// With Serilog
builder.Host.UseSerilog((ctx, services, config) =>
    config.ReadFrom.Configuration(ctx.Configuration)
          .WriteTo.ApplicationInsights(
              services.GetRequiredService<TelemetryConfiguration>(),
              TelemetryConverter.Traces));
```

## appsettings.json

```json
{
  "ApplicationInsights": {
    "ConnectionString": "<from-Key-Vault-or-environment>"
  }
}
```

## Custom Telemetry

```csharp
public class OrderService
{
    private readonly TelemetryClient _telemetry;

    public async Task<Order> CreateOrderAsync(CreateOrderRequest request, CancellationToken ct)
    {
        using var operation = _telemetry.StartOperation<RequestTelemetry>("CreateOrder");
        try
        {
            var order = /* ... */;
            _telemetry.TrackEvent("OrderCreated", new Dictionary<string, string>
            {
                ["OrderId"] = order.Id.ToString(),
                ["UserId"] = request.UserId.ToString(),
            });
            operation.Telemetry.Success = true;
            return order;
        }
        catch (Exception ex)
        {
            _telemetry.TrackException(ex);
            operation.Telemetry.Success = false;
            throw;
        }
    }
}
```

## Filtering Probes from Telemetry

```csharp
// Exclude health check endpoints from telemetry noise
builder.Services.AddApplicationInsightsTelemetryProcessor<HealthCheckTelemetryFilter>();

public class HealthCheckTelemetryFilter : ITelemetryProcessor
{
    private readonly ITelemetryProcessor _next;
    public HealthCheckTelemetryFilter(ITelemetryProcessor next) => _next = next;

    public void Process(ITelemetry item)
    {
        if (item is RequestTelemetry request && request.Url?.AbsolutePath.StartsWith("/health") == true)
            return;
        _next.Process(item);
    }
}
```

## Common Mistakes to Avoid

- ❌ Connection string in code → use environment variable or Key Vault reference
- ❌ No adaptive sampling in high-volume apps → costs add up; enable `EnableAdaptiveSampling`
- ❌ `TelemetryClient` as transient → it's thread-safe, register as singleton
- ❌ Logging health check probes → they create noise; filter them out
- ❌ Not correlating logs and requests → use `Enrich.FromLogContext()` with Serilog to preserve correlation IDs
