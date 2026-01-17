# Bicep Stack Profile

## Detection

```bash
# Detect Bicep files
find . -name "*.bicep" | head -1
```

## Best Practices

### Project Structure

```
infra/
├── main.bicep                  # Main deployment orchestrator
├── main.bicepparam             # Default parameters
├── modules/
│   ├── container-app.bicep
│   ├── database.bicep
│   ├── keyvault.bicep
│   └── monitoring.bicep
├── parameters/
│   ├── dev.bicepparam
│   ├── staging.bicepparam
│   └── prod.bicepparam
└── scripts/
    └── deploy.sh
```

### Module Pattern

```bicep
// modules/container-app.bicep
@description('Name of the container app')
param name string

@description('Location for resources')
param location string = resourceGroup().location

@description('Environment (dev, staging, prod)')
@allowed(['dev', 'staging', 'prod'])
param environment string

@description('Container image with tag')
param image string

@description('Container Apps Environment ID')
param environmentId string

@secure()
@description('Database connection string')
param connectionString string

// Local variables
var isProduction = environment == 'prod'

resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: name
  location: location
  // ... configuration
}

// Outputs for other modules
@description('Container App FQDN')
output fqdn string = containerApp.properties.configuration.ingress.fqdn

@description('Container App Principal ID')
output principalId string = containerApp.identity.principalId
```

### Main Orchestrator

```bicep
// main.bicep
targetScope = 'subscription'

@description('Environment name')
@allowed(['dev', 'staging', 'prod'])
param environment string

@description('Location for all resources')
param location string = 'westeurope'

@description('Base name for resources')
param baseName string

// Resource Group
resource rg 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: 'rg-${baseName}-${environment}'
  location: location
}

// Deploy modules
module monitoring 'modules/monitoring.bicep' = {
  scope: rg
  name: 'monitoring'
  params: {
    name: 'log-${baseName}-${environment}'
    location: location
  }
}

module database 'modules/database.bicep' = {
  scope: rg
  name: 'database'
  params: {
    name: 'psql-${baseName}-${environment}'
    location: location
    environment: environment
    logAnalyticsId: monitoring.outputs.logAnalyticsId
  }
}

module api 'modules/container-app.bicep' = {
  scope: rg
  name: 'api'
  params: {
    name: 'ca-${baseName}-api-${environment}'
    location: location
    environment: environment
    image: 'myregistry.azurecr.io/api:${imageTag}'
    environmentId: containerEnv.outputs.id
    connectionString: database.outputs.connectionString
  }
}
```

### Parameter Files

```bicep
// parameters/prod.bicepparam
using '../main.bicep'

param environment = 'prod'
param location = 'westeurope'
param baseName = 'myapp'
```

### Naming Convention

```bicep
// Consistent naming with abbreviations
var resourceNames = {
  resourceGroup: 'rg-${baseName}-${environment}'
  containerApp: 'ca-${baseName}-${environment}'
  containerEnv: 'cae-${baseName}-${environment}'
  postgres: 'psql-${baseName}-${environment}'
  keyVault: 'kv-${baseName}-${environment}'
  logAnalytics: 'log-${baseName}-${environment}'
  appInsights: 'appi-${baseName}-${environment}'
  staticWebApp: 'stapp-${baseName}-${environment}'
  storageAccount: 'st${replace(baseName, '-', '')}${environment}'  // No hyphens
}
```

### Conditional Deployment

```bicep
// Deploy based on environment
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-05-01' = if (environment == 'prod') {
  name: '${name}-pe'
  // ...
}

// Conditional properties
highAvailability: {
  mode: environment == 'prod' ? 'ZoneRedundant' : 'Disabled'
}

// Conditional SKU
var skuMap = {
  dev: 'B_Standard_B1ms'
  staging: 'GP_Standard_D2s_v3'
  prod: 'GP_Standard_D4s_v3'
}
sku: {
  name: skuMap[environment]
}
```

### Secret Management

```bicep
// Reference Key Vault secret
@secure()
param adminPassword string

// Or get from existing Key Vault
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
  scope: resourceGroup(keyVaultResourceGroup)
}

module database 'modules/database.bicep' = {
  params: {
    adminPassword: keyVault.getSecret('db-admin-password')
  }
}
```

## Common Mistakes

### Mistake: No Module Reuse

```bicep
// Bad: Duplicate code in main.bicep
resource containerApp1 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'app1'
  // 50 lines of config
}
resource containerApp2 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'app2'
  // Same 50 lines of config
}

// Good: Use modules
module app1 'modules/container-app.bicep' = {
  name: 'app1'
  params: { name: 'app1', ... }
}
module app2 'modules/container-app.bicep' = {
  name: 'app2'
  params: { name: 'app2', ... }
}
```

### Mistake: Hardcoded Values

```bicep
// Bad: Hardcoded environment-specific values
sku: {
  name: 'GP_Standard_D4s_v3'
}

// Good: Parameterized with defaults
@allowed(['dev', 'staging', 'prod'])
param environment string

var skuMap = {
  dev: 'B_Standard_B1ms'
  staging: 'GP_Standard_D2s_v3'
  prod: 'GP_Standard_D4s_v3'
}
sku: {
  name: skuMap[environment]
}
```

### Mistake: Missing Descriptions

```bicep
// Bad: No documentation
param name string
param env string

// Good: Documented parameters
@description('The name of the container app')
param name string

@description('Environment: dev, staging, or prod')
@allowed(['dev', 'staging', 'prod'])
param environment string
```

### Mistake: Secrets as Plain Parameters

```bicep
// Bad: Secret not marked as secure
param adminPassword string

// Good: Marked as secure
@secure()
param adminPassword string
```

### Mistake: No Output for Dependencies

```bicep
// Bad: No outputs, can't reference in other modules
resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  // ...
}

// Good: Output important values
output id string = containerApp.id
output fqdn string = containerApp.properties.configuration.ingress.fqdn
output principalId string = containerApp.identity.principalId
```

### Mistake: Using Deprecated API Versions

```bicep
// Bad: Old API version
resource containerApp 'Microsoft.App/containerApps@2022-03-01' = {

// Good: Recent stable API version
resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
```

## Review Checklist

- [ ] Modules used for reusable components
- [ ] Parameters have descriptions and constraints
- [ ] Secrets marked with @secure()
- [ ] Environment-specific values parameterized
- [ ] Consistent naming convention used
- [ ] Outputs provided for module dependencies
- [ ] Recent API versions used
- [ ] Conditional deployment for env-specific resources
- [ ] Key Vault used for secrets
- [ ] No hardcoded resource IDs

## Resources

- [Bicep Documentation](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/)
- [Bicep Best Practices](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/best-practices)
- [Azure Naming Conventions](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-naming)
