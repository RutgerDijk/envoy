# Application Insights Stack Profile

## Detection

```bash
# Detect Application Insights
grep -E "ApplicationInsights|Microsoft.ApplicationInsights" *.csproj **/*.csproj 2>/dev/null | head -1
```

## Best Practices

### Setup

```csharp
// Program.cs
builder.Services.AddApplicationInsightsTelemetry(options =>
{
    options.ConnectionString = builder.Configuration["ApplicationInsights:ConnectionString"];
    options.EnableAdaptiveSampling = true;
    options.EnableDependencyTrackingTelemetryModule = true;
    options.EnableRequestTrackingTelemetryModule = true;
});

// With Serilog integration
builder.Host.UseSerilog((context, services, configuration) =>
{
    configuration
        .ReadFrom.Configuration(context.Configuration)
        .WriteTo.ApplicationInsights(
            services.GetRequiredService<TelemetryConfiguration>(),
            TelemetryConverter.Traces);
});
```

### Custom Telemetry

```csharp
public class OrderService
{
    private readonly TelemetryClient _telemetry;
    private readonly ILogger<OrderService> _logger;

    public OrderService(TelemetryClient telemetry, ILogger<OrderService> logger)
    {
        _telemetry = telemetry;
        _logger = logger;
    }

    public async Task<Order> CreateOrderAsync(CreateOrderRequest request)
    {
        using var operation = _telemetry.StartOperation<RequestTelemetry>("CreateOrder");

        try
        {
            // Track custom event
            _telemetry.TrackEvent("OrderCreated", new Dictionary<string, string>
            {
                ["UserId"] = request.UserId.ToString(),
                ["ItemCount"] = request.Items.Count.ToString()
            },
            new Dictionary<string, double>
            {
                ["OrderTotal"] = request.Total
            });

            var order = await ProcessOrderAsync(request);

            operation.Telemetry.Success = true;
            return order;
        }
        catch (Exception ex)
        {
            operation.Telemetry.Success = false;
            _telemetry.TrackException(ex);
            throw;
        }
    }
}
```

### Custom Metrics

```csharp
public class MetricsService
{
    private readonly TelemetryClient _telemetry;

    public MetricsService(TelemetryClient telemetry)
    {
        _telemetry = telemetry;
    }

    public void TrackOrderProcessingTime(double milliseconds)
    {
        _telemetry.TrackMetric("OrderProcessingTime", milliseconds);
    }

    public void TrackActiveUsers(int count)
    {
        var metric = _telemetry.GetMetric("ActiveUsers");
        metric.TrackValue(count);
    }

    public void TrackOrdersByRegion(string region, double amount)
    {
        var metric = _telemetry.GetMetric("OrderAmount", "Region");
        metric.TrackValue(amount, region);
    }
}
```

### Dependency Tracking

```csharp
// Automatic for HTTP, SQL, Azure services
// Custom dependency tracking
public async Task<ExternalData> CallExternalApiAsync(string endpoint)
{
    using var operation = _telemetry.StartOperation<DependencyTelemetry>("ExternalAPI");
    operation.Telemetry.Type = "HTTP";
    operation.Telemetry.Target = new Uri(endpoint).Host;
    operation.Telemetry.Data = endpoint;

    try
    {
        var result = await _httpClient.GetAsync(endpoint);
        operation.Telemetry.Success = result.IsSuccessStatusCode;
        operation.Telemetry.ResultCode = ((int)result.StatusCode).ToString();

        return await result.Content.ReadFromJsonAsync<ExternalData>();
    }
    catch (Exception ex)
    {
        operation.Telemetry.Success = false;
        _telemetry.TrackException(ex);
        throw;
    }
}
```

### User Tracking

```csharp
// Set authenticated user context
public class TelemetryMiddleware
{
    private readonly RequestDelegate _next;

    public TelemetryMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context, TelemetryClient telemetry)
    {
        if (context.User.Identity?.IsAuthenticated == true)
        {
            var userId = context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            var userName = context.User.FindFirst(ClaimTypes.Name)?.Value;

            telemetry.Context.User.AuthenticatedUserId = userId;
            telemetry.Context.User.Id = userId;

            // Custom properties on all telemetry
            telemetry.Context.GlobalProperties["UserName"] = userName;
        }

        await _next(context);
    }
}
```

### Availability Tests

