# GitHub Issue Template

## Title Format

```
[TYPE] Brief description of the feature/task
```

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `perf`

## Issue Body

```markdown
## Summary

One-sentence description of what needs to be done.

## Context

Why is this needed? What problem does it solve?

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Technical Notes

Brief technical guidance (optional):
- Key files to modify
- Patterns to follow
- Dependencies to consider

## Links

- Spec: `docs/specs/YYYY-MM-DD-feature-name.md`
- Design: (if applicable)
- Related issues: #123, #456

## Labels

- `backend` / `frontend` / `infrastructure`
- `feature` / `bug` / `refactor`
- `priority:high` / `priority:medium` / `priority:low`
```

## Example

```markdown
## Summary

Add user profile editing functionality to the settings page.

## Context

Users currently cannot update their profile information after registration. This is a frequently requested feature based on user feedback.

## Acceptance Criteria

- [ ] User can update display name
- [ ] User can update email (with verification)
- [ ] User can upload profile picture
- [ ] Changes are persisted to database
- [ ] Form validates input before submission
- [ ] Success/error feedback shown to user

## Technical Notes

- Extend existing `UserService` with update methods
- Use React Hook Form + Zod for form handling
- Profile pictures stored in Azure Blob Storage
- Email changes require verification flow

## Links

- Spec: `docs/specs/2024-01-15-user-profile-editing.md`
- Related: #45 (user registration), #67 (settings page)

## Labels

- `frontend`, `backend`
- `feature`
- `priority:high`
```
