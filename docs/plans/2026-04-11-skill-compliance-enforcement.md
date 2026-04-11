# Skill Compliance Enforcement

> **For Claude:** Use envoy:pickup to execute this spec task-by-task.

## Overview

Fix multiple failure modes where agents skip steps, defer tasks, improvise from memory, or narrate instead of executing. Structural fix: execution phases move to isolated agents. Behavioral fix: Scope Iron Law + Blocker Protocol. 25 audit findings addressed.

## Architecture

Three new execution agents (`pickup-execution`, `review-execution`, `finalize-execution`) replace inline execution in their parent skills. Skills become thin wrappers. Fresh agents can't pattern-match from memory. Brainstorm restructured to produce full task plans in GitHub issues; pickup does viability check instead of plan writing.

## Acceptance Criteria

See GitHub issue #19.

---

## Implementation Plan

**Execution Strategy:** batch
**Rationale:** Changes span many files but fall into clear dependency phases. Agents must exist before skill wrappers reference them. Audit fixes are independent of each other.

---

### Batch 1: CLAUDE.md and quick wins (no new files, high confidence)

#### Task 1: Update CLAUDE.md rigid skills list

**Files:**
- Modify: `CLAUDE.md`

Already partially done (review added). Complete it:

Add `pickup`, `systematic-debugging`, `receiving-code-review` to the rigid skills list.

**Commit:**
```bash
git add CLAUDE.md
git commit -m "docs(claude): add pickup, systematic-debugging, receiving-code-review to rigid skills list"
```

---

#### Task 2: Fix Workflow.md wiki drift

**Files:**
- Modify: `docs/wiki/Workflow.md`

