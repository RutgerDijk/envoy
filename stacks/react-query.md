# TanStack React Query Stack Profile

## Detection

```bash
# Detect React Query
grep -E '"@tanstack/react-query"' package.json 2>/dev/null | head -1
```

## Best Practices

### Provider Setup

```typescript
// app/providers.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30, // 30 minutes
      retry: 3,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 1,
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
```

### Query Keys Factory

```typescript
// lib/query-keys.ts
export const queryKeys = {
  users: {
    all: ["users"] as const,
    lists: () => [...queryKeys.users.all, "list"] as const,
    list: (filters: UserFilters) =>
      [...queryKeys.users.lists(), filters] as const,
    details: () => [...queryKeys.users.all, "detail"] as const,
    detail: (id: number) => [...queryKeys.users.details(), id] as const,
  },
  orders: {
    all: ["orders"] as const,
    byUser: (userId: number) => [...queryKeys.orders.all, "user", userId] as const,
  },
} as const;
```

### Custom Query Hook

```typescript
// hooks/use-users.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { api } from "@/lib/api";

export function useUsers(filters?: UserFilters) {
  return useQuery({
    queryKey: queryKeys.users.list(filters ?? {}),
    queryFn: () => api.users.list(filters),
  });
}

export function useUser(id: number) {
  return useQuery({
    queryKey: queryKeys.users.detail(id),
    queryFn: () => api.users.get(id),
    enabled: id > 0,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.users.create,
    onSuccess: (newUser) => {
      // Invalidate list queries
      queryClient.invalidateQueries({ queryKey: queryKeys.users.lists() });

      // Optionally set the new user in cache
      queryClient.setQueryData(queryKeys.users.detail(newUser.id), newUser);
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateUserDto }) =>
      api.users.update(id, data),
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(
        queryKeys.users.detail(updatedUser.id),
        updatedUser
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.users.lists() });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.users.delete,
    onSuccess: (_, deletedId) => {
      queryClient.removeQueries({ queryKey: queryKeys.users.detail(deletedId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.users.lists() });
    },
  });
}
```

### Optimistic Updates

```typescript
export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateUserDto }) =>
      api.users.update(id, data),

    onMutate: async ({ id, data }) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: queryKeys.users.detail(id) });

      // Snapshot previous value
      const previousUser = queryClient.getQueryData<User>(
        queryKeys.users.detail(id)
      );

      // Optimistically update
      if (previousUser) {
        queryClient.setQueryData(queryKeys.users.detail(id), {
          ...previousUser,
          ...data,
        });
      }

      return { previousUser };
    },

    onError: (err, { id }, context) => {
      // Rollback on error
      if (context?.previousUser) {
        queryClient.setQueryData(
          queryKeys.users.detail(id),
          context.previousUser
        );
      }
    },

    onSettled: (_, __, { id }) => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: queryKeys.users.detail(id) });
    },
  });
}
```

### Pagination

```typescript
export function useUsersPaginated(page: number, pageSize: number) {
  return useQuery({
    queryKey: queryKeys.users.list({ page, pageSize }),
    queryFn: () => api.users.list({ page, pageSize }),
    placeholderData: keepPreviousData, // Smooth page transitions
  });
}

// Usage
function UserList() {
  const [page, setPage] = useState(1);
  const { data, isPlaceholderData } = useUsersPaginated(page, 10);

  return (
    <div className={isPlaceholderData ? "opacity-50" : ""}>
      {data?.items.map((user) => (
        <UserCard key={user.id} user={user} />
      ))}
      <Pagination
        page={page}
        totalPages={data?.totalPages ?? 1}
        onPageChange={setPage}
        hasNextPage={!isPlaceholderData && data?.hasNextPage}
      />
    </div>
  );
}
```

### Infinite Queries

```typescript
export function useUsersInfinite() {
  return useInfiniteQuery({
    queryKey: queryKeys.users.lists(),
    queryFn: ({ pageParam }) => api.users.list({ cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

// Usage
function UserList() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useUsersInfinite();

  const allUsers = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      {allUsers.map((user) => (
        <UserCard key={user.id} user={user} />
      ))}
      {hasNextPage && (
        <Button onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? "Loading..." : "Load More"}
        </Button>
      )}
    </>
  );
}
```

## Common Mistakes

### Mistake: Inline Query Keys

```typescript
// Bad: String keys are error-prone
useQuery({ queryKey: ["users", id], ... });
useQuery({ queryKey: ["user", id], ... }); // Typo!

// Good: Factory pattern
useQuery({ queryKey: queryKeys.users.detail(id), ... });
```

### Mistake: Not Invalidating Related Queries

```typescript
// Bad: Only updates detail, list shows stale data
onSuccess: (updatedUser) => {
  queryClient.setQueryData(queryKeys.users.detail(updatedUser.id), updatedUser);
};

// Good: Invalidate related queries
onSuccess: (updatedUser) => {
  queryClient.setQueryData(queryKeys.users.detail(updatedUser.id), updatedUser);
  queryClient.invalidateQueries({ queryKey: queryKeys.users.lists() });
};
```

### Mistake: Not Handling Loading/Error States

```typescript
// Bad: No loading state handling
function UserProfile({ id }: { id: number }) {
  const { data } = useUser(id);
  return <div>{data.name}</div>; // Crashes if loading
}

// Good: Handle all states
function UserProfile({ id }: { id: number }) {
  const { data, isLoading, error } = useUser(id);

  if (isLoading) return <Skeleton />;
  if (error) return <ErrorMessage error={error} />;
  if (!data) return null;

  return <div>{data.name}</div>;
}
```

### Mistake: Fetching in useEffect

```typescript
// Bad: Manual fetching bypasses cache
useEffect(() => {
  fetchUser(id).then(setUser);
}, [id]);

// Good: Use React Query
const { data: user } = useUser(id);
```

### Mistake: Wrong Stale Time

```typescript
// Bad: Too short staleTime causes excessive requests
useQuery({
  queryKey: ["users"],
  queryFn: fetchUsers,
  staleTime: 0, // Refetches on every mount
});

// Good: Appropriate staleTime for data type
useQuery({
  queryKey: ["users"],
  queryFn: fetchUsers,
  staleTime: 1000 * 60 * 5, // 5 minutes
});
```

### Mistake: Not Disabling Queries

```typescript
// Bad: Fetches with undefined id
const { data } = useQuery({
  queryKey: ["user", id],
  queryFn: () => fetchUser(id!), // Non-null assertion!
});

// Good: Disable until id is available
const { data } = useQuery({
  queryKey: ["user", id],
  queryFn: () => fetchUser(id!),
  enabled: !!id,
});
```

## Review Checklist

- [ ] Query key factory pattern used
- [ ] Related queries invalidated on mutations
- [ ] Loading and error states handled
- [ ] Appropriate staleTime configured
- [ ] Queries disabled when dependencies missing
- [ ] Optimistic updates with rollback
- [ ] Pagination uses placeholderData
- [ ] DevTools configured for development
- [ ] No manual fetching in useEffect
- [ ] gcTime appropriate for memory usage

## Resources

- [TanStack Query Documentation](https://tanstack.com/query/latest)
- [Practical React Query](https://tkdodo.eu/blog/practical-react-query)
- [Query Key Factory](https://tkdodo.eu/blog/effective-react-query-keys)
