---
applyTo: '**/*.{cs,csproj,sln}'
---

# .NET Best Practices

## Project Structure (Clean Architecture)

```
src/
├── Api/                    # Controllers, middleware, filters, Program.cs
├── Application/            # Commands, queries, services, interfaces (business logic)
├── Domain/                 # Entities, value objects, domain exceptions
└── Infrastructure/         # EF contexts, repositories, external service implementations
tests/
├── Unit/                   # Fast isolated tests (no I/O)
├── Integration/            # Database and API tests
└── Common/                 # Fixtures, builders, fakes
```

Layer rules: Domain ← Application ← Infrastructure ← Api. Never reference a layer above you.

## Naming Conventions

| Item | Convention | Example |
|------|------------|---------|
| Classes | PascalCase | `UserService` |
| Interfaces | I-prefix | `IUserService` |
| Async methods | Async suffix | `CreateUserAsync` |
| Private fields | `_camelCase` | `_userRepository` |
| Parameters | camelCase | `userId` |

## Dependency Injection

Register via extension methods:

```csharp
public static IServiceCollection AddApplicationServices(this IServiceCollection services)
{
    services.AddScoped<IUserService, UserService>();
    return services;
}
// In Program.cs:
builder.Services.AddApplicationServices();
```

## Async/Await Rules

- Every I/O method must be `async Task<T>` with a `CancellationToken` parameter
- Never `.Result` or `.Wait()` — always `await`
- Pass `CancellationToken` all the way down

```csharp
public async Task<UserDto?> GetUserAsync(int id, CancellationToken cancellationToken)
{
    var user = await _repository.FindByIdAsync(id, cancellationToken);
    return user is null ? null : _mapper.Map<UserDto>(user);
}
```

## Configuration

Use strongly-typed options:

```csharp
public class EmailSettings
{
    public string SmtpHost { get; set; } = string.Empty;
    public int SmtpPort { get; set; }
}
builder.Services.Configure<EmailSettings>(builder.Configuration.GetSection("Email"));
```

## Common Mistakes to Avoid

- ❌ String concatenation for SQL → use parameterized queries or EF Core
- ❌ `DateTime.Now` → use `DateTime.UtcNow` or inject `TimeProvider`
- ❌ `async void` → always `async Task` (except event handlers)
- ❌ Catching `Exception` broadly → catch specific exception types
- ❌ Returning `null` for collections → return empty `IEnumerable`
- ❌ `var` for non-obvious types → use explicit type for clarity
