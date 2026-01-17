# Security Stack Profile

## Detection

```bash
# Always applicable to web applications
echo "security"
```

## Best Practices

### Input Validation

```csharp
// Server-side validation
public class CreateUserRequestValidator : AbstractValidator<CreateUserRequest>
{
    public CreateUserRequestValidator()
    {
        RuleFor(x => x.Email)
            .NotEmpty()
            .EmailAddress()
            .MaximumLength(255);

        RuleFor(x => x.Name)
            .NotEmpty()
            .MaximumLength(100)
            .Matches(@"^[\w\s\-']+$"); // Alphanumeric only

        RuleFor(x => x.Password)
            .NotEmpty()
            .MinimumLength(8)
            .Must(HaveStrongPassword);
    }

    private bool HaveStrongPassword(string password) =>
        password.Any(char.IsUpper) &&
        password.Any(char.IsLower) &&
        password.Any(char.IsDigit);
}
```

```typescript
// Client-side validation (Zod)
const schema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(100).regex(/^[\w\s\-']+$/),
  password: z.string()
    .min(8)
    .regex(/[A-Z]/, "Must contain uppercase")
    .regex(/[a-z]/, "Must contain lowercase")
    .regex(/[0-9]/, "Must contain number"),
});
```

### SQL Injection Prevention

```csharp
// Good: Parameterized queries with EF
var users = await _context.Users
    .Where(u => u.Email == email)
    .ToListAsync();

// Good: Raw SQL with parameters
var users = await _context.Users
    .FromSqlInterpolated($"SELECT * FROM users WHERE email = {email}")
    .ToListAsync();

// BAD: String concatenation
var users = await _context.Users
    .FromSqlRaw($"SELECT * FROM users WHERE email = '{email}'") // VULNERABLE!
    .ToListAsync();
```

### XSS Prevention

```typescript
// React auto-escapes by default
<p>{userInput}</p> // Safe - escaped

// Dangerous: Only use when content is trusted
<div dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />

// Sanitize if HTML is needed
import DOMPurify from "dompurify";
const clean = DOMPurify.sanitize(dirtyHtml);
```

```csharp
// Content Security Policy
app.Use(async (context, next) =>
{
    context.Response.Headers.Append(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
    await next();
});
```

### CSRF Protection

```csharp
// ASP.NET Core anti-forgery
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-XSRF-TOKEN";
});

[HttpPost]
[ValidateAntiForgeryToken]
public async Task<IActionResult> UpdateUser(UpdateUserRequest request)
```

```typescript
// Include CSRF token in requests
const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

fetch('/api/users', {
  method: 'POST',
  headers: {
    'X-XSRF-TOKEN': csrfToken,
  },
});
```

### Authentication Security

```csharp
// Password hashing
public class PasswordService
{
    public string HashPassword(string password)
    {
        return BCrypt.Net.BCrypt.HashPassword(password, workFactor: 12);
    }

    public bool VerifyPassword(string password, string hash)
    {
        return BCrypt.Net.BCrypt.Verify(password, hash);
    }
}

// Rate limiting on auth endpoints
builder.Services.AddRateLimiter(options =>
{
    options.AddFixedWindowLimiter("auth", config =>
    {
        config.PermitLimit = 5;
        config.Window = TimeSpan.FromMinutes(1);
    });
});

[EnableRateLimiting("auth")]
[HttpPost("login")]
public async Task<IActionResult> Login(LoginRequest request)
```

### Secrets Management

```csharp
// Good: Environment variables or Key Vault
var connectionString = Environment.GetEnvironmentVariable("DB_CONNECTION");

// Good: User secrets in development
// dotnet user-secrets set "DbConnection" "..."

// Good: Azure Key Vault in production
builder.Configuration.AddAzureKeyVault(
    new Uri($"https://{vaultName}.vault.azure.net/"),
    new DefaultAzureCredential());

// BAD: Hardcoded secrets
var apiKey = "sk-1234567890abcdef"; // NEVER DO THIS
```

### HTTPS Enforcement

