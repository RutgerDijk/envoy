# Health Checks Stack Profile

## Detection

```bash
# Detect ASP.NET Core Health Checks
grep -E "AddHealthChecks|HealthChecks" **/*.cs **/*.csproj 2>/dev/null | head -1
```

## Best Practices

### Basic Setup

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
        tags: ["ready"]);

// Map endpoints
app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("live"),
    ResponseWriter = WriteResponse
});

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready"),
    ResponseWriter = WriteResponse
});

app.MapHealthChecks("/health", new HealthCheckOptions
{
    ResponseWriter = WriteResponse
});
```

### Custom Response Writer

```csharp
static Task WriteResponse(HttpContext context, HealthReport report)
{
    context.Response.ContentType = "application/json";

    var response = new
    {
        status = report.Status.ToString(),
        duration = report.TotalDuration.TotalMilliseconds,
        checks = report.Entries.Select(e => new
        {
            name = e.Key,
            status = e.Value.Status.ToString(),
            duration = e.Value.Duration.TotalMilliseconds,
            description = e.Value.Description,
            exception = e.Value.Exception?.Message,
            data = e.Value.Data
        })
    };

    return context.Response.WriteAsJsonAsync(response);
}
```

### Custom Health Check

```csharp
public class RedisHealthCheck : IHealthCheck
{
    private readonly IConnectionMultiplexer _redis;

    public RedisHealthCheck(IConnectionMultiplexer redis)
    {
        _redis = redis;
    }

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var db = _redis.GetDatabase();
            var latency = await db.PingAsync();

            var data = new Dictionary<string, object>
            {
                ["latency_ms"] = latency.TotalMilliseconds
            };

            if (latency > TimeSpan.FromSeconds(1))
            {
                return HealthCheckResult.Degraded(
                    "Redis responding slowly",
                    data: data);
            }

            return HealthCheckResult.Healthy("Redis is healthy", data);
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy(
                "Redis connection failed",
                exception: ex);
        }
    }
}

// Registration
builder.Services.AddHealthChecks()
    .AddCheck<RedisHealthCheck>("redis", tags: ["ready"]);
```

### Database Health Check with Query

```csharp
public class DatabaseHealthCheck : IHealthCheck
{
    private readonly ApplicationDbContext _context;

    public DatabaseHealthCheck(ApplicationDbContext context)
    {
        _context = context;
    }

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            // Simple connectivity check
            await _context.Database.CanConnectAsync(cancellationToken);

            // Optional: Check for pending migrations
            var pendingMigrations = await _context.Database
                .GetPendingMigrationsAsync(cancellationToken);

            if (pendingMigrations.Any())
            {
                return HealthCheckResult.Degraded(
                    $"Pending migrations: {string.Join(", ", pendingMigrations)}");
            }

            return HealthCheckResult.Healthy();
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy("Database unavailable", ex);
        }
    }
}
```

### Health Check with Timeout

```csharp
builder.Services.AddHealthChecks()
    .AddAsyncCheck("slow-dependency", async cancellationToken =>
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(TimeSpan.FromSeconds(5));

        try
        {
            await CheckSlowDependencyAsync(cts.Token);
            return HealthCheckResult.Healthy();
        }
        catch (OperationCanceledException)
        {
            return HealthCheckResult.Unhealthy("Health check timed out");
        }
    }, tags: ["ready"]);
```

### Kubernetes Probes Configuration

```yaml
# kubernetes deployment.yaml
spec:
  containers:
    - name: api
      livenessProbe:
        httpGet:
          path: /health/live
          port: 8080
        initialDelaySeconds: 10
        periodSeconds: 15
        timeoutSeconds: 5
        failureThreshold: 3
      readinessProbe:
        httpGet:
          path: /health/ready
          port: 8080
        initialDelaySeconds: 5
        periodSeconds: 10
        timeoutSeconds: 5
        failureThreshold: 3
      startupProbe:
        httpGet:
          path: /health/live
          port: 8080
        initialDelaySeconds: 0
        periodSeconds: 5
        timeoutSeconds: 5
        failureThreshold: 30
```

### Azure Container Apps Health Probes

```bicep
// container-app.bicep
resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  properties: {
    configuration: {
      ingress: {
        targetPort: 8080
      }
    }
    template: {
      containers: [
        {
          name: 'api'
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health/live'
                port: 8080
              }
              initialDelaySeconds: 10
              periodSeconds: 15
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health/ready'
                port: 8080
              }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
    }
  }
}
```

### Health Check UI (Optional)

```csharp
// For development/internal monitoring
builder.Services
    .AddHealthChecksUI(options =>
    {
        options.SetEvaluationTimeInSeconds(30);
        options.MaximumHistoryEntriesPerEndpoint(50);
        options.AddHealthCheckEndpoint("API", "/health");
    })
    .AddInMemoryStorage();

