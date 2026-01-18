# OpenAPI / Swagger Stack Profile

## Detection

```bash
# Detect Swashbuckle/OpenAPI
grep -E "Swashbuckle|OpenApi|AddSwaggerGen" **/*.cs **/*.csproj 2>/dev/null | head -1
```

## Best Practices

### Basic Setup

```csharp
// Program.cs
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "My API",
        Version = "v1",
        Description = "API for managing resources",
        Contact = new OpenApiContact
        {
            Name = "API Support",
            Email = "support@example.com"
        }
    });
});

// Enable in development
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(options =>
    {
        options.SwaggerEndpoint("/swagger/v1/swagger.json", "My API v1");
        options.RoutePrefix = "swagger";
    });
}
```

### XML Documentation

```csharp
// Program.cs - Include XML comments
builder.Services.AddSwaggerGen(options =>
{
    var xmlFile = $"{Assembly.GetExecutingAssembly().GetName().Name}.xml";
    var xmlPath = Path.Combine(AppContext.BaseDirectory, xmlFile);
    options.IncludeXmlComments(xmlPath);
});

// .csproj - Enable XML documentation
<PropertyGroup>
    <GenerateDocumentationFile>true</GenerateDocumentationFile>
    <NoWarn>$(NoWarn);1591</NoWarn> <!-- Suppress missing XML comment warnings -->
</PropertyGroup>
```

### JWT Authentication

```csharp
builder.Services.AddSwaggerGen(options =>
{
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Enter your JWT token"
    });

    options.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference
                {
                    Type = ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });
});
```

### API Versioning with Swagger

```csharp
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo { Title = "My API", Version = "v1" });
    options.SwaggerDoc("v2", new OpenApiInfo { Title = "My API", Version = "v2" });
});

app.UseSwaggerUI(options =>
{
    options.SwaggerEndpoint("/swagger/v1/swagger.json", "My API v1");
    options.SwaggerEndpoint("/swagger/v2/swagger.json", "My API v2");
});
```

### Endpoint Documentation

```csharp
/// <summary>
/// Gets all users with optional filtering.
/// </summary>
/// <param name="filter">Optional filter parameters</param>
/// <param name="cancellationToken">Cancellation token</param>
/// <returns>Paginated list of users</returns>
/// <response code="200">Returns the list of users</response>
/// <response code="401">Unauthorized - invalid or missing token</response>
[HttpGet]
[ProducesResponseType(typeof(PagedResult<UserDto>), StatusCodes.Status200OK)]
[ProducesResponseType(StatusCodes.Status401Unauthorized)]
public async Task<ActionResult<PagedResult<UserDto>>> GetUsers(
    [FromQuery] UserFilter filter,
    CancellationToken cancellationToken)
{
    return Ok(await _userService.GetUsersAsync(filter, cancellationToken));
}

/// <summary>
/// Creates a new user.
/// </summary>
/// <param name="request">User creation request</param>
/// <returns>The created user</returns>
/// <response code="201">User created successfully</response>
/// <response code="400">Invalid request data</response>
/// <response code="409">User with email already exists</response>
[HttpPost]
[ProducesResponseType(typeof(UserDto), StatusCodes.Status201Created)]
[ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
[ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
public async Task<ActionResult<UserDto>> CreateUser(
    [FromBody] CreateUserRequest request)
{
    var user = await _userService.CreateUserAsync(request);
    return CreatedAtAction(nameof(GetUser), new { id = user.Id }, user);
}
```

### Schema Examples

```csharp
/// <summary>
/// Request to create a new user.
/// </summary>
public record CreateUserRequest
{
    /// <summary>
    /// User's full name.
    /// </summary>
    /// <example>John Doe</example>
    [Required]
    [StringLength(100, MinimumLength = 2)]
    public required string Name { get; init; }

    /// <summary>
    /// User's email address.
    /// </summary>
    /// <example>john.doe@example.com</example>
    [Required]
    [EmailAddress]
    public required string Email { get; init; }

    /// <summary>
    /// User's role in the system.
    /// </summary>
    /// <example>User</example>
    public UserRole Role { get; init; } = UserRole.User;
}
```

### Custom Schema Filters

```csharp
// Hide internal properties from documentation
public class HideInternalPropertiesFilter : ISchemaFilter
{
    public void Apply(OpenApiSchema schema, SchemaFilterContext context)
    {
        var excludedProperties = context.Type.GetProperties()
            .Where(p => p.GetCustomAttribute<InternalAttribute>() != null)
            .Select(p => p.Name.ToCamelCase());

        foreach (var prop in excludedProperties)
        {
            schema.Properties.Remove(prop);
        }
    }
}

// Registration
builder.Services.AddSwaggerGen(options =>
{
    options.SchemaFilter<HideInternalPropertiesFilter>();
});
```

### Operation Filters

```csharp
// Add correlation ID header to all operations
public class CorrelationIdOperationFilter : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        operation.Parameters ??= new List<OpenApiParameter>();

        operation.Parameters.Add(new OpenApiParameter
        {
            Name = "X-Correlation-ID",
            In = ParameterLocation.Header,
            Required = false,
            Schema = new OpenApiSchema { Type = "string", Format = "uuid" },
            Description = "Optional correlation ID for request tracing"
        });
    }
}
```

### Enum as String

```csharp
builder.Services.AddSwaggerGen(options =>
{
    options.UseInlineDefinitionsForEnums();
});

// Or with System.Text.Json
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    });
```

### Export OpenAPI Spec for Orval

