# Tailwind CSS Stack Profile

## Detection

```bash
# Detect Tailwind CSS
grep -E '"tailwindcss"' package.json 2>/dev/null | head -1
```

## Best Practices

### Configuration

```javascript
// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["Inter var", "sans-serif"],
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-in": {
          from: { transform: "translateY(-10px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "slide-in": "slide-in 0.3s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
```

### CSS Variables

```css
/* globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;
    /* ... dark mode values */
  }
}
```

### Component Patterns

```typescript
// Responsive design
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {items.map((item) => (
    <Card key={item.id} item={item} />
  ))}
</div>

// Hover and focus states
<button className="bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-colors">
  Click me
</button>

// Conditional classes with cn()
import { cn } from "@/lib/utils";

<div className={cn(
  "rounded-lg border p-4",
  isActive && "border-primary bg-primary/5",
  isDisabled && "opacity-50 pointer-events-none"
)}>
```

### Layout Patterns

```typescript
// Centered container
<div className="container mx-auto px-4 max-w-7xl">
  <Content />
</div>

// Flex layouts
<div className="flex items-center justify-between gap-4">
  <Logo />
  <Navigation />
</div>

// Stack (vertical spacing)
<div className="flex flex-col gap-4">
  <Header />
  <Main />
  <Footer />
</div>

// Sticky header
<header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
  <nav className="container flex h-14 items-center">
    {/* ... */}
  </nav>
</header>
```

### Typography

```typescript
// Heading hierarchy
<h1 className="text-4xl font-bold tracking-tight">Page Title</h1>
<h2 className="text-2xl font-semibold tracking-tight">Section</h2>
<h3 className="text-xl font-medium">Subsection</h3>

// Body text
<p className="text-muted-foreground leading-7">
  Lorem ipsum...
</p>

// Small text
<span className="text-sm text-muted-foreground">
  Updated 2 hours ago
</span>

// Truncation
<p className="truncate">Very long text that will be truncated...</p>
<p className="line-clamp-2">Text limited to two lines...</p>
```

## Common Mistakes

### Mistake: Arbitrary Values Overuse

```typescript
// Bad: Arbitrary values everywhere
<div className="p-[13px] mt-[27px] text-[15px]">

// Good: Use design system values
<div className="p-3 mt-6 text-sm">
```

### Mistake: Not Using Theme Colors

```typescript
// Bad: Hardcoded colors
<button className="bg-blue-500 text-white hover:bg-blue-600">

// Good: Semantic colors
<button className="bg-primary text-primary-foreground hover:bg-primary/90">
```

### Mistake: Duplicate Utility Patterns

```typescript
// Bad: Repeated utility combinations
<div className="flex items-center justify-center">
<div className="flex items-center justify-center">
<div className="flex items-center justify-center">

// Good: Extract to component or use @apply
// components/center.tsx
function Center({ children }) {
  return <div className="flex items-center justify-center">{children}</div>;
}

// Or in CSS (sparingly)
@layer components {
  .center {
    @apply flex items-center justify-center;
  }
}
```

### Mistake: Forgetting Dark Mode

```typescript
// Bad: Only light mode colors
<div className="bg-white text-gray-900">

// Good: Dark mode support
<div className="bg-background text-foreground">
// or
<div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
```

### Mistake: Missing Focus States

```typescript
// Bad: No visible focus
<button className="bg-primary hover:bg-primary/90">

// Good: Clear focus indication
<button className="bg-primary hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
```

### Mistake: Inconsistent Spacing

```typescript
// Bad: Inconsistent spacing values
<div className="p-3">
  <div className="mb-5">
    <div className="mt-7">

// Good: Consistent spacing scale
<div className="p-4">
  <div className="space-y-4">
    {/* Children automatically spaced */}
```

## Review Checklist

- [ ] Theme colors used (not hardcoded)
- [ ] Responsive breakpoints applied
- [ ] Dark mode supported
- [ ] Focus states visible
- [ ] Spacing consistent with scale
- [ ] Typography uses semantic classes
- [ ] Animations are subtle and purposeful
- [ ] cn() used for conditional classes
- [ ] Arbitrary values minimized
- [ ] Accessibility classes present (sr-only)

## Resources

- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Tailwind CSS Cheat Sheet](https://nerdcave.com/tailwind-cheat-sheet)
- [Tailwind UI](https://tailwindui.com/)
