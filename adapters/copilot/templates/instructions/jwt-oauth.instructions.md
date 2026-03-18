---
applyTo: '**/{*Auth*,*Jwt*,*Token*,*Permission*,*Authorization*}.cs'
---

# JWT / OAuth Best Practices

## JWT Bearer Setup

```csharp
// Program.cs
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority = builder.Configuration["Auth:Authority"];
        options.Audience = builder.Configuration["Auth:Audience"];
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ClockSkew = TimeSpan.FromMinutes(5),
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("AdminOnly", policy => policy.RequireRole("admin"));
    options.AddPolicy("CanManageUsers", policy => policy.RequireClaim("permission", "users:manage"));
    // Fallback: require auth on all endpoints by default
    options.FallbackPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build();
});
```

## Authorization on Controllers

```csharp
[Authorize]                           // Requires authentication
[Authorize(Policy = "AdminOnly")]     // Requires admin role
[AllowAnonymous]                       // Explicitly public
```

## Extract User Claims

```csharp
// Extension method for clean claim extraction
public static class ClaimsPrincipalExtensions
{
    public static int GetUserId(this ClaimsPrincipal user)
    {
        var claim = user.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? throw new InvalidOperationException("User ID claim not found");
        return int.Parse(claim);
    }
}

// In controller
var userId = User.GetUserId();
```

## Common Mistakes to Avoid

- ❌ No fallback authorization policy → new endpoints are unauthenticated by default
- ❌ Storing tokens in `localStorage` → use `httpOnly` cookies for SPAs (XSS resistant)
- ❌ Long-lived access tokens → keep them short (15 min), use refresh tokens
- ❌ `ClockSkew = TimeSpan.Zero` → causes clock-drift failures; use 5 minutes
- ❌ Role checks in code with string literals → extract to constants or a policy
- ❌ Trusting claims without scope validation → always validate `audience` and `issuer`
