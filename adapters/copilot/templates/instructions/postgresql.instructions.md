---
applyTo: '**/{*.sql,appsettings*.json}'
---

# PostgreSQL Best Practices

## Indexing Strategy

```sql
-- Index on frequently filtered columns
CREATE INDEX ix_users_email ON users (email);

-- Composite index for common query patterns
CREATE INDEX ix_orders_user_status ON orders (user_id, status);

-- Partial index — only indexes active records
CREATE INDEX ix_active_users ON users (email) WHERE is_active = true;

-- Covering index — avoids table lookup
CREATE INDEX ix_orders_covering ON orders (user_id) INCLUDE (total, created_at);
```

## Connection String (production)

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Host=server;Database=db;Username=user;Password=pass;Ssl Mode=Require;Pooling=true;MinPoolSize=2;MaxPoolSize=100;Connection Idle Lifetime=300"
  }
}
```

## Query Patterns

```sql
-- Use EXPLAIN ANALYZE to verify query plan
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 123;

-- Limit results — never fetch unbounded
SELECT id, name FROM users ORDER BY created_at DESC LIMIT 50 OFFSET 0;

-- EXISTS instead of COUNT for existence checks
SELECT EXISTS(SELECT 1 FROM users WHERE email = 'test@example.com');

-- Use CTEs for readable complex queries
WITH active_users AS (
  SELECT id FROM users WHERE is_active = true AND last_login > NOW() - INTERVAL '30 days'
)
SELECT o.* FROM orders o INNER JOIN active_users u ON o.user_id = u.id;
```

## Naming Conventions

- Tables: `snake_case` plural (`users`, `order_lines`)
- Columns: `snake_case` (`created_at`, `user_id`)
- Indexes: `ix_<table>_<columns>` (`ix_users_email`)
- Foreign keys: `fk_<table>_<referenced>` (`fk_orders_users`)

## Common Mistakes to Avoid

- ❌ `SELECT *` in production queries → specify columns explicitly
- ❌ No index on foreign keys → JOIN performance degrades with data growth
- ❌ `NOT IN` with subqueries → use `NOT EXISTS` (handles NULLs correctly)
- ❌ `LIKE '%value%'` without a full-text index → full table scan
- ❌ Transactions without `COMMIT`/`ROLLBACK` → connection holds locks indefinitely
