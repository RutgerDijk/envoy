# Simplify Workflow: Merge 8 Phases Into 5

> **For Claude:** Use envoy:executing-plans to implement this spec task-by-task.

## Overview

Restructure Envoy's workflow skills from 8 loosely-chained phases into 5 cohesive phases with clear human decision points. Eliminates redundant review passes, moves work to where it logically belongs, and simplifies the artifact model.

**Current:** brainstorm → writing-plans → pickup → executing-plans → cleanup-pass → layered-review → finishing-branch → cleanup

**Proposed:** brainstorm → pickup → review → finalize → cleanup

## Architecture

The core insight: GitHub issue IS the design doc. Brainstorm outputs an issue, not a spec file. Pickup creates the branch, writes the plan, and executes. Review absorbs cleanup-pass. Finalize is shipping only. Cleanup gains session clearing and wiki sync.

### Key Decisions

1. **No spec file during brainstorm** — issue body contains Overview, Architecture, Acceptance Criteria
2. **Pickup is the workhorse** — creates branch, writes spec, executes tasks
3. **Cleanup-pass becomes Review Layer 0.5** — runs before AI review, re-runs if fixes introduce slop
4. **Finalize is lean** — push, PR, CodeRabbit, CI, verify (no docstrings, no wiki, no session clearing)
5. **Cleanup gains responsibilities** — session clearing, wiki sync, close issue

## Acceptance Criteria

- [ ] 5-phase workflow works end-to-end: brainstorm → pickup → review → finalize → cleanup
- [ ] Old skills deleted: writing-plans, executing-plans, subagent-driven-development, cleanup-pass
- [ ] Commands updated to match new skill names
- [ ] CLAUDE.md updated to reflect 5-phase workflow
- [ ] All skill descriptions under 30 words, start with "Use when..."

---

## Implementation Plan

**Execution Strategy:** `batch`

Batch 1 modifies independent skills (brainstorm, cleanup). Batch 2 tackles the three core merged skills (pickup, review, finalize) which touch different files. Batch 3 deletes old skills and updates commands/docs.

### Task 1: Simplify brainstorm — drop branch/spec creation

**Files:**
- Modify: `skills/brainstorm/SKILL.md`

**Step 1: Rewrite brainstorm skill**

Replace the current brainstorm skill with a simplified version that:
- Keeps Phase 1 (Understanding), Phase 2 (Approaches), Phase 3 (Design presentation)
- Removes Phase 4b (branch creation) and Phase 4c (issue creation with branch reference)
- Changes Phase 4 to output a GitHub issue directly with: Overview, Architecture, Acceptance Criteria
- No spec file, no branch, no `--design-only` flag
- Issue body is the design doc — no linked spec, no feature branch section
- Labels still applied
- Final handoff says: `/envoy:pickup <issue-number>` to start implementation

Key sections of the issue body:
```markdown
## Overview
<description>

## Architecture
<technical approach, key decisions>

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
```

**Step 2: Verify**

Review the skill manually — ensure no references to spec files, branches, `--design-only`, or `docs/plans/`.

**Step 3: Commit**
```bash
git add skills/brainstorm/SKILL.md
git commit -m "refactor(skills): simplify brainstorm — output GitHub issue only, no branch/spec"
```

### Task 2: Expand cleanup — add session clearing, wiki sync

**Files:**
- Modify: `skills/cleanup/SKILL.md`

**Step 1: Add session clearing and wiki sync to cleanup**

Add these steps between the current "Delete Feature Branch" and "Verify Cleanup" steps:

1. **Clear session state** — Remove `.envoy-session.json` and `.envoy-scratchpad.json` from the worktree before removing it
2. **Wiki sync** — If `docs/wiki/` was changed on the branch, run `/envoy:wiki-sync`
3. **Remove "in progress" label** — `gh issue edit <number> --remove-label "in progress"`

Update the report table to include session state and wiki sync status.

Update the description to: "Use after your PR has been merged to main, before starting new work"

