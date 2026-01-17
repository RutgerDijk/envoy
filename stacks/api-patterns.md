# API Patterns Stack Profile

## Detection

```bash
# Detect ASP.NET API
grep -E "Microsoft.AspNetCore|AddControllers" *.csproj **/*.csproj Program.cs 2>/dev/null | head -1
```

## Best Practices

### Controller Structure

```csharp
[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class UsersController : ControllerBase
{
    private readonly IUserService _userService;
    private readonly ILogger<UsersController> _logger;

    public UsersController(IUserService userService, ILogger<UsersController> logger)
    {
        _userService = userService;
        _logger = logger;
    }

    /// <summary>
    /// Gets all users with optional filtering.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(PagedResult<UserDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<PagedResult<UserDto>>> GetUsers(
        [FromQuery] UserFilter filter,
        CancellationToken cancellationToken)
    {
        var result = await _userService.GetUsersAsync(filter, cancellationToken);
        return Ok(result);
    }

    /// <summary>
    /// Gets a user by ID.
    /// </summary>
    [HttpGet("{id:int}")]
    [ProducesResponseType(typeof(UserDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<UserDto>> GetUser(int id, CancellationToken cancellationToken)
    {
        var user = await _userService.GetUserAsync(id, cancellationToken);
        return user is null ? NotFound() : Ok(user);
    }

    /// <summary>
    /// Creates a new user.
    /// </summary>
    [HttpPost]
    [ProducesResponseType(typeof(UserDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<UserDto>> CreateUser(
        CreateUserRequest request,
        CancellationToken cancellationToken)
    {
        var user = await _userService.CreateUserAsync(request, cancellationToken);
        return CreatedAtAction(nameof(GetUser), new { id = user.Id }, user);
    }

    /// <summary>
    /// Updates an existing user.
    /// </summary>
    [HttpPut("{id:int}")]
    [ProducesResponseType(typeof(UserDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<UserDto>> UpdateUser(
        int id,
        UpdateUserRequest request,
        CancellationToken cancellationToken)
    {
        var user = await _userService.UpdateUserAsync(id, request, cancellationToken);
        return user is null ? NotFound() : Ok(user);
    }

    /// <summary>
    /// Deletes a user.
    /// </summary>
    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteUser(int id, CancellationToken cancellationToken)
    {
        var deleted = await _userService.DeleteUserAsync(id, cancellationToken);
        return deleted ? NoContent() : NotFound();
    }
}
```

### DTOs and Validation

```csharp
public record CreateUserRequest
{
    [Required]
    [StringLength(100)]
    public required string Name { get; init; }

    [Required]
    [EmailAddress]
    public required string Email { get; init; }

    [Required]
    [MinLength(8)]
    public required string Password { get; init; }
}

public record UserDto(int Id, string Name, string Email, DateTime CreatedAt);

public record PagedResult<T>(
    IReadOnlyList<T> Items,
    int TotalCount,
    int Page,
    int PageSize)
{
    public int TotalPages => (int)Math.Ceiling(TotalCount / (double)PageSize);
    public bool HasNextPage => Page < TotalPages;
    public bool HasPreviousPage => Page > 1;
}
```

### Global Exception Handling

```csharp
public class GlobalExceptionHandler : IExceptionHandler
{
    private readonly ILogger<GlobalExceptionHandler> _logger;

    public GlobalExceptionHandler(ILogger<GlobalExceptionHandler> logger)
    {
        _logger = logger;
    }

    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        _logger.LogError(exception, "Unhandled exception occurred");

        var problemDetails = exception switch
        {
            NotFoundException e => new ProblemDetails
            {
                Status = StatusCodes.Status404NotFound,
                Title = "Resource not found",
                Detail = e.Message
            },
            ValidationException e => new ProblemDetails
            {
                Status = StatusCodes.Status400BadRequest,
                Title = "Validation error",
                Detail = e.Message
            },
            _ => new ProblemDetails
            {
                Status = StatusCodes.Status500InternalServerError,
                Title = "An error occurred"
            }
        };

        httpContext.Response.StatusCode = problemDetails.Status ?? 500;
        await httpContext.Response.WriteAsJsonAsync(problemDetails, cancellationToken);

        return true;
    }
}

// Program.cs
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
app.UseExceptionHandler();
```

### API Versioning

```csharp
builder.Services.AddApiVersioning(options =>
{
    options.DefaultApiVersion = new ApiVersion(1, 0);
    options.AssumeDefaultVersionWhenUnspecified = true;
    options.ReportApiVersions = true;
    options.ApiVersionReader = ApiVersionReader.Combine(
        new UrlSegmentApiVersionReader(),
        new HeaderApiVersionReader("X-Api-Version"));
})
.AddApiExplorer(options =>
{
    options.GroupNameFormat = "'v'VVV";
    options.SubstituteApiVersionInUrl = true;
});

// Controller
[ApiController]
[Route("api/v{version:apiVersion}/[controller]")]
[ApiVersion("1.0")]
public class UsersController : ControllerBase { }
```

