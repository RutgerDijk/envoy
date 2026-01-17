# shadcn/ui + Radix UI Stack Profile

## Detection

```bash
# Detect shadcn/ui or Radix
grep -E '"@radix-ui|"class-variance-authority"' package.json 2>/dev/null | head -1
```

## Best Practices

### Component Structure

```
src/
├── components/
│   ├── ui/                     # shadcn/ui base components
│   │   ├── button.tsx
│   │   ├── dialog.tsx
│   │   └── input.tsx
│   └── features/               # Feature-specific compositions
│       ├── user-form.tsx
│       └── data-table.tsx
└── lib/
    └── utils.ts                # cn() utility
```

### Utility Function

```typescript
// lib/utils.ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### Button Component Pattern

```typescript
// components/ui/button.tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
```

### Dialog Pattern

```typescript
// components/ui/dialog.tsx
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out",
      className
    )}
    {...props}
  />
));

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] rounded-lg border bg-background p-6 shadow-lg",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));

export { Dialog, DialogTrigger, DialogContent, DialogClose };
```

### Composition Example

```typescript
// components/features/confirm-dialog.tsx
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  trigger: React.ReactNode;
  title: string;
  description: string;
  onConfirm: () => void;
  confirmText?: string;
  variant?: "default" | "destructive";
}

export function ConfirmDialog({
  trigger,
  title,
  description,
  onConfirm,
  confirmText = "Confirm",
  variant = "default",
}: ConfirmDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="flex justify-end gap-2 mt-4">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant={variant} onClick={onConfirm}>
              {confirmText}
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

## Common Mistakes

### Mistake: Not Using Radix Primitives

```typescript
// Bad: Custom accessibility implementation
function Dialog({ open, onClose, children }) {
  return open ? (
    <div className="dialog" onClick={onClose}>
      {children}
    </div>
  ) : null;
}

// Good: Use Radix primitives for accessibility
import * as DialogPrimitive from "@radix-ui/react-dialog";

function Dialog({ open, onOpenChange, children }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Content>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Root>
  );
}
```

### Mistake: Hardcoded Colors

```typescript
// Bad: Hardcoded colors
<Button className="bg-blue-500 hover:bg-blue-600">

// Good: Use semantic tokens
<Button className="bg-primary hover:bg-primary/90">
```

### Mistake: Not Using asChild

```typescript
// Bad: Wrapper div breaks semantics
<DialogTrigger>
  <Button>Open</Button>
</DialogTrigger>

// Good: asChild passes props to child
<DialogTrigger asChild>
  <Button>Open</Button>
</DialogTrigger>
```

### Mistake: Inline Styles Instead of Variants

```typescript
// Bad: Inline conditional classes
<Button className={isLoading ? "opacity-50" : ""}>

// Good: Use disabled state
<Button disabled={isLoading}>
  {isLoading && <Spinner className="mr-2" />}
  Submit
</Button>
```

### Mistake: Missing Screen Reader Text

```typescript
// Bad: Icon-only button without label
<Button size="icon">
  <X className="h-4 w-4" />
</Button>

// Good: Include sr-only text
<Button size="icon">
  <X className="h-4 w-4" />
  <span className="sr-only">Close</span>
</Button>
```

### Mistake: Not Forwarding Refs

```typescript
// Bad: Ref not forwarded
function CustomButton({ className, ...props }) {
  return <button className={cn("...", className)} {...props} />;
}

// Good: Forward ref for composition
const CustomButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
  <button ref={ref} className={cn("...", className)} {...props} />
));
```

## Review Checklist

- [ ] Radix primitives used for interactive components
- [ ] cn() utility for class merging
- [ ] Semantic color tokens used
- [ ] asChild used for trigger components
- [ ] Variants defined with CVA
- [ ] Refs forwarded properly
- [ ] Screen reader text for icon buttons
- [ ] Keyboard navigation works
- [ ] Focus states visible
- [ ] Dark mode supported via tokens

## Resources

- [shadcn/ui Documentation](https://ui.shadcn.com/)
- [Radix UI Primitives](https://www.radix-ui.com/primitives)
- [Class Variance Authority](https://cva.style/docs)
