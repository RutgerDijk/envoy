---
name: finishing-branch
description: Use when implementation is complete and you're ready to create a PR
---

# Finishing a Development Branch

## Overview

PR-first workflow: create PR early so GitHub CodeRabbit reviews in parallel with local reviews. All findings (including nitpicks) get addressed. Max 3 fix-and-verify cycles.

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

### Step 1: Add Docstrings (Quick Win)

Use envoy:docstrings to document public APIs:

```
/envoy:docstrings
```

After adding docstrings:
```bash
git add -p
git commit -m "docs: add docstrings to public APIs"
```

### Step 2: Update Documentation

Check if documentation updates are needed:

1. **New features** → Add to relevant wiki pages
2. **API changes** → Update API docs
3. **Configuration changes** → Update setup docs

If docs/wiki/ was updated:
```bash
git add docs/wiki/
git commit -m "docs: update wiki documentation"
```

### Step 3: Determine Complexity Tier

Classify the change to decide review depth:

```bash
# Count changed files and types
CHANGED=$(git diff --name-only main...HEAD)
FILE_COUNT=$(echo "$CHANGED" | wc -l)
DOC_ONLY=$(echo "$CHANGED" | grep -v '\.\(md\|txt\|json\)$' | wc -l)
```

| Tier | Criteria | Review Depth |
|------|----------|--------------|
| **Trivial** | Docs/config only, or ≤2 files with no logic | Lint + CodeRabbit only (skip AI review) |
| **Small** | 1-3 files with logic changes | Sonnet AI review only |
| **Medium** | 4-10 files | Full parallel review |
| **Large** | 10+ files or cross-cutting | Full parallel review + extra scrutiny |

### Step 4: Push Branch and Create PR

Create the PR **before** running reviews so GitHub CodeRabbit starts in parallel:

```bash
# Push branch
git push -u origin HEAD

# Get PR format from existing PRs
gh pr list --limit 5 --state merged --json title,body

# Create PR
gh pr create --title "<title>" --body "$(cat <<'PREOF'
## Summary

<Brief description of changes>

## Changes

- **Implementation:** <main work summary>
- **Code review:** Pending
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
PREOF
)"
```

**Save PR number for CodeRabbit polling.**

### Step 5: Dispatch Parallel Review Subagents

Launch review subagents in parallel based on complexity tier:

**Trivial tier:**
- Only lint (Layer 0) — CodeRabbit will review on GitHub automatically

**Small tier:**
- Sonnet AI review only (Layer 2)

**Medium/Large tier — 3 parallel subagents:**

```
Agent 1: Local CodeRabbit CLI
  - coderabbit review --prompt-only --base main
  - Tools: Read, Grep, Glob (read-only)

Agent 2: Sonnet AI Review (spec compliance, TDD, patterns)
  - model: "sonnet"
  - Focus: spec compliance, TDD verification, codebase patterns
  - Tools: Read, Grep, Glob (read-only)

Agent 3: Visual Review + App Health Check
  - envoy:visual-review
  - HTTP health check on localhost
  - Tools: Read, Grep, Glob, mcp__chrome-devtools__*
```

**Background (non-blocking):** Poll GitHub for CodeRabbit App comments:
```bash
# Poll every 60 seconds for up to 5 minutes
gh api repos/{owner}/{repo}/pulls/{pr}/comments
```

### Step 6: Merge Findings from All Sources

Collect findings from:
1. Local CodeRabbit CLI
2. Sonnet AI reviewer
3. Visual review
4. GitHub CodeRabbit comments (from polling)

Deduplicate and categorize:
- **Obvious fixes** — Apply immediately
- **Ambiguous** — Present to user for decision

### Step 7: Address Every Finding (Including Nitpicks)

**No skipping.** Address ALL findings:

```bash
# For each finding:
# 1. Apply the fix
# 2. Commit
git add -p
git commit -m "fix: address review feedback — <finding summary>"
```

### Step 8: Reply to GitHub CodeRabbit Comments

For each GitHub CodeRabbit PR comment:

```bash
# Reply with fix + commit hash
gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies \
  --method POST \
  --field body="Fixed in <commit-hash>. <brief explanation>"

# Resolve the conversation thread
gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id} \
  --method PATCH \
  --field resolved=true
```

### Step 9: Push Fixes

```bash
git push
```

### Step 10: Re-verify (Max 3 Cycles)

After pushing fixes, check for new CodeRabbit comments:

```bash
# Check for new comments since last push
gh api repos/{owner}/{repo}/pulls/{pr}/comments --jq '.[].created_at'
```

**If new comments appear:**
1. Address the new findings
2. Reply + resolve each comment
3. Push again
4. Repeat (max 3 cycles total)

**After 3 cycles with remaining issues → escalate to user:**
```
**Escalation: Review cycle limit reached**

After 3 fix-and-verify cycles, these issues remain:
- <issue 1>
- <issue 2>

Please review and decide how to proceed.
```

### Step 11: Final Verification

Run envoy:verification with full checklist:

```bash
# Tests pass
dotnet test
npm test

# Build succeeds
dotnet build
npm run build

# Lint passes
npm run lint

# App health check
curl -f http://localhost:5000/health || echo "Backend health check failed"
curl -f http://localhost:5173 || echo "Frontend health check failed"

# Zero unresolved PR conversations
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --jq '[.[] | select(.resolved == false)] | length'
```

**All checks must pass with evidence before claiming ready.**

### Step 12: Wiki Sync

Use envoy:wiki-sync to push documentation:

```
/envoy:wiki-sync
```

### Step 13: Report Completion

```
**Branch finalized**

| Step | Status |
|------|--------|
| Docstrings | ✓ Added |
| PR | ✓ Created (#<number>) |
| Local CodeRabbit | ✓ <N> findings addressed |
| AI Review (Sonnet) | ✓ <N> findings addressed |
| Visual Review | ✓ Passed |
| GitHub CodeRabbit | ✓ <N> comments resolved |
| Verification | ✓ Tests, build, lint, health all pass |
| Wiki | ✓ Synced |
| Fix cycles | <N>/3 used |

**Pull Request:** <URL>
**Unresolved PR conversations:** 0

**Next steps:**
1. Wait for CI to pass
2. Request reviewers
3. Address any human PR feedback
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

- [ ] **Preconditions:** On feature branch, clean state, tests pass
- [ ] **Docstrings:** Public APIs documented
- [ ] **Complexity tier:** Determined (trivial/small/medium/large)
- [ ] **PR created:** Before running reviews
- [ ] **Parallel reviews:** Dispatched based on complexity tier
- [ ] **All findings addressed:** Including nitpicks
- [ ] **GitHub CodeRabbit:** Every comment replied to + resolved
- [ ] **Verification:** Tests, build, lint, health, zero unresolved comments
- [ ] **Wiki:** Synced
