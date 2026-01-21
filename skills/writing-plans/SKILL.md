---
name: writing-plans
description: Use when you have a spec and need to add implementation tasks to it
---

# Writing Implementation Plans

## Overview

Add implementation tasks to an existing spec document, or create a new spec with tasks. Plans assume the implementing engineer has zero context — document everything needed.

**Announce at start:** "I'm using envoy:writing-plans to create the implementation plan."

## Spec Document Structure

Specs combine design and implementation in one file:

```markdown
# [Feature Name]

> **For Claude:** Use envoy:executing-plans to implement this spec task-by-task.

## Overview

[One sentence describing what this builds]

## Architecture

[2-3 sentences about approach, key technologies]

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

---

## Implementation Plan

**Execution Strategy:** parallel | batch | sequential

[Tasks go here...]
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

## After Saving the Spec

**Always show the exact spec path in the completion message:**

"**Spec complete!**

**Spec saved to:** `docs/plans/YYYY-MM-DD-<topic>.md`
**Tasks:** N tasks across M phases

**To execute this spec:**
```bash
/envoy:executing-plans docs/plans/YYYY-MM-DD-<topic>.md
```

**Execution options:**

1. **Execute now (this session)** — Run `/envoy:executing-plans <spec-path>`
2. **Subagent-Driven (this session)** — Dispatch fresh agent per task with reviews
3. **New session** — Open worktree session and run the command above

Which approach?"

**IMPORTANT:** Always include the exact spec file path in any suggestion to execute.

## Key Principles

- Exact file paths always
- Complete code in plan (not "add validation")
- Exact commands with expected output
- DRY, YAGNI, TDD where applicable
- Frequent commits
- Reference stack profiles for technology-specific guidance
