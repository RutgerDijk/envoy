---
applyTo: '**/*.bicep'
---

# Azure Container Apps Best Practices

## Container App Configuration

```bicep
resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: appName
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      ingress: { external: true, targetPort: 8080, transport: 'http' }
      secrets: [{ name: 'connection-string', value: connectionString }]
      registries: [{ server: '${registryName}.azurecr.io', identity: 'system' }]
    }
    template: {
      containers: [{
        name: 'api'
        image: '${registryName}.azurecr.io/${imageName}:${imageTag}'
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'ASPNETCORE_ENVIRONMENT', value: environment }
          { name: 'ConnectionStrings__DefaultConnection', secretRef: 'connection-string' }
        ]
        probes: [
          { type: 'liveness', httpGet: { path: '/health/live', port: 8080 } }
          { type: 'readiness', httpGet: { path: '/health/ready', port: 8080 } }
        ]
      }]
    }
  }
}
```

## Environment Configuration

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
  }
}
```

## Scaling Rules

```bicep
scale: {
  minReplicas: environment == 'prod' ? 2 : 0
  maxReplicas: environment == 'prod' ? 20 : 5
  rules: [
    { name: 'http-scaling', http: { metadata: { concurrentRequests: '100' } } }
    { name: 'cpu-scaling', custom: { type: 'cpu', metadata: { type: 'Utilization', value: '70' } } }
  ]
}
```

## Common Mistakes to Avoid

- ❌ Missing health probes → define liveness and readiness probes on every container
- ❌ Secrets as plain env var values → declare in `configuration.secrets` and reference via `secretRef`
- ❌ `:latest` image tag → pin a specific version tag (e.g. `image: '...api:${imageTag}'`)
- ❌ `zoneRedundant: false` in production → enable zone redundancy for prod environments
- ❌ `minReplicas: 0` in production → cold starts on every request; keep at least 2 replicas
- ❌ No `resources` block on containers → always set explicit CPU and memory limits
- ❌ Registry credentials in secrets → pull images with managed identity (`identity: 'system'`)
