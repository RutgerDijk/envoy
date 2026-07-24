---
applyTo: '**/*.{bicep,bicepparam}'
---

# Bicep Best Practices

## Module Pattern

```bicep
// modules/container-app.bicep
@description('Name of the container app')
param name string

@description('Environment (dev, staging, prod)')
@allowed(['dev', 'staging', 'prod'])
param environment string

@secure()
@description('Database connection string')
param connectionString string

resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: name
  // ... configuration
}

// Outputs so other modules can reference this one
output fqdn string = containerApp.properties.configuration.ingress.fqdn
output principalId string = containerApp.identity.principalId
```

## Environment-Specific Values

```bicep
// Parameterize instead of hardcoding
var skuMap = {
  dev: 'B_Standard_B1ms'
  staging: 'GP_Standard_D2s_v3'
  prod: 'GP_Standard_D4s_v3'
}
sku: {
  name: skuMap[environment]
}

// Conditional deployment
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-05-01' = if (environment == 'prod') {
  name: '${name}-pe'
  // ...
}
```

## Secret Management

```bicep
// Get secrets from Key Vault, pass to @secure() params
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

## Naming Convention

```bicep
// Consistent abbreviation-prefixed names
var resourceNames = {
  resourceGroup: 'rg-${baseName}-${environment}'
  containerApp: 'ca-${baseName}-${environment}'
  keyVault: 'kv-${baseName}-${environment}'
  storageAccount: 'st${replace(baseName, '-', '')}${environment}'  // No hyphens
}
```

## Common Mistakes to Avoid

- ❌ Duplicating resource definitions in main.bicep → extract reusable modules
- ❌ Hardcoded environment-specific values (SKUs, locations) → parameterize with `@allowed` + variable maps
- ❌ Parameters without `@description` or constraints
- ❌ Secrets as plain parameters → mark with `@secure()` and source from Key Vault
- ❌ No outputs on modules → downstream modules can't reference IDs, FQDNs, principal IDs
- ❌ Deprecated API versions → use recent stable versions
