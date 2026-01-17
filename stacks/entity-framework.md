# Entity Framework Core Stack Profile

## Detection

```bash
# Detect EF Core
grep -E "Microsoft.EntityFrameworkCore" *.csproj **/*.csproj 2>/dev/null | head -1
```

## Best Practices

### DbContext Configuration

```csharp
public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<Order> Orders => Set<Order>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Apply all configurations from assembly
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);

        // Global query filters
        modelBuilder.Entity<User>().HasQueryFilter(u => !u.IsDeleted);
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        // Audit tracking
        foreach (var entry in ChangeTracker.Entries<IAuditable>())
        {
            if (entry.State == EntityState.Added)
                entry.Entity.CreatedAt = DateTime.UtcNow;
            if (entry.State == EntityState.Modified)
                entry.Entity.UpdatedAt = DateTime.UtcNow;
        }

        return base.SaveChangesAsync(cancellationToken);
    }
}
```

### Entity Configuration

```csharp
// Separate configuration files
public class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable("users");

        builder.HasKey(u => u.Id);

        builder.Property(u => u.Email)
            .IsRequired()
            .HasMaxLength(255);

        builder.HasIndex(u => u.Email)
            .IsUnique();

        builder.HasMany(u => u.Orders)
            .WithOne(o => o.User)
            .HasForeignKey(o => o.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Value conversion
        builder.Property(u => u.Status)
            .HasConversion<string>();
    }
}
```

### Migrations

```bash
# Create migration
dotnet ef migrations add InitialCreate --project src/Infrastructure --startup-project src/Api

# Apply migration
dotnet ef database update --project src/Infrastructure --startup-project src/Api

# Script for production
dotnet ef migrations script --idempotent --output migrate.sql
```

```csharp
// Apply migrations on startup (dev only)
if (app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync();
}
```

### Query Patterns

```csharp
// Good: Projection to DTO
public async Task<List<UserSummaryDto>> GetUserSummariesAsync(CancellationToken ct)
{
    return await _context.Users
        .Select(u => new UserSummaryDto(u.Id, u.Name, u.Email))
        .ToListAsync(ct);
}

// Good: Explicit loading when needed
public async Task<User?> GetUserWithOrdersAsync(int id, CancellationToken ct)
{
    return await _context.Users
        .Include(u => u.Orders.Where(o => o.Status == OrderStatus.Active))
        .FirstOrDefaultAsync(u => u.Id == id, ct);
}

// Good: Pagination
public async Task<PagedResult<User>> GetUsersPagedAsync(int page, int pageSize, CancellationToken ct)
{
    var query = _context.Users.AsNoTracking();

    var total = await query.CountAsync(ct);
    var items = await query
        .OrderBy(u => u.Name)
        .Skip((page - 1) * pageSize)
        .Take(pageSize)
        .ToListAsync(ct);

    return new PagedResult<User>(items, total, page, pageSize);
}
```

### Repository Pattern (Optional)

```csharp
public interface IRepository<T> where T : class
{
    Task<T?> GetByIdAsync(int id, CancellationToken ct = default);
    Task<List<T>> GetAllAsync(CancellationToken ct = default);
    Task AddAsync(T entity, CancellationToken ct = default);
    void Update(T entity);
    void Remove(T entity);
}

public class Repository<T> : IRepository<T> where T : class
{
    protected readonly AppDbContext _context;
    protected readonly DbSet<T> _dbSet;

    public Repository(AppDbContext context)
    {
        _context = context;
        _dbSet = context.Set<T>();
    }

    public virtual async Task<T?> GetByIdAsync(int id, CancellationToken ct = default)
        => await _dbSet.FindAsync([id], ct);

    public virtual async Task<List<T>> GetAllAsync(CancellationToken ct = default)
        => await _dbSet.ToListAsync(ct);

    public virtual async Task AddAsync(T entity, CancellationToken ct = default)
        => await _dbSet.AddAsync(entity, ct);

    public virtual void Update(T entity)
        => _dbSet.Update(entity);

    public virtual void Remove(T entity)
        => _dbSet.Remove(entity);
}
```

## Common Mistakes

### Mistake: N+1 Queries

```csharp
// Bad: Lazy loading causes N+1
var users = await _context.Users.ToListAsync();
foreach (var user in users)
{
    var orderCount = user.Orders.Count; // Each access queries DB!
}

// Good: Eager loading
var users = await _context.Users
    .Include(u => u.Orders)
    .ToListAsync();

// Better: Project only what you need
var userOrders = await _context.Users
    .Select(u => new { u.Name, OrderCount = u.Orders.Count })
    .ToListAsync();
```

### Mistake: Tracking Unnecessary Entities

```csharp
// Bad: Tracking read-only queries
var users = await _context.Users.ToListAsync();

// Good: No tracking for read operations
var users = await _context.Users.AsNoTracking().ToListAsync();
```

### Mistake: Loading Entire Entities

```csharp
// Bad: Load entire entity when you need one property
var user = await _context.Users.FirstOrDefaultAsync(u => u.Id == id);
return user?.Email;

// Good: Project to what you need
return await _context.Users
    .Where(u => u.Id == id)
    .Select(u => u.Email)
    .FirstOrDefaultAsync();
```

### Mistake: Include Without Filter

```csharp
// Bad: Include loads ALL related data
var user = await _context.Users
    .Include(u => u.Orders)  // All orders ever!
    .FirstOrDefaultAsync(u => u.Id == id);

// Good: Filter the Include
var user = await _context.Users
    .Include(u => u.Orders.Where(o => o.CreatedAt > DateTime.UtcNow.AddMonths(-1)))
    .FirstOrDefaultAsync(u => u.Id == id);
```

### Mistake: Not Using Transactions

```csharp
// Bad: Partial updates on failure
await _context.Users.AddAsync(user);
await _context.SaveChangesAsync();
await _emailService.SendWelcomeEmail(user.Email); // If this fails...
await _context.SaveChangesAsync();

// Good: Transaction for atomicity
await using var transaction = await _context.Database.BeginTransactionAsync();
try
{
    await _context.Users.AddAsync(user);
    await _context.SaveChangesAsync();
    await _emailService.SendWelcomeEmail(user.Email);
    await transaction.CommitAsync();
}
catch
{
    await transaction.RollbackAsync();
    throw;
}
```

### Mistake: String Interpolation in Queries

```csharp
// Bad: SQL injection risk
var users = await _context.Users
    .FromSqlRaw($"SELECT * FROM users WHERE email = '{email}'")
    .ToListAsync();

// Good: Parameterized queries
var users = await _context.Users
    .FromSqlInterpolated($"SELECT * FROM users WHERE email = {email}")
    .ToListAsync();
```

## Review Checklist

- [ ] AsNoTracking() used for read-only queries
- [ ] Projections used instead of full entities
- [ ] Include() filtered to limit data
- [ ] No N+1 query patterns
- [ ] Transactions used for multi-operation changes
- [ ] Migrations are idempotent
- [ ] Entity configurations in separate files
- [ ] Indexes defined for query patterns
- [ ] Soft delete uses global query filters
- [ ] Audit fields auto-populated

## Resources

- [EF Core Documentation](https://learn.microsoft.com/en-us/ef/core/)
- [Performance Tips](https://learn.microsoft.com/en-us/ef/core/performance/)
- [Complex Query Operators](https://learn.microsoft.com/en-us/ef/core/querying/complex-query-operators)
