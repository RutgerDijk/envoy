---
name: review
description: Use after implementation is complete, before creating PR or finalizing work
---

# Multi-Layer Code Review

## Overview

Runs a multi-layer review pipeline in an isolated execution agent. The agent handles complexity tier detection, stack profile loading, and all review layers.

After this skill completes, use `/envoy:finalize` to create the PR.

**Announce at start:** "I'm using envoy:review to run a multi-layer code review."

## Arguments

| Flag | Effect |
|------|--------|
| (none) | Full review based on complexity tier |
| `--quick` | Layers 0 and 0.5 only (lint + cleanup, no AI/visual/docs) |

## Process

### Step 1: Collect Context

```bash
BRANCH=$(git branch --show-current)
```

Check for `--quick` flag in arguments.

### Step 2: Spawn Review Execution Agent

**YOU MUST spawn the Agent tool call below. Do NOT inline the review logic. Do NOT narrate what the agent would do.**

```
Agent({
  subagent_type: "envoy:review-execution",
  description: "Run multi-layer code review",
  prompt: `Branch: ${BRANCH}
Flags: ${flags}

Execute the full review pipeline as defined in your agent instructions.`
})
```

### Step 3: Report

The review-execution agent produces its own report. Surface it to the user verbatim.

## Integration with Envoy

Spawns: `envoy:review-execution` agent (full layer logic lives there)

Slot in workflow:
```
pickup → review → finalize
```
