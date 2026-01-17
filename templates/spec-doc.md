# Specification Document Template

Save as: `docs/specs/YYYY-MM-DD-feature-name.md`

---

```markdown
# Feature Name

> One-sentence summary of what this feature does.

## Overview

### Problem Statement

What problem does this feature solve? Why is it needed?

### Goals

- Primary goal
- Secondary goal

### Non-Goals

- What this feature explicitly does NOT do
- Scope limitations

## User Stories

### Story 1: [User Role] can [Action]

As a [role], I want to [action] so that [benefit].

**Acceptance Criteria:**
- [ ] Criterion 1
- [ ] Criterion 2

### Story 2: [User Role] can [Action]

...

## Technical Design

### Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │────▶│     API     │────▶│  Database   │
└─────────────┘     └─────────────┘     └─────────────┘
```

Brief description of the architecture.

### Data Model

```sql
-- New tables or changes
CREATE TABLE feature_table (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/feature` | List all items |
| POST | `/api/feature` | Create new item |
| PUT | `/api/feature/{id}` | Update item |
| DELETE | `/api/feature/{id}` | Delete item |

**Request/Response Examples:**

```json
// POST /api/feature
{
  "name": "Example",
  "description": "Description"
}

// Response: 201 Created
{
  "id": 1,
  "name": "Example",
  "description": "Description",
  "createdAt": "2024-01-15T10:00:00Z"
}
```

### UI Components

- **Component 1**: Description of what it does
- **Component 2**: Description of what it does

### Security Considerations

- Authentication requirements
- Authorization rules
- Input validation
- Data protection

### Performance Considerations

- Expected load
- Caching strategy
- Query optimization needs

## Implementation Plan

### Phase 1: Backend Foundation

1. Create database migrations
2. Implement repository layer
3. Add service layer
4. Create API endpoints
5. Write unit tests

### Phase 2: Frontend Implementation

1. Create UI components
2. Implement form handling
3. Connect to API
4. Add loading/error states
5. Write E2E tests

### Phase 3: Polish

1. Add validation messages
2. Implement error handling
3. Add loading indicators
4. Performance optimization

## Testing Strategy

### Unit Tests

- Service layer tests
- Validation tests

### Integration Tests

- API endpoint tests
- Database interaction tests

### E2E Tests

- Happy path scenarios
- Error scenarios

## Rollout Plan

1. Deploy to staging
2. QA verification
3. Deploy to production (feature flag)
4. Monitor for issues
5. Full rollout

## Open Questions

- [ ] Question 1 that needs clarification
- [ ] Question 2 that needs decision

## References

- Related documentation
- External resources
- Previous discussions
```
