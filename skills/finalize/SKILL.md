---
name: finalize
description: Use when review is complete and you're ready to push, create PR, and ship
---

# Finalize

## Overview

Ships the work: push, create PR, handle CodeRabbit, fix CI, verify, wiki-sync. Assumes `envoy:review` has already been run. Execution happens in an isolated agent.

**Announce at start:** "I'm using envoy:finalize to create a PR and ship this work."

## Preconditions

Run these checks BEFORE spawning the agent. If any fail, stop and resolve first.

```bash
# 1. On a feature branch (not main/master)
BRANCH=$(git branch --show-current)
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

## Process

### Step 1: Preconditions Check

Run the preconditions above. All must pass before proceeding.

### Step 2: Collect Context

```bash
BRANCH=$(git branch --show-current)
OWNER=$(gh repo view --json owner -q '.owner.login')
REPO=$(gh repo view --json name -q '.name')
```

### Step 3: Spawn Finalize Execution Agent

**YOU MUST spawn the Agent tool call below. Do NOT inline any finalize steps. Do NOT look for shell scripts to run instead.**

```
Agent({
  subagent_type: "envoy:finalize-execution",
  description: "Run finalize pipeline — PR, CodeRabbit, CI, verification, wiki-sync",
  prompt: `Branch: ${BRANCH}
Repo: ${OWNER}/${REPO}

Execute the full finalize pipeline as defined in your agent instructions.`
})
```

## Error Handling

### Tests Fail on Precondition Check

```
Cannot finalize: Tests failing

Fix tests before finalizing.
```

### PR Creation Fails (reported by execution agent)

```
PR creation failed: <error>

Try: gh pr create --web
```

## Integration with Envoy

Spawns: `envoy:finalize-execution` agent (full execution logic lives there)
Assumes: `envoy:review` has already been run
Follow with: `/envoy:cleanup` after PR is merged
