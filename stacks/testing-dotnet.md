# .NET Testing Stack Profile

## Detection

```bash
# Detect xUnit, Moq, FluentAssertions
grep -E "xunit|Moq|FluentAssertions" *.csproj **/*.csproj 2>/dev/null | head -1
```

## Best Practices

### Test Project Structure

```
tests/
├── Unit/                       # Fast, isolated tests
│   ├── Services/
│   └── Validators/
├── Integration/                # Database, API tests
│   ├── Api/
│   └── Data/
└── Common/                     # Shared test utilities
    ├── Fixtures/
    ├── Builders/
    └── Fakes/
```

### Naming Convention

```csharp
// Pattern: MethodName_StateUnderTest_ExpectedBehavior
[Fact]
public async Task CreateUser_WithValidEmail_ReturnsCreatedUser()

[Fact]
public async Task CreateUser_WithDuplicateEmail_ThrowsDuplicateException()

[Fact]
public async Task GetUser_WhenUserNotFound_ReturnsNull()
```

### Test Structure (Arrange-Act-Assert)

```csharp
[Fact]
public async Task CreateUser_WithValidData_ReturnsCreatedUser()
{
    // Arrange
    var request = new CreateUserRequest
    {
        Name = "John Doe",
        Email = "john@example.com"
    };

    _userRepositoryMock
        .Setup(r => r.EmailExistsAsync(request.Email, It.IsAny<CancellationToken>()))
        .ReturnsAsync(false);

    _userRepositoryMock
        .Setup(r => r.AddAsync(It.IsAny<User>(), It.IsAny<CancellationToken>()))
        .ReturnsAsync((User u, CancellationToken _) => u);

    // Act
    var result = await _sut.CreateUserAsync(request);

    // Assert
    result.Should().NotBeNull();
    result.Name.Should().Be(request.Name);
    result.Email.Should().Be(request.Email);
}
```

### FluentAssertions Patterns

```csharp
// Object assertions
user.Should().NotBeNull();
user.Should().BeEquivalentTo(expectedUser);
user.Should().BeOfType<AdminUser>();

// Collection assertions
users.Should().HaveCount(3);
users.Should().ContainSingle(u => u.Email == "test@example.com");
users.Should().BeInAscendingOrder(u => u.Name);
users.Should().AllSatisfy(u => u.IsActive.Should().BeTrue());

// Exception assertions
var act = async () => await _service.CreateUserAsync(invalidRequest);
await act.Should().ThrowAsync<ValidationException>()
    .WithMessage("*email*");

// Numeric assertions
result.Total.Should().BeApproximately(99.99m, 0.01m);
items.Count.Should().BeInRange(1, 10);
```

### Moq Setup Patterns

```csharp
// Basic setup
_mock.Setup(x => x.GetByIdAsync(It.IsAny<int>()))
    .ReturnsAsync(new User { Id = 1, Name = "Test" });

// Conditional returns
_mock.Setup(x => x.GetByIdAsync(1)).ReturnsAsync(user1);
_mock.Setup(x => x.GetByIdAsync(2)).ReturnsAsync(user2);

// Callback for capturing arguments
User? capturedUser = null;
_mock.Setup(x => x.AddAsync(It.IsAny<User>(), It.IsAny<CancellationToken>()))
    .Callback<User, CancellationToken>((u, _) => capturedUser = u)
    .ReturnsAsync((User u, CancellationToken _) => u);

// Sequence of returns
_mock.SetupSequence(x => x.GetNextAsync())
    .ReturnsAsync(item1)
    .ReturnsAsync(item2)
    .ThrowsAsync(new EndOfStreamException());

// Verify calls
_mock.Verify(x => x.SaveAsync(It.IsAny<User>(), It.IsAny<CancellationToken>()), Times.Once);
_mock.Verify(x => x.DeleteAsync(It.IsAny<int>()), Times.Never);
```

### Test Data Builders

