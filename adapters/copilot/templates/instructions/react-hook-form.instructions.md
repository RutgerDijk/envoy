---
applyTo: '**/*.{tsx,jsx}'
---

# React Hook Form + Zod Best Practices

## Schema Definition

```typescript
// schemas/user.schema.ts
import { z } from "zod";

export const createUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Must contain uppercase")
    .regex(/[0-9]/, "Must contain a number"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export type CreateUserFormData = z.infer<typeof createUserSchema>;
```

## Form Setup

```typescript
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

export function CreateUserForm() {
  const form = useForm<CreateUserFormData>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  const onSubmit = async (data: CreateUserFormData) => {
    // data is fully typed and validated
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}
```

## Async Validation

```typescript
email: z.string().email().refine(
  async (email) => !(await checkEmailExists(email)),
  "This email is already registered"
)
```

## Common Mistakes to Avoid

- ❌ Manual `useState` for form fields alongside RHF → let RHF manage state
- ❌ `onChange` parsing in handlers → put parsing in `transform` or Zod `.transform()`
- ❌ Using `watch()` in loops → use `useWatch` for performance
- ❌ Forgetting to call `form.reset()` after successful submit
- ❌ Too-eager validation on blur → use `mode: "onBlur"` only for UX-sensitive flows
- ❌ Validation schema defined inline in component → define in a separate schema file
