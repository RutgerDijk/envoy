---
applyTo: '**/{tailwind.config.*,*.css,*.module.css}'
---

# Tailwind CSS Best Practices

## Configuration

Use CSS variables for theming (enables dark mode and easy customization):

```javascript
// tailwind.config.js
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
      },
    },
  },
};
```

## The `cn()` Utility

Always use `cn()` for conditional class merging:

```typescript
// lib/utils.ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Usage
<div className={cn("p-4 rounded", isActive && "bg-primary", className)}>
```

## Responsive Design

Mobile-first approach using breakpoint prefixes:

```tsx
<div className="
  flex flex-col          // mobile: stack vertically
  md:flex-row            // tablet+: side by side
  md:items-center
  gap-4
">
```

Breakpoints: `sm` (640px), `md` (768px), `lg` (1024px), `xl` (1280px), `2xl` (1536px)

## Semantic Color Usage

Use semantic color names, not arbitrary values:

```tsx
// Good — uses design system tokens
<button className="bg-primary text-primary-foreground hover:bg-primary/90">

// Bad — hard-coded colors that won't respect theming
<button className="bg-blue-600 text-white hover:bg-blue-700">
```

## Animation

Use Tailwind's built-in animations or extend with custom keyframes:

```tsx
<div className="animate-fadeIn">    // If defined in config
<div className="transition-colors duration-200">  // Smooth hover transitions
```

## Common Mistakes to Avoid

- ❌ Arbitrary values everywhere `[#ff0000]` → define design tokens in config
- ❌ Inline styles alongside Tailwind → use Tailwind or CSS, not both
- ❌ `!important` overrides → fix specificity issues instead
- ❌ Very long class strings in JSX → extract into a `cva` variant or a component
- ❌ Forgetting `dark:` variants when dark mode is enabled