**Step 2: Verify**

Check the skill for consistency — steps numbered correctly, report table matches steps.

**Step 3: Commit**
```bash
git add skills/cleanup/SKILL.md
git commit -m "refactor(skills): expand cleanup — add session clearing, wiki sync, label removal"
```

### Task 3: Expand pickup — absorb plan writing and execution

**Files:**
- Modify: `skills/pickup/SKILL.md`

This is the largest task. Pickup absorbs logic from writing-plans, executing-plans, and subagent-driven-development.

**Step 1: Rewrite pickup skill**

The new pickup flow:

1. **Fetch issue** — `gh issue view <N>` to get title, body, labels
2. **Set in progress** — Add "in progress" label, comment on issue
3. **Create feature branch** — `feature/<N>-<topic>` from main (NOT fetched from remote — created fresh)
4. **Create worktree** — `.worktrees/<N>-<topic>` with permissions merge (keep existing Step 5b)
5. **Detect stack profiles** — Keep existing stack detection logic
6. **Run search-first** — Invoke `envoy:search-first` against acceptance criteria from issue body
7. **Write spec with implementation plan** — Read issue body, detect stack, write spec to `docs/plans/YYYY-MM-DD-<topic>.md` on the feature branch. Include both design (from issue) and implementation tasks. Follow the task structure template from current writing-plans skill (TDD, exact files, steps, commit messages). Commit spec.
8. **Pause for approval** — Show the plan, ask "Ready to execute? (yes / edit / abort)"
9. **Execute tasks** — Absorb executing-plans logic:
   - Parse execution strategy from spec
   - Initialize session state (`.envoy-session.json`)
   - Load stack profiles + implementation reminders
   - Analyze task dependencies for parallelization
   - TDD Iron Law enforcement
   - Complexity classification
   - Execute tasks (sequential/batch/parallel dispatch)
   - Lightweight per-task check: TDD compliance, spec match, pattern propagation
   - Progress tracking via session state + task list
   - Verification after each task
10. **Report completion** — Summary of executed tasks, pass/fail status

Include from executing-plans:
- Parallelization heuristics (different features ✓, backend vs frontend ✓, same entity different layers ✗)
- Complexity tiers (trivial/small/medium/large)
- Session state tracking (`lib/session-state.js`)
- Agent scratchpad for parallel dispatch (`lib/agent-scratchpad.js`)
- LITM-aware prompt building (`lib/context-budget.js`)
- Relevance scoring (`lib/relevance-scorer.js`)

Include from subagent-driven-development:
- Fresh subagent per task (no context pollution)
- Two-stage review per task (spec compliance + code quality)
- Implementer prompt structure (objective + TDD + constraints + reference + acceptance)

Arguments:
- `<issue-number>` — Required
- `--plan-only` — Stop after spec writing, don't execute

**Step 2: Verify**

Check that:
- No references to "fetch from remote" for the branch (we create it fresh)
- TDD Iron Law is clearly stated
- Session state tracking is included
- Parallel execution logic is included
- search-first is invoked before plan writing

**Step 3: Commit**
```bash
git add skills/pickup/SKILL.md
git commit -m "refactor(skills): expand pickup — absorb plan writing, execution, parallel dispatch"
```

### Task 4: Expand layered-review into review — absorb cleanup-pass and docstrings

**Files:**
- Modify: `skills/layered-review/SKILL.md`
- Rename to: `skills/review/SKILL.md` (create new, delete old in Task 8)

**Step 1: Create the new review skill**

Create `skills/review/SKILL.md` that combines layered-review + cleanup-pass + docstrings integration:

New layer structure:
- **Layer 0: Lint** — `npm run lint` / `dotnet build` (all tiers)
- **Layer 0.5: Cleanup pass** — Fresh agent removes AI slop from diff (all tiers except trivial):
  - Unnecessary defensive checks
  - Over-engineering (single-impl interfaces, premature caching)
  - Redundant tests (mock-returns-mock)
  - Excessive comments
  - Dead code
  - Run tests after each category
  - One commit per category
