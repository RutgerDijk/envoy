---
mode: 'agent'
description: 'Complete branch finalization: review, docstrings, wiki sync, and PR creation'
---

# Finalize Branch

Complete end-to-end finalization of a feature branch: full review, documentation, wiki sync, and PR creation.

## Preconditions

Verify all preconditions before starting:

```bash
# Must be on a feature branch
BRANCH=$(git branch --show-current)
echo "Branch: $BRANCH"
# Must NOT be main or master

# Working directory must be clean
git status --porcelain
# Must be empty

# All tests must pass
dotnet test
npm test
```

**If any precondition fails, stop and fix it first.**

---

## Step 1: Full Review

Run the `/review` workflow (full 4-layer review).

Fix all Critical and Important findings:

```bash
git add -A
git commit -m "fix: address review feedback"
```

---

## Step 2: Add Docstrings

Run the `/docstrings` workflow to add XML documentation to all public C# APIs and JSDoc to exported TypeScript functions.

```bash
git add -A
git commit -m "docs: add docstrings to public APIs"
```

---

## Step 3: Update Documentation

Check if any wiki pages need updating for this feature:

```bash
# Look for existing wiki pages related to this feature
ls docs/wiki/
```

Update or create pages as needed:
- New features → add to relevant wiki pages
- API changes → update API docs
- Configuration changes → update setup docs

```bash
git add docs/
git commit -m "docs: update wiki documentation"
```

---

## Step 4: Sync Wiki

Run the `/wiki-sync` workflow to push `docs/wiki/` to the GitHub wiki repository.

---

## Step 5: Final Verification

```bash
dotnet test        # All tests pass
npm test           # All frontend tests pass
dotnet build       # Build succeeds
npm run build      # Frontend build succeeds
npm run lint       # No lint errors
```

If anything fails, fix it and commit before continuing.

---

## Step 6: Create Pull Request

```bash
gh pr create \
  --title "<feature title>" \
  --body "$(cat <<'EOF'
## Summary

<2–3 sentence description of what this PR does>

## Changes

- <Change 1>
- <Change 2>

## Testing

- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing done

## Related Issue

Closes #<issue-number>
EOF
)" \
  --base main
```

Output the PR URL when done.
