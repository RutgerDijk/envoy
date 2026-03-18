---
applyTo: '**/*.{tsx,jsx}'
---

# React Best Practices

## Project Structure

```
src/
├── components/
│   ├── ui/          # Base components (Button, Input, Dialog)
│   └── features/    # Feature-specific components
├── pages/           # Route-level components
├── hooks/           # Custom React hooks
├── lib/             # Utilities and helpers
├── services/        # API client and external services
└── types/           # TypeScript type definitions
```

## Component Patterns

Always use typed props with destructuring:

```tsx
interface UserCardProps {
  user: User;
  onSelect?: (user: User) => void;
  className?: string;
}

export function UserCard({ user, onSelect, className }: UserCardProps) {
  return (
    <div className={cn("rounded-lg p-4", className)}>
      <h3>{user.name}</h3>
      {onSelect && <button onClick={() => onSelect(user)}>Select</button>}
    </div>
  );
}
```

## Custom Hooks

Extract reusable stateful logic into hooks:

```tsx
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}
```

## Event Handlers

Name handlers explicitly:

```tsx
const handleEmailChange = (e: ChangeEvent<HTMLInputElement>) => {
  setEmail(e.target.value);
};
const handleSubmit = (e: FormEvent) => {
  e.preventDefault();
  // ...
};
```

## Common Mistakes to Avoid

- ❌ Mutating state directly → always return new objects/arrays
- ❌ `useEffect` with missing dependencies → include all referenced values
- ❌ Inline event handlers in lists → extract to named handlers
- ❌ Key prop as list index on reorderable lists → use stable unique IDs
- ❌ `any` type → use specific types or `unknown`
- ❌ Boolean props written as `enabled={true}` → write as `enabled`
- ❌ Conditional hooks → hooks must always be called in same order
