---
applyTo: '**/*.{ts,tsx}'
---

# TanStack React Query Best Practices

## Provider Setup

```typescript
// app/providers.tsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,      // 5 min
      gcTime: 1000 * 60 * 30,         // 30 min
      retry: 3,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 1 },
  },
});
```

## Query Keys Factory

```typescript
// lib/query-keys.ts
export const queryKeys = {
  users: {
    all: ["users"] as const,
    lists: () => [...queryKeys.users.all, "list"] as const,
    detail: (id: number) => [...queryKeys.users.all, "detail", id] as const,
  },
} as const;
```

## Query Hooks

```typescript
// hooks/use-users.ts
export function useUsers(filters: UserFilters) {
  return useQuery({
    queryKey: queryKeys.users.lists(),
    queryFn: ({ signal }) => usersApi.getAll(filters, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useUser(id: number) {
  return useQuery({
    queryKey: queryKeys.users.detail(id),
    queryFn: ({ signal }) => usersApi.getById(id, { signal }),
    enabled: id > 0,
  });
}
```

## Mutation with Cache Invalidation

```typescript
export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateUserDto) => usersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
    onError: (error) => {
      toast.error(`Failed to create user: ${error.message}`);
    },
  });
}
```

## Optimistic Updates

```typescript
useMutation({
  mutationFn: updateUser,
  onMutate: async (updatedUser) => {
    await queryClient.cancelQueries({ queryKey: queryKeys.users.detail(updatedUser.id) });
    const previous = queryClient.getQueryData(queryKeys.users.detail(updatedUser.id));
    queryClient.setQueryData(queryKeys.users.detail(updatedUser.id), updatedUser);
    return { previous };
  },
  onError: (_, __, context) => {
    queryClient.setQueryData(queryKeys.users.detail(context!.id), context!.previous);
  },
  onSettled: (_, __, { id }) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.users.detail(id) });
  },
});
```

## Common Mistakes to Avoid

- ❌ Hardcoded query keys as strings → use a query keys factory
- ❌ Manual loading state with `useState` → use `isLoading` from `useQuery`
- ❌ Fetching on button click with `useQuery` → use `useQuery` with `enabled: false` + `refetch()`, or `useMutation`
- ❌ Not passing `signal` to fetch → cancellation won't work
- ❌ Forgetting to invalidate after mutations → stale UI
