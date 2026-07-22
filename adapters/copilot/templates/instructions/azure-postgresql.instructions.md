---
applyTo: '**/*.bicep'
---

# Azure PostgreSQL Best Practices

## Flexible Server Configuration

```bicep
resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-03-01-preview' = {
  name: serverName
  location: location
  sku: { name: skuName, tier: skuTier }
  properties: {
    version: '16'
    storage: {
      storageSizeGB: environment == 'prod' ? 256 : 64
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: environment == 'prod' ? 35 : 7
      geoRedundantBackup: environment == 'prod' ? 'Enabled' : 'Disabled'
    }
    highAvailability: {
      mode: environment == 'prod' ? 'ZoneRedundant' : 'Disabled'
    }
    maintenanceWindow: { customWindow: 'Enabled', dayOfWeek: 0, startHour: 2, startMinute: 0 }
  }
}
```

## Network Access

Use a private endpoint for production; the `0.0.0.0` firewall rule allows Azure services only.

```bicep
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-05-01' = if (environment == 'prod') {
  name: '${serverName}-pe'
  location: location
  properties: {
    subnet: { id: subnetId }
    privateLinkServiceConnections: [
      {
        name: '${serverName}-plsc'
        properties: { privateLinkServiceId: postgresServer.id, groupIds: ['postgresqlServer'] }
      }
    ]
  }
}
```

## SKU Selection

| Environment | SKU | Description |
|------------|-----|-------------|
| Development | B_Standard_B1ms | Burstable, 1 vCore, 2GB RAM |
| Staging | GP_Standard_D2s_v3 | General Purpose, 2 vCores |
| Production | GP_Standard_D4s_v3 | General Purpose, 4 vCores |
| High Load | MO_Standard_E4s_v3 | Memory Optimized, 4 vCores |

## Managed Identity Access

Prefer Entra ID authentication over passwords in connection strings.

```bicep
resource postgresAdmin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2023-03-01-preview' = {
  parent: postgresServer
  name: containerApp.identity.principalId
  properties: {
    principalName: containerApp.name
    principalType: 'ServicePrincipal'
    tenantId: subscription().tenantId
  }
}
```

Grant access to the app's identity in Bicep, then connect with a token from `DefaultAzureCredential` instead of a stored password.

## Common Mistakes to Avoid

- ❌ `highAvailability: { mode: 'Disabled' }` in production → use `ZoneRedundant`
- ❌ Firewall rule `0.0.0.0`–`255.255.255.255` (public access) → private endpoint plus Azure-services-only rule
- ❌ `geoRedundantBackup: 'Disabled'` in production → enable geo-redundant backups with 35-day retention
- ❌ Passwords in connection strings or config → managed identity, or a Key Vault secret reference
- ❌ `SSL Mode=Disable` in connection strings → `SSL Mode=Require`
- ❌ Undersized storage with `autoGrow: 'Disabled'` → size for the environment and enable auto-grow
- ❌ No maintenance window → configure a custom window in off-peak hours
- ❌ No slow-query logging → set `log_min_duration_statement` via server configuration parameters