- **Layer 1: AI code review** — Sonnet, iterative retrieval, read-only (small+)
- **If Layer 1 introduces fixes:** Re-run Layer 0.5 on those fixes only
- **Layer 2: Visual review** — Chrome DevTools (medium+) — invoke `envoy:visual-review`
- **Layer 3: Documentation** — Invoke `envoy:docstrings` for public API docs (medium+)

Complexity tiers (preserved from layered-review):
- Trivial: Layer 0 only
- Small: Layers 0, 0.5, 1
- Medium: Layers 0, 0.5, 1, 2, 3
- Large: All layers (full depth)

Keep from layered-review:
- Pre-review file loading and relevance scoring
- Stack detection and profile loading
- Layer 1 iterative retrieval (3 cycles max)
- Checks: spec compliance, TDD verification, pattern consistency
- Review pattern loading from `lib/learning-loader.js`

Keep from cleanup-pass:
- Fresh agent that only sees the diff
- Category-by-category cleanup with test runs
- "Never touch" rules (test assertions, intentional defensive code)

Skill metadata:
```yaml
name: review
description: Use after implementation is complete, before creating PR or finalizing work
```

**Step 2: Verify**

- Layer numbering is consistent
- Re-run of 0.5 after Layer 1 fixes is clearly described
- Complexity tiers map correctly to layers

**Step 3: Commit**
```bash
git add skills/review/SKILL.md
git commit -m "refactor(skills): create review skill — merge layered-review + cleanup-pass + docstrings"
```

### Task 5: Slim finalize — shipping only

**Files:**
- Modify: `skills/finishing-branch/SKILL.md`
- Rename to: `skills/finalize/SKILL.md` (create new, delete old in Task 8)

**Step 1: Create the new finalize skill**

Create `skills/finalize/SKILL.md` that is finishing-branch minus docstrings, wiki sync, and session clearing:

Keep:
- Preconditions (feature branch, clean state, tests pass)
- Push and create PR
- Poll CodeRabbit (exponential backoff, 22min max)
- Address all findings, push fixes, re-poll (max 3 cycles)
- Poll CI, auto-fix via `envoy:fix-ci` (max 3 cycles)
- Final verification with evidence
- Report PR URL

Remove:
- Step 1 (docstrings) — moved to review Layer 3
- Step 2 (update documentation / wiki) — moved to cleanup
- Step 11 (clear session state) — moved to cleanup
- Step 12 (wiki sync) — moved to cleanup

Skill metadata:
```yaml
name: finalize
description: Use when review is complete and you're ready to push, create PR, and ship
```

**Step 2: Verify**

- No references to docstrings, wiki sync, or session state clearing
- Steps are renumbered correctly
- Report table doesn't mention docstrings/wiki/session items

**Step 3: Commit**
```bash
git add skills/finalize/SKILL.md
git commit -m "refactor(skills): create finalize skill — shipping only, no docstrings/wiki/session"
```

### Task 6: Delete old skill directories

**Files:**
- Delete: `skills/writing-plans/SKILL.md` (and directory)
- Delete: `skills/executing-plans/SKILL.md` (and directory)
- Delete: `skills/subagent-driven-development/SKILL.md` (and directory)
- Delete: `skills/cleanup-pass/SKILL.md` (and directory)
- Delete: `skills/layered-review/SKILL.md` (and directory)
- Delete: `skills/finishing-branch/SKILL.md` (and directory)

**Step 1: Remove old skill directories**

```bash
rm -rf skills/writing-plans/
rm -rf skills/executing-plans/
rm -rf skills/subagent-driven-development/
rm -rf skills/cleanup-pass/
rm -rf skills/layered-review/
rm -rf skills/finishing-branch/
```

**Step 2: Verify**

```bash
ls skills/
```

