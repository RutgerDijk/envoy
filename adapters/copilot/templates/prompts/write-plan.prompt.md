---
agent: 'agent'
description: 'Add a detailed implementation plan to an existing spec document'
---

# Write Implementation Plan

Add a detailed, task-by-task implementation plan to an existing spec document, or create a new spec with tasks from a description.

## Find or Identify the Spec

If a spec file path is provided, use it. Otherwise, find the most recent one:

```bash
ls -t docs/plans/*.md | head -1
```

Read the spec file to understand:
- The feature being built
- Architecture decisions already made
- Acceptance criteria

## Plan Requirements

Every plan must:
1. Be executable by someone with zero prior context
2. Follow TDD — every task has a test file
3. Use the smallest meaningful task granularity (2–5 minutes per task)
4. Include exact file paths and commands
5. Include a commit step at the end of each task

## Analyze the Work

Before writing tasks:
1. What are the independent units of work? (parallel candidates)
2. What has dependencies? (sequential or batch)
3. What is the test/implementation pairing for each unit?
4. What is the correct build order?

## Execution Strategy Options

```yaml
# Independent tasks (no shared files, no dependencies)
Execution Strategy: parallel

# Phased work with checkpoints
Execution Strategy: batch
Batch 1 – Data Layer: [tasks 1-3]
Batch 2 – Business Logic: [tasks 4-6]
Batch 3 – API Layer: [tasks 7-9]

# Tightly coupled work where each step depends on the next
Execution Strategy: sequential
```

## Task Template

```markdown
### Task N: <Descriptive Name>

**Files:**
- Create: `src/Domain/Entities/User.cs`
- Create: `tests/Unit/Domain/UserTests.cs`
- Modify: `src/Infrastructure/Data/AppDbContext.cs`

**Step 1: Write failing test**

```csharp
[Fact]
public void User_WithValidEmail_CreatesSuccessfully()
{
    var user = new User("test@example.com", "Test User");
    user.Email.Should().Be("test@example.com");
}
```

**Step 2: Run test — expect FAIL**

```bash
dotnet test --filter "User_WithValidEmail"
```

**Step 3: Implement minimal code**

```csharp
public class User
{
    public string Email { get; private set; }
    public string Name { get; private set; }

    public User(string email, string name)
    {
        Email = email;
        Name = name;
    }
}
```

**Step 4: Run test — expect PASS**

```bash
dotnet test --filter "User_WithValidEmail"
```

**Step 5: Commit**

```bash
git add src/Domain/Entities/User.cs tests/Unit/Domain/UserTests.cs
git commit -m "feat(domain): add User entity"
```
```

## Stack-Specific Test Patterns

Detect .csproj files → use xUnit + FluentAssertions pattern (like above).
Detect package.json with React → use Vitest + React Testing Library:

```typescript
test('UserCard renders user name', () => {
  render(<UserCard user={{ id: 1, name: 'Test User' }} />)
  expect(screen.getByText('Test User')).toBeInTheDocument()
})
```

Detect playwright in package.json → use Page Object Model pattern.

## Write the Plan

Add the implementation plan to the spec file under the `## Implementation Plan` section. If the section doesn't exist, add it after the Acceptance Criteria section.

When done, output:
```
✅ Implementation plan written to: docs/plans/<file>.md
Tasks: <N>
Strategy: <parallel|batch|sequential>
Estimated time: <N * 3 minutes>
```
