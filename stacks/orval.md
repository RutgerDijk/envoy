# Orval Stack Profile

## Detection

```bash
# Detect Orval
grep -E '"orval"' package.json 2>/dev/null | head -1
```

## Best Practices

### Configuration

```javascript
// orval.config.ts
import { defineConfig } from "orval";

export default defineConfig({
  api: {
    input: {
      target: "./openapi.json", // Or API URL
      // target: "http://localhost:5000/swagger/v1/swagger.json",
    },
    output: {
      target: "./src/api/generated.ts",
      client: "react-query",
      mode: "tags-split", // Separate files per tag
      override: {
        mutator: {
          path: "./src/api/custom-instance.ts",
          name: "customInstance",
        },
        query: {
          useQuery: true,
          useMutation: true,
          signal: true,
        },
      },
    },
    hooks: {
      afterAllFilesWrite: "prettier --write",
    },
  },
});
```

### Custom Axios Instance

```typescript
// src/api/custom-instance.ts
import Axios, { AxiosRequestConfig, AxiosError } from "axios";

export const AXIOS_INSTANCE = Axios.create({
  baseURL: import.meta.env.VITE_API_URL,
});

// Request interceptor for auth
AXIOS_INSTANCE.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor for errors
AXIOS_INSTANCE.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Handle token refresh or logout
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export const customInstance = <T>(
  config: AxiosRequestConfig,
  options?: AxiosRequestConfig
): Promise<T> => {
  const source = Axios.CancelToken.source();
  const promise = AXIOS_INSTANCE({
    ...config,
    ...options,
    cancelToken: source.token,
  }).then(({ data }) => data);

  // @ts-expect-error - adding cancel method
  promise.cancel = () => {
    source.cancel("Query was cancelled");
  };

  return promise;
};

export default customInstance;
```

### Generated Code Usage

```typescript
// Generated hooks usage
import { useGetUsers, useCreateUser, useGetUser } from "@/api/generated";

function UserList() {
  // Query hook
  const { data: users, isLoading, error } = useGetUsers();

  // Mutation hook
  const createUser = useCreateUser();

  const handleCreate = async () => {
    await createUser.mutateAsync({
      data: { name: "John", email: "john@example.com" },
    });
  };

  if (isLoading) return <Spinner />;
  if (error) return <Error message={error.message} />;

  return (
    <div>
      {users?.map((user) => (
        <UserCard key={user.id} user={user} />
      ))}
      <Button onClick={handleCreate}>Add User</Button>
    </div>
  );
}
```

### Type-Safe API Calls

```typescript
// Types are auto-generated from OpenAPI spec
import type { User, CreateUserDto, UpdateUserDto } from "@/api/generated";

// Function signatures match API exactly
function UserForm({ user }: { user?: User }) {
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();

  const onSubmit = async (data: CreateUserDto | UpdateUserDto) => {
    if (user) {
      await updateUser.mutateAsync({ id: user.id, data });
    } else {
      await createUser.mutateAsync({ data });
    }
  };
}
```

### Custom Query Options

```typescript
// orval.config.ts - Override query options
export default defineConfig({
  api: {
    output: {
      override: {
        query: {
          useQuery: true,
          options: {
            staleTime: 10000,
          },
        },
        operations: {
          getUsers: {
            query: {
              options: {
                staleTime: 60000, // Users list cached longer
              },
            },
          },
        },
      },
    },
  },
});
```

### MSW Mocking

```typescript
// orval.config.ts - Generate MSW handlers
export default defineConfig({
  api: {
    output: {
      target: "./src/api/generated.ts",
      client: "react-query",
      mock: true, // Generate MSW handlers
    },
  },
});

// src/mocks/handlers.ts
import { getGetUsersMock } from "@/api/generated.msw";

export const handlers = [
  ...getGetUsersMock(),
  // Custom overrides
  rest.get("/api/users", (req, res, ctx) => {
    return res(ctx.json([{ id: 1, name: "Test User" }]));
  }),
];
```

## Common Mistakes

### Mistake: Not Regenerating After API Changes

```bash
# Bad: Generated code out of sync with API
# Frontend still using old types after backend change

# Good: Regenerate in CI and watch mode
npm run generate:api
# Or watch mode during development
npx orval --watch
```

### Mistake: Editing Generated Files

```typescript
// Bad: Modifying generated code directly
// src/api/generated.ts
export const useGetUsers = () => {
  // Custom logic added here - WILL BE OVERWRITTEN
};

// Good: Wrap generated hooks
// src/hooks/use-users.ts
import { useGetUsers as useGetUsersGenerated } from "@/api/generated";

export function useGetUsers() {
  const query = useGetUsersGenerated();

  // Add custom logic here
  return {
    ...query,
    activeUsers: query.data?.filter((u) => u.isActive),
  };
}
```

### Mistake: Missing Base URL Configuration

```typescript
// Bad: Hardcoded URL in instance
const AXIOS_INSTANCE = Axios.create({
  baseURL: "http://localhost:5000",
});

// Good: Environment-based configuration
const AXIOS_INSTANCE = Axios.create({
  baseURL: import.meta.env.VITE_API_URL,
});
```

### Mistake: Not Handling Auth Tokens

```typescript
// Bad: No auth handling
export const customInstance = <T>(config: AxiosRequestConfig): Promise<T> => {
  return AXIOS_INSTANCE(config).then(({ data }) => data);
};

// Good: Interceptor for auth
AXIOS_INSTANCE.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
```

### Mistake: Ignoring Error Types

```typescript
// Bad: Untyped error handling
const { error } = useGetUsers();
if (error) {
  console.log(error.message); // May not have message
}

// Good: Type-safe error handling
import type { AxiosError } from "axios";
import type { ProblemDetails } from "@/api/generated";

const { error } = useGetUsers();
if (error) {
  const axiosError = error as AxiosError<ProblemDetails>;
  console.log(axiosError.response?.data?.detail);
}
```

### Mistake: Not Using Tags Split Mode

```typescript
// Bad: Single giant file
output: {
  target: "./src/api/generated.ts",
  mode: "single",
}

// Good: Split by OpenAPI tags
output: {
  target: "./src/api/",
  mode: "tags-split",
}
// Creates: users.ts, orders.ts, products.ts, etc.
```

## Review Checklist

- [ ] Orval config uses environment-based API URL
- [ ] Custom instance handles authentication
- [ ] Generated code not manually edited
- [ ] Wrapper hooks for custom logic
- [ ] MSW mocks generated for testing
- [ ] Types imported from generated files
- [ ] Error types properly handled
- [ ] Tags-split mode for large APIs
- [ ] Generation runs in CI pipeline
- [ ] Watch mode for development

## Resources

- [Orval Documentation](https://orval.dev/)
- [OpenAPI Specification](https://swagger.io/specification/)
- [React Query Integration](https://orval.dev/reference/configuration/output#client)
