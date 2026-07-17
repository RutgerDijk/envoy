---
name: prs
description: Use when you want a read-only overview of every open PR's health — CI, CodeRabbit, unresolved threads, idle time — to see what's stuck and why.
when_to_use:
  - When the user types /envoy:prs
  - When you want a one-glance status of all open PRs before deciding what to act on
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
---

# Open PR Pipeline View

## Overview

A **read-only** pipeline-health view. For each open PR, read one
`lib/pr-status.js` snapshot and render it as a compact status table. This skill
**takes no actions** — no comments, no skill invocations, no pushes. It only
reports what is stuck and why. To act on the findings, use `envoy:babysit`.

**Announce at start:** "I'm using envoy:prs to show open PR status."

## Process

### Step 1: Enumerate open PRs

```bash
gh pr list --state open --json number,title -q '.[] | "\(.number)\t\(.title)"'
```

### Step 2: Snapshot each PR

```bash
SNAP=$(node lib/pr-status.js "$PR" 2>/dev/null)
[ -z "$SNAP" ] && continue   # skip PRs that fail to read; never guess
```

Read from the snapshot (see `lib/pr-status.js`): `.ci.state`,
`.coderabbit.checkState`, `.coderabbit.unresolvedThreads`,
`.coderabbit.rateLimit.rateLimited`, `.coderabbit.rateLimit.resetsAt`,
`.idle.idleMinutes`.

### Step 3: Render the table

| PR | CI | CodeRabbit | Unresolved | Idle | Next action |
|----|----|-----------|-----------|------|-------------|
| #NN | pass/fail | ok / rate-limited (resets HH:MM) | N threads | Nm | *suggested* |

- **CodeRabbit** column shows `rate-limited (resets …)` when
  `rateLimit.rateLimited` is true, otherwise the check state.
- **Next action** mirrors `envoy:babysit`'s decision table but is only
  **suggested here** — never executed:
  - rate-limited + cooldown passed → "re-trigger CodeRabbit"
  - CI failing → "fix-ci"
  - unresolved threads > 0 → "coderabbit-pr-review"
  - all green → "ready to merge"

Print the table and stop. Do not take any action.

## Integration with Envoy

- Reads `lib/pr-status.js` — the single PR-status source (shared with `envoy:babysit`)
- `envoy:babysit` is the acting counterpart to this read-only view
