---
name: babysit
description: Use when you want to move open PRs forward — re-trigger a rate-limited CodeRabbit, fix red CI, or resolve outstanding review threads — in one pass across every open PR.
when_to_use:
  - When the user types /envoy:babysit
  - When one or more open PRs are waiting on CodeRabbit, CI, or unresolved threads
  - When a CodeRabbit review stalled on rate-limit and needs re-triggering after cooldown
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - Skill
---

# Babysit Open PRs

## Overview

Shepherd open PRs toward merge. For each open PR, read one `lib/pr-status.js`
snapshot and take **at most one action**, then report what was done and suggest
when to run again.

**Announce at start:** "I'm using envoy:babysit to shepherd open PRs."

## One-pass model (does NOT sleep)

Babysit makes a single pass and returns. It **never sleeps or polls in-session** —
cadence is the caller's job. To run it on an interval, compose it with `/loop`:

```
/loop 15m /envoy:babysit
```

This keeps babysit portable and daemon-free: one pass, one report, done.

## Process

### Step 1: Enumerate open PRs

```bash
gh pr list --state open --json number -q '.[].number'
```

If a PR number is passed as an argument, act on just that PR.

### Step 2: Snapshot each PR

For each PR, read the authoritative status snapshot:

```bash
SNAP=$(node lib/pr-status.js "$PR" 2>/dev/null)
[ -z "$SNAP" ] && continue   # PR vanished or gh failed — skip, do not guess
```

The snapshot shape (see `lib/pr-status.js`):

```
.ci.state                       # overall CI roll-up
.coderabbit.checkState
.coderabbit.unresolvedThreads    # authoritative unresolved count (GraphQL)
.coderabbit.rateLimit.rateLimited
.coderabbit.rateLimit.resetsAt   # ISO cooldown end, or null
.idle.idleMinutes
```

### Step 3: Take at most one action

Apply the first matching rule, then move to the next PR:

| Condition (from snapshot) | Action |
|---------------------------|--------|
| `coderabbit.rateLimit.rateLimited` **and** `resetsAt` has passed | Re-trigger: `gh pr comment "$PR" --body "@coderabbitai review"` |
| `ci.state` is failing | Invoke `envoy:fix-ci` for this PR |
| `coderabbit.unresolvedThreads > 0` | Invoke `envoy:coderabbit-pr-review` for this PR |
| all green, nothing outstanding | Report **ready to merge** |

Only re-trigger CodeRabbit when it was actually rate-limited **and** the cooldown
(`resetsAt`) is in the past — never poke an active or already-complete review.

### Step 4: Report + suggest cadence

Summarize the pass: per PR, the action taken (or "ready to merge" / "waiting on
CodeRabbit"). Then suggest a re-run — e.g. "re-run in ~15m; the #NN cooldown ends
at HH:MM" — and remind the caller they can automate it with `/loop 15m
/envoy:babysit`.

## Integration with Envoy

- Reads `lib/pr-status.js` — the single PR-status source (shared with `envoy:prs`)
- Invokes `envoy:fix-ci` for red CI
- Invokes `envoy:coderabbit-pr-review` for unresolved review threads
