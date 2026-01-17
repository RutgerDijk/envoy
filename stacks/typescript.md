# TypeScript Stack Profile

## Detection

```bash
# Detect TypeScript projects
find . -name "tsconfig.json" | head -1
```

## Best Practices

### Type Definitions

```typescript
// Good: Explicit types for function signatures
function calculateTotal(items: OrderItem[], tax: number): number {
  return items.reduce((sum, item) => sum + item.price, 0) * (1 + tax);
}

// Good: Type aliases for complex types
type UserId = string;
type OrderStatus = "pending" | "confirmed" | "shipped" | "delivered";

// Good: Interfaces for object shapes
interface User {
  id: UserId;
  name: string;
  email: string;
  createdAt: Date;
}

// Good: Discriminated unions for variants
type ApiResponse<T> =
  | { status: "success"; data: T }
  | { status: "error"; error: string };
```

### Type Guards

```typescript
// Good: Type guard for runtime checking
function isUser(value: unknown): value is User {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    "email" in value
  );
}

// Usage
function processData(data: unknown) {
  if (isUser(data)) {
    console.log(data.name); // TypeScript knows data is User
  }
}
```

### Generics

```typescript
// Good: Generic functions with constraints
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

// Good: Generic interfaces
interface Repository<T extends { id: string }> {
  findById(id: string): Promise<T | null>;
  save(entity: T): Promise<T>;
  delete(id: string): Promise<void>;
}
```

### Utility Types

```typescript
// Partial - all properties optional
type UpdateUserDto = Partial<User>;

// Pick - select specific properties
type UserSummary = Pick<User, "id" | "name">;

// Omit - exclude properties
type CreateUserDto = Omit<User, "id" | "createdAt">;

// Record - typed key-value map
type UserCache = Record<UserId, User>;

// Required - all properties required
type CompleteUser = Required<PartialUser>;

// Readonly - immutable object
type FrozenUser = Readonly<User>;
```

### Null Handling

```typescript
// Good: Explicit null checks
function getUser(id: string): User | null {
  const user = users.get(id);
  return user ?? null;
}

// Good: Optional chaining
const userName = user?.profile?.displayName;

// Good: Nullish coalescing
const name = userName ?? "Anonymous";

// Good: Non-null assertion only when certain
function processUser(id: string) {
  const user = getUser(id);
  if (!user) throw new Error("User not found");

  // Now TypeScript knows user is not null
  console.log(user.name);
}
```

### Module Organization

```typescript
// Good: Named exports for utilities
export function formatDate(date: Date): string { ... }
export function parseDate(str: string): Date { ... }

// Good: Default export for main component/class
export default class UserService { ... }

// Good: Re-export from index files
// lib/index.ts
export { formatDate, parseDate } from "./date";
export { formatCurrency } from "./currency";
export type { DateFormat, CurrencyCode } from "./types";
```

## Common Mistakes

### Mistake: Using `any`

```typescript
// Bad: any defeats type checking
function process(data: any) {
  return data.foo.bar; // No error, but might crash
}

// Good: Use unknown for truly unknown types
function process(data: unknown) {
  if (isValidData(data)) {
    return data.foo.bar; // Type-safe after guard
  }
  throw new Error("Invalid data");
}
```

### Mistake: Type Assertions Overuse

```typescript
// Bad: Forcing type without validation
const user = apiResponse as User;

// Good: Validate at runtime
function parseUser(data: unknown): User {
  if (!isUser(data)) {
    throw new Error("Invalid user data");
  }
  return data;
}
```

### Mistake: Ignoring strictNullChecks

```typescript
// Bad: Assuming value exists
function getName(user: User | undefined) {
  return user.name; // Error with strictNullChecks
}

// Good: Handle null case
function getName(user: User | undefined) {
  return user?.name ?? "Unknown";
}
```

### Mistake: Enum Misuse

```typescript
// Bad: Numeric enums can be error-prone
enum Status {
  Active,    // 0
  Inactive,  // 1
}

// Good: String literal unions
type Status = "active" | "inactive";

// Or const enum for compile-time only
const enum HttpMethod {
  GET = "GET",
  POST = "POST",
}
```

### Mistake: Object.keys Typing

```typescript
// Bad: Object.keys returns string[]
const keys = Object.keys(user); // string[]
user[keys[0]]; // Error: can't index with string

// Good: Type-safe key iteration
function getKeys<T extends object>(obj: T): (keyof T)[] {
  return Object.keys(obj) as (keyof T)[];
}

// Or use for...in with type guard
for (const key in user) {
  if (Object.hasOwn(user, key)) {
    console.log(user[key as keyof User]);
  }
}
```

### Mistake: Mutable Default Parameters

```typescript
// Bad: Shared mutable default
function addItem(item: string, list: string[] = []) {
  list.push(item); // Mutates default!
  return list;
}

// Good: Create new array
function addItem(item: string, list: string[] = []) {
  return [...list, item];
}
```

## Review Checklist

- [ ] No `any` types (use `unknown` if needed)
- [ ] Type assertions validated at runtime
- [ ] Strict null checks enabled and handled
- [ ] Generic constraints are appropriate
- [ ] Union types used for variants
- [ ] Utility types used where applicable
- [ ] Exports are properly typed
- [ ] No implicit any in function parameters
- [ ] Error types are defined and thrown
- [ ] tsconfig.json has strict mode enabled

## Resources

- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [TypeScript Deep Dive](https://basarat.gitbook.io/typescript/)
- [Total TypeScript](https://www.totaltypescript.com/)