```bash
# Generate OpenAPI spec at build time
dotnet swagger tofile --output ./openapi.json ./bin/Debug/net8.0/MyApi.dll v1

# Or expose endpoint
app.MapGet("/swagger/v1/swagger.json", () => ...);
```

### Minimal API Documentation

```csharp
app.MapGet("/users/{id}", async (int id, IUserService service) =>
{
    var user = await service.GetUserAsync(id);
    return user is null ? Results.NotFound() : Results.Ok(user);
})
.WithName("GetUser")
.WithDescription("Gets a user by their unique identifier")
.WithTags("Users")
.Produces<UserDto>(StatusCodes.Status200OK)
.Produces(StatusCodes.Status404NotFound)
.WithOpenApi(operation =>
{
    operation.Parameters[0].Description = "The unique user identifier";
    return operation;
});
```

## Common Mistakes

### Mistake: Missing Response Types

```csharp
// Bad: No response documentation
[HttpGet("{id}")]
public async Task<ActionResult<UserDto>> GetUser(int id)
{
    var user = await _service.GetUserAsync(id);
    return user is null ? NotFound() : Ok(user);
}

// Good: All responses documented
[HttpGet("{id}")]
[ProducesResponseType(typeof(UserDto), StatusCodes.Status200OK)]
[ProducesResponseType(StatusCodes.Status404NotFound)]
[ProducesResponseType(StatusCodes.Status401Unauthorized)]
public async Task<ActionResult<UserDto>> GetUser(int id)
{
    var user = await _service.GetUserAsync(id);
    return user is null ? NotFound() : Ok(user);
}
```

### Mistake: Swagger in Production

```csharp
// Bad: Swagger exposed in production
app.UseSwagger();
app.UseSwaggerUI();

// Good: Development only
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Or: Protected endpoint for internal use
app.UseSwagger();
app.UseSwaggerUI().RequireAuthorization("AdminOnly");
```

### Mistake: Missing XML Comments

```csharp
// Bad: No documentation
public record CreateUserRequest
{
    public required string Name { get; init; }
    public required string Email { get; init; }
}

// Good: Full documentation with examples
/// <summary>
/// Request to create a new user account.
/// </summary>
public record CreateUserRequest
{
    /// <summary>
    /// User's display name.
    /// </summary>
    /// <example>Jane Smith</example>
    [Required]
    public required string Name { get; init; }

    /// <summary>
    /// User's email address (must be unique).
    /// </summary>
    /// <example>jane.smith@example.com</example>
    [Required]
    [EmailAddress]
    public required string Email { get; init; }
}
```

### Mistake: Not Documenting Error Responses

```csharp
// Bad: Only success documented
[ProducesResponseType(typeof(UserDto), StatusCodes.Status200OK)]
public async Task<ActionResult<UserDto>> CreateUser(CreateUserRequest request)

// Good: All possible responses
[ProducesResponseType(typeof(UserDto), StatusCodes.Status201Created)]
[ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
[ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
[ProducesResponseType(StatusCodes.Status401Unauthorized)]
[ProducesResponseType(StatusCodes.Status500InternalServerError)]
public async Task<ActionResult<UserDto>> CreateUser(CreateUserRequest request)
```

### Mistake: Inconsistent Naming

```csharp
// Bad: Mixed naming conventions
[HttpGet] // GET /api/Users
[HttpPost("create-user")] // POST /api/Users/create-user
[HttpPut("UpdateUser/{id}")] // PUT /api/Users/UpdateUser/1

// Good: Consistent RESTful naming
[HttpGet] // GET /api/users
[HttpPost] // POST /api/users
[HttpPut("{id}")] // PUT /api/users/1
[HttpDelete("{id}")] // DELETE /api/users/1
```

### Mistake: Exposing Internal Types

```csharp
// Bad: Entity exposed in API
[HttpGet("{id}")]
public async Task<ActionResult<User>> GetUser(int id) // Exposes EF entity
{
    return await _context.Users.FindAsync(id);
}

// Good: DTO with controlled exposure
[HttpGet("{id}")]
[ProducesResponseType(typeof(UserDto), StatusCodes.Status200OK)]
public async Task<ActionResult<UserDto>> GetUser(int id)
{
    var user = await _service.GetUserAsync(id);
    return user is null ? NotFound() : Ok(user);
}
```

### Mistake: No API Grouping

```csharp
// Bad: All endpoints in single list
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase

// Good: Tagged and grouped
[ApiController]
[Route("api/[controller]")]
[Tags("Users")]
[Produces("application/json")]
public class UsersController : ControllerBase
```

## Review Checklist

- [ ] All endpoints have XML documentation
- [ ] Response types documented with ProducesResponseType
- [ ] Error responses (400, 401, 404, 500) documented
- [ ] Request/response examples provided
- [ ] JWT/OAuth security scheme configured
- [ ] Swagger disabled or protected in production
- [ ] API versioning reflected in docs
- [ ] Consistent RESTful naming
- [ ] DTOs used (not entities)
- [ ] Tags used for endpoint grouping
- [ ] OpenAPI spec exportable for client generation

## Resources

- [Swashbuckle Documentation](https://github.com/domaindrivendev/Swashbuckle.AspNetCore)
- [ASP.NET Core Web API Documentation](https://learn.microsoft.com/en-us/aspnet/core/tutorials/web-api-help-pages-using-swagger)
- [OpenAPI Specification](https://swagger.io/specification/)
- [NSwag Alternative](https://github.com/RicoSuter/NSwag)
