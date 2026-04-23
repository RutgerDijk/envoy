---
name: finalize
description: Use when review is complete and you're ready to push, create PR, and ship
---

# Finalize

## Overview

Ships the work: push, create PR, handle CodeRabbit, fix CI, verify, wiki-sync. Assumes `envoy:review` has already been run. The skill runs the full pipeline directly — no delegation to an execution agent.

**Announce at start:** "I'm using envoy:finalize to create a PR and ship this work."

**Discipline rule:** This is a rigid skill. Every step MUST be executed as written. Do NOT skip, narrate, or reorder steps. See `contexts/execution-announce.md`.

## Context

```bash
BRANCH=$(git branch --show-current)
OWNER=$(gh repo view --json owner -q '.owner.login')
REPO=$(gh repo view --json name -q '.name')
EXECUTION_ANNOUNCE=$(cat contexts/execution-announce.md)
```

## Preconditions

Run these checks BEFORE proceeding. If any fail, stop and resolve first.

```bash
# 1. On a feature branch (not main/master)
if [[ "$BRANCH" == "main" || "$BRANCH" == "master" ]]; then
  echo "ERROR: Cannot finalize on main/master branch"
  exit 1
fi

# 2. Working directory is clean
if [[ -n $(git status --porcelain) ]]; then
  echo "ERROR: Uncommitted changes — commit or stash first"
  exit 1
fi

# 3. Tests pass (only run when tool + project are present)
if command -v dotnet >/dev/null 2>&1 && find . \( -name '*.sln' -o -name '*.csproj' \) -print -quit | grep -q .; then
  dotnet test
else
  echo "Skipping dotnet tests: dotnet or .NET project not present"
fi

if command -v npm >/dev/null 2>&1 && [[ -f package.json ]]; then
  npm test
else
  echo "Skipping npm tests: npm or package.json not present"
fi
```

**If any precondition fails, stop and resolve.**

---

## Process

| Steps | File | Purpose |
|-------|------|---------|
| 1 | This file (below) | Preconditions check |
| 2 | This file (below) | Push and create PR |
| 3–7 | `steps/coderabbit.md` | Poll, address, reply/resolve, re-poll CodeRabbit |
| 8 | `steps/ci.md` | Poll CI and invoke fix-ci on failure |
| 9, 11 | `steps/verify.md` | Final verification + shipment report + error handling |
| 10 | `steps/wiki.md` | Wiki sync when `docs/wiki/` changed |

### Step 1: Preconditions Check

Announce: `Running Step 1: Preconditions check...`

Run the preconditions above. All must pass before proceeding.

### Step 2: Push and Create PR

Announce: `Running Step 2: Push and create PR...`

```bash
git push -u origin HEAD
```

```bash
gh pr create --title "<title>" --body "$(cat <<'PREOF'
## Summary

<Brief description of changes>

## Changes

- **Implementation:** <main work summary>

## Test Plan

- [ ] Unit tests pass
- [ ] E2E tests pass

## Linked Issue

Closes #<issue-number>

---

*Created with Envoy*
PREOF
)"
```

```bash
# Store PR number for fix-ci auto-detection
PR_NUMBER=$(gh pr view --json number -q .number)
echo "$PR_NUMBER" > /tmp/envoy-active-pr.txt
```

---

## Integration with Envoy

- Assumes `envoy:review` (layered review) has already been run
- Invokes `envoy:fix-ci` for CI failure auto-remediation
- Invokes `envoy:wiki-sync` when docs/wiki/ changes are detected
- Uses `envoy:verification` principles (evidence before assertions)
- Uses `lib/loop-safeguards.js` completion signal protocol
- Follow with `/envoy:cleanup` after PR is merged

**Platform constraint:** Claude Code subagents cannot spawn subagents (the `Agent` tool is silently stripped from subagent tool allowlists). This skill therefore orchestrates directly rather than delegating to an execution agent.
