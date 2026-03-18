---
applyTo: '**/{*HealthCheck*.cs,Program.cs}'
---

# ASP.NET Core Health Checks Best Practices

## Setup

```csharp
// Program.cs
builder.Services.AddHealthChecks()
    .AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"])
    .AddNpgSql(
        connectionString: builder.Configuration.GetConnectionString("DefaultConnection")!,
        name: "database",
        tags: ["ready"])
    .AddUrlGroup(
        new Uri("https://api.external-service.com/health"),
        name: "external-api",
        tags: ["ready"],
        timeout: TimeSpan.FromSeconds(3));

// Separate endpoints for liveness and readiness probes
app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("live"),
    ResponseWriter = WriteHealthResponse
}).AllowAnonymous();

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready"),
    ResponseWriter = WriteHealthResponse
}).AllowAnonymous();
```

## Custom Response Writer

```csharp
static Task WriteHealthResponse(HttpContext context, HealthReport report)
{
    context.Response.ContentType = "application/json";
    var result = JsonSerializer.Serialize(new
    {
        status = report.Status.ToString(),
        checks = report.Entries.Select(e => new
        {
            name = e.Key,
            status = e.Value.Status.ToString(),
            duration = e.Value.Duration.TotalMilliseconds,
            description = e.Value.Description
        }),
        totalDuration = report.TotalDuration.TotalMilliseconds
    });
    return context.Response.WriteAsync(result);
}
```

## Custom Health Check

```csharp
public class ExternalServiceHealthCheck : IHealthCheck
{
    private readonly HttpClient _client;

    public ExternalServiceHealthCheck(HttpClient client) => _client = client;

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var response = await _client.GetAsync("/ping", cancellationToken);
            return response.IsSuccessStatusCode
                ? HealthCheckResult.Healthy()
                : HealthCheckResult.Degraded($"Status: {response.StatusCode}");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy(ex.Message, ex);
        }
    }
}
```

## Common Mistakes to Avoid

- ❌ Single `/health` endpoint for both liveness and readiness → container orchestrators need them separate
- ❌ Health check endpoint behind authentication → it must be accessible without credentials
- ❌ Slow external calls in liveness probe → liveness should only check process health
- ❌ No timeout on external health checks → a hanging dependency hangs the whole health endpoint
