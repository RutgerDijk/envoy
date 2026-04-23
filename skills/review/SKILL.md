---
name: review
description: Review expert. ALWAYS invoke when the /envoy:review command fires or after implementation is complete and before creating a PR. Runs layered review (lint, cleanup, AI review, visual, docs). Do not perform inline review.
when_to_use:
  - After implementation is complete and before creating a PR
  - When the user types /envoy:review
  - When /envoy:pickup hands off by writing .envoy/pickup/handoff-to-review.json
  - Before /envoy:finalize
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - Skill
  - Agent
  - WebFetch
model: opus
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

## Layers

Each layer is documented in its own file. Execute them in order for the tier:

| Layer | File | When |
|-------|------|------|
| 0: Lint | `layers/lint.md` | All tiers |
| 0.5: Cleanup | `layers/cleanup.md` | All tiers except trivial |
| 1: AI Review | `layers/ai-review.md` | Small+ tiers |
| 2: Visual | `layers/visual.md` | Medium+ tiers |
| 3: Docs | `layers/docs.md` | Medium+ tiers |

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
