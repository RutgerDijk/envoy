# Envoy Self-Learning System

> **For Claude:** Use envoy:executing-plans to implement this spec task-by-task.

## Overview

Three interconnected subsystems that create a feedback loop where each review cycle is cheaper than the last. Patterns graduate from detection to prevention to automation. Team learnings are version-controlled and shared via `memory/`.

**Priority #1: Reduce recurring issues to zero token cost.**

## Architecture

### Feedback Loop

```
implement (with confirmed patterns + corrections loaded)
  → fewer issues introduced
    → review finds fewer issues
      → CodeRabbit flags fewer things
        → corrections decrease over time
          → patterns that stop appearing get archived
```

### Three Subsystems

```
Sources:                        Graduated Pool:              Application:

Review findings ───┐            ┌─ DETECTED ────────────► logged only
                   ├──────────► ├─ CONFIRMED ───────────► implementation reminders
CodeRabbit PRs ────┤            ├─ AUTOMATED ───────────► suggest hook/rule to user
                   │            └─ ARCHIVED
User corrections ──┘              (not seen in 5 reviews)
```

All three sources feed into the same graduated pattern pool with consistent levels and thresholds.

### Subsystem A: Graduated Learning

Refactors the existing `learning-extractor.js` from a flat list into a level-based system.

**Levels and thresholds:**

| Level | Trigger | Action | Token Cost |
|-------|---------|--------|------------|
| **Detected** | Seen 1x | Logged in `memory/review-learnings.md` | 0 (async hook) |
| **Confirmed** | Seen 3x | Injected into implementing agent prompt | ~100 tokens/pattern |
| **Automated** | Seen 5x | Claude suggests a hook or lint rule to user | 0 after automation |
| **Archived** | Not seen in 5 reviews | Removed from active patterns | 0 |

The implementing agent (`executing-plans`) loads confirmed patterns before each task:
```
Known patterns for this stack:
- [dotnet] Always check null on API response DTOs before mapping
- [react] Use useCallback for event handlers passed as props
- [typescript] Prefer `unknown` over `any` for external data
```

When a pattern reaches the automated level, Claude suggests a concrete prevention mechanism (hook, lint rule, or eslint plugin config) but does NOT commit it — the user decides.

**Archival:** Patterns that stop appearing have been learned by the team. After 5 reviews without seeing the pattern, it moves to an archived section. If it reappears, it gets re-promoted.

### Subsystem B: Cross-PR CodeRabbit Aggregation

A new async Stop hook that runs after finalize sessions. Tracks which CodeRabbit comment categories recur across PRs.

```
PR #3: CodeRabbit flags "unused import" (2x), "missing await" (1x)
PR #4: CodeRabbit flags "unused import" (3x)
PR #5: CodeRabbit flags "unused import" (1x), "missing await" (2x)
  → "unused import": 3 PRs → confirmed → implementation reminder
  → "missing await": 2 PRs → detected → logged
```

**Storage:** `memory/coderabbit-patterns.md` — tagged with stack, feeds into the same graduated levels.

**Key insight:** CodeRabbit comments are free (zero tokens from us) but fixing them costs tokens. If we can prevent the issue at implementation time, the fix cost drops to zero.

### Subsystem C: User Correction Learning

A `UserPromptSubmit` hook that detects corrections via Haiku classification.

When the user submits a prompt, send it to Haiku:
```
Classify this user message:
1. Is this a correction of Claude's behavior? (yes/no)
2. If yes, scope: project-specific or universal?
3. If yes, one-line rule summary.

Message: "<user prompt>"
```

**Scope heuristic (Haiku decides):**
- References specific files, APIs, classes, or project patterns → **project-level** (`memory/corrections.md`)
- References a language, framework, or general coding practice → **user-level** (`~/.claude/learnings/corrections.md`)

**Examples:**
- "No, use IResult not ActionResult in this API" → project-level
- "Don't use `any` in TypeScript ever" → user-level
- "We always put DTOs in the Contracts folder" → project-level
- "Prefer composition over inheritance" → user-level

Skills load relevant corrections before implementation:
- `executing-plans` loads project corrections + user corrections
- `layered-review` loads project corrections (to avoid flagging things the team chose intentionally)

### Storage Layout

