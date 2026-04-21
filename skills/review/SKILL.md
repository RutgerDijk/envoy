---
name: review
description: Use after implementation is complete, before creating PR or finalizing work
---

# Multi-Layer Code Review

## Overview

Runs a multi-layer review pipeline with per-layer subagent isolation. The skill orchestrates directly and spawns one subagent per layer where isolation is required (cleanup, AI review). Lint and orchestration run at skill level.

After this skill completes, use `/envoy:finalize` to create the PR.

**Announce at start:** "I'm using envoy:review to run a multi-layer code review."

**Discipline rule:** This is a rigid skill. Each layer MUST be executed, not narrated. See `contexts/execution-announce.md`. Do NOT write "I would do X" or "I did X" — actually do X.

## Arguments

| Flag | Effect |
|------|--------|
| (none) | Full review based on complexity tier |
| `--quick` | Layers 0 and 0.5 only (lint + cleanup, no AI/visual/docs) |

---

## Pre-Review Setup

### 1. Parse Flags and Get Branch

```bash
BRANCH=$(git branch --show-current)

flags=""
if [[ "$*" == *"--quick"* ]]; then
  flags="--quick"
fi
```

### 2. Get Changed Files

```bash
git diff --name-only main...HEAD
```

If no changed files: stop with "Nothing to review. Make changes first."

### 3. Classify Complexity Tier

```bash
CHANGED=$(git diff --name-only main...HEAD)
FILE_COUNT=$(echo "$CHANGED" | grep -c '.' || echo 0)
LINE_COUNT=$(git diff main...HEAD --numstat | awk '{sum += $1} END {print sum+0}')
```

| Tier | Criteria | Layers |
|------|----------|--------|
| **Trivial** | <5 files AND <50 lines changed | 0 only |
| **Small** | <10 files AND <200 lines changed | 0, 0.5, 1 |
| **Medium** | <20 files AND <500 lines changed | 0, 0.5, 1, 2, 3 |
| **Large** | Everything else | 0, 0.5, 1 (deep), 2, 3 |

If `--quick` flag is set, override tier mapping: run Layers 0 and 0.5 only regardless of complexity.

### 4. Score File Relevance

Use `lib/relevance-scorer.js` to determine read depth per file:

```javascript
const { scoreTaskRelevance, formatForPrompt } = require('../../lib/relevance-scorer');
const changedFiles = getChangedFiles();
const results = scoreTaskRelevance(changedFiles, projectRoot);
const relevanceBriefing = formatForPrompt(results);
```

Depth recommendations:
- **full** — directly changed or critical dependency (score >= 0.5)
- **focused** — read signatures + changed sections (score 0.2-0.5)
- **skim** — scan exports only (score 0.1-0.2)
- **skip** — not relevant

Include `relevanceBriefing` in the Layer 1 AI reviewer prompt.

### 5. Detect and Load Stack Profiles (Selective)

Only load stacks relevant to changed files, and only the "Common Mistakes" section:

| Changed File Pattern | Load These Stacks |
|---------------------|-------------------|
| `*.cs`, `*.csproj` | dotnet, entity-framework, api-patterns |
| `*.tsx`, `*.ts` | react, typescript, tailwind |
| `*.bicep` | bicep, azure-container-apps |
| `*test*` | testing-dotnet or testing-playwright |

```javascript
const { loadStackSection } = require('../../lib/stack-loader');
const mistakes = loadStackSection('dotnet', 'Common Mistakes');
```

### 6. Load Known Review Patterns

```javascript
const { loadConfirmedPatterns, loadCorrections } = require('../../lib/learning-loader');
const patterns = loadConfirmedPatterns(detectedStacks);
const corrections = loadCorrections();
```

Load confirmed patterns from both `memory/review-learnings.md` AND `memory/coderabbit-patterns.md`. Known patterns can be flagged immediately as a cheap local check before the AI review.

Also load corrections — items in corrections are team decisions, not bugs. Do not flag these during review.

### 7. Load Discipline Contexts

Load shared discipline content once; reuse in subagent prompts:

```bash
EXECUTION_ANNOUNCE=$(cat contexts/execution-announce.md)
```

### 8. Shell Output Compression

When running build/test/lint commands during review, use `lib/output-compressor.js` to reduce noisy output:

```javascript
const { compress } = require('../../lib/output-compressor');
const result = compress(rawOutput, 'dotnet test');
```

Supported patterns: `dotnet build`, `dotnet test`, `npm install`, `npm run build`, `jest`, `vitest`, `playwright`, `cargo build/test`, `git status/log`, `docker compose`.

---

## Layer 0: Lint (All Tiers)

Announce: `Running Layer 0: Lint...`

Run project linters:

```bash
npm run lint
dotnet build
```

**If lint fails:**
- Fix auto-fixable issues: `npm run lint -- --fix`
- Fix remaining issues manually
- Commit:
  ```bash
  git add <fixed-files>
  git commit -m "fix: resolve lint issues"
  ```

**For trivial tier: stop here.** Report and suggest `/envoy:finalize`.

