---
name: docstrings
description: Use when public APIs need documentation, after implementation or before PR creation
---

# Add Docstrings

## Overview

Add documentation to public APIs in files changed on this branch. Follows project conventions for each language.

**Announce at start:** "I'm using envoy:docstrings to document public APIs."

## Scope

### Default: Changed Files

Find files changed since base branch:

```bash
git diff --name-only main...HEAD
```

Filter to code files:
- C#: `*.cs` (exclude `*.Designer.cs`, `Migrations/`)
- TypeScript: `*.ts`, `*.tsx` (exclude `*.d.ts`, `*.spec.ts`, `*.test.ts`)

### Specific Files

If file paths provided, document only those files.

## Conventions

### C# (XML Documentation)

#### Class Documentation

```csharp
/// <summary>
/// Manages user-related operations including creation, retrieval, and updates.
/// </summary>
/// <remarks>
/// This service handles all user lifecycle operations and integrates with
/// the authentication system for credential management.
/// </remarks>
public class UserService : IUserService
```

#### Method Documentation

```csharp
/// <summary>
/// Creates a new user with the specified details.
/// </summary>
/// <param name="request">The user creation request containing user details.</param>
/// <param name="cancellationToken">Cancellation token for the operation.</param>
/// <returns>The created user with assigned ID.</returns>
/// <exception cref="ArgumentException">Thrown when email is invalid.</exception>
/// <exception cref="DuplicateUserException">Thrown when email already exists.</exception>
public async Task<UserDto> CreateUserAsync(CreateUserRequest request, CancellationToken cancellationToken = default)
```

#### Property Documentation

```csharp
/// <summary>
/// Gets or sets the user's email address.
/// </summary>
/// <value>A valid email address that uniquely identifies the user.</value>
public string Email { get; set; }
```

#### Controller Action Documentation

```csharp
/// <summary>
/// Retrieves a user by their unique identifier.
/// </summary>
/// <param name="id">The unique identifier of the user.</param>
/// <param name="cancellationToken">Cancellation token for the operation.</param>
/// <returns>The user details if found.</returns>
/// <response code="200">Returns the user details.</response>
/// <response code="404">User with the specified ID was not found.</response>
[HttpGet("{id}")]
[ProducesResponseType(typeof(UserDto), StatusCodes.Status200OK)]
[ProducesResponseType(StatusCodes.Status404NotFound)]
public async Task<ActionResult<UserDto>> GetUser(int id, CancellationToken cancellationToken)
```

### TypeScript/React (JSDoc)

#### Function Documentation

```typescript
/**
 * Creates a new user with the specified details.
 *
 * @param request - The user creation request containing user details.
 * @returns A promise that resolves to the created user.
 * @throws {ValidationError} When the email format is invalid.
 * @throws {DuplicateError} When the email already exists.
 *
 * @example
 * ```ts
 * const user = await createUser({ name: 'John', email: 'john@example.com' });
 * ```
 */
export async function createUser(request: CreateUserRequest): Promise<User> {
```

#### React Component Documentation

```typescript
/**
 * Displays a form for creating or editing a user.
 *
 * @param props - Component props.
 * @param props.user - Existing user for editing, or undefined for creation.
 * @param props.onSubmit - Callback invoked when the form is submitted.
 * @param props.onCancel - Callback invoked when the user cancels.
 *
 * @example
 * ```tsx
 * <UserForm
 *   user={existingUser}
 *   onSubmit={handleSave}
 *   onCancel={handleCancel}
 * />
 * ```
 */
export function UserForm({ user, onSubmit, onCancel }: UserFormProps) {
```

#### Interface Documentation

```typescript
/**
 * Represents a user in the system.
 */
export interface User {
  /** Unique identifier for the user. */
  id: number;

  /** User's display name. */
  name: string;

  /** User's email address (unique). */
  email: string;

  /** When the user was created. */
  createdAt: Date;
}
```

#### Hook Documentation

```typescript
/**
 * Hook for managing user data fetching and mutations.
 *
 * @param userId - The ID of the user to fetch, or undefined for new user.
 * @returns An object containing the user data, loading state, and mutation functions.
 *
 * @example
 * ```tsx
 * const { user, isLoading, updateUser } = useUser(123);
 *
 * if (isLoading) return <Spinner />;
 * return <UserProfile user={user} onUpdate={updateUser} />;
 * ```
 */
export function useUser(userId?: number) {
```

## Process

### Step 1: Identify Files

```bash
# Get changed files
CHANGED_FILES=$(git diff --name-only main...HEAD)

# Filter to code files
CS_FILES=$(echo "$CHANGED_FILES" | grep '\.cs$' | grep -v 'Designer.cs' | grep -v 'Migrations/')
TS_FILES=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx)$' | grep -v '\.d\.ts$' | grep -v '\.spec\.' | grep -v '\.test\.')
```

### Step 2: Analyze Each File

For each file:
1. Parse to identify public APIs
2. Check if documentation exists
3. Generate appropriate docstrings

### Step 3: Add Missing Documentation

For each undocumented public API:
1. Analyze the code to understand purpose
2. Generate documentation following conventions
3. Add to the file

### Step 4: Review Changes

```bash
git diff
```

Verify:
- Documentation is accurate
- No existing docs were removed
- Formatting is correct

### Step 5: Commit

```bash
git add -A
git commit -m "docs: add docstrings to public APIs

Files documented:
- <file1>
- <file2>
- ..."
```

## What to Document

### Always Document

- Public classes and interfaces
- Public methods and functions
- Public properties
- Exported React components
- Exported hooks
- Exported utility functions
- API endpoints (controllers)

### Skip

- Private/internal members
- Implementation details
- Auto-generated code
- Test files
- Type definition files (`.d.ts`)

## Quality Checklist

- [ ] **Accurate** — Documentation matches actual behavior
- [ ] **Concise** — No unnecessary words
- [ ] **Complete** — All parameters and return values documented
- [ ] **Examples** — Complex APIs have usage examples
- [ ] **Exceptions** — Error conditions documented
- [ ] **Consistent** — Follows project conventions

## Report

```
**Docstrings Added**

## Files Documented

| File | APIs Documented |
|------|-----------------|
| UserService.cs | 5 methods, 2 properties |
| UserController.cs | 4 endpoints |
| UserForm.tsx | 1 component, 3 functions |

## Summary

- Total files: 3
- Total APIs documented: 15
- Already documented: 8 (skipped)

## Sample

```csharp
/// <summary>
/// Creates a new user with the specified details.
/// </summary>
/// <param name="request">The user creation request.</param>
/// <returns>The created user.</returns>
public async Task<UserDto> CreateUserAsync(CreateUserRequest request)
```

Ready to commit.
```

## Standalone Usage

Docstrings can be added anytime:

```
/envoy:docstrings                    # Document changed files
/envoy:docstrings src/services/      # Document specific directory
/envoy:docstrings UserService.cs     # Document specific file
```