```csharp
// Program.cs
if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}
app.UseHttpsRedirection();

// Force HTTPS in production
builder.Services.AddHttpsRedirection(options =>
{
    options.RedirectStatusCode = StatusCodes.Status307TemporaryRedirect;
    options.HttpsPort = 443;
});
```

### CORS Configuration

```csharp
builder.Services.AddCors(options =>
{
    options.AddPolicy("Production", policy =>
    {
        policy.WithOrigins("https://myapp.com")
              .AllowedMethods("GET", "POST", "PUT", "DELETE")
              .AllowedHeaders("Content-Type", "Authorization")
              .AllowCredentials();
    });
});

// BAD: Allow all origins
policy.AllowAnyOrigin(); // NEVER in production
```

### Security Headers

```csharp
app.Use(async (context, next) =>
{
    var headers = context.Response.Headers;

    // Prevent clickjacking
    headers.Append("X-Frame-Options", "DENY");

    // Prevent MIME sniffing
    headers.Append("X-Content-Type-Options", "nosniff");

    // XSS protection (legacy browsers)
    headers.Append("X-XSS-Protection", "1; mode=block");

    // Referrer policy
    headers.Append("Referrer-Policy", "strict-origin-when-cross-origin");

    // Content Security Policy
    headers.Append("Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");

    await next();
});
```

## Common Mistakes

### Mistake: Logging Sensitive Data

```csharp
// Bad: Logging passwords or tokens
_logger.LogInformation("User login: {Email} {Password}", email, password);

// Good: Never log sensitive data
_logger.LogInformation("User login attempt: {Email}", email);
```

### Mistake: Exposing Stack Traces

```csharp
// Bad: Stack traces in production
app.UseDeveloperExceptionPage(); // Development only!

// Good: Generic error in production
app.UseExceptionHandler("/error");
```

### Mistake: Insecure Direct Object Reference

```csharp
// Bad: No authorization check
[HttpGet("{id}")]
public async Task<ActionResult<Order>> GetOrder(int id)
{
    return await _context.Orders.FindAsync(id); // Anyone can access any order!
}

// Good: Verify ownership
[HttpGet("{id}")]
public async Task<ActionResult<Order>> GetOrder(int id)
{
    var userId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
    var order = await _context.Orders
        .Where(o => o.Id == id && o.UserId == userId)
        .FirstOrDefaultAsync();

    return order is null ? NotFound() : Ok(order);
}
```

### Mistake: Mass Assignment

```csharp
// Bad: Binding directly to entity
[HttpPost]
public async Task<ActionResult<User>> CreateUser(User user)
{
    user.IsAdmin = true; // Attacker can set this!
    await _context.Users.AddAsync(user);
}

// Good: Use DTOs with explicit properties
public record CreateUserRequest(string Name, string Email); // No IsAdmin

[HttpPost]
public async Task<ActionResult<User>> CreateUser(CreateUserRequest request)
{
    var user = new User { Name = request.Name, Email = request.Email };
    await _context.Users.AddAsync(user);
}
```

### Mistake: Weak Session Configuration

```csharp
// Bad: Insecure cookies
builder.Services.AddSession(options =>
{
    options.Cookie.HttpOnly = false;
    options.Cookie.SecurePolicy = CookieSecurePolicy.None;
});

// Good: Secure session cookies
builder.Services.AddSession(options =>
{
    options.Cookie.HttpOnly = true;
    options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.IdleTimeout = TimeSpan.FromMinutes(30);
});
```

## Review Checklist

- [ ] Input validated server-side (not just client)
- [ ] Parameterized queries used (no SQL injection)
- [ ] Output encoded/escaped (no XSS)
- [ ] CSRF tokens validated
- [ ] Passwords hashed with bcrypt/argon2
- [ ] Rate limiting on auth endpoints
- [ ] Secrets in environment/Key Vault (not code)
- [ ] HTTPS enforced
- [ ] CORS restricted to allowed origins
- [ ] Security headers configured
- [ ] Authorization checks on all endpoints
- [ ] DTOs used (no mass assignment)
- [ ] Sensitive data not logged

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [ASP.NET Core Security](https://learn.microsoft.com/en-us/aspnet/core/security/)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)
