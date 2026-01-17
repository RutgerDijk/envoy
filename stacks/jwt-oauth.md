# JWT/OAuth Stack Profile

## Detection

```bash
# Detect JWT/OAuth usage
grep -E "JwtBearer|OAuth|OpenIdConnect" *.csproj **/*.csproj 2>/dev/null | head -1
```

## Best Practices

### JWT Authentication Setup

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
            ClockSkew = TimeSpan.FromMinutes(5)
        };

        options.Events = new JwtBearerEvents
        {
            OnAuthenticationFailed = context =>
            {
                if (context.Exception is SecurityTokenExpiredException)
                {
                    context.Response.Headers.Append("Token-Expired", "true");
                }
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("AdminOnly", policy =>
        policy.RequireClaim("role", "admin"));

    options.AddPolicy("CanManageUsers", policy =>
        policy.RequireClaim("permission", "users:manage"));
});
```

### Azure AD / Entra ID

```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApi(builder.Configuration.GetSection("AzureAd"));

// appsettings.json
{
  "AzureAd": {
    "Instance": "https://login.microsoftonline.com/",
    "TenantId": "your-tenant-id",
    "ClientId": "your-client-id",
    "Audience": "api://your-client-id"
  }
}
```

### Token Generation

```csharp
public class TokenService : ITokenService
{
    private readonly JwtSettings _settings;
    private readonly SigningCredentials _credentials;

    public TokenService(IOptions<JwtSettings> settings)
    {
        _settings = settings.Value;
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_settings.Secret));
        _credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
    }

    public string GenerateToken(User user)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Email, user.Email),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new("role", user.Role)
        };

        var token = new JwtSecurityToken(
            issuer: _settings.Issuer,
            audience: _settings.Audience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(_settings.ExpiryMinutes),
            signingCredentials: _credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public string GenerateRefreshToken()
    {
        var randomBytes = new byte[64];
        using var rng = RandomNumberGenerator.Create();
        rng.GetBytes(randomBytes);
        return Convert.ToBase64String(randomBytes);
    }
}
```

### Refresh Token Flow

```csharp
public class AuthController : ControllerBase
{
    [HttpPost("refresh")]
    public async Task<ActionResult<TokenResponse>> Refresh([FromBody] RefreshTokenRequest request)
    {
        var principal = GetPrincipalFromExpiredToken(request.AccessToken);
        var userId = principal.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;

        var storedToken = await _tokenRepository.GetRefreshTokenAsync(userId);

        if (storedToken is null ||
            storedToken.Token != request.RefreshToken ||
            storedToken.ExpiresAt < DateTime.UtcNow)
        {
            return Unauthorized("Invalid refresh token");
        }

        var user = await _userRepository.GetByIdAsync(int.Parse(userId!));
        var newAccessToken = _tokenService.GenerateToken(user!);
        var newRefreshToken = _tokenService.GenerateRefreshToken();

        await _tokenRepository.UpdateRefreshTokenAsync(userId!, newRefreshToken);

        return Ok(new TokenResponse(newAccessToken, newRefreshToken));
    }
}
```

### Claims-Based Authorization

```csharp
// Policy-based
[Authorize(Policy = "AdminOnly")]
public class AdminController : ControllerBase { }

// Role-based
[Authorize(Roles = "Admin,Manager")]
public class ManagementController : ControllerBase { }

// Custom requirement
public class MinimumAgeRequirement : IAuthorizationRequirement
{
    public int MinimumAge { get; }
    public MinimumAgeRequirement(int minimumAge) => MinimumAge = minimumAge;
}

public class MinimumAgeHandler : AuthorizationHandler<MinimumAgeRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        MinimumAgeRequirement requirement)
    {
        var birthDateClaim = context.User.FindFirst("birthdate");
        if (birthDateClaim is null) return Task.CompletedTask;

        var birthDate = DateTime.Parse(birthDateClaim.Value);
        var age = DateTime.Today.Year - birthDate.Year;

        if (age >= requirement.MinimumAge)
            context.Succeed(requirement);

        return Task.CompletedTask;
    }
}
```

## Common Mistakes

### Mistake: Secret Key in Code

```csharp
// Bad: Hardcoded secret
var key = new SymmetricSecurityKey(
    Encoding.UTF8.GetBytes("my-super-secret-key-12345"));

// Good: From configuration/environment
var key = new SymmetricSecurityKey(
    Encoding.UTF8.GetBytes(configuration["Jwt:Secret"]!));
```

### Mistake: Long-Lived Access Tokens

```csharp
// Bad: Token valid for days
expires: DateTime.UtcNow.AddDays(7)

// Good: Short-lived access token + refresh token
expires: DateTime.UtcNow.AddMinutes(15)
```

### Mistake: No Token Validation

```csharp
// Bad: Minimal validation
options.TokenValidationParameters = new TokenValidationParameters
{
    ValidateIssuer = false,
    ValidateAudience = false,
    ValidateLifetime = false
};

// Good: Full validation
options.TokenValidationParameters = new TokenValidationParameters
{
    ValidateIssuer = true,
    ValidateAudience = true,
    ValidateLifetime = true,
    ValidateIssuerSigningKey = true,
    ValidIssuer = configuration["Jwt:Issuer"],
    ValidAudience = configuration["Jwt:Audience"]
};
```

### Mistake: Storing Sensitive Data in Token

```csharp
// Bad: Sensitive data in claims
claims.Add(new Claim("password", user.Password));
claims.Add(new Claim("ssn", user.SocialSecurityNumber));

// Good: Only non-sensitive identifiers
claims.Add(new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()));
claims.Add(new Claim("role", user.Role));
```

### Mistake: No Refresh Token Rotation

```csharp
// Bad: Reuse refresh token
return Ok(new { AccessToken = newToken, RefreshToken = request.RefreshToken });

// Good: Rotate refresh token
var newRefreshToken = _tokenService.GenerateRefreshToken();
await _tokenRepository.UpdateRefreshTokenAsync(userId, newRefreshToken);
return Ok(new { AccessToken = newToken, RefreshToken = newRefreshToken });
```

### Mistake: Missing HTTPS Requirement

```csharp
// Bad: Allow HTTP
options.RequireHttpsMetadata = false;

// Good: Require HTTPS in production
options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();
```

## Review Checklist

- [ ] Secret key stored securely (not in code)
- [ ] Access tokens are short-lived (15-30 min)
- [ ] Refresh tokens are rotated on use
- [ ] Token validation parameters complete
- [ ] No sensitive data in token claims
- [ ] HTTPS required for token endpoints
- [ ] Authorization policies defined
- [ ] Token expiration handled gracefully
- [ ] Refresh tokens stored securely
- [ ] Clock skew configured appropriately

## Resources

- [ASP.NET Core Authentication](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/)
- [JWT.io](https://jwt.io/)
- [OAuth 2.0 Best Practices](https://oauth.net/2/)