```
Project repo:
  memory/
  ├── review-learnings.md      ← graduated patterns (team-shared, committed)
  ├── coderabbit-patterns.md   ← cross-PR CodeRabbit patterns (team-shared)
  └── corrections.md           ← project-specific corrections (team-shared)

User home:
  ~/.claude/learnings/
  └── corrections.md           ← personal preferences (not shared)
```

All project-level files are version-controlled — teammates get the team's collective learnings on `git pull`. Learnings can be code-reviewed in PRs.

### Token Impact

| Scenario | Without learning | With learning | Savings |
|----------|-----------------|---------------|---------|
| Known pattern caught in review | ~500 tokens (find + fix) | ~0 (prevented at impl) | 100% |
| Recurring CodeRabbit comment | ~200 tokens/PR (parse + fix) | ~0 (prevented or automated) | 100% |
| User repeating same correction | Full correction each time | ~0 (loaded as context) | 100% |
| Loading confirmed patterns | N/A | ~100 tokens/pattern | New cost |
| Haiku correction classification | N/A | ~200 tokens/prompt | New cost |

Net effect: small upfront cost (loading patterns, classifying corrections) avoids much larger downstream costs (finding + fixing recurring issues).

## Acceptance Criteria

- [ ] Graduated learning: patterns have levels (detected/confirmed/automated/archived)
- [ ] Confirmed patterns (3x) injected into implementing agent before each task
- [ ] Automated patterns (5x) trigger suggestion of hook/lint rule to user (not auto-committed)
- [ ] Archived patterns (not seen in 5 reviews) removed from active list
- [ ] Cross-PR CodeRabbit aggregation tracks categories across PRs
- [ ] CodeRabbit patterns feed into the same graduated levels
- [ ] CodeRabbit patterns tagged with stack for selective loading
- [ ] User corrections detected via Haiku classification on UserPromptSubmit
- [ ] Project-specific corrections saved to `memory/corrections.md`
- [ ] User-level corrections saved to `~/.claude/learnings/corrections.md`
- [ ] `executing-plans` loads confirmed patterns + corrections before tasks
- [ ] `layered-review` loads corrections to avoid false flags
- [ ] All project learnings committed to repo (team-shared)
- [ ] Patterns that reappear after archival get re-promoted

---

## Implementation Plan

**Execution Strategy:** `batch`

```yaml
execution:
  strategy: batch
  batches:
    - name: "Foundation — Graduated Learning Refactor"
      tasks: [1, 2, 3]
    - name: "Integration — CodeRabbit Aggregation"
      tasks: [4, 5]
    - name: "Intelligence — User Correction Learning"
      tasks: [6, 7]
    - name: "Polish — Skill Integration & Docs"
      tasks: [8, 9, 10]
```

### Task 1: Refactor learning-extractor.js for graduated levels

**Files:**
- Modify: `hooks/learning-extractor.js`
- Modify: `memory/review-learnings.md` (format change)

**Steps:**
1. Add `level` field to pattern data structure: `detected`, `confirmed`, `automated`, `archived`
2. Update `saveLearnings()` to track level per pattern:
   - count 1-2 → `detected`
   - count 3-4 → `confirmed`
   - count 5+ → `automated`
   - `reviewsSinceLastSeen >= 5` AND level is confirmed+ → `archived`
3. Update `loadLearnings()` to parse level from stored data
4. Add re-promotion logic: if an archived pattern reappears, set it back to `detected` with count 1
5. Update markdown output to group patterns by level:
   ```markdown
   ## Confirmed (loaded into implementation)
   | Pattern | Times Seen | Stack |
   ## Detected (monitoring)
   | Pattern | Times Seen | Stack |
   ## Automated (hook/rule suggested)
   | Pattern | Times Seen | Suggestion |
   ## Archived (team learned)
   - ~~pattern~~ (archived after 5 clean reviews)
   ```
6. Commit: `git commit -m "feat(hooks): refactor learning extractor for graduated levels"`

### Task 2: Add implementation reminder loading to executing-plans

**Files:**
- Modify: `skills/executing-plans/SKILL.md`
- Create: `lib/learning-loader.js`

