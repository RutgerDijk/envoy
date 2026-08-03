---
name: finalize
description: Finalize expert. ALWAYS invoke when the /envoy:finalize command fires or after /envoy:review approves. Pushes branch, opens PR, drives CodeRabbit and CI loops, runs wiki-sync. Do not push or open PRs manually while this skill is applicable.
when_to_use:
  - After /envoy:review writes .envoy/review/handoff-to-finalize.json with reviewStatus "approved"
  - When the user types /envoy:finalize
  - When ready to ship reviewed work to a PR
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - Skill
  - WebFetch
context: fork
---

## Briefing

!`node ${CLAUDE_SKILL_DIR}/preflight.js`

### Checklist

- [ ] Step 1: Preconditions check
- [ ] Step 2: Push and create PR
- [ ] Steps 3–8: One combined remediation cycle — collect CodeRabbit findings
      + diagnose CI failures, fix everything, ONE commit, ONE push, reply/resolve,
      re-poll both; capped at 3 cycles (`steps/coderabbit.md` orchestrates,
      `steps/ci.md` is the CI-diagnosis helper folded into it)
- [ ] Steps 9, 11: Final verification and ship report (`steps/verify.md`)
- [ ] Step 10: Wiki sync if `docs/wiki/` changed (`steps/wiki.md`)

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

# 4. PR-split advisory: warn (ask-only) when the diff touches >150 files
FILE_COUNT=$(git diff --name-only origin/main...HEAD | wc -l | tr -d ' ')
FILE_COUNT="$FILE_COUNT" node -e '
  const { proposeSplit } = require("./lib/pr-size-check.js");
  const advisory = proposeSplit(Number(process.env.FILE_COUNT));
  if (advisory) {
    console.log(advisory.message);
    console.log("__ENVOY_PR_SPLIT_ADVISORY__");
  }
'
```

**If the advisory printed (`__ENVOY_PR_SPLIT_ADVISORY__` marker present), stop and present the proposal to the user. Wait for explicit approval before proceeding to Step 2 — "proceed as one PR" or "split" (split guidance only; do NOT create branches or rebase automatically, that is out of scope). Do not treat this as a hard failure — it's an ask-only pause, not an error.**

```bash
# 5. Main-drift check: catch breaking merges into origin/main before burning
# a full CI run. Uses git merge-base + rev-list --count + file-overlap
# intersection (lib/main-drift.js computeDrift) — drift with NO overlapping
# files is informational only; only overlapping-file drift stops and asks.
node -e '
  const { computeDrift } = require("./lib/main-drift.js");
  const result = computeDrift(process.cwd());
  console.log(result.message);
  if (result.hasDrift) console.log("__ENVOY_MAIN_DRIFT__");
'
```

**If `__ENVOY_MAIN_DRIFT__` printed, stop and present the rebase/merge/proceed options to the user (A/B/C, from the message above). Wait for explicit approval before proceeding to Step 2. Drift with no overlapping files is informational only — the note prints but does not stop this step.**

**This same check re-runs immediately before Step 6's push (`steps/coderabbit.md`) on every remediation cycle — drift landing mid-loop (e.g. a conflicting PR merges to main while this run is still looping through CodeRabbit cycles) must be caught before EVERY push, not just once here at the start.**

**If any other precondition fails, stop and resolve.**

---

## Process

| Steps | File | Purpose |
|-------|------|---------|
| 1 | This file (below) | Preconditions check |
| 2 | This file (below) | Push and create PR |
| 3–8 | `steps/coderabbit.md` (+ `steps/ci.md` as CI-diagnosis helper) | Unified remediation cycle: collect (poll CodeRabbit + diagnose CI) → fix all → ONE commit → ONE push → reply/resolve → re-poll both. Max 3 cycles; escalates to the user at the cap instead of looping or auto-finishing. |
| 9, 11 | `steps/verify.md` | Final verification + shipment report + error handling |
| 10 | `steps/wiki.md` | Wiki sync when `docs/wiki/` changed |

### Step 1: Preconditions Check

Announce: `Running Step 1: Preconditions check...`

Run the preconditions above. All must pass before proceeding. The PR-split
advisory (precondition 4) is a pause for approval, not a pass/fail gate —
see below.

### Step 2: Push and Create PR

Announce: `Running Step 2: Push and create PR...`

```bash
git push -u origin HEAD
```

If the precondition-4 advisory fired and the user chose to split, this PR is
one entry in a stacked series — set `IS_FINAL_PR=false` for every PR except
the last one in the stack. Otherwise (single PR, or the user chose "proceed
as one PR anyway"), `IS_FINAL_PR` stays `true`.

```bash
ISSUE_NUMBER="<issue-number>" IS_FINAL_PR="${IS_FINAL_PR:-true}" node -e '
  const { prLinkedIssueLine } = require("./lib/pr-size-check.js");
  console.log(prLinkedIssueLine(Number(process.env.ISSUE_NUMBER), process.env.IS_FINAL_PR === "true"));
' > /tmp/envoy-linked-issue-line.txt
LINKED_ISSUE_LINE=$(cat /tmp/envoy-linked-issue-line.txt)
```

```bash
gh pr create --title "<title>" --body "$(cat <<PREOF
## Summary

<Brief description of changes>

## Changes

- **Implementation:** <main work summary>

## Test Plan

- [ ] Unit tests pass
- [ ] E2E tests pass

## Linked Issue

$LINKED_ISSUE_LINE

---

*Created with Envoy*
PREOF
)"
```

```bash
# Update .envoy/finalize/state.json (seeded by preflight) with the PR info.
# fix-ci and cleanup read this file — do NOT write /tmp/envoy-active-pr.txt; that path is retired.
PR_NUMBER=$(gh pr view --json number -q .number)
PR_URL=$(gh pr view --json url -q .url)
echo "PR: $PR_URL"
PR_NUMBER="$PR_NUMBER" PR_URL="$PR_URL" node -e "
  const fs = require('fs');
  const p = '.envoy/finalize/state.json';
  const state = JSON.parse(fs.readFileSync(p, 'utf8'));
  state.prNumber = Number(process.env.PR_NUMBER);
  state.prUrl = process.env.PR_URL;
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
"
```

---

## Integration with Envoy

- Assumes `envoy:review` (layered review) has already been run
- Diagnoses CI failures inline (`steps/ci.md`) as part of its own remediation
  cycle — it no longer delegates to `envoy:fix-ci`'s independent commit/push
  loop; `envoy:fix-ci` remains available standalone for ad-hoc CI fixes outside finalize
- Invokes `envoy:wiki-sync` when docs/wiki/ changes are detected
- Uses `envoy:verification` principles (evidence before assertions)
- Uses `lib/loop-safeguards.js` completion signal protocol (loop name: `remediation-cycle`)
- Follow with `/envoy:cleanup` after PR is merged

**Platform constraint:** Claude Code subagents cannot spawn subagents (the `Agent` tool is silently stripped from subagent tool allowlists). This skill therefore orchestrates directly rather than delegating to an execution agent.
