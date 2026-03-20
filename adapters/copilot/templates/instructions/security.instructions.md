---
applyTo: '**/*.{cs,ts,tsx}'
---

# Security Best Practices

## Input Validation

Always validate on the server — never trust client input:

```csharp
// C# — Data Annotations
public class CreateUserRequest
{
   [Required, EmailAddress, MaxLength(255)]
   public required string Email { get; init; }

   [Required, MaxLength(100), RegularExpression(@"^[\w\s\-']+$")]
   public required string Name { get; init; }

   [Required, MinLength(8)]
   public required string Password { get; init; }
}
```

```typescript
// TypeScript — Zod
const schema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(100),
});
```

## Authorization Checklist

Every API endpoint must have one of:

- `[Authorize]` — requires authentication
- `[Authorize(Policy = "...")]` — requires specific role/claim
- `[AllowAnonymous]` — explicitly public (document why)

Set a fallback policy so new endpoints are authenticated by default:

```csharp
options.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();
```

## SQL Injection Prevention

```csharp
// Good: parameterized (EF Core always does this)
var user = await context.Users.FirstOrDefaultAsync(u => u.Email == email, ct);

// Good: raw SQL with parameters
var users = await context.Database.SqlQuery<User>($"SELECT * FROM users WHERE id = {id}").ToListAsync();

// Bad: string concatenation
var query = $"SELECT * FROM users WHERE email = '{email}'"; // NEVER do this
```

## XSS Prevention (React)

React escapes values by default in JSX. Avoid:

```tsx
// Dangerous — allows XSS
<div dangerouslySetInnerHTML={{ __html: userContent }} />

// Safe — React escapes this
<div>{userContent}</div>
```

## Sensitive Data

```csharp
// Never log sensitive fields
_logger.LogInformation("User created: {Email}", user.Email);    // OK
_logger.LogInformation("Password: {Password}", user.Password); // NEVER

// Never return sensitive fields from APIs
public record UserDto(int Id, string Name, string Email);       // No PasswordHash field
```

## Security Headers

Configure in `staticwebapp.config.json` or middleware:

```json
"globalHeaders": {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
}
```

## Common Mistakes to Avoid

- ❌ Trusting user input without validation
- ❌ String concatenation for SQL
- ❌ Using `dangerouslySetInnerHTML` with user content
- ❌ Logging passwords, tokens, or PII
- ❌ Returning password hashes or internal IDs in API responses
- ❌ No authorization fallback policy → new endpoints are public by accident
