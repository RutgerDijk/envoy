---
name: finishing-branch
description: Use when implementation is complete and you're ready to create a PR
---

# Finishing a Development Branch

## Overview

Complete workflow for finishing implementation: run review, add docstrings, sync wiki, create PR.

**Announce at start:** "I'm using envoy:finishing-branch to prepare this work for PR."

## Preconditions

Before starting, verify all preconditions:

```bash
# 1. On a feature branch (not main/master)
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" == "main" || "$BRANCH" == "master" ]]; then
  echo "ERROR: Cannot finalize on main/master branch"
  exit 1
fi

# 2. Working directory is clean
if [[ -n $(git status --porcelain) ]]; then
  echo "ERROR: Working directory has uncommitted changes"
  echo "Commit or stash changes before finalizing"
  exit 1
fi

# 3. Tests pass
dotnet test
npm test
```

**If any precondition fails, stop and resolve before continuing.**

## Process

### Step 1: Run Full Review

Use envoy:layered-review for comprehensive 4-layer review:

```
/envoy:review
```

This runs:
1. CodeRabbit static analysis
2. Documentation-informed AI review
3. Chrome DevTools visual verification
4. Documentation gap detection

**Fix any issues found before proceeding.**

After fixing:
```bash
git add -A
git commit -m "fix: address review feedback"
```

### Step 2: Add Docstrings

Use envoy:docstrings to document public APIs:

```
/envoy:docstrings
```

This adds:
- C#: XML documentation (`/// <summary>`)
- TypeScript: JSDoc comments (`/** */`)

After adding docstrings:
```bash
git add -A
git commit -m "docs: add docstrings to public APIs"
```

### Step 3: Update Documentation

Check if documentation updates are needed:

1. **New features** → Add to relevant wiki pages
2. **API changes** → Update API docs
3. **Configuration changes** → Update setup docs

If docs/wiki/ was updated:
```bash
git add docs/wiki/
git commit -m "docs: update wiki documentation"
```

### Step 4: Sync Wiki to GitHub

Use envoy:wiki-sync to push documentation:

```
/envoy:wiki-sync
```

This syncs `docs/wiki/` to the GitHub wiki repository.

### Step 5: Final Verification

Run one more verification:

```bash
# All tests pass
dotnet test
npm test

# Build succeeds
dotnet build
npm run build

# Lint passes
npm run lint
```

### Step 6: Push Branch

```bash
git push -u origin HEAD
```

### Step 7: Create Pull Request

Get PR format from existing PRs:

```bash
gh pr list --limit 5 --state merged --json title,body
```

Create PR matching the repository's format:

```bash
gh pr create --title "<title>" --body "$(cat <<'EOF'
## Summary

<Brief description of changes>

## Changes

- **Implementation:** <main work summary>
- **Code review:** <issues addressed>
- **Documentation:** <what was updated>

## Test Plan

- [ ] Unit tests pass
- [ ] E2E tests pass
- [ ] Manual verification completed
- [ ] Visual review passed

## Linked Issue

Closes #<issue-number>

## Screenshots

<If UI changes, include before/after screenshots>

---

*Created with Envoy*
EOF
)"
```

### Step 8: Report Completion

```
**Branch finalized**

| Step | Status |
|------|--------|
| Review | ✓ Passed (issues fixed) |
| Docstrings | ✓ Added |
| Wiki | ✓ Synced |
| Tests | ✓ Passing |
| PR | ✓ Created |

**Pull Request:** <URL>

**Next steps:**
1. Wait for CI to pass
2. Request reviewers
3. Address any PR feedback
4. Merge when approved
5. Run `/envoy:cleanup` to remove worktree and branch
```

## Error Handling

### Tests Fail

```
**Cannot finalize: Tests failing**

Failed tests:
- <test names>

Fix the failing tests before finalizing.
```

### Review Has Blocking Issues

```
**Cannot finalize: Review issues**

Blocking issues:
- <issue 1>
- <issue 2>

Address these issues before creating PR.
```

### Wiki Sync Conflict

```
**Wiki sync conflict**

GitHub wiki has changes not in docs/wiki/.

Options:
1. Overwrite with docs/wiki/ content
2. Merge manually
3. Skip wiki sync

Choice?
```

### PR Creation Fails

```
**PR creation failed**

Error: <error message>

Try manually:
gh pr create --web
```

## Checklist

Use this checklist to track progress:

- [ ] **Preconditions:** On feature branch, clean state, tests pass
- [ ] **Review:** 4-layer review completed, issues fixed
- [ ] **Docstrings:** Public APIs documented
- [ ] **Wiki:** Documentation updated and synced
- [ ] **Verification:** Final test run passed
- [ ] **Push:** Branch pushed to remote
- [ ] **PR:** Pull request created

## Tips

- **Don't rush** — Quality PRs get merged faster
- **Small PRs** — Easier to review, fewer issues
- **Good commit messages** — Help reviewers understand changes
- **Link the issue** — Maintains traceability
- **Screenshots for UI** — Worth a thousand words
