# Azure Container Apps Stack Profile

## Detection

```bash
# Detect Azure Container Apps
find . -name "*.bicep" -exec grep -l "containerApps" {} \; 2>/dev/null | head -1
```

## Best Practices

### Resource Structure

```
infra/
├── main.bicep                  # Main deployment
├── modules/
│   ├── container-app.bicep     # Container App module
│   ├── container-env.bicep     # Container Apps Environment
│   └── registry.bicep          # Container Registry
└── parameters/
    ├── dev.bicepparam
    └── prod.bicepparam
```

### Container App Configuration

```bicep
resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: appName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'http'
        corsPolicy: {
          allowedOrigins: ['https://myapp.com']
          allowedMethods: ['GET', 'POST', 'PUT', 'DELETE']
          allowedHeaders: ['*']
        }
      }
      secrets: [
        {
          name: 'connection-string'
          value: connectionString
        }
      ]
      registries: [
        {
          server: '${registryName}.azurecr.io'
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: '${registryName}.azurecr.io/${imageName}:${imageTag}'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'ASPNETCORE_ENVIRONMENT'
              value: environment
            }
            {
              name: 'ConnectionStrings__DefaultConnection'
              secretRef: 'connection-string'
            }
          ]
          probes: [
            {
              type: 'liveness'
              httpGet: {
                path: '/health/live'
                port: 8080
              }
              initialDelaySeconds: 30
              periodSeconds: 10
            }
            {
              type: 'readiness'
              httpGet: {
                path: '/health/ready'
                port: 8080
              }
              initialDelaySeconds: 5
              periodSeconds: 5
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 10
        rules: [
          {
            name: 'http-scaling'
            http: {
              metadata: {
                concurrentRequests: '100'
              }
            }
          }
        ]
      }
    }
  }
}
```

### Environment Configuration

```bicep
resource containerEnv 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: envName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    zoneRedundant: environment == 'prod'
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}
```

### Health Endpoints in .NET

```csharp
// Program.cs
builder.Services.AddHealthChecks()
    .AddCheck("self", () => HealthCheckResult.Healthy())
    .AddNpgSql(connectionString, name: "database")
    .AddUrlGroup(new Uri(externalApiUrl), name: "external-api");

app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = check => check.Name == "self"
});

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = _ => true
});
```

### Scaling Rules

```bicep
scale: {
  minReplicas: environment == 'prod' ? 2 : 0
  maxReplicas: environment == 'prod' ? 20 : 5
  rules: [
    {
      name: 'http-scaling'
      http: {
        metadata: {
          concurrentRequests: '100'
        }
      }
    }
    {
      name: 'cpu-scaling'
      custom: {
        type: 'cpu'
        metadata: {
          type: 'Utilization'
          value: '70'
        }
      }
    }
    {
      name: 'queue-scaling'
      azureQueue: {
        queueName: 'tasks'
        queueLength: 10
        auth: [
          {
            secretRef: 'storage-connection'
            triggerParameter: 'connection'
          }
        ]
      }
    }
  ]
}
```

## Common Mistakes

### Mistake: Missing Health Probes

```bicep
// Bad: No health probes
template: {
  containers: [{
    name: 'api'
    image: 'myimage:latest'
    // No probes defined
  }]
}

// Good: Liveness and readiness probes
template: {
  containers: [{
    name: 'api'
    image: 'myimage:latest'
    probes: [
      { type: 'liveness', httpGet: { path: '/health/live', port: 8080 } }
      { type: 'readiness', httpGet: { path: '/health/ready', port: 8080 } }
    ]
  }]
}
```

### Mistake: Hardcoded Secrets

```bicep
// Bad: Secrets in environment variables
env: [
  { name: 'DB_PASSWORD', value: 'mysecret' }
]

// Good: Use secret references
configuration: {
  secrets: [{ name: 'db-password', value: dbPassword }]
}
template: {
  containers: [{
    env: [{ name: 'DB_PASSWORD', secretRef: 'db-password' }]
  }]
}
```

### Mistake: Using :latest Tag

```bicep
// Bad: Unpredictable deployments
image: 'myregistry.azurecr.io/api:latest'

// Good: Specific version tag
image: 'myregistry.azurecr.io/api:${imageTag}'
```

### Mistake: No Zone Redundancy in Production

```bicep
// Bad: Single zone
properties: {
  zoneRedundant: false
}

// Good: Zone redundant for production
properties: {
  zoneRedundant: environment == 'prod'
}
```

### Mistake: Scale to Zero in Production

```bicep
// Bad: Cold starts for all requests
scale: {
  minReplicas: 0
  maxReplicas: 10
}

// Good: Minimum replicas in production
scale: {
  minReplicas: environment == 'prod' ? 2 : 0
  maxReplicas: 10
}
```

### Mistake: Missing Resource Limits

```bicep
// Bad: No resource constraints
containers: [{
  name: 'api'
  image: 'myimage:v1'
}]

// Good: Defined resource limits
containers: [{
  name: 'api'
  image: 'myimage:v1'
  resources: {
    cpu: json('0.5')
    memory: '1Gi'
  }
}]
```

## Review Checklist

- [ ] Health probes configured (liveness + readiness)
- [ ] Secrets stored securely (not in env vars)
- [ ] Specific image tags used (not :latest)
- [ ] Zone redundancy enabled for production
- [ ] Minimum replicas > 0 for production
- [ ] Resource limits defined
- [ ] Scaling rules appropriate for workload
- [ ] Managed identity used for Azure resources
- [ ] Log Analytics configured
- [ ] CORS policy restricted appropriately

## Resources

- [Azure Container Apps Documentation](https://learn.microsoft.com/en-us/azure/container-apps/)
- [Container Apps Scaling](https://learn.microsoft.com/en-us/azure/container-apps/scale-app)
- [Health Probes](https://learn.microsoft.com/en-us/azure/container-apps/health-probes)
