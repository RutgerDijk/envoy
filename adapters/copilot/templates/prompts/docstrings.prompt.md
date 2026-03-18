---
mode: 'agent'
description: 'Add XML documentation (C#) or JSDoc (TypeScript) to all public APIs'
---

# Add Docstrings

Add documentation comments to all public APIs in the current branch's changed files.

## Find Changed Files

```bash
git diff --name-only main...HEAD
```

Filter for files that contain public API surfaces:
- `*.cs` files in `src/` (not test files)
- `*.ts` / `*.tsx` files with exported functions or components

## C# — XML Documentation

For every `public` class, interface, method, and property in the changed `.cs` files that lacks `/// <summary>`:

```csharp
/// <summary>
/// Brief description of what this does.
/// </summary>
/// <param name="userId">The unique identifier of the user.</param>
/// <param name="cancellationToken">Token to cancel the operation.</param>
/// <returns>The user if found; otherwise <c>null</c>.</returns>
/// <exception cref="ArgumentException">Thrown when <paramref name="userId"/> is invalid.</exception>
public async Task<UserDto?> GetUserAsync(int userId, CancellationToken cancellationToken)
```

### Rules

- `<summary>` — what it does (one line if possible)
- `<param>` — describe each parameter
- `<returns>` — describe the return value (omit for `void`)
- `<exception>` — document exceptions that callers need to handle
- Use `<c>null</c>`, `<c>true</c>` for inline code references
- Use `<see cref="TypeName"/>` for type references

### Skip

- Private and internal members (unless they are complex)
- Test classes and test methods
- Auto-generated or scaffolded code
- Simple property wrappers that are self-explanatory

## TypeScript — JSDoc

For every exported function, class, and interface in the changed `.ts`/`.tsx` files:

```typescript
/**
 * Fetches a user by their unique identifier.
 *
 * @param userId - The unique identifier of the user.
 * @returns The user object, or null if not found.
 * @throws {ApiError} When the request fails.
 *
 * @example
 * const user = await getUser(123)
 * console.log(user?.name)
 */
export async function getUser(userId: number): Promise<User | null>
```

### React Components

```typescript
/**
 * Displays a user's profile card with their name and avatar.
 *
 * @example
 * <UserCard user={currentUser} onSelect={handleSelect} />
 */
export function UserCard({ user, onSelect }: UserCardProps)
```

### Rules

- Document all exported functions, types, and components
- Skip internal/private functions
- Include `@example` for non-obvious usage
- Keep descriptions concise — the code itself can explain obvious things

## After Adding Docstrings

Verify the build still works (especially XML doc generation):

```bash
dotnet build
```

Then commit:

```bash
git add -A
git commit -m "docs: add docstrings to public APIs"
```
