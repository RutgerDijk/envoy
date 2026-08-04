# Token Optimization

Token optimization is Envoy 2.0's #1 priority. Every design decision considers token cost.

## Strategies

### 1. Sonnet for AI Review (~60% Cost Savings)

The AI review layer uses Sonnet instead of Opus. Sonnet is sufficient for:
- Spec compliance checking
- TDD verification (git log analysis)
- Codebase pattern consistency
- Stack profile common mistakes

CodeRabbit (zero tokens from us) handles style, security, and common language mistakes.

### 2. Selective Stack Loading

Old approach: load entire stack profile (~500 lines per stack, multiple stacks).

New approach:
- Only load stacks for files that actually changed (`detectStacksFromDiff`)
- Only load the needed section (`loadStackSection`)
- Reviews load "Common Mistakes" only
- Implementation loads "Best Practices" only

Savings: 70-90% fewer stack profile tokens per session.

### 3. Complexity Tiers

Not every change needs the full pipeline:

| Tier | Criteria | What Runs |
|------|----------|-----------|
| Trivial | Docs/config only | Lint only |
| Small | 1-3 code files | Lint + Sonnet AI |
| Medium | 4-10 files | Full 4-layer review |
| Large | 10+ files | Full review with extra scrutiny |

A typo fix doesn't need a Sonnet reviewer.

### 4. Batched Lint (Hook-Based)

Without batching: Claude runs `npm run lint` after every edit → N lint outputs in context window.

With the post-edit-accumulator + stop-batch-lint hooks: lint runs once at the end across all files. One output instead of N.

### 5. Regex-First CodeRabbit Parsing

95%+ of CodeRabbit comments follow structured patterns. `lib/coderabbit-parser.js` extracts file path, line, severity, and suggestion using regex. Only malformed comments (confidence < 0.95) get sent to a Haiku agent.

Token cost for parsing 10 comments:
- Old (all LLM): ~5,000 tokens
- New (regex + 1 Haiku fallback): ~500 tokens

### 6. Skill Descriptions Under 30 Words

All 23 skill descriptions are trimmed to triggering conditions only — no workflow summaries. This reduces the token overhead of skill discovery.

### 7. Context Fragments

Phase-specific context files (~15-20 lines each) loaded dynamically:
- `contexts/review.md` — read-only tools, finding format
- `contexts/implement.md` — TDD cycle, commit pattern
- `contexts/research.md` — exploration constraints

Only the relevant fragment loads, not all three.

### 8. Async Hooks

Cost tracker and learning extractor run asynchronously at Stop. They never block and never inject output into Claude's context.

### 9. Review/Finalize Separation

Old approach: finalize re-ran all local reviews (duplicate tokens).

New approach: `/review` runs locally, `/finalize` only handles PR + GitHub CodeRabbit. Zero duplication.

### 10. Learning-Based Prevention

Patterns that recur across reviews are loaded into implementing agents as reminders, preventing issues before they happen:

| Scenario | Without Learning | With Learning | Savings |
|----------|-----------------|---------------|---------|
| Known pattern caught in review | ~500 tokens (find + fix) | ~0 (prevented at impl) | 100% |
| Recurring CodeRabbit comment | ~200 tokens/PR (parse + fix) | ~0 (prevented or automated) | 100% |
| User repeating same correction | Full correction each time | ~0 (loaded as context) | 100% |

New costs: ~100 tokens per loaded pattern, ~200 tokens per Haiku correction classification. Net effect is strongly positive after 2-3 review cycles.

### 11. LITM-Aware Prompt Structuring

**Lib:** `lib/context-budget.js`

Based on "Lost in the Middle" (Liu et al., 2023), LLMs attend most to the beginning and end of context. `buildAgentPrompt()` orders sections for Claude's attention curve (begin=0.92, middle=0.50, end=0.88):

- **Beginning (high attention):** Objective, constraints
- **Middle (low attention):** Reference material, stack profiles, examples
- **End (high attention):** Acceptance criteria, known patterns

Used by `envoy-authoring` (dispatching-parallel-agents step) and `pickup`.

### 12. Shell Output Compression

**Lib:** `lib/output-compressor.js`

Strips noise from verbose CLI output before it enters context. 11 command patterns (dotnet build/test, npm, jest, playwright, cargo, git, docker). A safeguard ratio prevents over-compression (if compressed < 15% of original, returns original).

Used by `review` during build/test verification.

### 13. Task-Aware File Relevance

**Lib:** `lib/relevance-scorer.js`

Walks import chains from changed files and scores dependencies via heat diffusion. Recommends read depth (full/focused/skim/skip) so reviewers and agents read deeply what matters and skip what doesn't.

Used by `pickup` (agent context) and `review` (reviewer guidance).

## Measuring Token Usage

Use `/envoy:costs` to view token usage from Claude Code's native session logs:

```
/envoy:costs              — Last 7 days
/envoy:costs --days 30    — Last 30 days
/envoy:costs --branch X   — Filter by branch
```

Shows breakdown by **activity** (skill/agent), **model** (opus/sonnet/haiku), **branch**, and **session**. See [[Context Efficiency#Cost Reporter]] for details.
