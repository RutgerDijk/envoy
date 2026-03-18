---
applyTo: '**/*.bicep'
---

# Azure Container Apps Best Practices

## Resource Naming Convention

Use a consistent prefix: `{app}-{component}-{env}` (e.g. `myapp-api-prod`)

## Container App Module Pattern

```bicep
// modules/container-app.bicep
@description('Name of the container app')
param name string

@description('Container Apps Environment ID')
param environmentId string

@description('Container image with tag')
param image string

@allowed(['dev', 'staging', 'prod'])
param environment string

resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: name
  location: resourceGroup().location
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'http'
      }
      secrets: [
        { name: 'db-connection', keyVaultUrl: dbConnectionSecretUri, identity: 'system' }
      ]
    }
    template: {
      containers: [
        {
          name: name
          image: image
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'ASPNETCORE_ENVIRONMENT', value: environment }
            { name: 'ConnectionStrings__DefaultConnection', secretRef: 'db-connection' }
          ]
          probes: [
            {
              type: 'Readiness'
              httpGet: { path: '/health/ready', port: 8080 }
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: { minReplicas: (environment == 'prod') ? 1 : 0, maxReplicas: 10 }
    }
  }
}
```

## Secrets — Always Use Key Vault

Never put secrets in Bicep parameters directly:

```bicep
// Good: reference from Key Vault
{ name: 'api-key', keyVaultUrl: '${keyVault.properties.vaultUri}secrets/api-key', identity: 'system' }

// Bad: secret in cleartext
{ name: 'api-key', value: 'my-secret-value' }
```

## Scale to Zero in Dev/Test

```bicep
scale: {
  minReplicas: (environment == 'prod') ? 1 : 0
  maxReplicas: 10
}
```

## Common Mistakes to Avoid

- ❌ No health probes → container may receive traffic before it's ready
- ❌ Scale to zero in production → cold starts will affect users
- ❌ Secrets in parameter files → use Key Vault references
- ❌ No managed identity → use system-assigned identity to access Azure resources
- ❌ Hardcoded CPU/memory → parameterize for different environments