Fixes:
- Remove "Add docstrings to public APIs" from finalize section (that's review Layer 3)
- Update brainstorm description: remove "implementation plan with numbered tasks" and "feature branch with spec committed" — brainstorm creates GitHub issue only
- Update to reflect new flow once brainstorm restructure lands (note as upcoming change)

**Commit:**
```bash
git add docs/wiki/Workflow.md
git commit -m "docs(wiki): fix workflow.md drift — correct brainstorm and finalize descriptions"
```

---

#### Task 3: Fix Skills-Reference.md

**Files:**
- Modify: `docs/wiki/Skills-Reference.md`

Fixes:
- Update rigid skills list: add `review`, `pickup`, `systematic-debugging`, `receiving-code-review`
- Add `envoy:review --quick` row to Quality & Review table

**Commit:**
```bash
git add docs/wiki/Skills-Reference.md
git commit -m "docs(wiki): update skills-reference — rigid skills list and --quick flag"
```

---

#### Task 4: Remove outdated references from skill files

**Files:**
- Modify: `skills/finalize/SKILL.md` (remove "Replaces envoy:finishing-branch" line)
- Modify: `skills/pickup/SKILL.md` (remove "Brainstorm no longer creates branches" note from Step 3; add clean integration note to Overview)

**Commit:**
```bash
git add skills/finalize/SKILL.md skills/pickup/SKILL.md
git commit -m "docs(skills): remove outdated finishing-branch and brainstorm-branch references"
```

---

#### Task 5: Fix dispatching-parallel-agents Task() → Agent() syntax

**Files:**
- Modify: `skills/dispatching-parallel-agents/SKILL.md`

Replace all `Task("...")` invocations with `Agent({ description: "...", prompt: "..." })` format consistent with all other skills.

**Commit:**
```bash
git add skills/dispatching-parallel-agents/SKILL.md
git commit -m "fix(skills): replace Task() with Agent({}) syntax in dispatching-parallel-agents"
```

---

### Batch 2: New execution agents

#### Task 6: Create agents/pickup-execution.md

**Files:**
- Create: `agents/pickup-execution.md`

This is the most important new file. Contents:
- Frontmatter: `name: pickup-execution`, description under 30 words
- Announce at start
- **Scope Iron Law** (full text from issue #19)
- **Blocker Protocol** with Blocker Report format (full text from issue #19)
- **TDD Iron Law** (adapt from `subagent-driven-development/SKILL.md` — reuse the implementer prompt structure)
- Task execution loop: for each task extracted from issue body, execute with TDD, commit, run spec compliance check
- Two-stage review per task: spec compliance reviewer prompt (from `subagent-driven-development/SKILL.md`), then code quality reviewer
- Completion report format

**Commit:**
```bash
git add agents/pickup-execution.md
git commit -m "feat(agents): add pickup-execution agent with Scope Iron Law and Blocker Protocol"
```

---

#### Task 7: Create agents/review-execution.md

**Files:**
- Create: `agents/review-execution.md`

Contents: full layer 0–3 review logic migrated from `skills/review/SKILL.md`, formatted as agent definition. Key additions vs current skill:
- Announce at start with layer-by-layer announce before each layer
- Layer 0.5: add `model: "sonnet"` and `subagent_type` to Agent call; add "YOU MUST spawn agent" consequence
- Layer 1: add "If you do not spawn Agent, STOP — do not proceed to Layer 2"
- Accepts context passed from skill wrapper: branch, flags (--quick)

**Commit:**
```bash
git add agents/review-execution.md
git commit -m "feat(agents): add review-execution agent with all layer logic and spawn enforcement"
```

---

#### Task 8: Create agents/finalize-execution.md

**Files:**
- Create: `agents/finalize-execution.md`

Contents: full finalize logic from `skills/finalize/SKILL.md`, formatted as agent definition. Additions:
- Step after PR creation: write `echo "$PR_NUMBER" > /tmp/envoy-active-pr.txt`
- Add Step 10: wiki-sync with "YOU MUST invoke `/envoy:wiki-sync`, not a shell script"
- Document CodeRabbit 22min vs CI 15min timeout difference with rationale
- Accepts context passed from skill wrapper: branch, PR target

**Commit:**
```bash
git add agents/finalize-execution.md
git commit -m "feat(agents): add finalize-execution agent with wiki-sync enforcement and PR number persistence"
```

---

### Batch 3: Thin skill wrappers

#### Task 9: Thin skills/review/SKILL.md

**Files:**
- Modify: `skills/review/SKILL.md`

Replace execution logic with thin wrapper:
1. Keep: Announce at start, `--quick` flag documentation, Overview
2. Replace: all layer logic with context collection + agent spawn:
   ```
   Collect: branch=$(git branch --show-current), flags (--quick if passed)
   Spawn: Agent({ subagent_type: "envoy:review-execution", prompt: "Branch: $branch\nFlags: $flags" })
   ```
3. Keep: Integration with Envoy section

**Commit:**
```bash
git add skills/review/SKILL.md
git commit -m "refactor(skills): thin review skill — spawn review-execution agent"
```

---

#### Task 10: Thin skills/finalize/SKILL.md

**Files:**
- Modify: `skills/finalize/SKILL.md`

Replace execution logic with thin wrapper:
1. Keep: Announce at start, Overview, Preconditions check (run preconditions before spawning)
2. Replace: all steps with agent spawn after preconditions pass:
   ```
   Spawn: Agent({ subagent_type: "envoy:finalize-execution", prompt: "Branch: $branch\nRepo: $owner/$repo" })
   ```
3. Keep: Error handling, Integration with Envoy section

**Commit:**
```bash
git add skills/finalize/SKILL.md
git commit -m "refactor(skills): thin finalize skill — spawn finalize-execution agent"
```

---

#### Task 11: Update skills/pickup/SKILL.md Step 10

**Files:**
- Modify: `skills/pickup/SKILL.md`

Changes:
- Replace Steps 7–8 (search-first + write spec) with viability check:
  ```
  ### Step 7: Viability Check
  Read the implementation plan from the issue body.
  Check: do referenced file paths still exist? Have any referenced APIs/interfaces changed?
  If viable: proceed to Step 8.
  If stale: surface specific staleness concerns to user, let them decide to proceed or update issue.
  ```
- Replace Step 10 execution dispatch with: `Agent({ subagent_type: "envoy:pickup-execution", prompt: issueBody + stackContext })`
- Add two-stage completion check before reporting done: spec compliance (task count) then `envoy:review`

**Commit:**
```bash
git add skills/pickup/SKILL.md
git commit -m "refactor(skills): pickup viability check replaces plan writing; Step 10 spawns pickup-execution agent"
```

---

### Batch 4: Brainstorm restructure

#### Task 12: Update skills/brainstorm/SKILL.md

**Files:**
- Modify: `skills/brainstorm/SKILL.md`

Add Phase 1.5 between "Understanding" and "Exploring Approaches":

```
### Phase 1.5: Repo Exploration

Before proposing approaches, explore the repo:
1. Read relevant existing files (use acceptance criteria as guide)
2. Check for existing patterns, utilities, or similar features
3. Note file paths that will likely be affected

This produces the implementation task list in the issue.
```

Update Phase 4 (GitHub Issue) template to include task list:
```markdown
## Tasks

### Task 1: <name>
**Files:** Create/Modify: `exact/path/to/file.ext`
**What:** <one sentence>

### Task 2: <name>
...
```

Add note: "Every task in this spec is REQUIRED. Optional/stretch work goes in a separate issue."

**Commit:**
```bash
git add skills/brainstorm/SKILL.md
git commit -m "feat(skills): brainstorm adds repo exploration and task list to issue body"
```

---

### Batch 5: Skill compliance fixes — pickup

#### Task 13: Add enforcement to pickup search-first (Step 7 — now viability check replaces it, but keep the pattern check)

**Files:**
- Modify: `agents/pickup-execution.md` (add search-first result handling)

Inside pickup-execution, add decision tree: if search-first recommends Adopt/Extend/Compose → STOP and surface recommendation to user. If Build → continue.

**Commit:**
```bash
git add agents/pickup-execution.md
git commit -m "feat(agents): add search-first result enforcement to pickup-execution"
```

---

#### Task 14: Add Task Granularity Iron Law to pickup-execution

**Files:**
- Modify: `agents/pickup-execution.md`

Add after Scope Iron Law:
```
#### Task Granularity Iron Law
Each task dispatched to an implementing agent MUST be:
- 2–5 minutes of focused work
- Exact file paths (never "add validation" — always "add null check in UserService.cs:42")
- One clear objective
If tasks from the issue plan are too coarse, break them into sub-steps before dispatching.
Violations: break it down. Do not dispatch.
```

**Commit:**
```bash
git add agents/pickup-execution.md
git commit -m "feat(agents): add task granularity iron law to pickup-execution"
```

---

#### Task 15: Add execution strategy mandatory defaults

**Files:**
- Modify: `skills/pickup/SKILL.md`

Add mandatory defaults to Step 9 (plan approval) section:
```
Execution strategy defaults if not specified in issue:
- 1–3 tasks → sequential
- 4–8 tasks → batch
- 9+ tasks → parallel
If uncertain, ask. Do NOT assume.
```

**Commit:**
```bash
git add skills/pickup/SKILL.md
git commit -m "fix(skills): add mandatory execution strategy defaults to pickup"
```

---

### Batch 6: Skill compliance fixes — other skills

#### Task 16: Add Iron Law to receiving-code-review

**Files:**
- Modify: `skills/receiving-code-review/SKILL.md`

Add after "The Response Pattern" section:
```
## Iron Law: Verify ALL Before Implement ANY

1. READ all feedback items
2. UNDERSTAND every item — restate or ask for clarification
3. VERIFY all items are technically sound
4. THEN implement

Do NOT:
- Implement items 1–3 while still unclear on item 4
- Assume items are independent and implement partially
- Skip verification on any item because it "seems obviously correct"

All items verified → implement all.
Any item unclear → ask first, implement nothing.
```

**Commit:**
```bash
git add skills/receiving-code-review/SKILL.md
git commit -m "feat(skills): add Iron Law to receiving-code-review — verify all before implement any"
```

---

#### Task 17: Add STOP consequence to TDD rationalization table

**Files:**
- Modify: `skills/test-driven-development/SKILL.md`
- Modify: `agents/pickup-execution.md` (ensure same language in execution agent)

Add after the rationalization table:
```
## Red Flags — STOP IMMEDIATELY

If you catch yourself thinking ANY of the above:
STOP. Delete the code. Start over with TDD. No exceptions.

Proceeding past a red flag = TDD violation = start over.
```

Also clarify TDD scope for existing code (below rationalization table):
```
## TDD Scope

TDD applies to NEW code.
- Modified existing code with no tests → write test FIRST, then change (TDD)
- Refactoring without behavior change → refactor first, add tests if missing
- Existing tests that don't cover the change → add coverage for new behavior only
```

**Commit:**
```bash
git add skills/test-driven-development/SKILL.md agents/pickup-execution.md
git commit -m "feat(skills): add STOP consequence and TDD scope clarification to TDD skill"
```

---

#### Task 18: Add execute-not-narrate enforcement to cleanup

**Files:**
- Modify: `skills/cleanup/SKILL.md`

Add at the top of the Process section:
```
**Discipline rule:** Every step in this skill MUST be executed as written, not narrated.
- DO NOT say "git branch --show-current would show..."
- DO run: `git branch --show-current` and capture output
- DO verify each step succeeded before proceeding
- DO NOT assume steps worked without evidence

This is a cleanup operation. Mistakes here mean lost work. Execute exactly.
```

**Commit:**
```bash
git add skills/cleanup/SKILL.md
git commit -m "feat(skills): add execute-not-narrate enforcement to cleanup"
```

---

### Batch 7: Error handling and integration fixes

#### Task 19: Fix finalize-execution — PR number persistence and fix-ci documentation

**Files:**
- Modify: `agents/finalize-execution.md`
- Modify: `skills/fix-ci/SKILL.md`

In finalize-execution, after PR creation step, add:
```bash
echo "$PR_NUMBER" > /tmp/envoy-active-pr.txt
```

In fix-ci, document PR detection order:
```
PR detection order:
1. Argument: /envoy:fix-ci <pr-number>
2. File: /tmp/envoy-active-pr.txt (written by finalize)
3. Git: gh pr view (current branch's PR)
4. FAIL: "Cannot find PR. Specify: /envoy:fix-ci <pr-number>"
```

**Commit:**
```bash
git add agents/finalize-execution.md skills/fix-ci/SKILL.md
git commit -m "fix(integration): finalize writes PR number for fix-ci; document detection order"
```

---

#### Task 20: Fix remaining error handling gaps

**Files:**
- Modify: `skills/verification/SKILL.md` (escalation guidance)
- Modify: `skills/coderabbit-pr-review/SKILL.md` (parsing fallback)
- Modify: `skills/cleanup/SKILL.md` (wiki-sync failure blocks worktree removal)
- Modify: `skills/docstrings/SKILL.md` (zero code files handler)
- Modify: `skills/eval-harness/SKILL.md` (2-minute timeout)
- Modify: `skills/wiki-sync/SKILL.md` (empty docs/wiki/ handler)

Each fix as described in audit findings 7, 17, 4, 25, 19, 20.

**Commit:**
```bash
git add skills/verification/SKILL.md skills/coderabbit-pr-review/SKILL.md skills/cleanup/SKILL.md skills/docstrings/SKILL.md skills/eval-harness/SKILL.md skills/wiki-sync/SKILL.md
git commit -m "fix(skills): address error handling gaps across 6 skills"
```

---

#### Task 21: Document CodeRabbit vs CI timeout rationale

**Files:**
- Modify: `agents/finalize-execution.md`

Add comment near polling sections:
```
# CodeRabbit: 22-minute max (async review, slower — GitHub App processes PR asynchronously)
# CI: 15-minute max (synchronous checks, faster feedback loop)
```

**Commit:**
```bash
git add agents/finalize-execution.md
git commit -m "docs(agents): document CodeRabbit vs CI timeout difference rationale"
```

---

### Batch 8: Final cleanup

#### Task 22: Commit already-applied partial fixes

**Files:**
- `CLAUDE.md` (review added to rigid skills — already modified)
- `skills/review/SKILL.md` (discipline rule, YOU MUST language — already modified)

These were applied earlier in this session. Commit them cleanly.

**Commit:**
```bash
git add CLAUDE.md skills/review/SKILL.md
git commit -m "fix(skills): apply partial compliance fixes from session — review rigid marking and enforcement language"
```

---

## Notes

- This is a pure markdown project. No unit tests. Verification = reviewing content against acceptance criteria from issue #19.
- Reuse content from `.worktrees/2-envoy-2.0/skills/subagent-driven-development/SKILL.md` for pickup-execution agent prompts.
- `.claude/settings.local.json` already updated with Write/WebSearch/Task/Skill permissions.
