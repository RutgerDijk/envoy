# Azure Database for PostgreSQL Stack Profile

## Detection

```bash
# Detect Azure PostgreSQL
find . -name "*.bicep" -exec grep -l "flexibleServers" {} \; 2>/dev/null | head -1
```

## Best Practices

### Bicep Configuration

```bicep
resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-03-01-preview' = {
  name: serverName
  location: location
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    version: '16'
    administratorLogin: adminUsername
    administratorLoginPassword: adminPassword
    storage: {
      storageSizeGB: storageSizeGB
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: environment == 'prod' ? 35 : 7
      geoRedundantBackup: environment == 'prod' ? 'Enabled' : 'Disabled'
    }
    highAvailability: {
      mode: environment == 'prod' ? 'ZoneRedundant' : 'Disabled'
    }
    maintenanceWindow: {
      customWindow: 'Enabled'
      dayOfWeek: 0  // Sunday
      startHour: 2
      startMinute: 0
    }
  }
}

// Database
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-03-01-preview' = {
  parent: postgresServer
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Firewall rule for Azure services
resource firewallRule 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-03-01-preview' = {
  parent: postgresServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// Private endpoint for production
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-05-01' = if (environment == 'prod') {
  name: '${serverName}-pe'
  location: location
  properties: {
    subnet: {
      id: subnetId
    }
    privateLinkServiceConnections: [
      {
        name: '${serverName}-plsc'
        properties: {
          privateLinkServiceId: postgresServer.id
          groupIds: ['postgresqlServer']
        }
      }
    ]
  }
}
```

### SKU Selection

| Environment | SKU | Description |
|------------|-----|-------------|
| Development | B_Standard_B1ms | Burstable, 1 vCore, 2GB RAM |
| Staging | GP_Standard_D2s_v3 | General Purpose, 2 vCores |
| Production | GP_Standard_D4s_v3 | General Purpose, 4 vCores |
| High Load | MO_Standard_E4s_v3 | Memory Optimized, 4 vCores |

```bicep
var skuConfig = {
  dev: { name: 'B_Standard_B1ms', tier: 'Burstable' }
  staging: { name: 'GP_Standard_D2s_v3', tier: 'GeneralPurpose' }
  prod: { name: 'GP_Standard_D4s_v3', tier: 'GeneralPurpose' }
}
```

### Connection String Configuration

```csharp
// appsettings.json
{
  "ConnectionStrings": {
    "DefaultConnection": "Host=myserver.postgres.database.azure.com;Database=mydb;Username=admin;Password=xxx;SSL Mode=Require;Trust Server Certificate=true"
  }
}

// With Managed Identity
{
  "ConnectionStrings": {
    "DefaultConnection": "Host=myserver.postgres.database.azure.com;Database=mydb;Username=myapp-identity;SSL Mode=Require;Trust Server Certificate=true"
  }
}
```

### Managed Identity Access

```bicep
// Grant Container App access to PostgreSQL
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

```csharp
// Use DefaultAzureCredential in code
var credential = new DefaultAzureCredential();
var token = await credential.GetTokenAsync(
    new TokenRequestContext(["https://ossrdbms-aad.database.windows.net/.default"]));

var connectionString = $"Host={host};Database={database};Username={username};Password={token.Token};SSL Mode=Require";
```

### Performance Configuration

```bicep
// Server parameters for performance
resource pgConfig 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2023-03-01-preview' = [for param in [
  { name: 'shared_buffers', value: '256MB' }
  { name: 'work_mem', value: '64MB' }
  { name: 'maintenance_work_mem', value: '512MB' }
  { name: 'effective_cache_size', value: '1GB' }
  { name: 'log_min_duration_statement', value: '1000' }  // Log queries > 1s
]: {
  parent: postgresServer
  name: param.name
  properties: {
    value: param.value
    source: 'user-override'
  }
}]
```

## Common Mistakes

### Mistake: No High Availability in Production

```bicep
// Bad: Single instance in production
highAvailability: {
  mode: 'Disabled'
}

// Good: Zone redundant for production
highAvailability: {
  mode: environment == 'prod' ? 'ZoneRedundant' : 'Disabled'
}
```

### Mistake: Public Access in Production

```bicep
// Bad: Public access enabled
firewallRules: [
  { startIpAddress: '0.0.0.0', endIpAddress: '255.255.255.255' }
]

// Good: Private endpoint + Azure services only
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-05-01' = {
  // Private endpoint configuration
}

resource firewallRule 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-03-01-preview' = {
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'  // Only Azure services
  }
}
```

### Mistake: No Backup Geo-Redundancy

```bicep
// Bad: Local backup only
backup: {
  backupRetentionDays: 7
  geoRedundantBackup: 'Disabled'
}

// Good: Geo-redundant for production
backup: {
  backupRetentionDays: environment == 'prod' ? 35 : 7
  geoRedundantBackup: environment == 'prod' ? 'Enabled' : 'Disabled'
}
```

### Mistake: Password in Connection String

```csharp
// Bad: Password stored in config
"ConnectionStrings": {
  "DefaultConnection": "Host=x;Password=mysecret"
}

// Good: Use Key Vault reference or Managed Identity
"ConnectionStrings": {
  "DefaultConnection": "@Microsoft.KeyVault(SecretUri=https://myvault.vault.azure.net/secrets/db-connection)"
}
```

### Mistake: Wrong SSL Mode

```csharp
// Bad: SSL disabled (data in transit unencrypted)
"Host=myserver;SSL Mode=Disable"

// Good: Require SSL
"Host=myserver;SSL Mode=Require;Trust Server Certificate=true"
```

### Mistake: Undersized Storage

```bicep
// Bad: Start too small, causes performance issues
storage: {
  storageSizeGB: 32
  autoGrow: 'Disabled'
}

// Good: Appropriate size with auto-grow
storage: {
  storageSizeGB: environment == 'prod' ? 256 : 64
  autoGrow: 'Enabled'
}
```

## Review Checklist

- [ ] High availability enabled for production
- [ ] Private endpoint used (no public access)
- [ ] Geo-redundant backups for production
- [ ] SSL required in connection strings
- [ ] Managed identity used (not passwords)
- [ ] Appropriate SKU for workload
- [ ] Auto-grow enabled for storage
- [ ] Maintenance window configured
- [ ] Query logging enabled (slow queries)
- [ ] Performance parameters tuned

## Resources

- [Azure PostgreSQL Flexible Server](https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/)
- [High Availability](https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-high-availability)
- [Security Best Practices](https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-security)
