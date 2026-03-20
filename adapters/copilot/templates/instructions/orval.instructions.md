---
applyTo: '**/{orval.config.*,src/api/**}'
---

# Orval (OpenAPI → React Query) Best Practices

## Configuration

```typescript
// orval.config.ts
import { defineConfig } from "orval";

export default defineConfig({
  api: {
    input: {
      target: "./openapi.json",
      // Or fetch from running API:
      // target: "http://localhost:5000/swagger/v1/swagger.json",
    },
    output: {
      target: "./src/api/generated",
      client: "react-query",
      mode: "tags-split",          // Separate file per controller tag
      override: {
        mutator: {
          path: "./src/api/axios-instance.ts",
          name: "customInstance",
        },
        query: {
          useQuery: true,
          useMutation: true,
          signal: true,            // Pass AbortSignal for cancellation
        },
      },
    },
    hooks: {
      afterAllFilesWrite: "prettier --write",
    },
  },
});
```

## Custom Axios Instance

```typescript
// src/api/axios-instance.ts
import axios from "axios";

const axiosInstance = axios.create({ baseURL: import.meta.env.VITE_API_URL });

// Auth tokens are handled via httpOnly cookies — no manual header injection needed.
// If your API requires bearer tokens, retrieve them from a secure auth provider,
// not localStorage.

export const customInstance = <T>(config: Parameters<typeof axiosInstance>[0]): Promise<T> => {
  return axiosInstance(config).then((response) => response.data);
};
```

## Usage of Generated Hooks

```typescript
// Import from generated file — never modify generated files directly
import { useGetUsers, useCreateUser } from "@/api/generated/users";

function UserList() {
  const { data, isLoading } = useGetUsers();
  const { mutate: createUser } = useCreateUser();
  // ...
}
```

## Re-generate After API Changes

```bash
npm run generate-api   # Should run: orval
```

## Common Mistakes to Avoid

- ❌ Modifying generated files → they will be overwritten; use `override` in orval config instead
- ❌ No custom Axios instance → auth headers won't be added automatically
- ❌ `mode: "single"` for large APIs → use `tags-split` for better code splitting
- ❌ Not running Prettier after generation → `afterAllFilesWrite: "prettier --write"`
- ❌ Forgetting `signal: true` → prevents request cancellation on component unmount