Should show: brainstorm, cleanup, costs, docstrings, eval-harness, fix-ci, finalize, pickup, pressure-test-scenarios, receiving-code-review, requesting-code-review, review, search-first, systematic-debugging, test-driven-development, using-envoy, using-git-worktrees, verification, visual-review, wiki-sync, writing-skills, dispatching-parallel-agents

**Step 3: Commit**
```bash
git add -A skills/writing-plans/ skills/executing-plans/ skills/subagent-driven-development/ skills/cleanup-pass/ skills/layered-review/ skills/finishing-branch/
git commit -m "refactor(skills): delete absorbed skills — writing-plans, executing-plans, subagent-driven-dev, cleanup-pass, layered-review, finishing-branch"
```

### Task 7: Update commands to match new skill names

**Files:**
- Delete: `commands/execute-plan.md`
- Delete: `commands/write-plan.md`
- Modify: `commands/finalize.md` — point to `envoy:finalize` (was `envoy:finishing-branch`)
- Modify: `commands/review.md` — point to `envoy:review` (was `envoy:layered-review`)
- Modify: `commands/quick-review.md` — point to `envoy:review` with layers 0-1 only (was `envoy:layered-review`)

**Step 1: Update command files**

`commands/finalize.md`: Update to reference `envoy:finalize` instead of `envoy:finishing-branch`. Update description.

`commands/review.md`: Update to reference `envoy:review` instead of `envoy:layered-review`. Update description.

`commands/quick-review.md`: Update to reference `envoy:review` with `--quick` flag or layers 0-1. Update description.

**Step 2: Delete removed commands**

```bash
rm commands/execute-plan.md
rm commands/write-plan.md
```

**Step 3: Verify**

```bash
ls commands/
```

Should show: brainstorm.md, cleanup.md, costs.md, docstrings.md, finalize.md, fix-ci.md, pickup.md, quick-review.md, review.md, visual-review.md, wiki-sync.md

**Step 4: Commit**
```bash
git add commands/
git commit -m "refactor(commands): update commands for 5-phase workflow, remove obsolete commands"
```

### Task 8: Update CLAUDE.md and skill descriptions

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update workflow description in CLAUDE.md**

Update the project description to reflect the 5-phase workflow:
```
**Workflow:** brainstorm → pickup → review → finalize → cleanup
```

Remove references to:
- writing-plans
- executing-plans
- subagent-driven-development
- cleanup-pass
- layered-review
- finishing-branch

Update any references to the old skill names with the new ones.

**Step 2: Verify**

Search CLAUDE.md for any remaining references to deleted skills.

**Step 3: Commit**
```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for 5-phase workflow"
```

### Task 9: Update cross-references in remaining skills

**Files:**
- Modify: Various skills that reference deleted/renamed skills

**Step 1: Search for cross-references**

```bash
grep -r "executing-plans\|writing-plans\|subagent-driven-development\|cleanup-pass\|layered-review\|finishing-branch" skills/ --include="*.md" -l
```

For each file found, update references:
- `envoy:executing-plans` → `envoy:pickup` (execution is now part of pickup)
- `envoy:writing-plans` → `envoy:pickup` (plan writing is now part of pickup)
- `envoy:subagent-driven-development` → `envoy:pickup` (parallel dispatch is now part of pickup)
- `envoy:cleanup-pass` → `envoy:review` (cleanup-pass is now Layer 0.5 of review)
- `envoy:layered-review` → `envoy:review`
- `envoy:finishing-branch` → `envoy:finalize`

Also check: `contexts/`, `lib/`, `agents/`, `hooks/`, `adapters/`, `docs/`

**Step 2: Verify**

```bash
grep -r "executing-plans\|writing-plans\|subagent-driven-development\|cleanup-pass\|layered-review\|finishing-branch" . --include="*.md" --include="*.js" --include="*.sh" -l
```

Should return no results (except possibly git history references or memory files).

**Step 3: Commit**
```bash
git add -A
git commit -m "refactor: update all cross-references to use 5-phase skill names"
```

---

*Generated by Envoy*
