---
name: hotfix
description: Use for an urgent, single-defect fix that must ship fast — skips brainstorm and multi-layer review but keeps a worktree, a failing repro test, verification, and the normal PR gates.
when_to_use:
  - When the user types /envoy:hotfix <description | #issue>
  - When a single known defect needs a fast, disciplined fix without full brainstorm
  - NOT for multi-part work or anything needing design — use /envoy:brainstorm + /envoy:pickup
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - Skill
---

# Hotfix — sanctioned fast-path

## Overview

The fast lane for one urgent defect. It **skips** brainstorm, the design issue's
task list, the committed `.envoy-tasks/` handoff, and the multi-layer
`envoy:review`. It **keeps** the discipline that actually protects production:
worktree isolation, a failing repro test (TDD), verification with evidence, and
the normal PR → CodeRabbit → CI gates.

**Announce at start:** "I'm using envoy:hotfix to fix <defect> on a fast path."

**This is the *sanctioned* fast path.** Routing around the heavier skills is the
top reason work escapes Envoy's gates; hotfix exists so that fast work is still
tracked. It records itself as the active skill (Step 2) so it shows up as a
sanctioned fast-path, not as invisible skill-less work.

## Scope Iron Law — one defect

A hotfix fixes **exactly one defect**. If the work grows a second root cause, a
refactor, or a feature, **STOP** and route it to the normal flow
(`/envoy:brainstorm` → `/envoy:pickup`). Sprawl is a hotfix failure, not a
judgment call.

## Process

### Step 1: Establish a traceable issue

If the user passed an issue number, use it. Otherwise file a **lightweight** bug
issue — no design doc, no tasks file, just enough for traceability:

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

The PR opened in Step 5 must include `Closes #<ISSUE_NUMBER>`.

### Step 2: Worktree first, then record state (anchored-first)

Create the worktree BEFORE writing any `.envoy/` state — never write state into
the main checkout (the #1560 ordering race). Anchor the session in the worktree,
then record the active skill inside it:

```bash
TOPIC=$(echo "<defect>" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-' | head -c 40)
git worktree add ".worktrees/hotfix-$TOPIC" -b "hotfix/$ISSUE_NUMBER-$TOPIC" main
cd ".worktrees/hotfix-$TOPIC"
# Only now, with the worktree existing and cwd anchored in it, record state:
mkdir -p .envoy
# NOTE: the env assignment is a PREFIX before `node` — a suffix (`node -e "..." VAR=val`)
# becomes argv, not process.env, so issueNumber would be NaN. Keep it a prefix.
ISSUE_NUMBER="$ISSUE_NUMBER" node -e "const fs=require('fs'); const issue=Number(process.env.ISSUE_NUMBER); fs.writeFileSync('.envoy/active-skill.json', JSON.stringify({\$schemaVersion:'1',skill:'hotfix',issueNumber:issue,startedAt:new Date().toISOString()},null,2)); require('${CLAUDE_SKILL_DIR}/../../lib/ledger').appendEvent(process.cwd(), {type:'skill-started', skill:'hotfix', issue:issue});"
```

Writing `.envoy/active-skill.json` here keeps the hotfix visible to the
compliance trail as a sanctioned fast-path.

### Step 3: TDD — failing repro test first

Invoke `envoy:test-driven-development`. Write a **failing test that reproduces
the defect**, run it to confirm it fails (RED), then write the minimal fix and
confirm it passes (GREEN). No production edit before a failing test exists.

### Step 4: Verify

Invoke `envoy:verification` — run the tests, build, and lint, and gather evidence
that the defect is fixed and nothing regressed. No "should work" assertions.

### Step 5: Open the PR

Push the branch and open a PR with `Closes #<ISSUE_NUMBER>`. It goes through the
normal CodeRabbit + CI gates. `envoy:babysit` can shepherd it from there.

## Integration with Envoy

- Invokes `envoy:test-driven-development` (failing test first) and `envoy:verification` (before PR)
- Routes any scope sprawl to `envoy:brainstorm` + `envoy:pickup`
- Records `.envoy/active-skill.json` for the compliance trail
- `envoy:babysit` shepherds the resulting PR
