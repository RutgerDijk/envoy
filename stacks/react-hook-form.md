# React Hook Form + Zod Stack Profile

## Detection

```bash
# Detect React Hook Form with Zod
grep -E '"react-hook-form"|"zod"|"@hookform/resolvers"' package.json 2>/dev/null | head -1
```

## Best Practices

### Schema Definition

```typescript
// schemas/user.schema.ts
import { z } from "zod";

export const createUserSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be less than 100 characters"),

  email: z
    .string()
    .email("Invalid email address"),

  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[0-9]/, "Password must contain a number"),

  confirmPassword: z.string(),

  role: z.enum(["user", "admin", "moderator"]),

  age: z
    .number()
    .min(18, "Must be at least 18 years old")
    .optional(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export type CreateUserFormData = z.infer<typeof createUserSchema>;
```

### Form Component

```typescript
// components/user-form.tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createUserSchema, type CreateUserFormData } from "@/schemas/user.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

interface UserFormProps {
  onSubmit: (data: CreateUserFormData) => Promise<void>;
  defaultValues?: Partial<CreateUserFormData>;
}

export function UserForm({ onSubmit, defaultValues }: UserFormProps) {
  const form = useForm<CreateUserFormData>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      role: "user",
      ...defaultValues,
    },
  });

  const handleSubmit = async (data: CreateUserFormData) => {
    try {
      await onSubmit(data);
      form.reset();
    } catch (error) {
      form.setError("root", {
        message: "Failed to create user. Please try again.",
      });
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="John Doe" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="john@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input type="password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {form.formState.errors.root && (
          <p className="text-sm text-destructive">
            {form.formState.errors.root.message}
          </p>
        )}

        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Creating..." : "Create User"}
        </Button>
      </form>
    </Form>
  );
}
```

### Field Arrays

```typescript
// Dynamic list of items
const schema = z.object({
  items: z.array(z.object({
    name: z.string().min(1, "Name required"),
    quantity: z.number().min(1),
  })).min(1, "At least one item required"),
});

function OrderForm() {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { items: [{ name: "", quantity: 1 }] },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      {fields.map((field, index) => (
        <div key={field.id} className="flex gap-2">
          <Input {...form.register(`items.${index}.name`)} />
          <Input
            type="number"
            {...form.register(`items.${index}.quantity`, { valueAsNumber: true })}
          />
          <Button type="button" onClick={() => remove(index)}>
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" onClick={() => append({ name: "", quantity: 1 })}>
        Add Item
      </Button>
    </form>
  );
}
```

### Async Validation

```typescript
const schema = z.object({
  email: z
    .string()
    .email()
    .refine(
      async (email) => {
        const exists = await checkEmailExists(email);
        return !exists;
      },
      { message: "Email already in use" }
    ),
});

// Or with manual validation
const form = useForm({
  resolver: zodResolver(baseSchema),
});

const onSubmit = async (data: FormData) => {
  const emailExists = await checkEmailExists(data.email);
  if (emailExists) {
    form.setError("email", { message: "Email already in use" });
    return;
  }
  // Continue with submission
};
```

### Controlled Components

```typescript
// For complex inputs (Select, DatePicker, etc.)
<FormField
  control={form.control}
  name="role"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Role</FormLabel>
      <Select onValueChange={field.onChange} defaultValue={field.value}>
        <FormControl>
          <SelectTrigger>
            <SelectValue placeholder="Select a role" />
          </SelectTrigger>
        </FormControl>
        <SelectContent>
          <SelectItem value="user">User</SelectItem>
          <SelectItem value="admin">Admin</SelectItem>
        </SelectContent>
      </Select>
      <FormMessage />
    </FormItem>
  )}
/>
```

## Common Mistakes

### Mistake: Not Using Zod Resolver

```typescript
// Bad: Manual validation
const form = useForm({
  mode: "onBlur",
});

const onSubmit = (data) => {
  if (!data.email.includes("@")) {
    form.setError("email", { message: "Invalid email" });
    return;
  }
};

// Good: Zod resolver handles validation
const form = useForm({
  resolver: zodResolver(schema),
});
```

### Mistake: Wrong Type Inference

```typescript
// Bad: Manual type that can drift
interface FormData {
  name: string;
  email: string;
}

// Good: Infer from schema
type FormData = z.infer<typeof schema>;
```

### Mistake: Not Handling Submission Errors

```typescript
// Bad: No error handling
const onSubmit = async (data) => {
  await createUser(data);
};

// Good: Handle API errors
const onSubmit = async (data) => {
  try {
    await createUser(data);
  } catch (error) {
    if (error.code === "EMAIL_EXISTS") {
      form.setError("email", { message: "Email already in use" });
    } else {
      form.setError("root", { message: "Something went wrong" });
    }
  }
};
```

### Mistake: Missing Loading State

```typescript
// Bad: No loading indicator
<Button type="submit">Submit</Button>

// Good: Disable during submission
<Button type="submit" disabled={form.formState.isSubmitting}>
  {form.formState.isSubmitting ? "Submitting..." : "Submit"}
</Button>
```

### Mistake: Registering Numbers as Strings

```typescript
// Bad: Number comes as string
<Input type="number" {...register("age")} />
// age will be "25" instead of 25

// Good: Use valueAsNumber
<Input type="number" {...register("age", { valueAsNumber: true })} />
```

### Mistake: Not Resetting Form After Success

```typescript
// Bad: Form keeps old values after success
const onSubmit = async (data) => {
  await createUser(data);
  toast.success("User created!");
};

// Good: Reset form after success
const onSubmit = async (data) => {
  await createUser(data);
  form.reset();
  toast.success("User created!");
};
```

## Review Checklist

- [ ] Zod resolver configured
- [ ] Types inferred from schema
- [ ] Form errors displayed
- [ ] Root error for API failures
- [ ] Loading state during submission
- [ ] Form reset after successful submission
- [ ] Number inputs use valueAsNumber
- [ ] Field arrays have unique keys
- [ ] Async validation handled properly
- [ ] Controlled components use onChange/value

## Resources

- [React Hook Form Documentation](https://react-hook-form.com/)
- [Zod Documentation](https://zod.dev/)
- [shadcn/ui Form Component](https://ui.shadcn.com/docs/components/form)