```csharp
public class UserBuilder
{
    private int _id = 1;
    private string _name = "Test User";
    private string _email = "test@example.com";
    private bool _isActive = true;

    public UserBuilder WithId(int id) { _id = id; return this; }
    public UserBuilder WithName(string name) { _name = name; return this; }
    public UserBuilder WithEmail(string email) { _email = email; return this; }
    public UserBuilder Inactive() { _isActive = false; return this; }

    public User Build() => new()
    {
        Id = _id,
        Name = _name,
        Email = _email,
        IsActive = _isActive
    };

    public static implicit operator User(UserBuilder b) => b.Build();
}

// Usage
var user = new UserBuilder().WithName("John").Inactive().Build();
```

### Fixture for Shared Setup

```csharp
public class UserServiceFixture : IAsyncLifetime
{
    public Mock<IUserRepository> UserRepositoryMock { get; } = new();
    public Mock<IEmailService> EmailServiceMock { get; } = new();
    public UserService Sut { get; private set; } = null!;

    public Task InitializeAsync()
    {
        Sut = new UserService(
            UserRepositoryMock.Object,
            EmailServiceMock.Object);
        return Task.CompletedTask;
    }

    public Task DisposeAsync() => Task.CompletedTask;
}

public class UserServiceTests : IClassFixture<UserServiceFixture>
{
    private readonly UserServiceFixture _fixture;

    public UserServiceTests(UserServiceFixture fixture)
    {
        _fixture = fixture;
    }
}
```

## Common Mistakes

### Mistake: Testing Implementation Details

```csharp
// Bad: Testing that specific internal method was called
_mock.Verify(x => x.ValidateInternally(It.IsAny<User>()), Times.Once);

// Good: Test observable behavior
result.Should().NotBeNull();
result.IsValid.Should().BeTrue();
```

### Mistake: Not Resetting Mocks

```csharp
// Bad: Mock state leaks between tests
[Fact]
public void Test1()
{
    _mock.Setup(x => x.Get()).Returns(1);
}

[Fact]
public void Test2()
{
    // _mock still has Test1's setup!
}

// Good: Reset in test or use fresh mock
public UserServiceTests()
{
    _mock = new Mock<IUserRepository>();
    _sut = new UserService(_mock.Object);
}
```

### Mistake: Overly Broad Mock Setup

```csharp
// Bad: Returns same value for any input
_mock.Setup(x => x.GetByIdAsync(It.IsAny<int>())).ReturnsAsync(user);

// Good: Specific setup for test scenario
_mock.Setup(x => x.GetByIdAsync(testUserId)).ReturnsAsync(user);
_mock.Setup(x => x.GetByIdAsync(It.Is<int>(i => i != testUserId))).ReturnsAsync((User?)null);
```

### Mistake: Missing Async Test Pattern

```csharp
// Bad: Not awaiting async method
[Fact]
public void CreateUser_Test() // Should be async Task
{
    var result = _sut.CreateUserAsync(request); // Missing await!
}

// Good: Proper async test
[Fact]
public async Task CreateUser_WithValidData_ReturnsUser()
{
    var result = await _sut.CreateUserAsync(request);
    result.Should().NotBeNull();
}
```

### Mistake: Hard-Coded Test Data

```csharp
// Bad: Magic values scattered in test
[Fact]
public void Test()
{
    var request = new CreateUserRequest { Email = "john@test.com" };
    _mock.Setup(x => x.EmailExistsAsync("john@test.com", ...));
}

// Good: Extract to constants or builders
private const string TestEmail = "test@example.com";

[Fact]
public void Test()
{
    var request = new CreateUserRequest { Email = TestEmail };
    _mock.Setup(x => x.EmailExistsAsync(TestEmail, ...));
}
```

## Review Checklist

- [ ] Tests follow Arrange-Act-Assert pattern
- [ ] Test names describe scenario and expected outcome
- [ ] FluentAssertions used for readable assertions
- [ ] Mocks verify behavior, not implementation
- [ ] Test data builders used for complex objects
- [ ] Async tests use async Task and await
- [ ] No test interdependence (isolated tests)
- [ ] Exceptions tested with Should().ThrowAsync
- [ ] Edge cases covered (null, empty, boundary values)
- [ ] No magic strings/numbers (use constants)

## Resources

- [xUnit Documentation](https://xunit.net/)
- [FluentAssertions Documentation](https://fluentassertions.com/)
- [Moq Quickstart](https://github.com/moq/moq4/wiki/Quickstart)
