# Finalize — Step 9: Final verification + Step 11: Report

### Step 9: Final Verification

Announce: `Running Step 9: Final verification...`

Run envoy:verification with evidence:

```bash
# Tests
dotnet test
npm test

# Build
dotnet build
npm run build

# Lint
npm run lint

# CI status (exclude pending/queued — only show actual failures)
gh pr checks $PR_NUMBER --json name,state,conclusion \
  --jq '.[] | select(.state != "PENDING" and .state != "QUEUED") | select(.conclusion != "SUCCESS") | .name + ": " + .conclusion'

# Zero unresolved PR conversations
gh api graphql -f query='
  query {
    repository(owner: "'$OWNER'", name: "'$REPO'") {
      pullRequest(number: '$PR_NUMBER') {
        reviewThreads(first: 100) {
          nodes { isResolved }
        }
      }
    }
  }
' --jq '.data.repository.pullRequest.reviewThreads.nodes | map(select(.isResolved == false)) | length'
```

**All checks must pass with evidence.**

### Step 11: Report

```
**Branch finalized**

| Step | Status |
|------|--------|
| PR | ✓ Created (#<number>) |
| GitHub CodeRabbit | ✓ <N> comments resolved |
| CI/CD | ✓ All checks passing |
| CI fix cycles | <N>/3 used |
| CodeRabbit cycles | <N>/3 used |
| Verification | ✓ Tests, build, lint pass |
| Unresolved conversations | 0 |
| Wiki sync | ✓ Synced / — No docs/wiki/ changes |

**Pull Request:** <URL>

**Next steps:**
1. Request human reviewers
2. Address any human feedback
3. Merge when approved
4. `/envoy:cleanup` to remove worktree and branch
```

---

## Error Handling

### Tests Fail

```
**Cannot finalize: Tests failing**

Failed tests:
- <test names>

Fix tests before finalizing.
```

### PR Creation Fails

```
**PR creation failed:** <error>

Try: gh pr create --web
```
