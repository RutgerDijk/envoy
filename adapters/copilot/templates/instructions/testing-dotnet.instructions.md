---
applyTo: '**/{*Tests.cs,*.Tests/**,*Test.cs}'
---

# .NET Testing Best Practices (xUnit + FluentAssertions + Moq)

## Naming Convention

```csharp
// Pattern: MethodName_StateUnderTest_ExpectedBehavior
[Fact]
public async Task CreateUser_WithValidEmail_ReturnsCreatedUser() { }

[Fact]
public async Task CreateUser_WithDuplicateEmail_ThrowsDuplicateException() { }

[Fact]
public async Task GetUser_WhenUserNotFound_ReturnsNull() { }
```

## Test Structure (Arrange–Act–Assert)

```csharp
[Fact]
public async Task CreateUser_WithValidData_ReturnsCreatedUser()
{
    // Arrange
    var request = new CreateUserRequest { Name = "John Doe", Email = "john@example.com" };
    _userRepositoryMock
        .Setup(r => r.EmailExistsAsync(request.Email, It.IsAny<CancellationToken>()))
        .ReturnsAsync(false);

    // Act
    var result = await _sut.CreateUserAsync(request);

    // Assert
    result.Should().NotBeNull();
    result.Name.Should().Be(request.Name);
    result.Email.Should().Be(request.Email);
}
```

## FluentAssertions Quick Reference

```csharp
result.Should().NotBeNull();
result.Should().Be(expected);
result.Should().BeEquivalentTo(expected, o => o.ExcludingMissingMembers());
list.Should().HaveCount(3);
list.Should().ContainSingle(u => u.IsAdmin);
action.Should().ThrowAsync<ArgumentException>().WithMessage("*email*");
```

## Use Builder Pattern for Test Data

```csharp
public class CreateUserRequestBuilder
{
    private string _name = "Test User";
    private string _email = "test@example.com";

    public CreateUserRequestBuilder WithEmail(string email) { _email = email; return this; }
    public CreateUserRequest Build() => new() { Name = _name, Email = _email };
}
```

## Integration Tests with WebApplicationFactory

```csharp
public class UsersApiTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client;

    public UsersApiTests(WebApplicationFactory<Program> factory)
    {
        _client = factory.WithWebHostBuilder(b =>
            b.ConfigureServices(services =>
                services.AddDbContext<AppDbContext>(o => o.UseInMemoryDatabase("test")))
        ).CreateClient();
    }
}
```

## Common Mistakes to Avoid

- ❌ Tests that pass without assertions → always use `Should().`
- ❌ `Thread.Sleep` in tests → use `Task.Delay` or a fake time provider
- ❌ Shared mutable state between tests → each test must be independent
- ❌ Testing implementation details → test observable behavior
- ❌ Mocking what you don't own → mock your own interfaces, not 3rd party
