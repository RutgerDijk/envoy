# React Stack Profile

## Detection

```bash
# Detect React projects
grep -l '"react"' package.json 2>/dev/null
```

## Best Practices

### Project Structure

```
src/
├── components/             # Reusable UI components
│   ├── ui/                 # Base components (Button, Input, etc.)
│   └── features/           # Feature-specific components
├── pages/                  # Route-level components
├── hooks/                  # Custom React hooks
├── lib/                    # Utilities and helpers
├── services/               # API client and external services
├── stores/                 # State management (if using)
├── types/                  # TypeScript type definitions
└── App.tsx
```

### Component Patterns

```tsx
// Good: Typed props with destructuring
interface UserCardProps {
  user: User;
  onSelect?: (user: User) => void;
  className?: string;
}

export function UserCard({ user, onSelect, className }: UserCardProps) {
  return (
    <div className={cn("rounded-lg p-4", className)}>
      <h3>{user.name}</h3>
      {onSelect && (
        <button onClick={() => onSelect(user)}>Select</button>
      )}
    </div>
  );
}
```

### Custom Hooks

```tsx
// Good: Extract reusable logic into hooks
function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : initialValue;
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}
```

### Event Handlers

```tsx
// Good: Named handlers, proper typing
function ContactForm() {
  const [email, setEmail] = useState("");

  const handleEmailChange = (e: ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Submit logic
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={handleEmailChange}
      />
    </form>
  );
}
```

### Conditional Rendering

```tsx
// Good: Clear conditional patterns
function UserStatus({ user }: { user: User | null }) {
  if (!user) {
    return <LoginPrompt />;
  }

  return (
    <div>
      <span>{user.name}</span>
      {user.isAdmin && <AdminBadge />}
    </div>
  );
}
```

### Error Boundaries

```tsx
// Good: Error boundary for graceful failures
class ErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Error caught by boundary:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
```

## Common Mistakes

### Mistake: Missing Key Prop

```tsx
// Bad: Missing key in list
{users.map(user => <UserCard user={user} />)}

// Good: Unique key prop
{users.map(user => <UserCard key={user.id} user={user} />)}
```

### Mistake: Stale Closure in useEffect

```tsx
// Bad: Stale value in effect
const [count, setCount] = useState(0);

useEffect(() => {
  const interval = setInterval(() => {
    setCount(count + 1); // Always uses initial count
  }, 1000);
  return () => clearInterval(interval);
}, []); // Missing dependency

// Good: Functional update
useEffect(() => {
  const interval = setInterval(() => {
    setCount(c => c + 1); // Uses current value
  }, 1000);
  return () => clearInterval(interval);
}, []);
```

### Mistake: Object/Array in Dependency Array

```tsx
// Bad: New object reference every render
useEffect(() => {
  fetchData(options);
}, [options]); // Runs every render if options = { limit: 10 }

// Good: Primitive values or useMemo
const memoizedOptions = useMemo(() => ({ limit: 10 }), []);
useEffect(() => {
  fetchData(memoizedOptions);
}, [memoizedOptions]);
```

### Mistake: Inline Functions in Props

```tsx
// Bad: New function every render (breaks memoization)
<ExpensiveComponent onClick={() => handleClick(id)} />

// Good: useCallback for stable reference
const handleItemClick = useCallback(() => {
  handleClick(id);
}, [id, handleClick]);

<ExpensiveComponent onClick={handleItemClick} />
```

### Mistake: State Updates After Unmount

```tsx
// Bad: Can cause memory leak warning
useEffect(() => {
  fetchUser(id).then(user => {
    setUser(user); // May run after unmount
  });
}, [id]);

// Good: Cleanup with AbortController
useEffect(() => {
  const controller = new AbortController();

  fetchUser(id, { signal: controller.signal })
    .then(setUser)
    .catch(e => {
      if (e.name !== 'AbortError') throw e;
    });

  return () => controller.abort();
}, [id]);
```

### Mistake: Prop Drilling

```tsx
// Bad: Passing props through many levels
<App user={user}>
  <Layout user={user}>
    <Sidebar user={user}>
      <UserMenu user={user} />

// Good: Context for shared state
const UserContext = createContext<User | null>(null);

function App({ user }: { user: User }) {
  return (
    <UserContext.Provider value={user}>
      <Layout>
        <Sidebar>
          <UserMenu />
```

## Review Checklist

- [ ] Components have typed props interfaces
- [ ] Lists have unique `key` props
- [ ] Effects have correct dependency arrays
- [ ] No state updates after unmount
- [ ] useCallback/useMemo used appropriately
- [ ] Error boundaries wrap critical sections
- [ ] Context used instead of deep prop drilling
- [ ] Event handlers properly typed
- [ ] Forms use controlled components
- [ ] Accessibility attributes present (aria-*, role)

## Resources

- [React Documentation](https://react.dev/)
- [React TypeScript Cheatsheet](https://react-typescript-cheatsheet.netlify.app/)
- [Patterns.dev React Patterns](https://www.patterns.dev/react)