---

## Layer 0.5: Cleanup Pass (All Tiers Except Trivial)

Announce: `Running Layer 0.5: Cleanup Pass...`

**YOU MUST spawn an Agent tool call here. Inline cleanup without spawning an agent is wrong. Do not skip this.**

Spawn a fresh cleanup agent that ONLY sees the diff — no implementation context, no conversation history. This is a focused mandate to remove AI-generated slop.

**Key principle:** Never add "don't do X" instructions to the implementing agent — let it implement freely, then run this focused cleanup.

```
Agent({
  model: "sonnet",
  description: "Cleanup pass",
  prompt: `${EXECUTION_ANNOUNCE}

  You are a code cleanup agent. Your job is to remove slop from a recent implementation.

  Read the diff:
  git diff main...HEAD

  Then read each changed file in full to understand context.

  Remove the categories below IN ORDER. Edit files directly.
  Run tests after each category. Commit after each category.

  IMPORTANT:
  - Only remove things that are genuinely unnecessary
  - If in doubt, leave it
  - Never change functionality — only remove noise
  - Never touch test assertions that verify real behavior
  - Intentional defensive code with explanatory comments is NOT slop

  Tools: Read, Edit, Write, Bash, Grep, Glob
  `
})
```

### Category 1: Unnecessary Defensive Checks

Remove:
- Null checks on parameters that can't be null (required params, just-constructed objects)
- Try/catch around code that can't throw (simple assignments, arithmetic)
- Redundant type guards (checking type after TypeScript already narrowed)
- `if (x !== undefined)` when x is always defined
- Empty catch blocks that swallow errors silently

**Keep:**
- Null checks on external input (API responses, user input, database results)
- Try/catch around I/O operations (file, network, database)
- Defensive checks documented as intentional (explicit comment explaining why)

```bash
dotnet test && npm test
git add <changed-files>
git commit -m "refactor: remove unnecessary defensive checks"
```

### Category 2: Over-Engineering

Remove:
- Interfaces/abstractions with only one implementation (and no documented plan for more)
- Generic type parameters that are always the same concrete type
- Factory functions that just call `new`
- Configuration objects for values that never change
- Premature caching/memoization without evidence of performance need
- Feature flags for non-optional features
- Backwards-compatibility shims for code that was just written

**Keep:**
- Abstractions required by the framework (dependency injection, etc.)
- Generics that genuinely serve multiple types
- Configuration that's documented as user-facing

```bash
dotnet test && npm test
git add <changed-files>
git commit -m "refactor: remove over-engineering"
```

### Category 3: Redundant Tests

Remove:
- Tests that just assert the mock returns what you told it to return
- Tests that duplicate another test with trivially different input (keep one, parameterize if needed)
- Tests for framework behavior (e.g., testing that React renders a div)
- Tests that only verify the test setup (e.g., "service is defined")

**Keep:**
- Tests for actual business logic
- Edge case tests that exercise different code paths
- Integration tests that verify real behavior
- Tests for error handling

```bash
dotnet test && npm test
git add <changed-files>
git commit -m "refactor: remove redundant tests"
```

### Category 4: Excessive Comments

