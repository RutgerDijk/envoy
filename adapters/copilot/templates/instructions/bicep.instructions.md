---
applyTo: '**/*.bicep'
---

# Bicep Best Practices

## Project Structure

```
infra/
├── main.bicep              # Orchestrator — calls all modules
├── main.bicepparam         # Default parameters
├── modules/
│   ├── container-app.bicep
│   ├── database.bicep
│   └── keyvault.bicep
└── parameters/
    ├── dev.bicepparam
    ├── staging.bicepparam
    └── prod.bicepparam
```

## Module Pattern

```bicep
// modules/container-app.bicep
@description('Environment (dev, staging, prod)')
@allowed(['dev', 'staging', 'prod'])
param environment string

@description('Container image with tag')
param image string

// Use targetScope = 'resourceGroup' (default) for resources
// Use targetScope = 'subscription' for resource groups and policies
```

## Parameter Conventions

```bicep
// Always add @description
@description('The name of the application')
param appName string

// Use @allowed for constrained values
@allowed(['dev', 'staging', 'prod'])
param environment string

// Use @minLength/@maxLength for strings
@minLength(3)
@maxLength(24)
param storageAccountName string

// Default to dev-safe values
param minReplicas int = 0    // Scale to zero in dev
```

## Naming

Use a consistent naming function, e.g.:

```bicep
var prefix = '${appName}-${environment}'
var apiName = '${prefix}-api'
var dbName = '${prefix}-db'
```

## Common Mistakes to Avoid

- ❌ Hardcoded secrets in Bicep → use Key Vault `getSecret()` or `@secure()` parameters
- ❌ No `@description` on parameters → makes the template hard to use
- ❌ Production and dev sharing the same module without environment-based conditionals
- ❌ Using `existing` without specifying the correct scope
- ❌ Deploying without `what-if` in production → always preview changes first:
  ```bash
  az deployment group what-if --resource-group rg-myapp-prod --template-file infra/main.bicep
  ```
