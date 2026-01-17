# PostgreSQL Stack Profile

## Detection

```bash
# Detect PostgreSQL usage
grep -r "Npgsql\|PostgreSQL\|postgres" *.csproj appsettings*.json 2>/dev/null | head -1
```

## Best Practices

### Connection Configuration

```json
// appsettings.json
{
  "ConnectionStrings": {
    "DefaultConnection": "Host=localhost;Database=myapp;Username=user;Password=pass;Pooling=true;MinPoolSize=5;MaxPoolSize=100"
  }
}
```

### Indexing Strategy

```sql
-- Good: Index on frequently filtered columns
CREATE INDEX ix_users_email ON users (email);

-- Good: Composite index for common query patterns
CREATE INDEX ix_orders_user_status ON orders (user_id, status);

-- Good: Partial index for filtered queries
CREATE INDEX ix_active_users ON users (email) WHERE is_active = true;

-- Good: Include columns for covering index
CREATE INDEX ix_orders_user_covering ON orders (user_id) INCLUDE (total, created_at);
```

### Query Patterns

```sql
-- Good: Use EXPLAIN ANALYZE to verify performance
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 123;

-- Good: Limit results
SELECT * FROM orders WHERE user_id = 123 ORDER BY created_at DESC LIMIT 50;

-- Good: Use EXISTS instead of COUNT for existence check
SELECT EXISTS(SELECT 1 FROM users WHERE email = 'test@example.com');

-- Good: Use CTE for complex queries
WITH recent_orders AS (
    SELECT user_id, COUNT(*) as order_count
    FROM orders
    WHERE created_at > NOW() - INTERVAL '30 days'
    GROUP BY user_id
)
SELECT u.name, ro.order_count
FROM users u
JOIN recent_orders ro ON u.id = ro.user_id
WHERE ro.order_count > 5;
```

### Transaction Management

```csharp
// Good: Use transactions for related operations
await using var transaction = await _context.Database.BeginTransactionAsync(ct);
try
{
    await _context.Orders.AddAsync(order, ct);
    await _context.SaveChangesAsync(ct);

    await _inventoryService.DeductStockAsync(order.Items, ct);

    await transaction.CommitAsync(ct);
}
catch
{
    await transaction.RollbackAsync(ct);
    throw;
}
```

### Connection Pooling

```csharp
// Good: Configure pooling in connection string
"Host=localhost;Database=myapp;Pooling=true;MinPoolSize=5;MaxPoolSize=100;Connection Idle Lifetime=300"

// Good: Use DbContext pooling in DI
builder.Services.AddDbContextPool<AppDbContext>(options =>
    options.UseNpgsql(connectionString));
```

### JSON Operations

```sql
-- Good: Query JSONB data efficiently
SELECT * FROM products WHERE metadata->>'category' = 'electronics';

-- Good: Index JSONB properties
CREATE INDEX ix_products_category ON products ((metadata->>'category'));

-- Good: GIN index for complex JSONB queries
CREATE INDEX ix_products_metadata ON products USING GIN (metadata);
```

## Common Mistakes

### Mistake: N+1 Queries

```csharp
// Bad: Separate query for each user's orders
foreach (var user in users)
{
    var orders = await _context.Orders.Where(o => o.UserId == user.Id).ToListAsync();
}

// Good: Eager loading with Include
var users = await _context.Users
    .Include(u => u.Orders)
    .ToListAsync();

// Good: Single query with join
var usersWithOrders = await _context.Users
    .Select(u => new
    {
        User = u,
        Orders = u.Orders.Take(10).ToList()
    })
    .ToListAsync();
```

### Mistake: SELECT *

```sql
-- Bad: Fetching all columns
SELECT * FROM orders WHERE user_id = 123;

-- Good: Select only needed columns
SELECT id, total, status, created_at FROM orders WHERE user_id = 123;
```

### Mistake: Missing Index on Foreign Keys

```sql
-- Bad: FK without index (slow joins)
ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id);

-- Good: Add index with FK
CREATE INDEX ix_orders_user_id ON orders (user_id);
ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id);
```

### Mistake: LIKE with Leading Wildcard

```sql
-- Bad: Can't use index with leading wildcard
SELECT * FROM users WHERE email LIKE '%@example.com';

-- Good: Use trigram index for pattern matching
CREATE EXTENSION pg_trgm;
CREATE INDEX ix_users_email_trgm ON users USING GIN (email gin_trgm_ops);

-- Or: Reverse the pattern logic
SELECT * FROM users WHERE email_domain = 'example.com';
```

### Mistake: Not Using Prepared Statements

```csharp
// Bad: String concatenation (SQL injection risk)
var sql = $"SELECT * FROM users WHERE email = '{email}'";

// Good: Parameterized query
var users = await _context.Users
    .FromSqlInterpolated($"SELECT * FROM users WHERE email = {email}")
    .ToListAsync();

// Best: Use EF LINQ
var users = await _context.Users.Where(u => u.Email == email).ToListAsync();
```

### Mistake: Large IN Clauses

```sql
-- Bad: Huge IN clause
SELECT * FROM orders WHERE id IN (1, 2, 3, ... 10000);

-- Good: Use ANY with array
SELECT * FROM orders WHERE id = ANY(@ids);

-- Good: Use temporary table for very large lists
CREATE TEMP TABLE temp_ids (id INT);
INSERT INTO temp_ids SELECT unnest(@ids);
SELECT o.* FROM orders o JOIN temp_ids t ON o.id = t.id;
```

## Review Checklist

- [ ] Indexes exist on foreign keys
- [ ] Indexes exist on frequently filtered columns
- [ ] No N+1 query patterns
- [ ] EXPLAIN ANALYZE run on complex queries
- [ ] Connection pooling configured appropriately
- [ ] Transactions used for related operations
- [ ] Parameterized queries used (no SQL injection)
- [ ] SELECT only needed columns
- [ ] LIMIT used for large result sets
- [ ] JSONB indexes exist for queried properties

## Resources

- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Use The Index, Luke](https://use-the-index-luke.com/)
- [PostgreSQL Performance Tips](https://wiki.postgresql.org/wiki/Performance_Optimization)