### Rate Limiting

```csharp
builder.Services.AddRateLimiter(options =>
{
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
    {
        return RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.User.Identity?.Name ?? context.Request.Headers.Host.ToString(),
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 100,
                Window = TimeSpan.FromMinutes(1)
            });
    });

    options.AddPolicy("api", context =>
        RateLimitPartition.GetTokenBucketLimiter(
            partitionKey: context.User.Identity?.Name ?? "anonymous",
            factory: _ => new TokenBucketRateLimiterOptions
            {
                TokenLimit = 100,
                ReplenishmentPeriod = TimeSpan.FromSeconds(10),
                TokensPerPeriod = 10
            }));

    options.OnRejected = async (context, token) =>
    {
        context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        await context.HttpContext.Response.WriteAsJsonAsync(
            new ProblemDetails
            {
                Status = 429,
                Title = "Too many requests",
                Detail = "Rate limit exceeded. Try again later."
            }, token);
    };
});
```

## Common Mistakes

### Mistake: Not Using Cancellation Tokens

```csharp
// Bad: No cancellation support
[HttpGet]
public async Task<ActionResult<List<User>>> GetUsers()
{
    return await _userService.GetAllAsync();
}

// Good: Pass cancellation token
[HttpGet]
public async Task<ActionResult<List<User>>> GetUsers(CancellationToken cancellationToken)
{
    return await _userService.GetAllAsync(cancellationToken);
}
```

### Mistake: Returning Entities Instead of DTOs

```csharp
// Bad: Exposes internal structure, circular references
[HttpGet("{id}")]
public async Task<User> GetUser(int id) => await _context.Users.FindAsync(id);

// Good: Return DTO
[HttpGet("{id}")]
public async Task<ActionResult<UserDto>> GetUser(int id, CancellationToken ct)
{
    var user = await _userService.GetUserAsync(id, ct);
    return user is null ? NotFound() : Ok(user);
}
```

### Mistake: Wrong HTTP Status Codes

```csharp
// Bad: 200 for everything
[HttpPost]
public async Task<ActionResult<User>> CreateUser(CreateUserRequest request)
{
    var user = await _service.CreateAsync(request);
    return Ok(user);  // Should be 201 Created
}

// Good: Correct status codes
[HttpPost]
public async Task<ActionResult<User>> CreateUser(CreateUserRequest request, CancellationToken ct)
{
    var user = await _service.CreateAsync(request, ct);
    return CreatedAtAction(nameof(GetUser), new { id = user.Id }, user);
}
```

### Mistake: Not Documenting API

```csharp
// Bad: No documentation
[HttpGet("{id}")]
public async Task<ActionResult<UserDto>> GetUser(int id)

// Good: Documented endpoints
/// <summary>
/// Gets a user by their unique identifier.
/// </summary>
/// <param name="id">The user ID.</param>
/// <returns>The user details.</returns>
/// <response code="200">Returns the user.</response>
/// <response code="404">User not found.</response>
[HttpGet("{id:int}")]
[ProducesResponseType(typeof(UserDto), StatusCodes.Status200OK)]
[ProducesResponseType(StatusCodes.Status404NotFound)]
public async Task<ActionResult<UserDto>> GetUser(int id, CancellationToken ct)
```

### Mistake: No Input Validation

```csharp
// Bad: No validation
[HttpPost]
public async Task<ActionResult<User>> CreateUser(CreateUserRequest request)
{
    return await _service.CreateAsync(request);
}

// Good: Validation with Data Annotations + FluentValidation
public class CreateUserRequestValidator : AbstractValidator<CreateUserRequest>
{
    public CreateUserRequestValidator()
    {
        RuleFor(x => x.Email)
            .NotEmpty()
            .EmailAddress()
            .MaximumLength(255);

        RuleFor(x => x.Password)
            .NotEmpty()
            .MinimumLength(8)
            .Matches("[A-Z]").WithMessage("Password must contain uppercase")
            .Matches("[0-9]").WithMessage("Password must contain digit");
    }
}
```

## Review Checklist

- [ ] Cancellation tokens passed through
- [ ] DTOs used (not entities)
- [ ] Correct HTTP status codes
- [ ] API documentation complete
- [ ] Input validation in place
- [ ] Global exception handling
- [ ] Rate limiting configured
- [ ] API versioning strategy
- [ ] Consistent error responses (ProblemDetails)
- [ ] Route constraints used (e.g., `{id:int}`)

## Resources

- [ASP.NET Core Web API](https://learn.microsoft.com/en-us/aspnet/core/web-api/)
- [API Design Best Practices](https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design)
- [Problem Details RFC](https://www.rfc-editor.org/rfc/rfc7807)