```csharp
// Track availability from health checks
public class HealthCheckPublisher : IHealthCheckPublisher
{
    private readonly TelemetryClient _telemetry;

    public HealthCheckPublisher(TelemetryClient telemetry)
    {
        _telemetry = telemetry;
    }

    public Task PublishAsync(HealthReport report, CancellationToken ct)
    {
        foreach (var entry in report.Entries)
        {
            var availability = new AvailabilityTelemetry
            {
                Name = entry.Key,
                Success = entry.Value.Status == HealthStatus.Healthy,
                Duration = entry.Value.Duration,
                Message = entry.Value.Description
            };

            _telemetry.TrackAvailability(availability);
        }

        return Task.CompletedTask;
    }
}
```

### Frontend Integration

```typescript
// React setup
import { ApplicationInsights } from "@microsoft/applicationinsights-web";
import { ReactPlugin } from "@microsoft/applicationinsights-react-js";

const reactPlugin = new ReactPlugin();
const appInsights = new ApplicationInsights({
  config: {
    connectionString: import.meta.env.VITE_APP_INSIGHTS_CONNECTION_STRING,
    extensions: [reactPlugin],
    enableAutoRouteTracking: true,
    enableCorsCorrelation: true,
    enableRequestHeaderTracking: true,
    enableResponseHeaderTracking: true,
  },
});

appInsights.loadAppInsights();

// Track custom events
appInsights.trackEvent({ name: "ButtonClicked" }, { buttonId: "submit" });

// Track page views
appInsights.trackPageView({ name: "Dashboard" });

// Track exceptions
try {
  // risky code
} catch (error) {
  appInsights.trackException({ exception: error as Error });
}
```

## Common Mistakes

### Mistake: Missing Connection String

```csharp
// Bad: Instrumentation key (deprecated)
options.InstrumentationKey = "...";

// Good: Connection string
options.ConnectionString = "InstrumentationKey=...;IngestionEndpoint=...";
```

### Mistake: Not Tracking Custom Dimensions

```csharp
// Bad: Just the metric value
_telemetry.TrackMetric("OrderProcessed", 1);

// Good: Include dimensions for analysis
_telemetry.TrackMetric("OrderProcessed", 1, new Dictionary<string, string>
{
    ["Region"] = order.Region,
    ["PaymentMethod"] = order.PaymentMethod,
    ["CustomerTier"] = customer.Tier
});
```

### Mistake: Logging Sensitive Data

```csharp
// Bad: PII in telemetry
_telemetry.TrackEvent("UserLogin", new Dictionary<string, string>
{
    ["Email"] = user.Email,
    ["Password"] = password // NEVER!
});

// Good: Use IDs, not PII
_telemetry.TrackEvent("UserLogin", new Dictionary<string, string>
{
    ["UserId"] = user.Id.ToString(),
    ["LoginMethod"] = "Password"
});
```

### Mistake: Not Correlating Frontend/Backend

```typescript
// Bad: No correlation headers
fetch("/api/orders");

// Good: Include correlation headers
import { appInsights } from "./app-insights";

const operationId = appInsights.context.telemetryTrace.traceID;
fetch("/api/orders", {
  headers: {
    "Request-Id": operationId,
  },
});
```

### Mistake: Excessive Telemetry

```csharp
// Bad: Track everything
foreach (var item in largeCollection)
{
    _telemetry.TrackEvent("ItemProcessed", ...); // Thousands of events!
}

// Good: Track aggregates
_telemetry.TrackMetric("ItemsProcessed", largeCollection.Count);
_telemetry.TrackEvent("BatchCompleted", new Dictionary<string, string>
{
    ["ItemCount"] = largeCollection.Count.ToString()
});
```

### Mistake: Not Setting Cloud Role

```csharp
// Bad: Default role name (hard to filter in portal)

// Good: Set cloud role for filtering
services.AddApplicationInsightsTelemetry();
services.AddSingleton<ITelemetryInitializer, CloudRoleInitializer>();

public class CloudRoleInitializer : ITelemetryInitializer
{
    public void Initialize(ITelemetry telemetry)
    {
        telemetry.Context.Cloud.RoleName = "api-service";
        telemetry.Context.Cloud.RoleInstance = Environment.MachineName;
    }
}
```

## Review Checklist

- [ ] Connection string configured (not instrumentation key)
- [ ] Custom events track business metrics
- [ ] Dimensions included for filtering
- [ ] No PII in telemetry
- [ ] Frontend/backend correlation enabled
- [ ] Cloud role name set
- [ ] Sampling configured appropriately
- [ ] Availability tests configured
- [ ] User context set for authenticated users
- [ ] Exception tracking enabled

## Resources

- [Application Insights Documentation](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview)
- [JavaScript SDK](https://learn.microsoft.com/en-us/azure/azure-monitor/app/javascript)
- [Custom Telemetry](https://learn.microsoft.com/en-us/azure/azure-monitor/app/api-custom-events-metrics)
