---
agent: 'agent'
description: 'Fast-path fix for one urgent defect: branch from main, failing repro test, minimal fix, hotfix PR'
---

# Hotfix

The sanctioned fast lane for **exactly one urgent defect**. It skips `/brainstorm`, the task file, and the full `/review` — but keeps the discipline that protects production: a failing repro test first, verification with evidence, and the normal PR gates.

**Usage:** `/hotfix <description | issue-number>`

**Scope rule:** a hotfix fixes one defect. If the work grows a second root cause, a refactor, or a feature, STOP and route it through `/brainstorm` + `/pickup` instead. Sprawl is a hotfix failure, not a judgment call.

## Step 1: Establish a Traceable Issue

If an issue number was passed, use it. Otherwise file a lightweight bug issue — no design doc, just enough for traceability:

```bash
ISSUE_URL=$(gh issue create --title "<one-line defect>" --label bug --body "$(cat <<'EOF'
## Defect
<what is broken>

## Repro
<steps / trigger>

## Expected vs actual
<expected> / <actual>
EOF
)")
ISSUE_NUMBER=$(basename "$ISSUE_URL")
```

## Step 2: Branch from Main in a Worktree

Worktrees are **always** created in `.worktrees/`. Branch directly from `main`:

```bash
git fetch origin main
TOPIC="<short-defect-slug>"
git worktree add .worktrees/hotfix-$TOPIC -b "hotfix/$ISSUE_NUMBER-$TOPIC" origin/main
cd .worktrees/hotfix-$TOPIC
```

## Step 3: Write a Failing Repro Test (RED)

Before touching any production code, write a test that reproduces the defect, and run it to confirm it fails for the expected reason:

```bash
dotnet test --filter "<repro-test-name>"   # or: npm test -- <repro-test-file>
```

No production edit is allowed until this test exists and fails.

## Step 4: Minimal Fix (GREEN)

Write the smallest change that makes the repro test pass. Re-run the test to confirm it passes, then commit test + fix together:

```bash
git add -p
git commit -m "fix: <one-line defect> (#$ISSUE_NUMBER)"
```

## Step 5: Verify

Run the full verification and confirm nothing regressed. No "should work" assertions — every claim needs command output as evidence:

```bash
dotnet test        # All .NET tests pass
npm test           # All frontend tests pass
dotnet build       # Build succeeds
npm run build      # Frontend build succeeds
npm run lint       # No lint errors
```

If anything fails, fix it and commit before continuing.

## Step 6: Open the Hotfix PR

```bash
git push -u origin "hotfix/$ISSUE_NUMBER-$TOPIC"
gh pr create \
  --title "hotfix: <one-line defect>" \
  --label hotfix \
  --body "$(cat <<EOF
## Hotfix

Single-defect fast-path fix.

## Defect
<what was broken and why>

## Fix
<what changed, kept minimal>

## Testing
- [ ] Failing repro test added first, now passing
- [ ] Full test suite passes

Closes #$ISSUE_NUMBER
EOF
)" \
  --base main
```

The PR goes through the normal review and CI gates. Output the PR URL when done.
