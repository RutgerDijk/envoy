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
context: fork
---

## Briefing

!`node ${CLAUDE_SKILL_DIR}/preflight.js`

### Checklist

- [ ] Layer 0: Lint (`layers/lint.md`)
- [ ] Layer 0.5: Cleanup pass (`layers/cleanup.md`)
- [ ] Layer 1: AI code review (`layers/ai-review.md`)
- [ ] Layer 2: Visual review (`layers/visual.md`)
- [ ] Layer 3: Documentation (`layers/docs.md`)

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

### 4. Inputs produced by preflight

The inline `## Briefing` at the top of this skill runs `preflight.js`, which:

- Validates the pickup handoff at `.envoy/pickup/handoff-to-review.json`
- Writes `.envoy/active-skill.json`
- Prints the issue number, branch, diff range, and stack profiles

You do NOT need to invoke library utilities yourself — preflight is the
single source of truth for relevance scoring, stack detection, review
learnings, and output compression. Consume its briefing; treat
`.envoy/pickup/handoff-to-review.json` as the contract.

### 5. Load Discipline Contexts

Load shared discipline content once; reuse in subagent prompts:

```bash
EXECUTION_ANNOUNCE=$(cat contexts/execution-announce.md)
```

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

## Write the finalize handoff

Write `.envoy/review/handoff-to-finalize.json` conforming to `lib/schemas/handoff-review-to-finalize.json`:

```javascript
const handoff = {
  $schemaVersion: '1',
  issueNumber: handoffIn.issueNumber,
  branch: handoffIn.branch,
  reviewStatus: allLayersPassed ? 'approved' : 'needs-fixes',
  layers: [
    { name: 'lint', status: 'passed', findings: 0 },
    { name: 'cleanup', status: 'fixed', findings: cleanupCount },
    { name: 'ai-review', status: 'fixed', findings: reviewCount },
    { name: 'visual', status: visualStatus, findings: 0 },
    { name: 'docs', status: docsStatus, findings: 0 },
  ],
  commitShas: git.log('main..HEAD'),
  producedAt: new Date().toISOString(),
};

fs.mkdirSync('.envoy/review', { recursive: true });
fs.writeFileSync('.envoy/review/handoff-to-finalize.json', JSON.stringify(handoff, null, 2));

require('../../lib/ledger').appendEvent(process.cwd(), { type: 'handoff-written', from: 'review', to: 'finalize' });
```

Finalize preflight requires `reviewStatus === "approved"`; any other value blocks finalize.

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
