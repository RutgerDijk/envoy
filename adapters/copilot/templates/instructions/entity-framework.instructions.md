---
applyTo: '**/{*DbContext.cs,*DbContext.cs,Migrations/**,*Configuration.cs}'
---

# Entity Framework Core Best Practices

## DbContext

```csharp
public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
        // Global soft-delete filter
        modelBuilder.Entity<User>().HasQueryFilter(u => !u.IsDeleted);
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        foreach (var entry in ChangeTracker.Entries<IAuditable>())
        {
            if (entry.State == EntityState.Added) entry.Entity.CreatedAt = DateTime.UtcNow;
            if (entry.State == EntityState.Modified) entry.Entity.UpdatedAt = DateTime.UtcNow;
        }
        return base.SaveChangesAsync(cancellationToken);
    }
}
```

## Entity Configuration (separate files)

```csharp
public class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable("users");
        builder.Property(u => u.Email).IsRequired().HasMaxLength(255);
        builder.HasIndex(u => u.Email).IsUnique();
        // Store enums as strings
        builder.Property(u => u.Status).HasConversion<string>();
    }
}
```

## Migrations

```bash
# Add migration
dotnet ef migrations add <MigrationName> --project src/Infrastructure --startup-project src/Api

# Apply migrations
dotnet ef database update --project src/Infrastructure --startup-project src/Api
```

Apply migrations at startup:
```csharp
using var scope = app.Services.CreateScope();
await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
```

## Query Patterns

```csharp
// Good: Select only needed columns
var names = await context.Users.Select(u => u.Name).ToListAsync(ct);

// Good: Avoid N+1 — include related data explicitly
var orders = await context.Orders
    .Include(o => o.Lines)
    .ThenInclude(l => l.Product)
    .Where(o => o.UserId == userId)
    .ToListAsync(ct);

// Good: AsNoTracking for read-only queries
var users = await context.Users.AsNoTracking().ToListAsync(ct);
```

## Common Mistakes to Avoid

- ❌ Loading full entities when only a few columns are needed → use `.Select()`
- ❌ N+1 queries → use `.Include()` or project with `.Select()`
- ❌ Calling `SaveChangesAsync` in a loop → batch changes, save once
- ❌ Using `Find()` when you need filtering → use `FirstOrDefaultAsync()`
- ❌ Migration in wrong project → always specify `--project` and `--startup-project`