Remove:
- Comments that restate the code (`// increment counter` above `counter++`)
- JSDoc/XML-doc on private methods with obvious signatures
- `// TODO` comments for things that are already done
- Commented-out code (it's in git history if needed)
- Section dividers that don't add information (`// ---- Helper Functions ----`)
- "This function does X" when the function name already says X

**Keep:**
- Comments explaining WHY (not what)
- Comments marking intentional trade-offs or workarounds
- JSDoc/XML-doc on public API methods
- Regulatory/compliance comments

```bash
dotnet test && npm test
git add <changed-files>
git commit -m "refactor: remove excessive comments"
```

### Category 5: Dead Code and Unused Imports

Remove:
- Imports not referenced anywhere in the file
- Functions/methods defined but never called
- Variables assigned but never read
- Type definitions not used
- Files created but not imported anywhere
- Unreachable branches

**Keep:**
- Exports that are part of the public API (even if not used internally)
- Types used only in test files

```bash
dotnet test && npm test
git add <changed-files>
git commit -m "refactor: remove dead code and unused imports"
```

### Error Handling for Cleanup

If tests fail after any cleanup category: **revert that category's changes** and continue with the next category. Do not leave broken code.

```bash
git checkout -- .   # revert failed category
```

---

## Layer 1: AI Code Review (Small+ Tiers)

Announce: `Running Layer 1: AI Code Review...`

**YOU MUST spawn an Agent tool call here with `subagent_type: "envoy:code-reviewer"`. Inline review without spawning an agent is wrong. Do not skip this.**

**If you do not spawn an Agent tool call, STOP — do not proceed to Layer 2.**

Spawn a fresh **Sonnet** agent with NO implementation context. The agent uses **iterative retrieval** to understand codebase context:

```
Agent({
  subagent_type: "envoy:code-reviewer",
  model: "sonnet",
  description: "AI code review",
  prompt: `You are reviewing code changes. Context provided via files, not inline.

  FIRST: Read contexts/iterative-retrieval.md for the retrieval protocol.

  **Pre-scored file relevance (from dependency analysis):**
  ${relevanceBriefing}

  Use these scores to guide your retrieval — start with 'full' and 'focused'
  files, then expand if needed:
  1. Read git diff main...HEAD
  2. Read 'full' relevance files first, then 'focused' files
  3. If <3 files scored >=0.7 after reading pre-scored files, follow one more hop
  4. Stop when 3+ files have relevance >=0.7 or 3 cycles done

  Report your retrieval context before reviewing.

  Also read:
  - <spec-path> (acceptance criteria)
  - <stack-common-mistakes> (patterns to check)

  Focus areas:
  1. Spec/acceptance criteria compliance
  2. TDD verification: git log shows test commits before implementation?
  3. Codebase pattern consistency (informed by retrieved context)
  4. Stack profile common mistakes

  DO NOT check (GitHub CodeRabbit handles these on the PR):
  - Style, naming, formatting
  - Security basics
  - Common language mistakes
  - Performance anti-patterns

  Tools allowed: Read, Grep, Glob ONLY (read-only review)

  Output format:
  **Retrieval context:**
  - <file> (<score>) — <reason>

  **Review findings:**
  - Pass: <description>
  - Concern: <file>:<line> — <description>
  - Issue: <file>:<line> — <description>
  `
})
```

### Apply Fixes from Layer 1

For each finding:
- **Obvious fixes** — apply immediately
- **Ambiguous** — present to user for decision

```bash
git add <fixed-files>
git commit -m "fix: address review findings

- <fix 1>
- <fix 2>"
```

### If Layer 1 Produced Fixes: Re-run Layer 0.5

When Layer 1 fixes introduce new code, re-run cleanup but **scoped to files changed by Layer 1 fixes only**. Same five categories, same order, same test-after-each rule. This prevents review fixes from introducing new slop.

```bash
# Get files changed by Layer 1 fixes
L1_FILES=$(git diff --name-only HEAD~1)
```

Run the cleanup agent again with the diff scoped to these files. Commit messages use the same pattern but this pass appears as "0.5 re-run" in the report.

---

## Layer 2: Visual Review (Medium+ Tiers)

Announce: `Running Layer 2: Visual Review...`

Invoke `envoy:visual-review` for Chrome DevTools verification.

1. **Identify affected pages** from changed files
2. **For each affected page:**
   - Navigate to page
   - Take screenshot
   - Check console for errors
   - Check network for failures
3. **Test user flows** from acceptance criteria
4. **App health check:**
   ```bash
   curl -sf http://localhost:5000/health && echo "Backend OK" || echo "Backend DOWN"
   curl -sf http://localhost:5173 && echo "Frontend OK" || echo "Frontend DOWN"
   ```

Fix console errors, network failures, and visual bugs before proceeding. Commit fixes.

---

## Layer 3: Documentation (Medium+ Tiers)

Announce: `Running Layer 3: Documentation...`

Invoke `envoy:docstrings` for public API documentation.

Scope: only changed files that have public APIs. Filter to code files:
- C#: `*.cs` (exclude `*.Designer.cs`, `Migrations/`)
- TypeScript: `*.ts`, `*.tsx` (exclude `*.d.ts`, `*.spec.ts`, `*.test.ts`)

Skip if no changed files have public APIs.

---

## Complexity Tier Mapping

| Tier | Layers |
|------|--------|
| Trivial | 0 only |
| Small | 0, 0.5, 1 |
| Medium | 0, 0.5, 1, 2, 3 |
| Large | 0, 0.5, 1 (deep), 2, 3 |

"Deep" Layer 1 for Large tier means: increase iterative retrieval to full 3 cycles, expand to 'skim' relevance files, and follow additional import chain hops.

---

## Report

```
**Review complete**

| Layer | Status | Findings |
|-------|--------|----------|
| 0: Lint | ✓ / ✗ | N issues fixed |
| 0.5: Cleanup | ✓ / ⊘ | N items removed |
| 0.5 re-run | ✓ / ⊘ | N items removed (after L1 fixes) |
| 1: AI Review | ✓ / ⊘ | N findings, N fixed |
| 2: Visual | ✓ / ⊘ | N issues found |
| 3: Docs | ✓ / ⊘ | N APIs documented |

Complexity: <tier>
Ready for: /envoy:finalize
```

Use ⊘ for layers that were skipped due to tier.

---

## Integration with Envoy

Slot in workflow:
```
pickup → review → finalize
```

**Spawns (leaf subagents only — no nested spawning):**
- Layer 0.5: fresh cleanup agent (inline prompt)
- Layer 1: `envoy:code-reviewer`

**Invokes (via Skill tool):**
- Layer 2: `envoy:visual-review`
- Layer 3: `envoy:docstrings`

**Platform constraint:** Claude Code subagents cannot spawn subagents (the `Agent` tool is silently stripped from subagent tool allowlists). This skill therefore orchestrates directly rather than delegating to an execution agent.
