---
applyTo: '**/*.{ts,tsx}'
---

# TypeScript Best Practices

## Type Definitions

Be explicit. Avoid `any`.

```typescript
// Good: explicit function signatures
function calculateTotal(items: OrderItem[], tax: number): number {
  return items.reduce((sum, item) => sum + item.price, 0) * (1 + tax);
}

// Good: type aliases for semantic meaning
type UserId = string;
type OrderStatus = "pending" | "confirmed" | "shipped" | "delivered";

// Good: discriminated unions for variants
type ApiResponse<T> =
  | { status: "success"; data: T }
  | { status: "error"; error: string };
```

## Interfaces vs Types

- Use `interface` for object shapes that might be extended
- Use `type` for unions, intersections, and computed types

```typescript
interface User {
  id: UserId;
  name: string;
  email: string;
}

type CreateUserDto = Omit<User, "id">;
type UpdateUserDto = Partial<CreateUserDto>;
```

## Type Guards

Write runtime checks for `unknown` data:

```typescript
function isUser(value: unknown): value is User {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    "email" in value
  );
}
```

## Utility Types

```typescript
Partial<T>          // All properties optional
Required<T>         // All properties required
Readonly<T>         // No mutations
Pick<T, K>          // Select subset of properties
Omit<T, K>          // Exclude properties
NonNullable<T>      // Remove null/undefined
ReturnType<F>       // Extract function return type
```

## Common Mistakes to Avoid

- ❌ `as any` → use type guards or proper typing
- ❌ `as T` casts on unknown data → validate first
- ❌ `!` non-null assertions on values that could be null → check first
- ❌ `Function` type → use `() => void` or specific signatures
- ❌ Enums → prefer `const` objects or union types (better tree-shaking)
- ❌ `Object` type → use `object`, `Record<string, unknown>`, or a specific interface