**Steps:**
1. Create `lib/learning-loader.js` with:
   - `loadConfirmedPatterns(stackNames)` — reads `memory/review-learnings.md` and `memory/coderabbit-patterns.md`, returns only confirmed+ patterns matching the given stacks
   - `loadCorrections(projectDir)` — reads `memory/corrections.md` (project) and `~/.claude/learnings/corrections.md` (user), returns combined list
   - `formatReminders(patterns, corrections)` — formats as a concise prompt section
2. Update `executing-plans/SKILL.md`:
   - Before each implementation task, add step: "Load implementation reminders"
   - The implementing agent receives a `Known patterns` section in its prompt:
     ```
     **Known patterns (avoid these):**
     - [dotnet] Always check null on API response DTOs before mapping
     - [react] Use useCallback for event handlers passed as props

     **Team corrections:**
     - Use IResult not ActionResult in this API
     - DTOs go in the Contracts folder
     ```
3. Only load patterns relevant to the task's stack (selective loading)
4. Commit: `git commit -m "feat(skills): load confirmed patterns as implementation reminders"`

### Task 3: Add automation suggestion for 5x patterns

**Files:**
- Modify: `hooks/learning-extractor.js`
- Create: `lib/automation-suggester.js`

**Steps:**
1. Create `lib/automation-suggester.js` with:
   - `suggestAutomation(pattern)` — given a pattern, suggest a prevention mechanism:
     - If pattern is about linting/style → suggest ESLint rule or Prettier config
     - If pattern is about missing checks → suggest a PreToolUse hook
     - If pattern is about wrong API usage → suggest a code snippet/template
   - Returns: `{ type: 'lint-rule' | 'hook' | 'template', description, suggestion }`
2. Update `learning-extractor.js`:
   - When a pattern reaches `automated` level (count >= 5), call `suggestAutomation()`
   - Write suggestion to `memory/review-learnings.md` in the Automated section
   - Output a `hookSpecificOutput` message so Claude tells the user:
     ```
     Pattern seen 5+ times: "missing null check on API responses"
     Suggested automation: Add PreToolUse hook that checks for null handling
     Would you like me to create this hook? (The pattern will keep being checked manually until you decide)
     ```
3. The suggestion is informational only — Claude asks, user decides
4. Commit: `git commit -m "feat(lib): add automation suggester for 5x patterns"`

### Task 4: Add cross-PR CodeRabbit aggregation hook

**Files:**
- Create: `hooks/coderabbit-aggregator.js`
- Modify: `hooks/hooks.json`
- Modify: `hooks/hook-runner.js` (add to HOOK_PROFILES)

**Steps:**
1. Create `hooks/coderabbit-aggregator.js` as async Stop hook:
   - Detects if session included a finalize (check for `gh pr create` or coderabbit-pr-review activity)
   - Reads the current session's CodeRabbit findings from `lib/coderabbit-parser.js` output
   - Loads existing `memory/coderabbit-patterns.md`
   - For each finding category:
     - If category seen before: increment PR count, update last seen
     - If new: add with PR count 1
   - Apply graduated levels based on PR count (same thresholds: 1=detected, 3=confirmed, 5=automated)
   - Tag each pattern with stack (detected from file extension of the flagged file)
   - Save updated patterns
2. Register in `hooks/hooks.json` as async Stop hook
3. Add to `HOOK_PROFILES` in `hook-runner.js`: `['standard', 'strict']`
4. Storage format in `memory/coderabbit-patterns.md`:
   ```markdown
   ## Confirmed
   | Category | PRs Seen | Stack | Example |
   |----------|---------|-------|---------|
   | unused-import | 4 | typescript | `import { foo } from './bar'` unused |

   ## Detected
   | Category | PRs Seen | Stack | Example |
   ```
5. Commit: `git commit -m "feat(hooks): add cross-PR CodeRabbit pattern aggregation"`

### Task 5: Integrate CodeRabbit patterns into graduated pool

**Files:**
- Modify: `lib/learning-loader.js`
- Modify: `skills/layered-review/SKILL.md`

**Steps:**
1. Update `loadConfirmedPatterns()` in `lib/learning-loader.js`:
   - Also read `memory/coderabbit-patterns.md`
   - Merge confirmed patterns from both sources
   - Deduplicate by normalized pattern key
2. Update `layered-review/SKILL.md` pre-review step:
   - "Load Known Review Patterns" now reads both `memory/review-learnings.md` AND `memory/coderabbit-patterns.md`
   - Confirmed CodeRabbit patterns are checked before the AI review layer
