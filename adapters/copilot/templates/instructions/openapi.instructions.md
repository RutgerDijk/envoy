---
applyTo: '**/{openapi.json,swagger.json,**/swagger/**,**/Swagger*}'
---

# OpenAPI / Swagger Best Practices

## Setup in Program.cs

```csharp
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo { Title = "My API", Version = "v1" });

    // Include XML comments
    var xmlFile = $"{Assembly.GetExecutingAssembly().GetName().Name}.xml";
    var xmlPath = Path.Combine(AppContext.BaseDirectory, xmlFile);
    options.IncludeXmlComments(xmlPath);

    // JWT auth in Swagger UI
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
    });
});

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(o => o.RoutePrefix = "swagger");
}
```

## Enable XML Documentation

In `.csproj`:

```xml
<PropertyGroup>
  <GenerateDocumentationFile>true</GenerateDocumentationFile>
  <NoWarn>$(NoWarn);1591</NoWarn>
</PropertyGroup>
```

## Annotate Controllers

```csharp
/// <summary>Creates a new user.</summary>
/// <param name="request">User creation data.</param>
/// <returns>The created user.</returns>
[HttpPost]
[ProducesResponseType(typeof(UserDto), StatusCodes.Status201Created)]
[ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
public async Task<ActionResult<UserDto>> CreateUser(CreateUserRequest request)
```

## Common Mistakes to Avoid

- ❌ Missing `[ProducesResponseType]` → Swagger shows incomplete response schemas
- ❌ No XML doc on public endpoints → Swagger descriptions are empty
- ❌ Exposing Swagger in production → gate it behind `IsDevelopment()`
- ❌ Using `object` as response type → use concrete DTOs for accurate schemas
- ❌ Not documenting error responses → clients don't know what errors to expect
