---
applyTo: '**/{Program.cs,appsettings*.json,*.bicep}'
---

# Application Insights Best Practices

## Setup in Program.cs

```csharp
builder.Services.AddApplicationInsightsTelemetry(options =>
{
    options.ConnectionString = builder.Configuration["ApplicationInsights:ConnectionString"];
    options.EnableAdaptiveSampling = true;
});
```

Use the connection string, never the deprecated instrumentation key.

## Cloud Role Name

Register an `ITelemetryInitializer` so services are distinguishable in the portal:

```csharp
public void Initialize(ITelemetry telemetry)
{
    telemetry.Context.Cloud.RoleName = "api-service";
    telemetry.Context.Cloud.RoleInstance = Environment.MachineName;
}
```

## Custom Events and Metrics

Track business events with dimensions so they can be filtered and analyzed:

```csharp
_telemetry.TrackEvent("OrderCreated",
    new Dictionary<string, string> { ["UserId"] = request.UserId.ToString(), ["Region"] = order.Region },
    new Dictionary<string, double> { ["OrderTotal"] = request.Total });

// Multi-dimensional metrics
_telemetry.GetMetric("OrderAmount", "Region").TrackValue(amount, region);
```

## Operations and Dependencies

HTTP, SQL, and Azure calls are tracked automatically. Wrap other external calls:

```csharp
using var operation = _telemetry.StartOperation<DependencyTelemetry>("ExternalAPI");
operation.Telemetry.Type = "HTTP";
operation.Telemetry.Target = new Uri(endpoint).Host;

var result = await _httpClient.GetAsync(endpoint);
operation.Telemetry.Success = result.IsSuccessStatusCode;
operation.Telemetry.ResultCode = ((int)result.StatusCode).ToString();
```

Set `Success = false` and call `_telemetry.TrackException(ex)` in the catch path.

For authenticated requests, set `telemetry.Context.User.AuthenticatedUserId` (e.g. in middleware) so telemetry is attributable per user.

## Common Mistakes to Avoid

- ❌ `InstrumentationKey` instead of `ConnectionString` → the key alone is deprecated
- ❌ Metrics without dimensions → include Region, PaymentMethod, etc. for analysis
- ❌ PII in telemetry (emails, names, passwords) → use IDs and enum-like values only
- ❌ Frontend requests without correlation → enable CORS correlation so traces span browser and API
- ❌ Tracking an event per item in a loop → track aggregates (count, batch-completed event)
- ❌ Default cloud role name → set RoleName/RoleInstance so multi-service telemetry is filterable
