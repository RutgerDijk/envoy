# Spec Document Template

Save as: `docs/plans/YYYY-MM-DD-feature-name.md`

---

```markdown
# Feature Name

> **For Claude:** Use envoy:executing-plans to implement this spec task-by-task.
>
> GitHub Issue: #123

## Overview

Brief summary of what will be implemented and why.

## Architecture

Technical approach, key decisions, and components involved.

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

---

## Implementation Plan

## Execution Strategy

**Strategy:** `batch` | `sequential` | `parallel`

- **batch**: Execute in phases with review checkpoints
- **sequential**: Execute tasks one by one
- **parallel**: Execute independent tasks concurrently

## Tasks

### Phase 1: Foundation

| # | Task | Description | Files | Est. |
|---|------|-------------|-------|------|
| 1 | Create database migration | Add new tables for feature | `Migrations/` | S |
| 2 | Add entity models | Define domain entities | `Domain/Entities/` | S |
| 3 | Create repository interface | Define data access contract | `Application/Interfaces/` | S |
| 4 | Implement repository | PostgreSQL implementation | `Infrastructure/Data/` | M |

**Checkpoint:** Database layer complete, can query new tables

### Phase 2: Business Logic

| # | Task | Description | Files | Est. |
|---|------|-------------|-------|------|
| 5 | Create DTOs | Request/response models | `Application/DTOs/` | S |
| 6 | Add validators | FluentValidation rules | `Application/Validators/` | S |
| 7 | Implement service | Business logic layer | `Application/Services/` | M |
| 8 | Write unit tests | Service layer tests | `Tests/Unit/` | M |

**Checkpoint:** Business logic complete, all unit tests pass

### Phase 3: API Layer

| # | Task | Description | Files | Est. |
|---|------|-------------|-------|------|
| 9 | Create controller | API endpoints | `Api/Controllers/` | M |
| 10 | Add Swagger docs | OpenAPI documentation | `Api/Controllers/` | S |
| 11 | Write integration tests | API endpoint tests | `Tests/Integration/` | M |

**Checkpoint:** API complete, Swagger shows new endpoints

### Phase 4: Frontend

| # | Task | Description | Files | Est. |
|---|------|-------------|-------|------|
| 12 | Generate API client | Run Orval generation | `src/api/` | S |
| 13 | Create form schema | Zod validation schema | `src/schemas/` | S |
| 14 | Build UI components | React components | `src/components/` | L |
| 15 | Create page | Main feature page | `src/pages/` | M |
| 16 | Add React Query hooks | Data fetching hooks | `src/hooks/` | M |
| 17 | Write E2E tests | Playwright tests | `e2e/` | M |

**Checkpoint:** Feature complete end-to-end

### Phase 5: Polish

| # | Task | Description | Files | Est. |
|---|------|-------------|-------|------|
| 18 | Add loading states | Skeleton loaders | `src/components/` | S |
| 19 | Implement error handling | Error boundaries, toasts | `src/components/` | S |
| 20 | Add accessibility | ARIA labels, keyboard nav | `src/components/` | S |
| 21 | Performance optimization | Memoization, lazy loading | Various | M |

**Checkpoint:** Production ready

## Size Estimates

- **S (Small)**: < 30 min, simple change
- **M (Medium)**: 30-60 min, moderate complexity
- **L (Large)**: 1-2 hours, complex implementation

## Dependencies

```mermaid
graph TD
    T1[1. Migration] --> T2[2. Entities]
    T2 --> T3[3. Repository Interface]
    T3 --> T4[4. Repository Impl]
    T4 --> T5[5. DTOs]
    T5 --> T6[6. Validators]
    T5 --> T7[7. Service]
    T6 --> T7
    T7 --> T8[8. Unit Tests]
    T7 --> T9[9. Controller]
    T9 --> T10[10. Swagger]
    T9 --> T11[11. Integration Tests]
    T9 --> T12[12. API Client]
    T12 --> T13[13. Form Schema]
    T12 --> T14[14. UI Components]
    T13 --> T15[15. Page]
    T14 --> T15
    T12 --> T16[16. Query Hooks]
    T15 --> T17[17. E2E Tests]
    T15 --> T18[18. Loading States]
    T15 --> T19[19. Error Handling]
    T15 --> T20[20. Accessibility]
    T15 --> T21[21. Performance]
```

## Verification Steps

After each phase:

1. Run tests: `dotnet test && npm test`
2. Check build: `dotnet build && npm run build`
3. Manual verification of new functionality
4. Code review checkpoint

## Rollback Plan

If issues are found:

1. Revert migrations if needed
2. Feature flag to disable
3. Previous API version still available

## Notes

- Follow existing patterns in codebase
- Update OpenAPI spec for Orval
- Coordinate with team on database changes
```
