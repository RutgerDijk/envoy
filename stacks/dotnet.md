# .NET Stack Profile

## Detection

```bash
# Detect .NET projects
find . -name "*.csproj" -o -name "*.sln" | head -1
```

## Best Practices

### Project Structure

```
src/
├── Api/                    # Web API project
│   ├── Controllers/        # API endpoints
│   ├── Middleware/         # Custom middleware
│   ├── Filters/            # Action filters
│   └── Program.cs          # Application entry
├── Application/            # Business logic (Clean Architecture)
│   ├── Commands/           # CQRS commands
│   ├── Queries/            # CQRS queries
│   ├── Services/           # Application services
│   └── Interfaces/         # Service interfaces
├── Domain/                 # Domain entities
│   ├── Entities/           # Domain models
│   ├── ValueObjects/       # Value objects
│   └── Exceptions/         # Domain exceptions
└── Infrastructure/         # External concerns
    ├── Data/               # EF contexts, repositories
    ├── Services/           # External service implementations
    └── Extensions/         # DI registration extensions
```

### Naming Conventions

| Item | Convention | Example |
|------|------------|---------|
| Classes | PascalCase | `UserService` |
| Interfaces | I-prefix | `IUserService` |
| Methods | PascalCase | `GetUserAsync` |
| Async methods | Async suffix | `CreateUserAsync` |
| Private fields | _camelCase | `_userRepository` |
| Parameters | camelCase | `userId` |
| Constants | PascalCase | `MaxRetryCount` |

### Dependency Injection

```csharp
// Good: Register via extension method
public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddApplicationServices(this IServiceCollection services)
    {
        services.AddScoped<IUserService, UserService>();
        services.AddScoped<IEmailService, EmailService>();
        return services;
    }
}

// In Program.cs
builder.Services.AddApplicationServices();
```

### Configuration

```csharp
// Good: Strongly-typed configuration
public class EmailSettings
{
    public string SmtpHost { get; set; } = string.Empty;
    public int SmtpPort { get; set; }
    public string FromAddress { get; set; } = string.Empty;
}

// Registration
builder.Services.Configure<EmailSettings>(
    builder.Configuration.GetSection("Email"));

// Usage via IOptions<T>
public class EmailService(IOptions<EmailSettings> options)
{
    private readonly EmailSettings _settings = options.Value;
}
```

### Exception Handling

```csharp
// Good: Domain-specific exceptions
public class UserNotFoundException : Exception
{
    public int UserId { get; }

    public UserNotFoundException(int userId)
        : base($"User with ID {userId} was not found.")
    {
        UserId = userId;
    }
}

// Global exception handler middleware
app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async context =>
    {
        var exception = context.Features.Get<IExceptionHandlerFeature>()?.Error;
        var response = exception switch
        {
            UserNotFoundException e => new ProblemDetails
            {
                Status = 404,
                Title = "User not found",
                Detail = e.Message
            },
            _ => new ProblemDetails
            {
                Status = 500,
                Title = "An error occurred"
            }
        };

        context.Response.StatusCode = response.Status ?? 500;
        await context.Response.WriteAsJsonAsync(response);
    });
});
```

### Cancellation Tokens

```csharp
// Good: Pass cancellation token through all async operations
public async Task<User> GetUserAsync(int id, CancellationToken cancellationToken = default)
{
    return await _context.Users
        .FirstOrDefaultAsync(u => u.Id == id, cancellationToken)
        ?? throw new UserNotFoundException(id);
}
```

## Common Mistakes

### Mistake: Service Locator Pattern

```csharp
// Bad: Using IServiceProvider directly
public class UserService
{
    private readonly IServiceProvider _provider;

    public void DoWork()
    {
        var repo = _provider.GetRequiredService<IUserRepository>();
    }
}

// Good: Constructor injection
public class UserService(IUserRepository repository)
{
    public void DoWork()
    {
        // Use repository directly
    }
}
```

### Mistake: Missing Async/Await

```csharp
// Bad: Returns Task without await (exceptions won't propagate correctly)
public Task<User> GetUserAsync(int id)
{
    return _repository.GetByIdAsync(id);
}

// Good: Await the result
public async Task<User> GetUserAsync(int id)
{
    return await _repository.GetByIdAsync(id);
}
```

### Mistake: Blocking on Async Code

```csharp
// Bad: .Result or .Wait() can cause deadlocks
var user = GetUserAsync(id).Result;

// Good: Async all the way
var user = await GetUserAsync(id);
```

### Mistake: Not Using IAsyncEnumerable

```csharp
// Bad: Loading all items into memory
public async Task<List<User>> GetAllUsersAsync()
{
    return await _context.Users.ToListAsync();
}

// Good: Stream results when appropriate
public IAsyncEnumerable<User> GetAllUsersAsync()
{
    return _context.Users.AsAsyncEnumerable();
}
```

### Mistake: Exposing Internal Implementation

```csharp
// Bad: Returning IQueryable leaks EF details
public IQueryable<User> GetUsers() => _context.Users;

// Good: Return concrete types
public async Task<List<UserDto>> GetUsersAsync(CancellationToken ct)
{
    return await _context.Users
        .Select(u => new UserDto(u.Id, u.Name))
        .ToListAsync(ct);
}
```

## Review Checklist

- [ ] Async methods use `async`/`await` properly
- [ ] Cancellation tokens passed through async chain
- [ ] No blocking calls (`.Result`, `.Wait()`)
- [ ] Dependencies injected via constructor
- [ ] Configuration uses strongly-typed options
- [ ] Exceptions are domain-specific where appropriate
- [ ] No service locator pattern usage
- [ ] Interfaces define contracts, not implementation
- [ ] DTOs used for API responses (not entities)
- [ ] Nullable reference types enabled and handled

## Resources

- [.NET Documentation](https://learn.microsoft.com/en-us/dotnet/)
- [ASP.NET Core Best Practices](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/best-practices)
- [Clean Architecture with .NET](https://github.com/jasontaylordev/CleanArchitecture)
