# Advanced Patterns

Patterns that make autonomous agent workflows more reliable and efficient.

## Eval Harness

**Skill:** `envoy:eval-harness`

Automated skill testing. Define scenarios in YAML, run them as subagents, get pass/fail metrics.

```yaml
# tests/scenarios/test-driven-development.yml
skill: test-driven-development
scenarios:
  - name: "Resists writing code before tests"
    input: "Add a fibonacci function"
    expected:
      - "writes test file before implementation"
    failure:
      - "writes implementation before test"
```

Each scenario runs two subagents:
- **Baseline** (no skill) — what Claude does by default
- **With skill** — should exhibit expected behavior

Produces **pass@1** (first try) and **pass@3** (passes within 3 tries) metrics.

## Search-First

**Skill:** `envoy:search-first`

Before building anything, check if it already exists:

| Decision | When | Action |
|----------|------|--------|
| **Adopt** | Exact match exists | Install and use directly |
| **Extend** | 70%+ match exists | Thin wrapper |
| **Compose** | Multiple partial matches | Combine packages |
| **Build** | Nothing found | Implement from scratch |

Searches: existing codebase, npm/NuGet, GitHub. Evaluates maintenance status, downloads, bundle size, license.

Integrated with `executing-plans` — each task checks search-first before writing code.

## Cleanup Pass

**Skill:** `envoy:cleanup-pass`

A fresh agent reviews the diff and removes AI-generated slop:

| Category | Examples |
|----------|---------|
| Defensive checks | Null checks on required params, try/catch on non-throwing code |
| Over-engineering | Single-impl interfaces, premature generics, factory-for-new |
| Redundant tests | Mock-returns-mock, framework behavior tests |
| Comments | Restating the code, TODO for done items |
| Dead code | Unused imports, uncalled functions |

**Key principle:** Never add "don't do X" instructions to the implementing agent. That makes it hesitant. Let it code freely, then clean up.

Slot: `implement → cleanup-pass → review → finalize`

## Iterative Retrieval

Used by the Sonnet AI reviewer in `layered-review` Layer 1.

Instead of just reading the diff, the reviewer does up to 3 retrieval cycles:

1. **Cycle 1:** Read the diff, identify related files (imports, callers, shared types)
2. **Cycle 2:** Read those files, score relevance (0-1.0)
3. **Cycle 3:** If < 3 files scored >= 0.7, follow one more hop

Stops when 3+ files have relevance >= 0.7, or 3 cycles completed.

Since v2.2, the reviewer receives **pre-scored file relevance** from `lib/relevance-scorer.js` — giving it a head start on which files to read deeply vs. skim. See [[Context Efficiency#Relevance Scoring]].

Makes the reviewer codebase-aware instead of diff-only. Defined in `contexts/iterative-retrieval.md`.

## Agent Scratchpad Coordination

**Lib:** `lib/agent-scratchpad.js`

When multiple agents run in parallel (via `dispatching-parallel-agents` or `executing-plans` parallel strategy), they can coordinate through a shared scratchpad file (`.envoy-scratchpad.json`):

- **Register:** Each agent declares its role and file scope
- **Post findings:** Discoveries, conflicts, dependencies, questions
- **Check ownership:** Prevents two agents from editing the same file
- **Read unread:** Agents see others' discoveries to avoid duplicating work

The orchestrator checks `scratchpad.getConflicts(pad)` after agents complete, before integrating changes.

## Session State Continuity

**Lib:** `lib/session-state.js`

Persists task progress, decisions, files modified, and test results to `.envoy-session.json`. Survives context compaction and session restarts.

`session-start.sh` auto-detects this file and surfaces progress (~300-500 tokens vs 10K+ cold start). `finishing-branch` clears it when the branch ships.

See [[Context Efficiency]] for the full picture.

## Completion Signal Threshold

**Lib:** `lib/loop-safeguards.js`

A single "I'm done" from an agent could be hallucinated. Three consecutive `ENVOY_LOOP_COMPLETE` signals with fresh evidence confirm genuine completion.

```
counter = 0

while counter < 3:
  1. Run verification
  2. If passes: output ENVOY_LOOP_COMPLETE, counter += 1
  3. If fails: counter = 0, fix the issue
```

Applied in:
- Fix-and-verify cycles (`verification` skill)
- CodeRabbit re-poll cycles (`finishing-branch` skill)
- Any autonomous polling loop

## Graduated Learning

**Lib:** `lib/learning-loader.js`, `hooks/learning-extractor.js`

Patterns from AI review and CodeRabbit graduate through levels based on occurrence count:

| Level | Trigger | Action |
|-------|---------|--------|
| Detected | Seen 1x | Logged in `memory/review-learnings.md` |
| Confirmed | Seen 3x | Injected into implementing agent prompt |
| Automated | Seen 5x | Suggest hook/lint rule to user |
| Archived | 5 clean reviews | Removed from active patterns |

Confirmed patterns are loaded by `executing-plans` before each task:
```
Known patterns (avoid these):
- [dotnet] Always check null on API response DTOs before mapping
- [react] Use useCallback for event handlers passed as props
```

Archived patterns that reappear get re-promoted to detected, restarting the graduation cycle.

## Cross-PR CodeRabbit Aggregation

**Hook:** `hooks/coderabbit-aggregator.js`

Async Stop hook that runs after finalize sessions. Tracks which CodeRabbit comment categories recur across PRs and graduates them through the same levels.

```
PR #3: CodeRabbit flags "unused import" (2x), "missing await" (1x)
PR #4: CodeRabbit flags "unused import" (3x)
  → "unused import": 2 PRs → detected → logged
  → After 1 more PR: 3 PRs → confirmed → implementation reminder
```

Storage: `memory/coderabbit-patterns.md`, tagged with stack for selective loading.

## User Correction Learning

**Hook:** `hooks/correction-detector.js`

UserPromptSubmit hook that classifies user messages via Haiku:
- **Is this a correction?** (yes/no)
- **Scope?** project-specific or universal
- **One-line rule summary**

Project corrections → `memory/corrections.md` (team-shared, committed)
User corrections → `~/.claude/learnings/corrections.md` (personal)

Both are loaded by `executing-plans` and `layered-review` to avoid repeating the same mistakes.

## Regex-First Parsing

**Lib:** `lib/coderabbit-parser.js`

95%+ of CodeRabbit comments follow structured patterns. Parse with regex first:
- File path from `.path` field
- Line number from `.line` field
- Severity from emoji markers or `[severity]` tags
- Suggestion from ` ```suggestion ``` ` blocks

Only send to Haiku (cheap LLM) when regex confidence < 0.95. Massive token savings.
