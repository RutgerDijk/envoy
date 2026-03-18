---
applyTo: '**/{*.bicep,appsettings*.json}'
---

# Azure PostgreSQL Best Practices

## Connection Configuration

```json
// appsettings.json — use Key Vault references in production
{
  "ConnectionStrings": {
    "DefaultConnection": "Host=myserver.postgres.database.azure.com;Database=myapp;Username=dbuser;Password={from-key-vault};Ssl Mode=Require;Trust Server Certificate=false"
  }
}
```

## Bicep — Flexible Server

```bicep
resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-03-01-preview' = {
  name: serverName
  location: location
  sku: {
    name: (environment == 'prod') ? 'Standard_D2ds_v4' : 'Standard_B1ms'
    tier: (environment == 'prod') ? 'GeneralPurpose' : 'Burstable'
  }
  properties: {
    version: '15'
    administratorLogin: adminUsername
    administratorLoginPassword: adminPassword
    highAvailability: {
      mode: (environment == 'prod') ? 'ZoneRedundant' : 'Disabled'
    }
    backup: {
      backupRetentionDays: (environment == 'prod') ? 14 : 7
      geoRedundantBackup: (environment == 'prod') ? 'Enabled' : 'Disabled'
    }
    storage: { storageSizeGB: 32 }
  }
}
```

## EF Core Configuration

```csharp
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(
        builder.Configuration.GetConnectionString("DefaultConnection"),
        npgsqlOptions => npgsqlOptions
            .MigrationsAssembly("Infrastructure")
            .EnableRetryOnFailure(maxRetryCount: 3, maxRetryDelay: TimeSpan.FromSeconds(5), null)
    )
);
```

## Common Mistakes to Avoid

- ❌ Allowing public internet access to the database → use private endpoints or VNet integration
- ❌ Admin credentials in appsettings.json → use managed identity or Key Vault
- ❌ No SSL requirement → always require SSL for Azure PostgreSQL
- ❌ Single-zone in production → use Zone Redundant HA for critical workloads
- ❌ No connection retry logic → use `EnableRetryOnFailure`
