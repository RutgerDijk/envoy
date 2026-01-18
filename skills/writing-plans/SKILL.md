---
name: writing-plans
description: Use when you have a design doc or spec and need to create an implementation plan
---

# Writing Implementation Plans

## Overview

Create comprehensive implementation plans from design documents. Plans assume the implementing engineer has zero context — document everything needed.

**Announce at start:** "I'm using envoy:writing-plans to create the implementation plan."

## Plan Document Header

Every plan MUST start with:

```markdown
# [Feature Name] Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use envoy:executing-plans to implement this plan task-by-task.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

**Design Document:** `docs/plans/<design-doc>.md`

---
```

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**

- "Create the file" — step
- "Add the function" — step
- "Run the test" — step
- "Commit" — step

## Task Structure

```markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.ext`
- Modify: `exact/path/to/existing.ext:123-145`
- Test: `tests/exact/path/to/test.ext`

**Step 1: [Action]**

[Exact code or command]

**Step 2: [Action]**

[Exact code or command]

**Step 3: Verify**

Run: `[exact command]`
Expected: [what should happen]

**Step 4: Commit**

```bash
git add [files]
git commit -m "[type]: [description]"
```
```

## Execution Strategy

Each plan MUST specify an execution strategy in the header:

```yaml
execution:
  strategy: parallel | batch | sequential
  # For batch:
  batches:
    - tasks: [1, 2, 3]
      checkpoint: true
    - tasks: [4, 5]
      checkpoint: false
```

**Choose based on:**
- `parallel` — Independent tasks across different files
- `batch` — Logical phases (data model → API → UI)
- `sequential` — Tightly coupled changes

## Stack Detection

Before writing the plan, detect the project stack:

```bash
# Check for .NET
ls *.csproj 2>/dev/null

# Check for React
grep -l "react" package.json 2>/dev/null

# Check for other technologies
```

Include relevant stack profile references in tasks.

## After Saving the Plan

**Always show the exact plan path in the completion message:**

"**Plan complete!**

**Plan saved to:** `docs/plans/YYYY-MM-DD-<topic>-plan.md`
**Tasks:** N tasks across M phases

**To execute this plan:**
```bash
/envoy:executing-plans docs/plans/YYYY-MM-DD-<topic>-plan.md
```

**Execution options:**

1. **Execute now (this session)** — Run `/envoy:executing-plans <plan-path>`
2. **Subagent-Driven (this session)** — Dispatch fresh agent per task with reviews
3. **New session** — Open worktree session and run the command above

Which approach?"

**IMPORTANT:** Always include the exact plan file path in any suggestion to execute.

## Key Principles

- Exact file paths always
- Complete code in plan (not "add validation")
- Exact commands with expected output
- DRY, YAGNI, TDD where applicable
- Frequent commits
- Reference stack profiles for technology-specific guidance