app.MapHealthChecksUI(options =>
{
    options.UIPath = "/health-ui";
});
```

## Common Mistakes

### Mistake: No Timeout on Health Checks

```csharp
// Bad: Health check can hang indefinitely
public async Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken cancellationToken)
{
    await _httpClient.GetAsync("https://slow-service.com");
    return HealthCheckResult.Healthy();
}

// Good: Respect cancellation and add timeout
public async Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken cancellationToken)
{
    using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
    cts.CancelAfter(TimeSpan.FromSeconds(5));

    try
    {
        await _httpClient.GetAsync("https://slow-service.com", cts.Token);
        return HealthCheckResult.Healthy();
    }
    catch (OperationCanceledException)
    {
        return HealthCheckResult.Unhealthy("Service check timed out");
    }
}
```

### Mistake: Heavy Operations in Health Checks

```csharp
// Bad: Complex query in health check
public async Task<HealthCheckResult> CheckHealthAsync(...)
{
    var count = await _context.Users.CountAsync(); // Full table scan!
    return HealthCheckResult.Healthy($"Users: {count}");
}

// Good: Lightweight connectivity check
public async Task<HealthCheckResult> CheckHealthAsync(...)
{
    await _context.Database.CanConnectAsync(cancellationToken);
    return HealthCheckResult.Healthy();
}
```

### Mistake: No Separation of Liveness and Readiness

```csharp
// Bad: Single endpoint for everything
app.MapHealthChecks("/health");

// Good: Separate endpoints for different purposes
app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("live") // Self-check only
});

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready") // Dependencies
});
```

### Mistake: Exposing Sensitive Information

```csharp
// Bad: Detailed errors to anonymous users
app.MapHealthChecks("/health", new HealthCheckOptions
{
    ResponseWriter = async (context, report) =>
    {
        // Exposes connection strings, stack traces
        await context.Response.WriteAsJsonAsync(report);
    }
});

// Good: Detailed info only for authenticated users
app.MapHealthChecks("/health", new HealthCheckOptions
{
    ResponseWriter = async (context, report) =>
    {
        var isAuthenticated = context.User.Identity?.IsAuthenticated ?? false;
        var response = isAuthenticated
            ? GetDetailedResponse(report)
            : GetSimpleResponse(report);
        await context.Response.WriteAsJsonAsync(response);
    }
});
```

### Mistake: Not Handling Degraded State

```csharp
// Bad: Only healthy or unhealthy
return isOk
    ? HealthCheckResult.Healthy()
    : HealthCheckResult.Unhealthy();

// Good: Use degraded for partial failures
if (latency > TimeSpan.FromSeconds(5))
{
    return HealthCheckResult.Unhealthy("Service too slow");
}
if (latency > TimeSpan.FromSeconds(1))
{
    return HealthCheckResult.Degraded("Service responding slowly");
}
return HealthCheckResult.Healthy();
```

### Mistake: Missing Health Check in Dependencies

```csharp
// Bad: Checking only database
builder.Services.AddHealthChecks()
    .AddNpgSql(connectionString);

// Good: Check all critical dependencies
builder.Services.AddHealthChecks()
    .AddNpgSql(connectionString, tags: ["ready"])
    .AddRedis(redisConnectionString, tags: ["ready"])
    .AddUrlGroup(new Uri(externalApiUrl), tags: ["ready"])
    .AddAzureBlobStorage(blobConnectionString, tags: ["ready"]);
```

## Review Checklist

- [ ] Liveness and readiness probes separated
- [ ] Health checks have timeouts
- [ ] Lightweight operations only (no heavy queries)
- [ ] All critical dependencies checked
- [ ] Degraded state used appropriately
- [ ] Sensitive information not exposed
- [ ] Custom response format for monitoring
- [ ] Kubernetes/container probes configured
- [ ] Health check tags used for filtering
- [ ] Startup probe for slow-starting apps

## Resources

- [ASP.NET Core Health Checks](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/health-checks)
- [Health Checks Community Packages](https://github.com/Xabaril/AspNetCore.Diagnostics.HealthChecks)
- [Kubernetes Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