3. Commit: `git commit -m "feat(skills): integrate CodeRabbit patterns into graduated learning pool"`

### Task 6: Add user correction detection hook

**Files:**
- Create: `hooks/correction-detector.js`
- Modify: `hooks/hooks.json`
- Modify: `hooks/hook-runner.js`

**Steps:**
1. Create `hooks/correction-detector.js` as `UserPromptSubmit` hook:
   - Reads user prompt from stdin
   - Sends to Haiku for classification:
     ```
     Classify this user message. Reply with JSON only.
     {
       "is_correction": true/false,
       "scope": "project" | "user" | null,
       "rule": "one-line rule summary" | null
     }

     Message: "<prompt>"
     ```
   - If `is_correction: true`:
     - If `scope: "project"` → append to `memory/corrections.md`
     - If `scope: "user"` → append to `~/.claude/learnings/corrections.md`
   - Ensure `~/.claude/learnings/` directory exists
   - Deduplicate: don't save if a very similar rule already exists (fuzzy match)
2. Register in `hooks/hooks.json` as `UserPromptSubmit` hook
3. Add to `HOOK_PROFILES`: `['standard', 'strict']` (skip in minimal — costs tokens)
4. Correction file format:
   ```markdown
   # Project Corrections

   - Use IResult not ActionResult in this API (2026-04-04)
   - DTOs go in the Contracts folder (2026-04-04)
   - Always use the repository pattern, never direct DbContext (2026-04-05)
   ```
5. Commit: `git commit -m "feat(hooks): add Haiku-powered user correction detection"`

### Task 7: Add correction loading to skills

**Files:**
- Modify: `lib/learning-loader.js`
- Modify: `skills/executing-plans/SKILL.md`
- Modify: `skills/layered-review/SKILL.md`

**Steps:**
1. Implement `loadCorrections()` in `lib/learning-loader.js`:
   - Read `memory/corrections.md` (project-level)
   - Read `~/.claude/learnings/corrections.md` (user-level)
   - Return combined, deduplicated list
2. Update `executing-plans/SKILL.md`:
   - Before each task: load corrections alongside confirmed patterns
   - Format in prompt as "Team corrections" section
3. Update `layered-review/SKILL.md`:
   - In pre-review context loading: load corrections
   - Purpose: avoid flagging things the team intentionally does differently
   - Add note: "Items in corrections are team decisions, not bugs"
4. Commit: `git commit -m "feat(skills): load user and project corrections into implementation and review"`

### Task 8: Ensure memory/ is committed and shared

**Files:**
- Modify: `.gitignore` (ensure memory/ is NOT ignored)
- Create: `memory/.gitkeep`
- Create: `memory/README.md`

**Steps:**
1. Check `.gitignore` doesn't exclude `memory/`
2. Create `memory/.gitkeep` so the directory exists in fresh clones
3. Create `memory/README.md`:
   ```markdown
   # Team Learnings

   This directory contains patterns learned by Envoy across review cycles.
   These files are committed to the repo so the whole team benefits.

   - `review-learnings.md` — Patterns from AI code review
   - `coderabbit-patterns.md` — Recurring CodeRabbit PR comment categories
   - `corrections.md` — Team coding preferences and corrections

   These files are maintained automatically by Envoy hooks.
   Manual edits are fine — add patterns you know about.
   ```
4. Commit: `git commit -m "feat(memory): add shared team learnings directory"`

### Task 9: Update CLAUDE.md and README

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/wiki/Token-Optimization.md`
- Modify: `docs/wiki/Advanced-Patterns.md`

**Steps:**
1. Update CLAUDE.md:
   - Add `memory/` to project structure
   - Document graduated learning conventions
   - Document correction storage locations
2. Update README:
   - Add Self-Learning section explaining the feedback loop
   - Add memory/ to architecture tree
3. Update wiki pages:
   - Token-Optimization: add learning-based prevention savings
   - Advanced-Patterns: add graduated learning, CodeRabbit aggregation, correction learning
4. Commit: `git commit -m "docs: document self-learning system"`

### Task 10: Sync wiki

**Steps:**
1. Copy updated wiki pages to GitHub wiki repo
2. Commit: `git commit -m "docs: sync wiki with self-learning system docs"`

---

*Generated by Envoy*
